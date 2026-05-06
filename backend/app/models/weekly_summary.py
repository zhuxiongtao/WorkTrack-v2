from typing import Optional
from datetime import date, datetime
from sqlmodel import SQLModel, Field


class WeeklySummary(SQLModel, table=True):
    """周报 AI 总结持久化存储"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=1, foreign_key="user.id", index=True)
    week_start: date = Field(index=True)
    week_end: date
    summary_text: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.now)
