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


class GenerateAnnualPreviewBody(BaseModel):
    year: int


class AnnualApplyItem(BaseModel):
    user_id: int
    days: float               # 该员工本年度年假天数（HR 可在预览基础上微调）


class GenerateAnnualApplyBody(BaseModel):
    year: int
    items: list[AnnualApplyItem]


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


@router.post("/generate-annual/preview")
def generate_annual_preview(
    body: GenerateAnnualPreviewBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """按工龄预览本年度年假发放草稿（需 leave:manage）。

    对每个在职员工，依据「参加工作日期」算法定累计工龄→年假天数，
    返回草稿列表供 HR 确认/微调，本接口不写库。
    """
    if not _can_manage(current_user, db):
        raise HTTPException(403, "无权生成年假")
    year = body.year
    users = db.exec(
        select(User).where(User.is_active == True, User.status == "active")
    ).all()
    # 当前已发年假总额（小时）
    existing = {
        b.user_id: b for b in db.exec(
            select(LeaveBalance).where(
                LeaveBalance.leave_type == "年假",
                LeaveBalance.year == year,
            )
        ).all()
    }
    rows = []
    for u in users:
        days = leave_balance_service.statutory_annual_leave_days(u.first_work_date, year)
        bal = existing.get(u.id)
        rows.append({
            "user_id": u.id,
            "user_name": u.name or u.username,
            "first_work_date": u.first_work_date.isoformat() if u.first_work_date else None,
            "hire_date": u.hire_date.isoformat() if u.hire_date else None,
            "tenure_years": leave_balance_service._tenure_years(u.first_work_date, year),
            "statutory_days": days,
            "current_total_days": round(bal.total_hours / leave_balance_service.HOURS_PER_DAY, 1) if bal else 0,
            "current_used_days": round(bal.used_hours / leave_balance_service.HOURS_PER_DAY, 1) if bal else 0,
            "missing_first_work_date": u.first_work_date is None,
        })
    rows.sort(key=lambda r: (r["missing_first_work_date"], -r["statutory_days"], r["user_name"]))
    return {"year": year, "items": rows}


@router.post("/generate-annual/apply")
def generate_annual_apply(
    body: GenerateAnnualApplyBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """确认并发放年假（需 leave:manage）：将每位员工的年假总额设为指定天数。"""
    if not _can_manage(current_user, db):
        raise HTTPException(403, "无权发放年假")
    applied = 0
    for item in body.items:
        leave_balance_service.set_balance_total(
            item.user_id, "年假", body.year,
            item.days * leave_balance_service.HOURS_PER_DAY,
            f"{body.year} 年度按工龄发放年假 {item.days} 天",
            current_user.id, db,
        )
        applied += 1
    write_log("info", "leave_balance",
              f"用户 {current_user.username} 批量发放 {body.year} 年度年假，共 {applied} 人", db=db)
    return {"ok": True, "applied": applied, "year": body.year}


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
