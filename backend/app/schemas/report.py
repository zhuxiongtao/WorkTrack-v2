from datetime import date, datetime
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict

VALID_REPORT_STATUSES = ("draft", "submitted")


class DailyReportCreate(BaseModel):
    user_id: Optional[int] = None
    report_date: date
    content_md: str
    files_json: Optional[str] = None
    status: Optional[Literal["draft", "submitted"]] = "draft"


class DailyReportUpdate(BaseModel):
    content_md: Optional[str] = None
    report_date: Optional[date] = None
    ai_summary: Optional[str] = None
    files_json: Optional[str] = None
    status: Optional[Literal["draft", "submitted"]] = None


class DailyReportOut(BaseModel):
    id: int
    user_id: int
    report_date: date
    content_md: str
    ai_summary: Optional[str] = None
    files_json: Optional[str] = None
    status: str = "draft"
    created_at: datetime
    updated_at: datetime
