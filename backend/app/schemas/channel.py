"""通道 Schema：CRUD 与汇总"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ChannelCreate(BaseModel):
    supplier_id: int
    name: str
    code: str = ""
    api_protocol: str = "openai_compat"
    status: str = "合作中"
    cost_discount: Optional[float] = None
    markup: Optional[float] = None
    cost_source: str = "manual"
    scope_type: str = "all"
    model_family: Optional[str] = None
    model_id: Optional[int] = None
    sla_json: Optional[str] = None
    access_url: Optional[str] = None
    usage_url: Optional[str] = None
    remarks: Optional[str] = None


class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    api_protocol: Optional[str] = None
    status: Optional[str] = None
    cost_discount: Optional[float] = None
    markup: Optional[float] = None
    cost_source: Optional[str] = None
    scope_type: Optional[str] = None
    model_family: Optional[str] = None
    model_id: Optional[int] = None
    sla_json: Optional[str] = None
    access_url: Optional[str] = None
    usage_url: Optional[str] = None
    remarks: Optional[str] = None


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    name: str
    code: str
    api_protocol: str
    status: str
    computed_status: str
    cost_discount: Optional[float] = None
    markup: Optional[float] = None
    cost_source: str
    scope_type: str
    model_family: Optional[str] = None
    model_id: Optional[int] = None
    sla_json: Optional[str] = None
    access_url: Optional[str] = None
    usage_url: Optional[str] = None
    inventory_total: int
    inventory_available: int
    active_projects: int
    monthly_cost: float
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ChannelSummary(BaseModel):
    """通道汇总（含供应商名称）"""
    model_config = ConfigDict(from_attributes=True)

    channel_id: int
    supplier_id: int
    supplier_name: str
    name: str
    api_protocol: str
    status: str
    computed_status: str
    cost_discount: Optional[float]
    markup: Optional[float]
    scope_type: str
    model_family: Optional[str]
    inventory_available: int
    active_projects: int
    monthly_cost: float
