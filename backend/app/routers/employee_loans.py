"""员工借款台账：管理员录入借款，员工查看自己未结清借款。

提交报销时勾选"优先抵消借款"，系统自动按剩余本金从大到小扣减。
"""
import logging
from datetime import date as _date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.employee_loan import EmployeeLoan
from app.models.user import User
from app.models.legal_entity import LegalEntity
from app.auth import get_current_user, require_permission
from app.schemas.employee_loan import EmployeeLoanCreate, EmployeeLoanUpdate, EmployeeLoanOut
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/employee-loans", tags=["员工借款"])


def _to_out(loan: EmployeeLoan, db: Session) -> EmployeeLoanOut:
    user = db.get(User, loan.user_id)
    entity = db.get(LegalEntity, loan.entity_id)
    return EmployeeLoanOut(
        id=loan.id,
        user_id=loan.user_id,
        user_name=user.name if user else None,
        entity_id=loan.entity_id,
        entity_name=entity.name if entity else None,
        amount=loan.amount,
        used_amount=loan.used_amount,
        remaining=loan.remaining,
        loan_date=loan.loan_date,
        reason=loan.reason,
        status=loan.status,
        created_at=loan.created_at,
        updated_at=loan.updated_at,
    )


@router.get("", response_model=list[EmployeeLoanOut])
def list_loans(
    user_id: Optional[int] = Query(None, description="按用户筛选；不传或 0=查全部"),
    only_active: bool = Query(False, description="仅未结清"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """员工默认只看自己；财务/管理员可看全部（expense:view_all 权限）"""
    if not user_id and not current_user.is_admin:
        # 尝试获取角色权限
        from app.models.rbac import UserRole
        from app.auth import _user_has_permission  # type: ignore
        if not _user_has_permission(db, current_user, "expense:view_all"):
            user_id = current_user.id  # 退回：仅自己
    query = select(EmployeeLoan).order_by(EmployeeLoan.loan_date.desc(), EmployeeLoan.id.desc())
    if user_id:
        query = query.where(EmployeeLoan.user_id == user_id)
    if only_active:
        query = query.where(EmployeeLoan.status != "已结清")
    rows = db.exec(query).all()
    return [_to_out(r, db) for r in rows]


@router.get("/my-active", response_model=list[EmployeeLoanOut])
def my_active_loans(
    entity_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """当前用户未结清借款（按主体过滤可选）。供报销表单联动。"""
    query = select(EmployeeLoan).where(
        EmployeeLoan.user_id == current_user.id,
        EmployeeLoan.status != "已结清",
    )
    if entity_id:
        query = query.where(EmployeeLoan.entity_id == entity_id)
    query = query.order_by(EmployeeLoan.loan_date.asc())
    rows = db.exec(query).all()
    return [_to_out(r, db) for r in rows]


@router.post("", response_model=EmployeeLoanOut)
def create_loan(
    payload: EmployeeLoanCreate,
    current_user: User = Depends(require_permission("expense:view_all")),
    db: Session = Depends(get_session),
):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="借款金额必须大于 0")
    if not db.get(LegalEntity, payload.entity_id):
        raise HTTPException(status_code=400, detail="公司主体不存在")
    loan = EmployeeLoan(
        user_id=payload.user_id,
        entity_id=payload.entity_id,
        amount=payload.amount,
        used_amount=0,
        remaining=payload.amount,
        loan_date=payload.loan_date,
        reason=payload.reason,
        status="借款中",
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    write_log("info", "expense", f"录入员工借款 user#{payload.user_id} 金额 {payload.amount}（操作人：{current_user.name}）", db=db)
    return _to_out(loan, db)


@router.put("/{loan_id}", response_model=EmployeeLoanOut)
def update_loan(
    loan_id: int,
    payload: EmployeeLoanUpdate,
    current_user: User = Depends(require_permission("expense:view_all")),
    db: Session = Depends(get_session),
):
    loan = db.get(EmployeeLoan, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="借款记录不存在")
    for k, v in payload.model_dump(exclude_unset=True).items():
        if k == "amount":
            delta = v - loan.amount
            loan.amount = v
            loan.remaining = max(0, loan.remaining + delta)
        else:
            setattr(loan, k, v)
    _recompute_status(loan)
    loan.updated_at = now()
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return _to_out(loan, db)


@router.delete("/{loan_id}")
def delete_loan(
    loan_id: int,
    current_user: User = Depends(require_permission("expense:view_all")),
    db: Session = Depends(get_session),
):
    loan = db.get(EmployeeLoan, loan_id)
    if not loan:
        raise HTTPException(status_code=404, detail="借款记录不存在")
    if loan.used_amount > 0:
        raise HTTPException(status_code=400, detail="该借款已被报销抵消，不可删除")
    db.delete(loan)
    db.commit()
    return {"message": "ok"}


def _recompute_status(loan: EmployeeLoan) -> None:
    """根据 used_amount / amount 维护 status"""
    if loan.remaining <= 0:
        loan.status = "已结清"
        loan.remaining = 0
    elif loan.used_amount > 0:
        loan.status = "部分抵消"
    else:
        loan.status = "借款中"


def apply_offset(db: Session, user_id: int, entity_id: int, amount: float) -> float:
    """按剩余本金从小到大依次抵消。返回实际抵消金额。"""
    if amount <= 0:
        return 0
    loans = db.exec(
        select(EmployeeLoan).where(
            EmployeeLoan.user_id == user_id,
            EmployeeLoan.entity_id == entity_id,
            EmployeeLoan.status != "已结清",
            EmployeeLoan.remaining > 0,
        ).order_by(EmployeeLoan.remaining.asc())
    ).all()
    rest = amount
    for ln in loans:
        if rest <= 0:
            break
        d = min(ln.remaining, rest)
        ln.used_amount += d
        ln.remaining -= d
        rest -= d
        _recompute_status(ln)
        ln.updated_at = now()
        db.add(ln)
    db.commit()
    return amount - rest


def revert_offset(db: Session, user_id: int, entity_id: int, amount: float) -> None:
    """撤销之前已抵消的金额（按 used_amount 从大到小回退）。用于报销编辑/删除时回滚。"""
    if amount <= 0:
        return
    loans = db.exec(
        select(EmployeeLoan).where(
            EmployeeLoan.user_id == user_id,
            EmployeeLoan.entity_id == entity_id,
            EmployeeLoan.used_amount > 0,
        ).order_by(EmployeeLoan.used_amount.desc())
    ).all()
    rest = amount
    for ln in loans:
        if rest <= 0:
            break
        d = min(ln.used_amount, rest)
        ln.used_amount -= d
        ln.remaining += d
        rest -= d
        _recompute_status(ln)
        ln.updated_at = now()
        db.add(ln)
    db.commit()
    return amount - rest
