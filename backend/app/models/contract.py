from typing import Optional
from datetime import date, datetime
from sqlmodel import SQLModel, Field


class Contract(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=1, foreign_key="user.id", index=True)
    customer_id: int = Field(foreign_key="customer.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    title: str
    contract_no: str = ""
    file_path: str = ""
    file_name: str = ""
    file_type: str = ""
    file_size: int = 0
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: str = ""
    party_b: str = ""
    contract_amount: Optional[float] = None
    currency: str = "CNY"
    payment_terms: Optional[str] = None
    key_clauses: Optional[str] = None
    summary: Optional[str] = None
    raw_text: Optional[str] = None
    status: str = "生效中"
    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
