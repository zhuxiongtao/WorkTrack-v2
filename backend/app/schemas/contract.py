from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ContractCreate(BaseModel):
    title: str
    contract_no: str = ""
    contract_type: str = ""
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: str = ""
    party_b: str = ""
    contract_amount: Optional[float] = None
    amount_unit: str = "万元"
    currency: str = "CNY"
    payment_terms: Optional[str] = None
    remarks: Optional[str] = None
    seal_types_requested: str = ""


class ContractUpdate(BaseModel):
    title: Optional[str] = None
    contract_no: Optional[str] = None
    contract_type: Optional[str] = None
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    contract_amount: Optional[float] = None
    amount_unit: Optional[str] = None
    currency: Optional[str] = None
    payment_terms: Optional[str] = None
    status: Optional[str] = None
    remarks: Optional[str] = None
    content_html: Optional[str] = None
    seal_types_requested: Optional[str] = None


class ContractOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    title: str
    contract_no: str
    contract_type: str = ""
    file_path: str
    file_name: str
    file_type: str
    file_size: int
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: str
    party_b: str
    contract_amount: Optional[float] = None
    amount_unit: str = "万元"
    currency: str
    payment_terms: Optional[str] = None
    key_clauses: Optional[str] = None
    summary: Optional[str] = None
    status: str
    remarks: Optional[str] = None

    # 用章申请
    seal_types_requested: str = ""

    # 解析元数据（保留，只是 UI 降级）
    parse_status: str = "pending"
    parse_error: str = ""
    parsed_at: Optional[datetime] = None

    # 来源与模板
    source: str = "external"
    template_id: Optional[int] = None
    content_html: Optional[str] = None

    # 签章归档
    signed_file_path: str = ""
    signed_file_name: str = ""

    # 历史归档
    is_historical: bool = False

    created_at: datetime
    updated_at: datetime
