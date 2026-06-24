"""加班申请模型

走统一审批引擎，business_type="overtime"。
审批通过后若 compensate_type=调休，则按加班时长授予对应调休额度（LeaveBalance）。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class OvertimeRequest(SQLModel, table=True):
    """加班申请单"""
    __tablename__ = "overtime_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    title: str = Field(max_length=200)                    # 一句话摘要
    start_at: datetime                                    # 加班开始时间
    end_at: datetime                                      # 加班结束时间
    hours: float = Field(default=0)                       # 加班时长（小时）
    reason: str = Field(default="", max_length=2000)      # 加班事由

    # 补偿方式：调休 / 加班费
    compensate_type: str = Field(default="调休", max_length=20)

    # 附件，JSON 数组
    attachments: Optional[str] = Field(default=None)

    # 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回
    status: str = Field(default="草稿", index=True, max_length=20)

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
