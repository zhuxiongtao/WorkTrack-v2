from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class AssetCreate(BaseModel):
    name: str
    asset_no: Optional[str] = None
    category: str = "其他"
    spec: Optional[str] = None
    purchase_date: Optional[datetime] = None
    purchase_price: float = 0
    amount_unit: str = "元"
    currency: str = "CNY"
    status: str = "在用"
    location: Optional[str] = None
    user_id: Optional[int] = None
    supplier_id: Optional[int] = None
    remarks: Optional[str] = None


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    asset_no: Optional[str] = None
    category: Optional[str] = None
    spec: Optional[str] = None
    purchase_date: Optional[datetime] = None
    purchase_price: Optional[float] = None
    amount_unit: Optional[str] = None
    currency: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None
    user_id: Optional[int] = None
    supplier_id: Optional[int] = None
    remarks: Optional[str] = None


class AssetOut(BaseModel):
    id: int
    name: str
    asset_no: Optional[str] = None
    category: str
    spec: Optional[str] = None
    purchase_date: Optional[datetime] = None
    purchase_price: float
    amount_unit: str
    currency: str
    status: str
    location: Optional[str] = None
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime
