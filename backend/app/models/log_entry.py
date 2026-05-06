from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class LogEntry(SQLModel, table=True):
    """系统日志表：记录错误、任务执行、操作等"""
    id: Optional[int] = Field(default=None, primary_key=True)
    level: str = Field(default="info")  # info / warning / error
    category: str = Field(default="system")  # system / task / ai / report / meeting / project / other
    message: str  # 简要描述
    details: Optional[str] = None  # 详细堆栈/上下文
    created_at: datetime = Field(default_factory=datetime.now)
