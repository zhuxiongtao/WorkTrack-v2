"""通道 Schema：CRUD 与汇总"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ChannelCreate(BaseModel):
    supplier_id: int
    model_type: str = ""
    name: str
    code: str = ""
    kind: str = "官网通道"
    status: str = "合作中"
    cost_price: float = 0.0
    price_unit: str = "per_1k_token"
    discount_rate: float = 1.0
    suggested_markup: float = 0.2
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    sla_json: Optional[str] = None
    remarks: Optional[str] = None


class ChannelUpdate(BaseModel):
    model_type: Optional[str] = None
    name: Optional[str] = None
    code: Optional[str] = None
    kind: Optional[str] = None
    status: Optional[str] = None
    cost_price: Optional[float] = None
    price_unit: Optional[str] = None
    discount_rate: Optional[float] = None
    suggested_markup: Optional[float] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    sla_json: Optional[str] = None
    remarks: Optional[str] = None


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    model_type: str
    name: str
    code: str
    kind: str
    status: str
    cost_price: float
    price_unit: str
    discount_rate: float
    suggested_markup: float
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    sla_json: Optional[str] = None
    inventory_total: int
    inventory_available: int
    active_projects: int
    monthly_cost: float
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ChannelSummary(BaseModel):
    """通道汇总（按模型族 / 通道类型）"""
    model_config = ConfigDict(from_attributes=True)

    channel_id: int
    supplier_id: int
    supplier_name: str
    model_type: str
    name: str
    kind: str
    status: str
    cost_price: float
    price_unit: str
    discount_rate: float
    inventory_available: int
    active_projects: int
    monthly_cost: float
