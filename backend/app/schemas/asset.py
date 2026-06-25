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


class AssetActionIn(BaseModel):
    """资产流转操作：领用/归还/调拨/维修/报废"""
    action: str                         # 领用 | 归还 | 调拨 | 维修 | 报废
    to_user_id: Optional[int] = None    # 领用/调拨的目标使用人
    note: Optional[str] = None


class AssetRecordOut(BaseModel):
    id: int
    asset_id: int
    action: str
    from_user_id: Optional[int] = None
    from_user_name: Optional[str] = None
    to_user_id: Optional[int] = None
    to_user_name: Optional[str] = None
    operator_id: Optional[int] = None
    operator_name: Optional[str] = None
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime
