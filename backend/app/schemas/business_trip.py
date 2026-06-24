from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class BusinessTripCreate(BaseModel):
    title: str
    destination: str
    start_date: datetime
    end_date: datetime
    days: float = 0
    purpose: str = ""
    budget: float = 0
    budget_unit: str = "元"
    currency: str = "CNY"
    transport: str = "其他"
    attachments: Optional[str] = None


class BusinessTripUpdate(BaseModel):
    title: Optional[str] = None
    destination: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    days: Optional[float] = None
    purpose: Optional[str] = None
    budget: Optional[float] = None
    budget_unit: Optional[str] = None
    currency: Optional[str] = None
    transport: Optional[str] = None
    attachments: Optional[str] = None


class BusinessTripOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    title: str
    destination: str
    start_date: datetime
    end_date: datetime
    days: float
    purpose: str
    budget: float
    budget_unit: str
    currency: str
    transport: str
    attachments: Optional[str] = None
    status: str
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
