"""请假申请模型

走统一审批引擎，business_type="leave"。审批通过后由 approval_engine._on_finished
扣减 LeaveBalance 对应额度；销假时返还。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class LeaveRequest(SQLModel, table=True):
    """请假申请单"""
    __tablename__ = "leave_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    leave_type: str = Field(max_length=20, index=True)   # 年假 / 事假 / 病假 / 调休 / 婚假 / 产假 / 陪产假 / 丧假
    title: str = Field(max_length=200)                    # 一句话摘要
    start_at: datetime                                    # 开始时间
    end_at: datetime                                      # 结束时间
    hours: float = Field(default=0)                       # 请假时长（小时）
    reason: str = Field(default="", max_length=2000)      # 请假事由

    # 附件（医疗证明等），JSON 数组（与前端 FileUpload filesJson 一致）
    attachments: Optional[str] = Field(default=None)

    # 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已销假
    status: str = Field(default="草稿", index=True, max_length=20)

    # 销假信息
    actual_end_at: Optional[datetime] = Field(default=None)  # 实际销假时间
    cancelled_at: Optional[datetime] = Field(default=None)   # 销假操作时间

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
