"""供应商管理 Schema"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class SupplierCreate(BaseModel):
    name: str
    code: str = ""
    category: str = "模型厂商"
    status: str = "合作中"
    contact_person: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    settlement_currency: str = "USD"
    payment_terms: Optional[str] = None
    settlement_method: Optional[str] = None
    settlement_cycle_days: Optional[int] = None
    prepaid_balance: Optional[float] = None
    credit_limit: Optional[float] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    api_endpoint: Optional[str] = None
    api_doc_url: Optional[str] = None
    models_provided: Optional[str] = None
    auth_type: Optional[str] = None
    im_group: Optional[str] = None
    remarks: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    contact_person: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    settlement_currency: Optional[str] = None
    payment_terms: Optional[str] = None
    settlement_method: Optional[str] = None
    settlement_cycle_days: Optional[int] = None
    prepaid_balance: Optional[float] = None
    credit_limit: Optional[float] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    api_endpoint: Optional[str] = None
    api_doc_url: Optional[str] = None
    models_provided: Optional[str] = None
    auth_type: Optional[str] = None
    im_group: Optional[str] = None
    remarks: Optional[str] = None


class SupplierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    category: str
    status: str
    contact_person: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    settlement_currency: str = "USD"
    payment_terms: Optional[str] = None
    settlement_method: Optional[str] = None
    settlement_cycle_days: Optional[int] = None
    prepaid_balance: Optional[float] = None
    credit_limit: Optional[float] = None
    current_month_consumed: Optional[float] = None
    contract_start: Optional[str] = None
    contract_end: Optional[str] = None
    api_endpoint: Optional[str] = None
    api_doc_url: Optional[str] = None
    models_provided: Optional[str] = None
    auth_type: Optional[str] = None
    im_group: Optional[str] = None
    total_cost: Optional[float] = None
    project_count: Optional[int] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class SupplierSummary(BaseModel):
    """供应商汇总统计"""
    supplier_id: int
    supplier_name: str
    supplier_code: str
    category: str
    status: str
    settlement_currency: str
    total_cost: float = 0.0
    project_count: int = 0
    models: list[str] = []
    prepaid_balance: Optional[float] = None
    current_month_consumed: Optional[float] = None
