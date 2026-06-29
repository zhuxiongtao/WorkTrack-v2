from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class JobTitle(SQLModel, table=True):
    __tablename__ = "job_title"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=100, unique=True)
    description: Optional[str] = Field(default=None, max_length=255)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: now())
