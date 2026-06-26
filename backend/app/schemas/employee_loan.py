from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel


class EmployeeLoanCreate(BaseModel):
    user_id: int
    entity_id: int
    amount: float
    loan_date: date
    reason: str = ""


class EmployeeLoanUpdate(BaseModel):
    amount: Optional[float] = None
    reason: Optional[str] = None
    status: Optional[str] = None


class EmployeeLoanOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    entity_id: int
    entity_name: Optional[str] = None
    amount: float
    used_amount: float
    remaining: float
    loan_date: date
    reason: str
    status: str
    created_at: datetime
    updated_at: datetime
