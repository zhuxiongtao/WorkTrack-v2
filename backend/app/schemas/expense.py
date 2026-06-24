from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ExpenseCreate(BaseModel):
    title: str
    expense_type: str          # 差旅/交通/餐饮/办公用品/通讯/培训/其他
    amount: float = 0
    amount_unit: str = "元"
    currency: str = "CNY"
    expense_date: datetime
    reason: str = ""
    attachments: Optional[str] = None


class ExpenseUpdate(BaseModel):
    title: Optional[str] = None
    expense_type: Optional[str] = None
    amount: Optional[float] = None
    amount_unit: Optional[str] = None
    currency: Optional[str] = None
    expense_date: Optional[datetime] = None
    reason: Optional[str] = None
    attachments: Optional[str] = None


class ExpenseOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    title: str
    expense_type: str
    amount: float
    amount_unit: str
    currency: str
    expense_date: datetime
    reason: str
    attachments: Optional[str] = None
    status: str
    paid_at: Optional[datetime] = None
    paid_by: Optional[int] = None
    paid_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
