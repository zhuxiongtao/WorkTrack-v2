from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True, max_length=50)
    password_hash: str
    name: str = ""
    email: Optional[str] = Field(default=None, max_length=120)
    is_admin: bool = Field(default=False)
    is_active: bool = Field(default=True)
    use_shared_models: bool = Field(default=False)  # 是否可以使用平台共享模型
    can_manage_models: bool = Field(default=False)  # 是否可以管理自己的模型供应商
    avatar: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: Optional[datetime] = Field(default=None)
    failed_login_attempts: int = Field(default=0)
    locked_until: Optional[datetime] = Field(default=None)
    token_version: int = Field(default=1)
