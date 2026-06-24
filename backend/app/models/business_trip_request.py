"""出差申请模型

走统一审批引擎，business_type="business_trip"。
审批通过后员工出差，结束后可标记"已完成"。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class BusinessTripRequest(SQLModel, table=True):
    """出差申请单"""
    __tablename__ = "business_trip_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    title: str = Field(max_length=200)                    # 出差摘要
    destination: str = Field(max_length=200)              # 目的地
    start_date: datetime                                  # 开始日期
    end_date: datetime                                    # 结束日期
    days: float = Field(default=0)                        # 天数
    purpose: str = Field(default="", max_length=2000)     # 出差目的

    # 预算
    budget: float = Field(default=0)                      # 预算金额
    budget_unit: str = Field(default="元", max_length=10) # 元/万元
    currency: str = Field(default="CNY", max_length=10)

    # 交通方式：飞机/高铁/火车/汽车/其他
    transport: str = Field(default="其他", max_length=20)

    # 附件（行程单等），JSON 数组
    attachments: Optional[str] = Field(default=None)

    # 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已完成
    status: str = Field(default="草稿", index=True, max_length=20)

    completed_at: Optional[datetime] = Field(default=None)  # 完成时间

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
