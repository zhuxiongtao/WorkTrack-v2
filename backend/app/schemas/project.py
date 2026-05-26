from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    customer_name: str = ""
    name: str
    opportunity_amount: Optional[float] = None
    deal_amount: Optional[float] = None
    currency: str = "CNY"
    product: Optional[str] = None
    project_scenario: Optional[str] = None
    sales_person: Optional[str] = None
    status: str = ""
    progress: Optional[str] = None
    cloud_provider: Optional[str] = None
    files_json: Optional[str] = None
    start_date: Optional[date] = None
    termination_date: Optional[date] = None
    deadline: Optional[date] = None
    customer_id: Optional[int] = None
    meeting_ids: Optional[list[int]] = None


class ProjectUpdate(BaseModel):
    customer_name: Optional[str] = None
    name: Optional[str] = None
    opportunity_amount: Optional[float] = None
    deal_amount: Optional[float] = None
    currency: Optional[str] = None
    product: Optional[str] = None
    project_scenario: Optional[str] = None
    sales_person: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[str] = None
    cloud_provider: Optional[str] = None
    files_json: Optional[str] = None
    start_date: Optional[date] = None
    termination_date: Optional[date] = None
    deadline: Optional[date] = None
    customer_id: Optional[int] = None
    meeting_ids: Optional[list[int]] = None


class ProjectOut(BaseModel):
    id: int
    user_id: int
    customer_name: str
    name: str
    opportunity_amount: Optional[float] = None
    deal_amount: Optional[float] = None
    currency: str = "CNY"
    product: Optional[str] = None
    project_scenario: Optional[str] = None
    sales_person: Optional[str] = None
    status: str
    progress: Optional[str] = None
    analysis: Optional[str] = None
    cloud_provider: Optional[str] = None
    files_json: Optional[str] = None
    start_date: Optional[date] = None
    termination_date: Optional[date] = None
    deadline: Optional[date] = None
    customer_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
