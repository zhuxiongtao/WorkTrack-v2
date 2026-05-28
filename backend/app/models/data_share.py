"""数据分享模型：支持单条业务数据的跨部门分享与评论"""

from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class DataShare(SQLModel, table=True):
    """单条数据分享记录"""
    __tablename__ = "data_share"

    id: Optional[int] = Field(default=None, primary_key=True)
    target_type: str = Field(max_length=20)  # "report" | "meeting" | "project" | "customer" | "contract"
    target_id: int
    shared_by: int = Field(foreign_key="user.id")
    shared_to: int = Field(foreign_key="user.id")
    permission: str = Field(default="viewer", max_length=20)  # "viewer" | "commenter"
    expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DataShareComment(SQLModel, table=True):
    """分享评论"""
    __tablename__ = "data_share_comment"

    id: Optional[int] = Field(default=None, primary_key=True)
    share_id: int = Field(foreign_key="data_share.id")
    user_id: int = Field(foreign_key="user.id")
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
