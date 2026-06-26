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
    amount: float = Field(default=0)                      # 金额（所有明细汇总）
    amount_unit: str = Field(default="元", max_length=10) # 元/万元
    currency: str = Field(default="CNY", max_length=10)   # 币种
    expense_date: datetime                                # 费用发生日期
    reason: str = Field(default="", max_length=2000)      # 报销事由

    # 附件（票据照片等），JSON 数组
    attachments: Optional[str] = Field(default=None)

    # 报销明细（JSON 数组），每项 {expense_type, expense_date, amount, note}
    items: Optional[str] = Field(default=None)

    # 关联出差申请（差旅类型报销时必填），指向 business_trip_request.id
    trip_id: Optional[int] = Field(default=None, foreign_key="business_trip_request.id")

    # 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已付款
    status: str = Field(default="草稿", index=True, max_length=20)

    # 付款信息
    paid_at: Optional[datetime] = Field(default=None)     # 付款时间
    paid_by: Optional[int] = Field(default=None, foreign_key="user.id")  # 付款操作人

    # ── V2 扩展字段 ──
    invoice_entity_id: Optional[int] = Field(default=None, foreign_key="legal_entity.id", description="发票的我方名义")
    priority_offset_loan: bool = Field(default=False, description="是否优先抵消借款")
    offset_loan_amount: float = Field(default=0, description="本次抵消借款金额（系统计算）")
    account_balance: float = Field(default=0, description="账户余额快照")
    company_should_pay: float = Field(default=0, description="公司应支付个人")
    actual_pay_amount: float = Field(default=0, description="个人实发金额")
    company_owes_personal: float = Field(default=0, description="实报后公司欠个人")

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
