"""假期额度管理：HR 调整额度、员工查看自己的额度。

查看自己的额度仅需登录；查看全部/调整额度需 leave:manage（HR/管理员）。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from pydantic import BaseModel

from app.database import get_session
from app.models.leave_balance import LeaveBalance, LeaveBalanceLog
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.services import leave_balance_service
from app.routers.logs import write_log

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/leave-balances", tags=["假期额度"])


def _can_manage(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "leave:manage", db)


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


class AdjustBody(BaseModel):
    user_id: int
    leave_type: str
    year: int
    change_hours: float       # 正数增加总额度，负数减少
    reason: str = ""


@router.get("/my")
def get_my_balances(
    year: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """查看当前用户自己的额度"""
    from datetime import datetime
    y = year or datetime.now().year
    rows = db.exec(
        select(LeaveBalance).where(
            LeaveBalance.user_id == current_user.id,
            LeaveBalance.year == y,
        )
    ).all()
    return [{
        "id": r.id, "leave_type": r.leave_type, "year": r.year,
        "total_hours": r.total_hours, "used_hours": r.used_hours,
        "remaining_hours": round(r.total_hours - r.used_hours, 2),
    } for r in rows]


@router.get("")
def list_balances(
    user_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    leave_type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """查看全部额度（需 leave:manage）"""
    if not _can_manage(current_user, db):
        raise HTTPException(403, "无权查看全部额度")
    from datetime import datetime
    query = select(LeaveBalance)
    if user_id:
        query = query.where(LeaveBalance.user_id == user_id)
    if year:
        query = query.where(LeaveBalance.year == year)
    if leave_type:
        query = query.where(LeaveBalance.leave_type == leave_type)
    rows = db.exec(query.order_by(LeaveBalance.year.desc(), LeaveBalance.user_id)).all()
    nm = _name_map(db, [r.user_id for r in rows])
    return [{
        "id": r.id, "user_id": r.user_id, "user_name": nm.get(r.user_id, ""),
        "leave_type": r.leave_type, "year": r.year,
        "total_hours": r.total_hours, "used_hours": r.used_hours,
        "remaining_hours": round(r.total_hours - r.used_hours, 2),
    } for r in rows]


@router.post("/adjust")
def adjust(
    body: AdjustBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """HR 手动调整额度（需 leave:manage）"""
    if not _can_manage(current_user, db):
        raise HTTPException(403, "无权调整额度")
    bal = leave_balance_service.adjust_balance(
        body.user_id, body.leave_type, body.year,
        body.change_hours, body.reason, current_user.id, db,
    )
    write_log("info", "leave_balance",
              f"用户 {current_user.username} 调整用户 #{body.user_id} {body.leave_type} 额度 {body.change_hours:+.2f}h",
              db=db)
    nm = _name_map(db, [bal.user_id])
    return {
        "id": bal.id, "user_id": bal.user_id, "user_name": nm.get(bal.user_id, ""),
        "leave_type": bal.leave_type, "year": bal.year,
        "total_hours": bal.total_hours, "used_hours": bal.used_hours,
        "remaining_hours": round(bal.total_hours - bal.used_hours, 2),
    }


@router.get("/logs")
def list_logs(
    user_id: Optional[int] = Query(None),
    leave_type: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """查看额度变动日志（需 leave:manage，或查看自己的）"""
    if not _can_manage(current_user, db):
        # 非管理员只能看自己的
        user_id = current_user.id
    query = select(LeaveBalanceLog)
    if user_id:
        query = query.where(LeaveBalanceLog.user_id == user_id)
    if leave_type:
        query = query.where(LeaveBalanceLog.leave_type == leave_type)
    rows = db.exec(query.order_by(LeaveBalanceLog.created_at.desc()).limit(limit)).all()
    nm = _name_map(db, [r.user_id for r in rows] + [r.operator_id for r in rows if r.operator_id])
    return [{
        "id": r.id, "user_id": r.user_id, "user_name": nm.get(r.user_id, ""),
        "leave_type": r.leave_type, "year": r.year,
        "change_type": r.change_type, "change_hours": r.change_hours,
        "reason": r.reason,
        "operator_id": r.operator_id, "operator_name": nm.get(r.operator_id, "") if r.operator_id else "",
        "related_request_id": r.related_request_id,
        "created_at": r.created_at,
    } for r in rows]
