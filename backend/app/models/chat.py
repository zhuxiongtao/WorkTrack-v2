from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class ChatConversation(SQLModel, table=True):
    """AI 对话会话"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    title: str = "新对话"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChatMessage(SQLModel, table=True):
    """AI 对话消息"""
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="chatconversation.id", index=True)
    role: str  # user / assistant
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
