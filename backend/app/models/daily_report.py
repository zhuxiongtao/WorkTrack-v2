from typing import Optional
from datetime import date, datetime
from sqlmodel import SQLModel, Field


class DailyReport(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    report_date: date
    content_md: str
    ai_summary: Optional[str] = None
    files_json: Optional[str] = Field(default=None, description="附件列表 JSON: [{name, path, size, type}]")
    status: str = Field(default="draft", max_length=50) # "draft" (草稿) 或 "submitted" (已提交)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
