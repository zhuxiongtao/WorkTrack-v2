"""报销明细（独立表）

从 expense_request.items (JSON 字符串) 升级而来。
每条明细可独立上传票据、关联部门、记录费用日期等。
"""
from datetime import datetime, date
from typing import Optional
from sqlmodel import SQLModel, Field


class ExpenseItem(SQLModel, table=True):
    __tablename__ = "expense_item"

    id: Optional[int] = Field(default=None, primary_key=True)
    expense_id: int = Field(foreign_key="expense_request.id", index=True, description="所属报销单")
    name: str = Field(default="", max_length=100, description="报销名称")
    expense_type: str = Field(default="其他", max_length=50, index=True, description="类别")
    department_id: Optional[int] = Field(default=None, foreign_key="department.id", description="费用使用部门")
    city: str = Field(default="", max_length=50, description="费用产生城市")
    expense_date: Optional[date] = Field(default=None, description="费用产生时间")
    amount: float = Field(default=0, description="报销金额")
    note: str = Field(default="", max_length=500, description="费用说明")
    remark: str = Field(default="", max_length=500, description="备注")
    attachments: Optional[str] = Field(default=None, description="票据 JSON 数组（FileMeta[] 序列化）")
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
