"""假期额度服务：管理 LeaveBalance 账户的扣减/返还/授予/调整。

被 approval_engine._on_finished 调用：
- 请假审批通过 → apply_leave 扣减额度
- 加班审批通过（调休补偿）→ grant_overtime_compensate 授予调休额度
- 销假 → cancel_leave 返还额度

也被 routers/leave_balances.py 暴露给 HR 管理员手动调整。
"""
import logging
from typing import Optional
from datetime import datetime, date

from sqlmodel import Session, select

from app.models.leave_balance import LeaveBalance, LeaveBalanceLog
from app.models.leave_request import LeaveRequest
from app.models.overtime_request import OvertimeRequest
from app.utils.time import now

logger = logging.getLogger("worktrack")

# 每个工作日折合小时数（年假天数 → 额度小时数）
HOURS_PER_DAY = 8.0


def _tenure_years(first_work_date: Optional[date], as_of_year: int) -> int:
    """累计工龄（已满整年），以分配年度的 12 月 31 日为基准。"""
    if not first_work_date:
        return 0
    ref = date(as_of_year, 12, 31)
    return ref.year - first_work_date.year - (
        (ref.month, ref.day) < (first_work_date.month, first_work_date.day)
    )


def statutory_annual_leave_days(first_work_date: Optional[date], as_of_year: int) -> int:
    """按《职工带薪年休假条例》计算法定年假天数。

    依据「累计工作时间（社会工龄）」：
      - 累计满 1 年不满 10 年：5 天
      - 满 10 年不满 20 年：10 天
      - 满 20 年以上：15 天
      - 不满 1 年：0 天（条例规定不享受，首年是否按比例由 HR 在草稿中调整）

    工龄以指定年度的 12 月 31 日为基准，按已满整年计算。
    """
    years = _tenure_years(first_work_date, as_of_year)
    if years < 1:
        return 0
    if years < 10:
        return 5
    if years < 20:
        return 10
    return 15


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


# 需要额度管控的假期类型（年假/调休按余额，法定假期按 HR 核准额度）
BALANCE_CONTROLLED_TYPES = ("年假", "调休", "婚假", "产假", "陪产假", "丧假")


def apply_leave(
    leave: LeaveRequest, db: Session, operator_id: Optional[int] = None,
) -> Optional[LeaveBalance]:
    """请假审批通过后扣减额度。返回更新后的余额，额度不足抛 ValueError。"""
    year = leave.start_at.year
    # SELECT FOR UPDATE 锁行，防止并发请假重复扣减同一额度
    bal = db.exec(
        select(LeaveBalance).where(
            LeaveBalance.user_id == leave.user_id,
            LeaveBalance.leave_type == leave.leave_type,
            LeaveBalance.year == year,
        ).with_for_update()
    ).first()
    if not bal:
        bal = LeaveBalance(
            user_id=leave.user_id, leave_type=leave.leave_type,
            year=year, total_hours=0, used_hours=0,
        )
        db.add(bal)
        db.flush()
    remaining = bal.total_hours - bal.used_hours
    if leave.leave_type in BALANCE_CONTROLLED_TYPES and leave.hours > remaining:
        # 额度不足：拒绝扣减（理论上 submit_leave_approval 已拦截，此处为双保险）
        raise ValueError(
            f"{leave.leave_type}额度不足：剩余 {round(remaining, 1)} 小时，本次申请 {leave.hours} 小时"
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


def _proportional_refund(leave: LeaveRequest) -> float:
    """计算实际应返还的额度小时数。

    若提前销假（actual_end_at < end_at），按时间跨度比例返还未使用部分；
    否则（未提前）全额返还（申请撤销或实际使用满额）。
    """
    actual = leave.actual_end_at
    if actual and actual < leave.end_at:
        total_span = (leave.end_at - leave.start_at).total_seconds()
        if total_span > 0:
            actual_span = max(0.0, (actual - leave.start_at).total_seconds())
            ratio = min(1.0, actual_span / total_span)
            return round(leave.hours * (1.0 - ratio), 2)
    return leave.hours


def cancel_leave(
    leave: LeaveRequest, db: Session, operator_id: Optional[int] = None,
) -> Optional[LeaveBalance]:
    """销假返还额度（提前销假按比例返还未使用部分，否则全额返还）。"""
    year = leave.start_at.year
    # SELECT FOR UPDATE 锁行，防止并发销假导致 used_hours 负数
    bal = db.exec(
        select(LeaveBalance).where(
            LeaveBalance.user_id == leave.user_id,
            LeaveBalance.leave_type == leave.leave_type,
            LeaveBalance.year == year,
        ).with_for_update()
    ).first()
    if not bal:
        return None
    refund_hours = _proportional_refund(leave)
    bal.used_hours = round(max(0, bal.used_hours - refund_hours), 2)
    bal.updated_at = now()
    db.add(bal)
    db.commit()
    db.refresh(bal)
    _write_log(
        bal, "leave_cancelled", refund_hours,
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


def set_balance_total(
    user_id: int, leave_type: str, year: int,
    total_hours: float, reason: str, operator_id: int, db: Session,
) -> LeaveBalance:
    """将额度「总额」直接设为目标值（用于按工龄批量发放年假），记录变动差额。"""
    bal = get_or_create_balance(user_id, leave_type, year, db)
    new_total = round(max(0, total_hours), 2)
    delta = round(new_total - bal.total_hours, 2)
    bal.total_hours = new_total
    bal.updated_at = now()
    db.add(bal)
    db.commit()
    db.refresh(bal)
    if delta != 0:
        _write_log(
            bal, "adjust", delta,
            reason or "按工龄发放年假", db,
            operator_id=operator_id,
        )
    return bal
