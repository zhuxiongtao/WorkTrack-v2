"""采购供应商模型：用于采购申请的供应商/服务商

与 app/models/supplier.py（MaaS 模型供应商）完全独立，避免污染现有上游管理模块。
采购供应商侧重：银行账号、税号、开票信息等采购所需字段。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class PurchaseSupplier(SQLModel, table=True):
    """采购供应商"""
    __tablename__ = "purchase_supplier"

    id: Optional[int] = Field(default=None, primary_key=True)

    # ── 基本信息 ──
    name: str = Field(max_length=200, index=True)                    # 供应商名称
    short_name: Optional[str] = Field(default=None, max_length=100)   # 简称
    category: str = Field(default="其他", max_length=50)              # 类型：货物 / 服务 / 工程 / 其他
    status: str = Field(default="合作中", max_length=20, index=True)  # 合作中 / 暂停 / 已终止

    # ── 联系信息 ──
    contact_person: Optional[str] = Field(default=None, max_length=100)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    contact_email: Optional[str] = Field(default=None, max_length=100)
    address: Optional[str] = Field(default=None, max_length=500)

    # ── 商务/开票信息 ──
    bank_name: Optional[str] = Field(default=None, max_length=200)    # 开户行
    bank_account: Optional[str] = Field(default=None, max_length=100) # 银行账号
    tax_no: Optional[str] = Field(default=None, max_length=50)        # 纳税人识别号（统一社会信用代码）
    invoice_title: Optional[str] = Field(default=None, max_length=200) # 开票抬头（默认同 name）

    # ── 其他 ──
    remarks: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
