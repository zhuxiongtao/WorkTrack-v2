"""采购申请模型

走统一审批引擎，business_type="purchase"。
审批通过后执行采购，可关联 PurchaseSupplier。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class PurchaseRequest(SQLModel, table=True):
    """采购申请单"""
    __tablename__ = "purchase_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)

    title: str = Field(max_length=200)                    # 采购摘要
    purchase_type: str = Field(max_length=50, index=True) # 办公用品/设备/服务/其他

    # 关联采购供应商（可选）
    supplier_id: Optional[int] = Field(default=None, foreign_key="purchase_supplier.id", index=True)

    # 采购明细（JSON 数组，每项含 name/spec/qty/unit_price/amount）
    items: Optional[str] = Field(default=None)

    total_amount: float = Field(default=0)                # 总金额
    amount_unit: str = Field(default="元", max_length=10) # 元/万元
    currency: str = Field(default="CNY", max_length=10)

    reason: str = Field(default="", max_length=2000)      # 采购事由
    expected_date: Optional[datetime] = Field(default=None)  # 期望到货日期

    # 附件（报价单等），JSON 数组
    attachments: Optional[str] = Field(default=None)

    # 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已采购 | 已入库
    status: str = Field(default="草稿", index=True, max_length=20)

    purchased_at: Optional[datetime] = Field(default=None)  # 采购完成时间
    stored_at: Optional[datetime] = Field(default=None)     # 入库时间

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
