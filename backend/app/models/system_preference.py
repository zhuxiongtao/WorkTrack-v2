from typing import Optional
from sqlmodel import SQLModel, Field


class SystemPreference(SQLModel, table=True):
    """系统偏好设置（键值对，支持个人和全局）"""
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(index=True, max_length=100)
    value: str = Field(default="", max_length=5000)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
