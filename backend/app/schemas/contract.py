from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ContractCreate(BaseModel):
    title: str
    contract_no: str = ""
    customer_id: int
    project_id: Optional[int] = None
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: str = ""
    party_b: str = ""
    contract_amount: Optional[float] = None
    currency: str = "CNY"
    payment_terms: Optional[str] = None
    remarks: Optional[str] = None


class ContractUpdate(BaseModel):
    title: Optional[str] = None
    contract_no: Optional[str] = None
    project_id: Optional[int] = None
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    contract_amount: Optional[float] = None
    currency: Optional[str] = None
    payment_terms: Optional[str] = None
    status: Optional[str] = None
    remarks: Optional[str] = None


class ContractOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    customer_id: int
    project_id: Optional[int] = None
    title: str
    contract_no: str
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
    currency: str
    payment_terms: Optional[str] = None
    key_clauses: Optional[str] = None
    summary: Optional[str] = None
    raw_text: Optional[str] = None
    status: str
    remarks: Optional[str] = None

    # 阶段 1+2 业务字段
    contract_type: str = ""
    effective_term: str = ""
    auto_renew: str = ""
    penalty_clause: str = ""
    acceptance_terms: str = ""
    payment_schedule: str = ""
    ip_clause: str = ""
    dispute_resolution: str = ""
    governing_law: str = ""
    notice_clause: str = ""

    # 解析元数据
    parse_status: str = "pending"
    parse_error: str = ""
    parsed_at: Optional[datetime] = None
    extraction_meta: str = ""

    created_at: datetime
    updated_at: datetime
