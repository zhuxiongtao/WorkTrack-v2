"""企业资产模型

独立 CRUD 管理，不走审批流程。
用于登记和追踪企业固定资产（电子设备/办公家具/车辆等）。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class Asset(SQLModel, table=True):
    """企业资产"""
    __tablename__ = "asset"

    id: Optional[int] = Field(default=None, primary_key=True)

    name: str = Field(max_length=200, index=True)          # 资产名称
    asset_no: Optional[str] = Field(default=None, max_length=100, index=True)  # 资产编号
    category: str = Field(default="其他", max_length=50, index=True)  # 电子设备/办公家具/车辆/房屋/其他
    spec: Optional[str] = Field(default=None, max_length=200)  # 规格型号

    # 购置信息
    purchase_date: Optional[datetime] = Field(default=None)
    purchase_price: float = Field(default=0)               # 购置价格
    amount_unit: str = Field(default="元", max_length=10)
    currency: str = Field(default="CNY", max_length=10)

    # 使用信息
    status: str = Field(default="在用", index=True, max_length=20)  # 在用/闲置/维修中/已报废
    location: Optional[str] = Field(default=None, max_length=200)   # 存放位置
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)  # 使用人
    supplier_id: Optional[int] = Field(default=None, foreign_key="purchase_supplier.id")  # 采购供应商

    remarks: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
