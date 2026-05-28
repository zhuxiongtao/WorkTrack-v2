from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class MeetingPermission(SQLModel, table=True):
    __tablename__ = "meeting_permission"
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meetingnote.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    permission: str = Field(max_length=20)  # "viewer" / "commenter" / "editor"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MeetingComment(SQLModel, table=True):
    __tablename__ = "meeting_comment"
    id: Optional[int] = Field(default=None, primary_key=True)
    meeting_id: int = Field(foreign_key="meetingnote.id", index=True)
    user_id: int = Field(foreign_key="user.id")
    content: str = Field()
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
