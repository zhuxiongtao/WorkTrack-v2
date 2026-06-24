"""假期额度服务：管理 LeaveBalance 账户的扣减/返还/授予/调整。

被 approval_engine._on_finished 调用：
- 请假审批通过 → apply_leave 扣减额度
- 加班审批通过（调休补偿）→ grant_overtime_compensate 授予调休额度
- 销假 → cancel_leave 返还额度

也被 routers/leave_balances.py 暴露给 HR 管理员手动调整。
"""
import logging
from typing import Optional
from datetime import datetime

from sqlmodel import Session, select

from app.models.leave_balance import LeaveBalance, LeaveBalanceLog
from app.models.leave_request import LeaveRequest
from app.models.overtime_request import OvertimeRequest
from app.utils.time import now

logger = logging.getLogger("worktrack")


def get_or_create_balance(
    user_id: int, leave_type: str, year: int, db: Session,
    total_hours: float = 0,
) -> LeaveBalance:
    """获取或创建某用户某年度某类假期的额度账户"""
    bal = db.exec(
        select(LeaveBalance).where(
            LeaveBalance.user_id == user_id,
            LeaveBalance.leave_type == leave_type,
            LeaveBalance.year == year,
        )
    ).first()
    if not bal:
        bal = LeaveBalance(
            user_id=user_id, leave_type=leave_type, year=year,
            total_hours=total_hours, used_hours=0,
        )
        db.add(bal)
        db.commit()
        db.refresh(bal)
    return bal


def _write_log(
    balance: LeaveBalance, change_type: str, change_hours: float,
    reason: str, db: Session,
    operator_id: Optional[int] = None, related_request_id: Optional[int] = None,
) -> None:
    db.add(LeaveBalanceLog(
        balance_id=balance.id, user_id=balance.user_id,
        leave_type=balance.leave_type, year=balance.year,
        change_type=change_type, change_hours=change_hours,
        reason=reason, operator_id=operator_id,
        related_request_id=related_request_id,
    ))
    db.commit()


def apply_leave(
    leave: LeaveRequest, db: Session, operator_id: Optional[int] = None,
) -> Optional[LeaveBalance]:
    """请假审批通过后扣减额度。返回更新后的余额，额度不足返回 None。"""
    year = leave.start_at.year
    bal = get_or_create_balance(leave.user_id, leave.leave_type, year, db)
    if bal.used_hours + leave.hours > bal.total_hours:
        # 额度不足：允许透支（used 可超过 total），但记录警告
        logger.warning(
            "请假 #%s 额度透支：用户 %s %s 假期余额 %.2f，申请 %.2f",
            leave.id, leave.user_id, leave.leave_type,
            bal.total_hours - bal.used_hours, leave.hours,
        )
    bal.used_hours = round(bal.used_hours + leave.hours, 2)
    bal.updated_at = now()
    db.add(bal)
    db.commit()
    db.refresh(bal)
    _write_log(
        bal, "leave_used", -leave.hours,
        f"请假 #{leave.id}（{leave.title}）扣减", db,
        operator_id=operator_id, related_request_id=leave.id,
    )
    return bal


def cancel_leave(
    leave: LeaveRequest, db: Session, operator_id: Optional[int] = None,
) -> Optional[LeaveBalance]:
    """销假返还额度（按实际销假时间重算或全额返还）。

    简化策略：全额返还已扣减额度。如需按实际时间重算，可扩展此函数。
    """
    year = leave.start_at.year
    bal = db.exec(
        select(LeaveBalance).where(
            LeaveBalance.user_id == leave.user_id,
            LeaveBalance.leave_type == leave.leave_type,
            LeaveBalance.year == year,
        )
    ).first()
    if not bal:
        return None
    bal.used_hours = round(max(0, bal.used_hours - leave.hours), 2)
    bal.updated_at = now()
    db.add(bal)
    db.commit()
    db.refresh(bal)
    _write_log(
        bal, "leave_cancelled", leave.hours,
        f"销假 #{leave.id}（{leave.title}）返还", db,
        operator_id=operator_id, related_request_id=leave.id,
    )
    return bal


def grant_overtime_compensate(
    overtime: OvertimeRequest, db: Session,
) -> Optional[LeaveBalance]:
    """加班审批通过后，若补偿方式为调休，则授予对应调休额度。"""
    if overtime.compensate_type != "调休":
        return None
    year = overtime.start_at.year
    bal = get_or_create_balance(overtime.user_id, "调休", year, db)
    bal.total_hours = round(bal.total_hours + overtime.hours, 2)
    bal.updated_at = now()
    db.add(bal)
    db.commit()
    db.refresh(bal)
    _write_log(
        bal, "grant", overtime.hours,
        f"加班 #{overtime.id}（{overtime.title}）授予调休额度", db,
        operator_id=overtime.user_id, related_request_id=overtime.id,
    )
    return bal


def adjust_balance(
    user_id: int, leave_type: str, year: int,
    change_hours: float, reason: str, operator_id: int, db: Session,
) -> LeaveBalance:
    """HR 管理员手动调整额度（正数增加总额度，负数减少）。"""
    bal = get_or_create_balance(user_id, leave_type, year, db)
    bal.total_hours = round(max(0, bal.total_hours + change_hours), 2)
    bal.updated_at = now()
    db.add(bal)
    db.commit()
    db.refresh(bal)
    _write_log(
        bal, "adjust", change_hours,
        reason or "管理员调整", db,
        operator_id=operator_id,
    )
    return bal
