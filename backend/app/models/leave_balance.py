"""假期额度账户模型：按用户 + 假期类型 + 年度 维护额度

LeaveBalance     → 当前年度某类假期的总额度/已用额度
LeaveBalanceLog  → 额度变动的流水日志（管理员调整 / 请假扣减 / 销假返还 / 加班转调休授予）

请假审批通过后由 approval_engine._on_finished 调用本模块的 apply_leave 扣减额度；
销假时返还；加班审批通过后按 compensate_type=调休 授予调休额度。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class LeaveBalance(SQLModel, table=True):
    """假期额度账户"""
    __tablename__ = "leave_balance"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    leave_type: str = Field(max_length=20, index=True)   # 年假 / 事假 / 病假 / 调休 / 婚假 / 产假 / 陪产假 / 丧假
    year: int = Field(default=0, index=True)             # 年度，如 2026
    total_hours: float = Field(default=0)                # 总额度（小时）
    used_hours: float = Field(default=0)                 # 已用额度（小时）

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())

    @property
    def remaining_hours(self) -> float:
        return round(self.total_hours - self.used_hours, 2)


class LeaveBalanceLog(SQLModel, table=True):
    """额度变动日志"""
    __tablename__ = "leave_balance_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    balance_id: int = Field(foreign_key="leave_balance.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    leave_type: str = Field(max_length=20)
    year: int = Field(default=0)

    # adjust(管理员调整) / grant(授予，如加班转调休) / leave_used(请假扣减) / leave_cancelled(销假返还)
    change_type: str = Field(max_length=20)
    change_hours: float = Field(default=0)               # 正数=增加，负数=扣减
    reason: str = Field(default="", max_length=500)
    operator_id: Optional[int] = Field(default=None, foreign_key="user.id")
    related_request_id: Optional[int] = Field(default=None)  # 关联的请假/加班申请 ID

    created_at: datetime = Field(default_factory=lambda: now())
