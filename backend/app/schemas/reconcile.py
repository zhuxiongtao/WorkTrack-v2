"""对账 Schema"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict


# ──── 销售对账 ────

class ReconcileSalesCreate(BaseModel):
    project_id: int
    period: str
    customer_name: str = ""
    call_volume: float = 0.0
    call_volume_unit: str = "per_1k_token"
    final_price: float = 0.0
    amount_due: float = 0.0
    invoice_status: str = "待开票"
    diff_amount: float = 0.0
    remarks: Optional[str] = None


class ReconcileSalesUpdate(BaseModel):
    call_volume: Optional[float] = None
    call_volume_unit: Optional[str] = None
    final_price: Optional[float] = None
    amount_due: Optional[float] = None
    invoice_status: Optional[str] = None
    diff_amount: Optional[float] = None
    remarks: Optional[str] = None


class ReconcileSalesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    period: str
    customer_name: str
    call_volume: float
    call_volume_unit: str
    final_price: float
    amount_due: float
    invoice_status: str
    diff_amount: float
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ──── 供应对账 ────

class ReconcileSupplyCreate(BaseModel):
    channel_id: int
    supplier_id: int
    period: str
    call_volume: float = 0.0
    call_volume_unit: str = "per_1k_token"
    cost_price: float = 0.0
    amount_payable: float = 0.0
    bill_status: str = "待付款"
    diff_amount: float = 0.0
    remarks: Optional[str] = None


class ReconcileSupplyUpdate(BaseModel):
    call_volume: Optional[float] = None
    call_volume_unit: Optional[str] = None
    cost_price: Optional[float] = None
    amount_payable: Optional[float] = None
    bill_status: Optional[str] = None
    diff_amount: Optional[float] = None
    remarks: Optional[str] = None


class ReconcileSupplyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    channel_id: int
    supplier_id: int
    period: str
    call_volume: float
    call_volume_unit: str
    cost_price: float
    amount_payable: float
    bill_status: str
    diff_amount: float
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ──── 财务总账 ────

class ReconcileSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    period: str
    total_revenue: float
    invoice_count: int
    total_cost: float
    paid_count: int
    test_cost: float
    gross_profit: float
    final_profit: float
    gross_margin: Optional[float] = None
    status: str
    finalized_at: Optional[datetime] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ──── 差异分析 ────

class ReconcileDiffCreate(BaseModel):
    period: str
    project_id: Optional[int] = None
    channel_id: Optional[int] = None
    diff_type: str = "调用量差异"
    sales_call_volume: float = 0.0
    supply_call_volume: float = 0.0
    diff_volume: float = 0.0
    diff_amount: float = 0.0
    reason: Optional[str] = None
    resolution: Optional[str] = None
    status: str = "未处理"


class ReconcileDiffUpdate(BaseModel):
    diff_type: Optional[str] = None
    sales_call_volume: Optional[float] = None
    supply_call_volume: Optional[float] = None
    diff_volume: Optional[float] = None
    diff_amount: Optional[float] = None
    reason: Optional[str] = None
    resolution: Optional[str] = None
    status: Optional[str] = None


class ReconcileDiffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    period: str
    project_id: Optional[int] = None
    channel_id: Optional[int] = None
    diff_type: str
    sales_call_volume: float
    supply_call_volume: float
    diff_volume: float
    diff_amount: float
    diff_pct: Optional[float] = None
    reason: Optional[str] = None
    resolution: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime


# ──── 总账聚合统计 ────

class ReconcileOverallSummary(BaseModel):
    """对账总览：销售应收 / 供应应付 / 毛利 / 差异笔数"""
    period: str
    total_revenue: float
    total_cost: float
    gross_profit: float
    gross_margin: Optional[float] = None
    invoice_count: int
    paid_count: int
    diff_count: int
    diff_amount_total: float
    by_invoice_status: dict
    by_bill_status: dict
    by_diff_type: dict
