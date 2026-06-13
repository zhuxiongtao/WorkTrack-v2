from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class MeetingNoteCreate(BaseModel):
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    title: str
    content_md: str = ""
    attendees: Optional[str] = None
    audio_url: Optional[str] = None
    files_json: Optional[str] = None
    meeting_date: datetime


class MeetingNoteUpdate(BaseModel):
    title: Optional[str] = None
    content_md: Optional[str] = None
    attendees: Optional[str] = None
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    audio_url: Optional[str] = None
    files_json: Optional[str] = None


class MeetingNoteOut(BaseModel):
    id: int
    user_id: int
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    title: str
    content_md: str
    ai_summary: Optional[str] = None
    attendees: Optional[str] = None
    audio_url: Optional[str] = None
    files_json: Optional[str] = None
    meeting_date: datetime
    created_at: datetime
    is_shared: Optional[bool] = None
    shared_permission: Optional[str] = None
    owner_name: Optional[str] = None
