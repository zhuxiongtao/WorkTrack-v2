"""员工借款台账

员工向公司预支的差旅/项目备用金，提交报销时可选择"优先抵消借款"，
系统在「实报后公司欠个人」时优先扣减未结清借款。
"""
from datetime import datetime, date
from typing import Optional
from sqlmodel import SQLModel, Field

from app.utils.time import now


class EmployeeLoan(SQLModel, table=True):
    __tablename__ = "employee_loan"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    entity_id: int = Field(foreign_key="legal_entity.id", index=True, description="借款所属主体")
    amount: float = Field(default=0, description="借款本金")
    used_amount: float = Field(default=0, description="已被报销抵消的金额")
    remaining: float = Field(default=0, description="剩余未还")
    loan_date: date = Field(description="借款日期")
    reason: str = Field(default="", max_length=500, description="借款事由")
    status: str = Field(default="借款中", max_length=20, index=True)  # 借款中/部分抵消/已结清/已作废
    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
