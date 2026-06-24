"""报销申请：差旅/交通/餐饮/办公用品/通讯/培训/其他。

发起仅需登录；列表默认只看自己的，持 expense:view_all 可看全部。
审批走统一引擎 business_type="expense"，通过后由出纳执行付款（执行节点）。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.expense_request import ExpenseRequest
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.schemas.expense import ExpenseCreate, ExpenseUpdate, ExpenseOut
from app.services import approval_engine
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/expenses", tags=["报销申请"])

EXPENSE_TYPES = ["差旅", "交通", "餐饮", "办公用品", "通讯", "培训", "其他"]
_LOCKED_STATUSES = {"审批中", "已批准", "已付款"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "expense:view_all", db)


def _can_pay(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "expense:pay", db)


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


def _to_out(e: ExpenseRequest, nm: dict) -> ExpenseOut:
    return ExpenseOut(
        id=e.id, user_id=e.user_id, user_name=nm.get(e.user_id),
        title=e.title, expense_type=e.expense_type,
        amount=e.amount, amount_unit=e.amount_unit, currency=e.currency,
        expense_date=e.expense_date, reason=e.reason, attachments=e.attachments,
        status=e.status, paid_at=e.paid_at, paid_by=e.paid_by,
        paid_by_name=nm.get(e.paid_by) if e.paid_by else None,
        created_at=e.created_at, updated_at=e.updated_at,
    )


@router.get("/types")
def list_types():
    return {"types": EXPENSE_TYPES}


@router.get("", response_model=list[ExpenseOut])
def list_expenses(
    scope: str = Query("mine"),
    status: Optional[str] = Query(None),
    expense_type: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(ExpenseRequest).order_by(ExpenseRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(ExpenseRequest.user_id == current_user.id)
    if status:
        query = query.where(ExpenseRequest.status == status)
    if expense_type:
        query = query.where(ExpenseRequest.expense_type == expense_type)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.title or "").lower() or kw in (r.reason or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows] + [r.paid_by for r in rows if r.paid_by])
    return [_to_out(r, nm) for r in rows]


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(404, "报销申请不存在")
    if e.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该报销申请")
    nm = _name_map(db, [e.user_id] + ([e.paid_by] if e.paid_by else []))
    return _to_out(e, nm)


@router.post("", response_model=ExpenseOut)
def create_expense(body: ExpenseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    if not body.title.strip():
        raise HTTPException(400, "请填写报销摘要")
    e = ExpenseRequest(
        user_id=current_user.id,
        title=body.title.strip(),
        expense_type=body.expense_type,
        amount=body.amount or 0,
        amount_unit=body.amount_unit or "元",
        currency=body.currency or "CNY",
        expense_date=body.expense_date,
        reason=body.reason or "",
        attachments=body.attachments,
        status="草稿",
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    write_log("info", "expense", f"用户 {current_user.username} 新建报销申请 #{e.id}（{e.title}）", db=db)
    nm = _name_map(db, [e.user_id])
    return _to_out(e, nm)


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(expense_id: int, body: ExpenseUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(404, "报销申请不存在")
    if e.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该报销申请")
    if e.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{e.status}状态下不可编辑")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(e, k, v)
    e.updated_at = now()
    db.add(e)
    db.commit()
    db.refresh(e)
    nm = _name_map(db, [e.user_id])
    return _to_out(e, nm)


@router.delete("/{expense_id}")
def delete_expense(expense_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(404, "报销申请不存在")
    if e.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该报销申请")
    if e.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{e.status}状态下不可删除")
    db.delete(e)
    db.commit()
    write_log("info", "expense", f"报销申请 #{expense_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{expense_id}/submit-approval")
def submit_expense_approval(expense_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """提交报销审批：部门负责人 → 财务审核 → 老板批准 → 出纳付款（执行节点）。"""
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(404, "报销申请不存在")
    if e.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作该报销申请")
    if approval_engine.get_active_instance("expense", expense_id, db):
        raise HTTPException(400, "该报销申请已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "expense", expense_id, e, f"报销申请《{e.title}》", current_user, db,
        )
    except ValueError as ex:
        raise HTTPException(400, str(ex))

    if inst is None:
        e.status = "已批准"
        e.updated_at = now()
        db.add(e)
        db.commit()
        return {"approval_id": None, "status": e.status, "message": "无需审批，已直接通过"}

    if inst.status == "pending":
        e.status = "审批中"
        e.updated_at = now()
        db.add(e)
        db.commit()
    db.refresh(e)
    write_log("info", "expense", f"报销申请 #{expense_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": e.status, "message": "已提交审批"}


@router.post("/{expense_id}/revoke-approval")
def revoke_expense_approval(expense_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(404, "报销申请不存在")
    inst = approval_engine.get_active_instance("expense", expense_id, db)
    if not inst:
        raise HTTPException(400, "该报销申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as ex:
        raise HTTPException(400, str(ex))
    db.refresh(e)
    write_log("info", "expense", f"报销申请 #{expense_id} 审批已撤回", db=db)
    return {"status": e.status, "message": "审批已撤回，可重新编辑"}


@router.post("/{expense_id}/pay")
def pay_expense(
    expense_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """出纳执行付款（需 expense:pay 权限）。仅已批准状态可付款。"""
    if not _can_pay(current_user, db):
        raise HTTPException(403, "无权执行付款操作")
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(404, "报销申请不存在")
    if e.status != "已批准":
        raise HTTPException(400, "仅已批准的报销可以执行付款")
    e.status = "已付款"
    e.paid_at = now()
    e.paid_by = current_user.id
    e.updated_at = now()
    db.add(e)
    db.commit()
    db.refresh(e)
    write_log("info", "expense", f"报销申请 #{expense_id} 已由 {current_user.username} 执行付款", db=db)
    nm = _name_map(db, [e.user_id, e.paid_by])
    return _to_out(e, nm)
