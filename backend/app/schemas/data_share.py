from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class DataShareCreate(BaseModel):
    target_type: str  # "report" | "meeting" | "project" | "customer" | "contract"
    target_id: int
    shared_to: int
    permission: str = "viewer"  # "viewer" | "commenter"
    expires_at: Optional[datetime] = None


class DataShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_type: str
    target_id: int
    shared_by: int
    shared_to: int
    shared_to_name: str = ""
    permission: str
    expires_at: Optional[datetime] = None
    created_at: datetime
    # 数据摘要（用于列表展示）
    target_title: str = ""


class DataShareCommentCreate(BaseModel):
    content: str


class DataShareCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    share_id: int
    user_id: int
    user_name: str = ""
    user_avatar: Optional[str] = None
    content: str
    created_at: datetime
