"""通用关联申请单

把 `expense_request.trip_id` 单外键升级为多对多通用关联。
- target_type: business_trip / leave / purchase
- target_id: 对应表的主键

未来可扩展到 daily_report / meeting_note 等任意申请单类型。
"""
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field

from app.utils.time import now


class ExpenseRelation(SQLModel, table=True):
    __tablename__ = "expense_relation"

    id: Optional[int] = Field(default=None, primary_key=True)
    expense_id: int = Field(foreign_key="expense_request.id", index=True, description="所属报销单")
    target_type: str = Field(max_length=30, index=True, description="关联单据类型: business_trip/leave/purchase")
    target_id: int = Field(index=True, description="关联单据主键")
    relation_note: str = Field(default="", max_length=200, description="关联说明")
    created_at: datetime = Field(default_factory=lambda: now())
