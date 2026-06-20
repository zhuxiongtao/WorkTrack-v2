"""Token 三方对账 API

流程：
  1. POST /upload          上传供应商/MaaS/客户 Excel 账单
  2. GET  /{period}/uploads 查看已上传账单列表
  3. DELETE /upload/{id}   删除某份账单
  4. POST /{period}/compare 执行三方比对
  5. GET  /{period}/items  获取比对明细（按模型 ID）
  6. PATCH /item/{id}      人工标注某条明细（confirm / dispute）
  7. GET  /{period}/session 获取会话状态
  8. POST /{period}/submit-review 提交审批
"""
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth import get_current_user
from app.database import get_session
from app.models.bill_reconcile import (
    BillUpload, BillUploadRow, BillReconcileItem, BillReconcileSession
)
from app.models.user import User
from app.services import approval_engine
from app.services.bill_reconcile_service import parse_excel, run_compare

router = APIRouter(prefix="/api/v1/bill-reconcile", tags=["Token对账"])

SOURCE_TYPES = {"supplier", "maas", "customer"}
_LOCKED = {"approved"}


def _ensure_editable(session: BillReconcileSession) -> None:
    if session.status in _LOCKED:
        raise HTTPException(400, f"该月份对账已「{session.status}」，不可修改")


# ─── 账单上传 ────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_bill(
    period: str = Form(...),
    source_type: str = Form(...),
    source_name: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """上传一份账单 Excel（供应商/MaaS平台/客户）"""
    if source_type not in SOURCE_TYPES:
        raise HTTPException(400, f"source_type 必须是: {', '.join(SOURCE_TYPES)}")
    if not period or len(period) != 7 or period[4] != '-':
        raise HTTPException(400, "period 格式应为 YYYY-MM")
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, "仅支持 .xlsx / .xls 格式")

    # 检查该月份是否已锁定
    existing_session = db.exec(
        select(BillReconcileSession).where(BillReconcileSession.period == period)
    ).first()
    if existing_session and existing_session.status in _LOCKED:
        raise HTTPException(400, f"月份 {period} 已完成审批锁定，无法上传新账单")

    file_bytes = await file.read()
    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(400, "文件不得超过 20MB")

    try:
        upload = parse_excel(
            file_bytes=file_bytes,
            period=period,
            source_type=source_type,
            source_name=source_name,
            uploaded_by=current_user.id,
            filename=file.filename,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    return _upload_out(upload)


@router.get("/upload/{upload_id}/rows")
def get_upload_rows(
    upload_id: int,
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """查看某份账单的解析明细（前 200 行）"""
    upload = db.get(BillUpload, upload_id)
    if not upload:
        raise HTTPException(404, "账单不存在")
    rows = db.exec(
        select(BillUploadRow).where(BillUploadRow.upload_id == upload_id).limit(200)
    ).all()
    return [
        {
            "id": r.id,
            "model_id": r.model_id,
            "model_name": r.model_name,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "cache_read_tokens": r.cache_read_tokens,
            "cache_write_tokens": r.cache_write_tokens,
            "total_tokens": r.total_tokens,
            "amount": r.amount,
        }
        for r in rows
    ]


@router.delete("/upload/{upload_id}")
def delete_upload(
    upload_id: int,
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """删除某份账单（若对应月份已锁定则拒绝）"""
    upload = db.get(BillUpload, upload_id)
    if not upload:
        raise HTTPException(404, "账单不存在")
    s = db.exec(
        select(BillReconcileSession).where(BillReconcileSession.period == upload.period)
    ).first()
    if s and s.status in _LOCKED:
        raise HTTPException(400, "该月份已锁定，无法删除账单")
    # 删除关联行
    rows = db.exec(select(BillUploadRow).where(BillUploadRow.upload_id == upload_id)).all()
    for r in rows:
        db.delete(r)
    db.delete(upload)
    db.commit()
    return {"ok": True}


# ─── 月份视图 ────────────────────────────────────────────────────────────────

@router.get("/periods")
def list_periods(
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """列出所有有账单数据的月份"""
    periods = db.exec(select(BillUpload.period).distinct()).all()
    return sorted(set(periods), reverse=True)


@router.get("/{period}/uploads")
def list_uploads(
    period: str,
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """查看某月份的所有已上传账单"""
    uploads = db.exec(
        select(BillUpload).where(BillUpload.period == period)
        .order_by(BillUpload.created_at)
    ).all()
    return [_upload_out(u) for u in uploads]


@router.get("/{period}/session")
def get_session_status(
    period: str,
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """查看对账会话状态"""
    s = db.exec(select(BillReconcileSession).where(BillReconcileSession.period == period)).first()
    if not s:
        return None
    return _session_out(s)


@router.post("/{period}/compare")
def compare(
    period: str,
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """执行三方对账比对（覆盖上次结果）"""
    existing = db.exec(
        select(BillReconcileSession).where(BillReconcileSession.period == period)
    ).first()
    if existing and existing.status in _LOCKED:
        raise HTTPException(400, "该月份已完成审批，无法重新比对")

    try:
        session = run_compare(period, db)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _session_out(session)


@router.get("/{period}/items")
def list_items(
    period: str,
    only_diff: bool = False,
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """获取对账明细（按模型ID）。only_diff=true 只返回有差异的行。"""
    s = db.exec(select(BillReconcileSession).where(BillReconcileSession.period == period)).first()
    if not s:
        raise HTTPException(404, "请先执行比对")
    query = select(BillReconcileItem).where(BillReconcileItem.session_id == s.id)
    if only_diff:
        query = query.where(
            (BillReconcileItem.has_supplier_diff == True)
            | (BillReconcileItem.has_customer_diff == True)
        )
    items = db.exec(query.order_by(BillReconcileItem.model_id)).all()
    return [_item_out(i) for i in items]


class ReviewPatch(BaseModel):
    review_status: str          # confirmed | disputed
    review_note: Optional[str] = None


@router.patch("/item/{item_id}")
def review_item(
    item_id: int,
    body: ReviewPatch,
    db: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """人工标注单条对账明细（确认/争议）"""
    item = db.get(BillReconcileItem, item_id)
    if not item:
        raise HTTPException(404, "明细不存在")
    if body.review_status not in ("confirmed", "disputed", "pending"):
        raise HTTPException(400, "review_status 须为 confirmed / disputed / pending")
    item.review_status = body.review_status
    item.review_note = body.review_note
    item.updated_at = datetime.now(timezone.utc)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_out(item)


@router.post("/{period}/submit-review")
def submit_review(
    period: str,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """提交审批：有差异 → 走审批流；无差异 → 直接 approved"""
    s = db.exec(select(BillReconcileSession).where(BillReconcileSession.period == period)).first()
    if not s:
        raise HTTPException(404, "请先执行比对")
    if s.status not in ("compared", "draft"):
        raise HTTPException(400, f"当前状态「{s.status}」不可提交审批")
    if approval_engine.get_active_instance("bill_reconcile", s.id, db):
        raise HTTPException(400, "已有进行中的审批，请勿重复提交")

    now = datetime.now(timezone.utc)
    total_diff = s.diff_supplier_count + s.diff_customer_count

    if total_diff == 0:
        # 无差异 → 直接通过
        s.status = "approved"
        s.updated_at = now
        db.add(s)
        db.commit()
        return {"message": "无差异，已自动确认通过", "status": "approved", "approval_instance_id": None}

    try:
        instance = approval_engine.start_approval(
            target_type="bill_reconcile",
            target_id=s.id,
            target_obj=s,
            title=f"Token对账审批 {period}（供应商差异 {s.diff_supplier_count} 个模型，客户差异 {s.diff_customer_count} 个模型）",
            submitter=current_user,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if instance is None:
        # 无审批模板 → 直接通过
        s.status = "approved"
        s.updated_at = now
        db.add(s)
        db.commit()
        return {"message": "无审批模板配置，已直接确认", "status": "approved", "approval_instance_id": None}

    s.status = "pending_review"
    s.approval_instance_id = instance.id
    s.updated_at = now
    db.add(s)
    db.commit()
    db.refresh(s)
    return {
        "message": f"已提交审批，存在 {total_diff} 个模型差异需要确认",
        "status": s.status,
        "approval_instance_id": instance.id,
    }


# ─── 序列化辅助 ──────────────────────────────────────────────────────────────

def _upload_out(u: BillUpload) -> dict:
    return {
        "id": u.id,
        "period": u.period,
        "source_type": u.source_type,
        "source_name": u.source_name,
        "filename": u.filename,
        "row_count": u.row_count,
        "status": u.status,
        "parse_error": u.parse_error,
        "uploaded_by": u.uploaded_by,
        "created_at": u.created_at,
    }


def _session_out(s: BillReconcileSession) -> dict:
    return {
        "id": s.id,
        "period": s.period,
        "status": s.status,
        "model_count": s.model_count,
        "diff_supplier_count": s.diff_supplier_count,
        "diff_customer_count": s.diff_customer_count,
        "has_maas_bill": s.has_maas_bill,
        "has_supplier_bill": s.has_supplier_bill,
        "has_customer_bill": s.has_customer_bill,
        "notes": s.notes,
        "approval_instance_id": s.approval_instance_id,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


def _item_out(i: BillReconcileItem) -> dict:
    return {
        "id": i.id,
        "session_id": i.session_id,
        "period": i.period,
        "model_id": i.model_id,
        "model_name": i.model_name,
        "maas_input_tokens": i.maas_input_tokens,
        "maas_output_tokens": i.maas_output_tokens,
        "maas_cache_read_tokens": i.maas_cache_read_tokens,
        "maas_cache_write_tokens": i.maas_cache_write_tokens,
        "maas_total_tokens": i.maas_total_tokens,
        "supplier_input_tokens": i.supplier_input_tokens,
        "supplier_output_tokens": i.supplier_output_tokens,
        "supplier_total_tokens": i.supplier_total_tokens,
        "customer_input_tokens": i.customer_input_tokens,
        "customer_output_tokens": i.customer_output_tokens,
        "customer_total_tokens": i.customer_total_tokens,
        "supplier_diff_tokens": i.supplier_diff_tokens,
        "supplier_diff_pct": i.supplier_diff_pct,
        "has_supplier_diff": i.has_supplier_diff,
        "customer_diff_tokens": i.customer_diff_tokens,
        "customer_diff_pct": i.customer_diff_pct,
        "has_customer_diff": i.has_customer_diff,
        "review_status": i.review_status,
        "review_note": i.review_note,
        "created_at": i.created_at,
        "updated_at": i.updated_at,
    }
