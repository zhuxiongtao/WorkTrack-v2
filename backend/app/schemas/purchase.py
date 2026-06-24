from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PurchaseCreate(BaseModel):
    title: str
    purchase_type: str         # 办公用品/设备/服务/其他
    supplier_id: Optional[int] = None
    items: Optional[str] = None   # JSON 数组
    total_amount: float = 0
    amount_unit: str = "元"
    currency: str = "CNY"
    reason: str = ""
    expected_date: Optional[datetime] = None
    attachments: Optional[str] = None


class PurchaseUpdate(BaseModel):
    title: Optional[str] = None
    purchase_type: Optional[str] = None
    supplier_id: Optional[int] = None
    items: Optional[str] = None
    total_amount: Optional[float] = None
    amount_unit: Optional[str] = None
    currency: Optional[str] = None
    reason: Optional[str] = None
    expected_date: Optional[datetime] = None
    attachments: Optional[str] = None


class PurchaseOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    title: str
    purchase_type: str
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    items: Optional[str] = None
    total_amount: float
    amount_unit: str
    currency: str
    reason: str
    expected_date: Optional[datetime] = None
    attachments: Optional[str] = None
    status: str
    purchased_at: Optional[datetime] = None
    stored_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
