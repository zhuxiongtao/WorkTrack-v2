from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class FeedbackCreate(BaseModel):
    category: str = "feature"            # bug / feature / improve / other
    module: str
    is_custom_module: bool = False
    title: str
    content: str
    images: Optional[str] = None
    contact: Optional[str] = None
    user_priority: str = "medium"         # low / medium / high


class FeedbackAdminUpdate(BaseModel):
    status: Optional[str] = None          # pending/reviewing/processing/done/closed/wontfix
    admin_priority: Optional[str] = None  # low / medium / high
    handler_id: Optional[int] = None
    admin_reply: Optional[str] = None


class FeedbackOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None       # 提交人姓名（后台展示）
    category: str
    module: str
    is_custom_module: bool
    title: str
    content: str
    images: Optional[str] = None
    contact: Optional[str] = None
    user_priority: str
    status: str
    admin_priority: Optional[str] = None
    handler_id: Optional[int] = None
    handler_name: Optional[str] = None     # 处理人姓名
    admin_reply: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None
