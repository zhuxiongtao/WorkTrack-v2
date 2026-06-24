"""付款申请模型：供应商付款 / 员工报销 / 工资 / 其他付款

走统一审批引擎，business_type="payment"。审批链末节点为「出纳付款」执行节点，
全部通过后 status→已付款（见 approval_engine._on_finished）。
"""
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class PaymentRequest(SQLModel, table=True):
    """付款申请单"""
    __tablename__ = "payment_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)   # 申请人

    # 供应商付款 | 员工报销 | 工资 | 其他
    payment_type: str = Field(default="其他", index=True, max_length=20)
    title: str = Field(max_length=200)                         # 一句话摘要
    amount: float = Field(default=0)                           # 付款金额
    amount_unit: str = Field(default="元", max_length=10)      # 付款金额单位：元 | 万元
    currency: str = Field(default="CNY", max_length=10)        # 币种
    payee: str = Field(default="", max_length=200)             # 收款方
    payee_account: Optional[str] = Field(default=None, max_length=200)  # 收款账号（可选）
    reason: str = Field(default="", max_length=2000)           # 付款事由 / 说明
    contract_id: Optional[int] = Field(default=None, foreign_key="contract.id", index=True)  # 关联合同（可选）

    # 票据 / 发票附件，JSON 数组（与前端 FileUpload filesJson 一致）
    attachments: Optional[str] = Field(default=None)

    # 草稿 | 审批中 | 已付款 | 已驳回 | 已撤回
    status: str = Field(default="草稿", index=True, max_length=20)

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
