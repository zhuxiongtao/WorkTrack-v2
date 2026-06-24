"""对账（Reconcile）API：销售对账 + 供应对账 + 财务总账 + 差异分析

业务流程：月初由财务/业务对账员手动录入本期各项目/通道的调用量与金额，
系统自动计算应收/应付/毛利/差异，生成可对账的明细。
"""
from collections import defaultdict
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from app.database import get_session
from app.models.reconcile import ReconcileSales, ReconcileSupply, ReconcileSummary, ReconcileDiff
from app.models.project import Project
from app.models.channel import Channel
from app.models.supplier import Supplier
from app.schemas.reconcile import (
    ReconcileSalesCreate, ReconcileSalesUpdate, ReconcileSalesOut,
    ReconcileSupplyCreate, ReconcileSupplyUpdate, ReconcileSupplyOut,
    ReconcileSummaryOut,
    ReconcileDiffCreate, ReconcileDiffUpdate, ReconcileDiffOut,
    ReconcileOverallSummary,
)
from app.auth import require_permission
from app.services import approval_engine
from app.utils.time import BEIJING_TZ, now

router = APIRouter(prefix="/api/v1/reconcile", tags=["对账核算"])

_LOCKED_STATUSES = {"已复核", "已锁定"}


def _ensure_period_editable(period: str, db: Session) -> None:
    """若该月份的总账已进入复核/锁定状态，禁止修改任何明细"""
    summary = db.exec(select(ReconcileSummary).where(ReconcileSummary.period == period)).first()
    if summary and summary.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"该月份（{period}）已处于「{summary.status}」状态，不可修改明细")


# ──── 销售对账 ────

@router.get("/sales", response_model=list[ReconcileSalesOut])
def list_reconcile_sales(
    period: Optional[str] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:read")),
):
    """销售对账列表（按 period + project_id 筛选）"""
    query = select(ReconcileSales).order_by(ReconcileSales.period.desc(), ReconcileSales.id)
    if period:
        query = query.where(ReconcileSales.period == period)
    if project_id:
        query = query.where(ReconcileSales.project_id == project_id)
    return db.exec(query).all()


@router.post("/sales", response_model=ReconcileSalesOut)
def create_reconcile_sales(
    body: ReconcileSalesCreate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    _ensure_period_editable(body.period, db)
    if db.get(Project, body.project_id) is None:
        raise HTTPException(400, f"项目 {body.project_id} 不存在")
    obj = ReconcileSales(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/sales/{rid}", response_model=ReconcileSalesOut)
def update_reconcile_sales(
    rid: int,
    body: ReconcileSalesUpdate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    obj = db.get(ReconcileSales, rid)
    if not obj:
        raise HTTPException(404, "记录不存在")
    _ensure_period_editable(obj.period, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/sales/{rid}")
def delete_reconcile_sales(
    rid: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    obj = db.get(ReconcileSales, rid)
    if not obj:
        raise HTTPException(404, "记录不存在")
    _ensure_period_editable(obj.period, db)
    db.delete(obj)
    db.commit()
    return {"ok": True}


# ──── 供应对账 ────

@router.get("/supply", response_model=list[ReconcileSupplyOut])
def list_reconcile_supply(
    period: Optional[str] = None,
    channel_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:read")),
):
    query = select(ReconcileSupply).order_by(ReconcileSupply.period.desc(), ReconcileSupply.id)
    if period:
        query = query.where(ReconcileSupply.period == period)
    if channel_id:
        query = query.where(ReconcileSupply.channel_id == channel_id)
    if supplier_id:
        query = query.where(ReconcileSupply.supplier_id == supplier_id)
    return db.exec(query).all()


@router.post("/supply", response_model=ReconcileSupplyOut)
def create_reconcile_supply(
    body: ReconcileSupplyCreate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    _ensure_period_editable(body.period, db)
    if db.get(Channel, body.channel_id) is None:
        raise HTTPException(400, f"通道 {body.channel_id} 不存在")
    if db.get(Supplier, body.supplier_id) is None:
        raise HTTPException(400, f"供应商 {body.supplier_id} 不存在")
    channel = db.get(Channel, body.channel_id)
    if channel.supplier_id != body.supplier_id:
        raise HTTPException(400, f"通道 {body.channel_id} 不属于供应商 {body.supplier_id}")
    obj = ReconcileSupply(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/supply/{rid}", response_model=ReconcileSupplyOut)
def update_reconcile_supply(
    rid: int,
    body: ReconcileSupplyUpdate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    obj = db.get(ReconcileSupply, rid)
    if not obj:
        raise HTTPException(404, "记录不存在")
    _ensure_period_editable(obj.period, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/supply/{rid}")
def delete_reconcile_supply(
    rid: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    obj = db.get(ReconcileSupply, rid)
    if not obj:
        raise HTTPException(404, "记录不存在")
    _ensure_period_editable(obj.period, db)
    db.delete(obj)
    db.commit()
    return {"ok": True}


# ──── 财务总账 ────

@router.get("/summary", response_model=list[ReconcileSummaryOut])
def list_reconcile_summary(
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:read")),
):
    """总账列表（按月份）"""
    return db.exec(select(ReconcileSummary).order_by(ReconcileSummary.period.desc())).all()


@router.get("/summary/{period}", response_model=ReconcileSummaryOut)
def get_reconcile_summary(
    period: str,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:read")),
):
    obj = db.exec(select(ReconcileSummary).where(ReconcileSummary.period == period)).first()
    if not obj:
        raise HTTPException(404, "该月份总账未生成")
    return obj


@router.post("/summary/calculate/{period}")
def calculate_summary(
    period: str,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    """根据销售/供应对账自动汇总生成总账（已复核/已锁定状态禁止重算）"""
    _ensure_period_editable(period, db)
    sales = db.exec(select(ReconcileSales).where(ReconcileSales.period == period)).all()
    supply = db.exec(select(ReconcileSupply).where(ReconcileSupply.period == period)).all()
    diffs = db.exec(select(ReconcileDiff).where(ReconcileDiff.period == period)).all()

    total_revenue = sum(s.amount_due for s in sales)
    total_cost = sum(s.amount_payable for s in supply)
    invoice_count = sum(1 for s in sales if s.invoice_status == "已开票" or s.invoice_status == "已收款")
    paid_count = sum(1 for s in supply if s.bill_status == "已付款")
    diff_amount_total = sum(d.diff_amount for d in diffs)
    gross_profit = round(total_revenue - total_cost, 2)
    final_profit = gross_profit  # 测试成本留作扩展
    gross_margin = round((gross_profit / total_revenue * 100), 2) if total_revenue > 0 else None

    existing = db.exec(select(ReconcileSummary).where(ReconcileSummary.period == period)).first()
    if existing:
        existing.total_revenue = total_revenue
        existing.total_cost = total_cost
        existing.invoice_count = invoice_count
        existing.paid_count = paid_count
        existing.gross_profit = gross_profit
        existing.final_profit = final_profit
        existing.gross_margin = gross_margin
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    else:
        obj = ReconcileSummary(
            period=period,
            total_revenue=total_revenue,
            total_cost=total_cost,
            invoice_count=invoice_count,
            paid_count=paid_count,
            gross_profit=gross_profit,
            final_profit=final_profit,
            gross_margin=gross_margin,
            status="草稿",
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj


@router.post("/summary/{period}/submit-review")
def submit_reconcile_review(
    period: str,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    """提交月结复核：触发审批流（财务复核 → 总经理锁定）。
    若无匹配审批模板，直接置「已锁定」。"""
    summary = db.exec(select(ReconcileSummary).where(ReconcileSummary.period == period)).first()
    if not summary:
        raise HTTPException(404, f"月份 {period} 尚无总账，请先执行汇总计算")
    if summary.status != "草稿":
        raise HTTPException(400, f"当前状态为「{summary.status}」，只有草稿状态才可提交复核")
    if approval_engine.get_active_instance("reconcile_summary", summary.id, db):
        raise HTTPException(400, "已有进行中的复核审批，请勿重复提交")

    try:
        instance = approval_engine.start_approval(
            target_type="reconcile_summary",
            target_id=summary.id,
            target_obj=summary,
            title=f"对账月结复核 {period}",
            submitter=current_user,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    from datetime import datetime, timezone
    _now = now()

    if instance is None:
        # 无审批模板 → 直接锁定
        summary.status = "已锁定"
        summary.finalized_at = _now
        summary.updated_at = _now
        db.add(summary)
        db.commit()
        db.refresh(summary)
        return {"message": "无需审批，已直接锁定", "status": summary.status, "approval_instance_id": None}

    # 有审批流 → 置复核中
    summary.status = "已复核"
    summary.updated_at = _now
    db.add(summary)
    db.commit()
    db.refresh(summary)
    return {
        "message": "已提交复核，等待审批",
        "status": summary.status,
        "approval_instance_id": instance.id,
    }


# ──── 差异分析 ────

@router.get("/diff", response_model=list[ReconcileDiffOut])
def list_reconcile_diff(
    period: Optional[str] = None,
    project_id: Optional[int] = None,
    channel_id: Optional[int] = None,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:read")),
):
    query = select(ReconcileDiff).order_by(ReconcileDiff.period.desc(), ReconcileDiff.id)
    if period:
        query = query.where(ReconcileDiff.period == period)
    if project_id:
        query = query.where(ReconcileDiff.project_id == project_id)
    if channel_id:
        query = query.where(ReconcileDiff.channel_id == channel_id)
    return db.exec(query).all()


@router.post("/diff", response_model=ReconcileDiffOut)
def create_reconcile_diff(
    body: ReconcileDiffCreate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    _ensure_period_editable(body.period, db)
    if body.project_id is not None and db.get(Project, body.project_id) is None:
        raise HTTPException(400, f"项目 {body.project_id} 不存在")
    if body.channel_id is not None and db.get(Channel, body.channel_id) is None:
        raise HTTPException(400, f"通道 {body.channel_id} 不存在")
    obj = ReconcileDiff(**body.model_dump())
    if obj.sales_call_volume > 0:
        obj.diff_pct = round((obj.diff_volume / obj.sales_call_volume * 100), 2)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/diff/{rid}", response_model=ReconcileDiffOut)
def update_reconcile_diff(
    rid: int,
    body: ReconcileDiffUpdate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    obj = db.get(ReconcileDiff, rid)
    if not obj:
        raise HTTPException(404, "记录不存在")
    _ensure_period_editable(obj.period, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    # 重新计算 diff_pct
    if obj.sales_call_volume > 0:
        obj.diff_pct = round((obj.diff_volume / obj.sales_call_volume * 100), 2)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/diff/{rid}")
def delete_reconcile_diff(
    rid: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:edit")),
):
    obj = db.get(ReconcileDiff, rid)
    if not obj:
        raise HTTPException(404, "记录不存在")
    _ensure_period_editable(obj.period, db)
    db.delete(obj)
    db.commit()
    return {"ok": True}


# ──── 总览 ────

@router.get("/overall/{period}", response_model=ReconcileOverallSummary)
def get_overall(
    period: str,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:read")),
):
    """指定月份的对账总览（聚合销售 + 供应 + 差异）"""
    sales = db.exec(select(ReconcileSales).where(ReconcileSales.period == period)).all()
    supply = db.exec(select(ReconcileSupply).where(ReconcileSupply.period == period)).all()
    diffs = db.exec(select(ReconcileDiff).where(ReconcileDiff.period == period)).all()

    total_revenue = sum(s.amount_due for s in sales)
    total_cost = sum(s.amount_payable for s in supply)
    gross_profit = round(total_revenue - total_cost, 2)
    gross_margin = round((gross_profit / total_revenue * 100), 2) if total_revenue > 0 else None

    by_invoice_status: dict = defaultdict(float)
    for s in sales:
        by_invoice_status[s.invoice_status] = round(by_invoice_status[s.invoice_status] + s.amount_due, 2)
    by_bill_status: dict = defaultdict(float)
    for s in supply:
        by_bill_status[s.bill_status] = round(by_bill_status[s.bill_status] + s.amount_payable, 2)
    by_diff_type: dict = defaultdict(float)
    for d in diffs:
        by_diff_type[d.diff_type] = round(by_diff_type[d.diff_type] + d.diff_amount, 2)

    return ReconcileOverallSummary(
        period=period,
        total_revenue=round(total_revenue, 2),
        total_cost=round(total_cost, 2),
        gross_profit=gross_profit,
        gross_margin=gross_margin,
        invoice_count=len(sales),
        paid_count=len(supply),
        diff_count=len(diffs),
        diff_amount_total=round(sum(d.diff_amount for d in diffs), 2),
        by_invoice_status=dict(by_invoice_status),
        by_bill_status=dict(by_bill_status),
        by_diff_type=dict(by_diff_type),
    )


@router.get("/periods")
def list_periods(
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("reconcile:read")),
):
    """列出所有已有对账数据的月份（销售/供应/差异/总账 的并集）"""
    sales_p = db.exec(select(ReconcileSales.period).distinct()).all()
    supply_p = db.exec(select(ReconcileSupply.period).distinct()).all()
    diff_p = db.exec(select(ReconcileDiff.period).distinct()).all()
    summary_p = db.exec(select(ReconcileSummary.period).distinct()).all()
    all_periods = sorted(set(sales_p) | set(supply_p) | set(diff_p) | set(summary_p), reverse=True)
    return all_periods
