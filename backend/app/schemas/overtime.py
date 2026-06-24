from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class OvertimeCreate(BaseModel):
    title: str
    start_at: datetime
    end_at: datetime
    hours: float = 0
    reason: str = ""
    compensate_type: str = "调休"   # 调休 / 加班费
    attachments: Optional[str] = None


class OvertimeUpdate(BaseModel):
    title: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    hours: Optional[float] = None
    reason: Optional[str] = None
    compensate_type: Optional[str] = None
    attachments: Optional[str] = None


class OvertimeOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    title: str
    start_at: datetime
    end_at: datetime
    hours: float
    reason: str
    compensate_type: str
    attachments: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime
