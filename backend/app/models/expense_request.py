"""报销申请模型

走统一审批引擎，business_type="expense"。
审批通过后由出纳执行付款（执行节点），状态变为"已付款"。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class ExpenseRequest(SQLModel, table=True):
    """报销申请单"""
    __tablename__ = "expense_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    title: str = Field(max_length=200)                    # 报销摘要
    expense_type: str = Field(max_length=50, index=True)  # 差旅/交通/餐饮/办公用品/通讯/培训/其他
    amount: float = Field(default=0)                      # 金额
    amount_unit: str = Field(default="元", max_length=10) # 元/万元
    currency: str = Field(default="CNY", max_length=10)   # 币种
    expense_date: datetime                                # 费用发生日期
    reason: str = Field(default="", max_length=2000)      # 报销事由

    # 附件（票据照片等），JSON 数组
    attachments: Optional[str] = Field(default=None)

    # 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已付款
    status: str = Field(default="草稿", index=True, max_length=20)

    # 付款信息
    paid_at: Optional[datetime] = Field(default=None)     # 付款时间
    paid_by: Optional[int] = Field(default=None, foreign_key="user.id")  # 付款操作人

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
