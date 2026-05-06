from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class MeetingNote(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=1, foreign_key="user.id", index=True)
    customer_id: Optional[int] = Field(foreign_key="customer.id")
    project_id: Optional[int] = Field(foreign_key="project.id")
    title: str
    content_md: str
    ai_summary: Optional[str] = None
    attendees: Optional[str] = None
    audio_url: Optional[str] = None
    files_json: Optional[str] = Field(default=None, description="附件列表 JSON: [{name, path, size, type}]")
    meeting_date: datetime
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
