from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class ChatConversation(SQLModel, table=True):
    """AI 对话会话"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=1, foreign_key="user.id", index=True)
    title: str = "新对话"
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class ChatMessage(SQLModel, table=True):
    """AI 对话消息"""
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="chatconversation.id", index=True)
    role: str  # user / assistant
    content: str
    created_at: datetime = Field(default_factory=datetime.now)
