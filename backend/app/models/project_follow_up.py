from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field
from app.utils.time import now


class ProjectFollowUp(SQLModel, table=True):
    __tablename__ = "project_follow_up"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    track: str = Field(default="sales", max_length=10)  # sales | tech
    content: str = Field(max_length=4000)
    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
