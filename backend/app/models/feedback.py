"""意见反馈数据模型：Bug / 需求 / 体验改进收集与后台处理"""
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class Feedback(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)  # 提交人

    category: str = Field(default="feature", index=True)  # bug=问题 / feature=新功能 / improve=体验改进 / other
    module: str                                  # 功能模块（菜单标签或自定义文本）
    is_custom_module: bool = Field(default=False)  # 是否用户自定义模块

    title: str                                   # 一句话标题
    content: str                                 # 详细描述
    images: Optional[str] = None                 # 截图 JSON 数组（复用 FileUpload）
    contact: Optional[str] = None                # 可选额外联系方式

    user_priority: str = Field(default="medium")  # 提交者主观紧急度 low/medium/high

    # —— 后台处理字段 ——
    status: str = Field(default="pending", index=True)  # pending/reviewing/processing/done/closed/wontfix
    admin_priority: Optional[str] = None         # 管理员评定优先级 low/medium/high
    handler_id: Optional[int] = Field(default=None, foreign_key="user.id")  # 处理人
    admin_reply: Optional[str] = None            # 给提交者的回复

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
    resolved_at: Optional[datetime] = None
