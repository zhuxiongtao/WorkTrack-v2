from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


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
    status: str
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime
