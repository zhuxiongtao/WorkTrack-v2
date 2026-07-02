"""付款申请：供应商付款 / 员工报销 / 工资 / 其他付款。

无草稿概念：新建即校验必填项 + 立即提交审批，不存在「保存未提交」的中间态。
已驳回 / 已撤回的申请可编辑，编辑同样是「改完立即重新提交」的单一动作。
发起仅需登录；列表默认只看自己的，持 payment:view_all（财务/出纳/老板/管理员）可看全部。
审批走统一引擎 business_type="payment"，末节点「出纳付款」为执行节点。
"""
import json
import logging
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.payment import PaymentRequest
from app.models.contract import Contract
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.schemas.payment import PaymentCreate, PaymentUpdate, PaymentOut
from app.services import approval_engine
from app.routers.logs import write_log

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/payments", tags=["付款申请"])

PAYMENT_TYPES = ["供应商付款", "员工报销", "工资", "其他"]
# 审批中 / 已付款不可再编辑或删除；已驳回 / 已撤回可编辑后重新提交
_LOCKED_STATUSES = {"审批中", "已付款"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "payment:view_all", db)


def _validate_payment_fields(payment_type: str, title: str, contract_id: Optional[int], attachments: Optional[str]) -> None:
    """必填项校验：创建和编辑（重新提交）都必须通过，不允许保存不完整的数据。"""
    if not title or not title.strip():
        raise HTTPException(400, "请填写付款摘要")
    if payment_type == "供应商付款":
        if not contract_id:
            raise HTTPException(400, "供应商付款必须关联相关合同")
        try:
            atts = json.loads(attachments) if attachments else []
        except (TypeError, ValueError):
            atts = []
        if not atts:
            raise HTTPException(400, "供应商付款必须上传账单明细")


def _submit_to_approval(p: PaymentRequest, current_user: User, db: Session) -> None:
    """创建或编辑后立即提交审批（无草稿概念，保存即提交）。失败时抛 HTTPException，由调用方决定是否回滚。"""
    if approval_engine.get_active_instance("payment", p.id, db):
        raise HTTPException(400, "该付款申请已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "payment", p.id, p, f"付款申请《{p.title}》", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if inst is None:
        # 无匹配模板：直接置已付款（理论上不会发生，付款流为无条件触发）
        p.status = "已付款"
    elif inst.status == "pending":
        p.status = "审批中"
    p.updated_at = now()
    db.add(p)
    db.commit()
    db.refresh(p)


def _to_out(p: PaymentRequest, name_map: dict, contract_map: dict) -> PaymentOut:
    return PaymentOut(
        id=p.id, user_id=p.user_id, user_name=name_map.get(p.user_id),
        payment_type=p.payment_type, title=p.title, amount=p.amount,
        currency=p.currency, payee=p.payee, payee_account=p.payee_account,
        reason=p.reason, contract_id=p.contract_id,
        contract_title=contract_map.get(p.contract_id),
        attachments=p.attachments, status=p.status,
        created_at=p.created_at, updated_at=p.updated_at,
    )


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


def _contract_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    cs = db.exec(select(Contract).where(Contract.id.in_(ids))).all()
    return {c.id: c.title for c in cs}


@router.get("/types")
def list_types():
    return {"types": PAYMENT_TYPES}


@router.get("", response_model=list[PaymentOut])
def list_payments(
    scope: str = Query("mine", description="mine=我发起的；all=全部（需 view_all）"),
    status: Optional[str] = Query(None),
    payment_type: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(PaymentRequest).order_by(PaymentRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(PaymentRequest.user_id == current_user.id)
    if status:
        query = query.where(PaymentRequest.status == status)
    if payment_type:
        query = query.where(PaymentRequest.payment_type == payment_type)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.title or "").lower() or kw in (r.payee or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows])
    cm = _contract_map(db, [r.contract_id for r in rows if r.contract_id])
    return [_to_out(r, nm, cm) for r in rows]


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(payment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(PaymentRequest, payment_id)
    if not p:
        raise HTTPException(404, "付款申请不存在")
    if p.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该付款申请")
    nm = _name_map(db, [p.user_id])
    cm = _contract_map(db, [p.contract_id] if p.contract_id else [])
    return _to_out(p, nm, cm)


@router.post("", response_model=PaymentOut)
def create_payment(body: PaymentCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """新建付款申请：必填项校验通过后立即创建并提交审批，一步到位，没有草稿态。"""
    payment_type = body.payment_type or "其他"
    title = (body.title or "").strip()
    _validate_payment_fields(payment_type, title, body.contract_id, body.attachments)
    p = PaymentRequest(
        user_id=current_user.id,
        payment_type=payment_type,
        title=title,
        amount=body.amount or 0,
        amount_unit=body.amount_unit or "元",
        currency=body.currency or "CNY",
        payee=body.payee or "",
        payee_account=body.payee_account,
        reason=body.reason or "",
        contract_id=body.contract_id,
        attachments=body.attachments,
        status="审批中",  # 占位，_submit_to_approval 会立即覆盖为真实状态
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    try:
        _submit_to_approval(p, current_user, db)
    except HTTPException:
        # 提交审批失败：整条记录一并回滚，不留下任何未提交的孤儿数据
        db.delete(p)
        db.commit()
        raise
    write_log("info", "payment", f"用户 {current_user.username} 新建付款申请 #{p.id}（{p.title}）并提交审批", db=db)
    nm = _name_map(db, [p.user_id])
    cm = _contract_map(db, [p.contract_id] if p.contract_id else [])
    return _to_out(p, nm, cm)


@router.put("/{payment_id}", response_model=PaymentOut)
def update_payment(payment_id: int, body: PaymentUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """编辑付款申请：仅已驳回/已撤回可编辑，保存即重新提交审批，没有「只保存不提交」的中间态。"""
    p = db.get(PaymentRequest, payment_id)
    if not p:
        raise HTTPException(404, "付款申请不存在")
    if p.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该付款申请")
    if p.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{p.status}状态下不可编辑")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(p, k, v)
    _validate_payment_fields(p.payment_type, p.title, p.contract_id, p.attachments)
    p.updated_at = now()
    db.add(p)
    db.commit()
    db.refresh(p)
    _submit_to_approval(p, current_user, db)
    write_log("info", "payment", f"付款申请 #{payment_id} 修改后重新提交审批", db=db)
    nm = _name_map(db, [p.user_id])
    cm = _contract_map(db, [p.contract_id] if p.contract_id else [])
    return _to_out(p, nm, cm)


@router.delete("/{payment_id}")
def delete_payment(payment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(PaymentRequest, payment_id)
    if not p:
        raise HTTPException(404, "付款申请不存在")
    if p.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该付款申请")
    if p.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{p.status}状态下不可删除")
    db.delete(p)
    db.commit()
    write_log("info", "payment", f"付款申请 #{payment_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{payment_id}/revoke-approval")
def revoke_payment_approval(payment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(PaymentRequest, payment_id)
    if not p:
        raise HTTPException(404, "付款申请不存在")
    inst = approval_engine.get_active_instance("payment", payment_id, db)
    if not inst:
        raise HTTPException(400, "该付款申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))
    db.refresh(p)
    write_log("info", "payment", f"付款申请 #{payment_id} 审批已撤回", db=db)
    return {"status": p.status, "message": "审批已撤回，可重新编辑"}
