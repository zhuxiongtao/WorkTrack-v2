from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class LeaveCreate(BaseModel):
    leave_type: str               # 年假 / 事假 / 病假 / 调休 / 婚假 / 产假 / 陪产假 / 丧假
    title: str
    start_at: datetime
    end_at: datetime
    hours: float = 0
    reason: str = ""
    attachments: Optional[str] = None


class LeaveUpdate(BaseModel):
    leave_type: Optional[str] = None
    title: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    hours: Optional[float] = None
    reason: Optional[str] = None
    attachments: Optional[str] = None


class LeaveOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    leave_type: str
    title: str
    start_at: datetime
    end_at: datetime
    hours: float
    reason: str
    attachments: Optional[str] = None
    status: str
    actual_end_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class LeaveCancelBody(BaseModel):
    """销假请求体"""
    actual_end_at: Optional[datetime] = None   # 实际销假时间，默认当前
