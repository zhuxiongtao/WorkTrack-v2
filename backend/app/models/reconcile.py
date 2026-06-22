"""对账模块：销售对账 + 供应对账 + 财务总账 + 差异分析

对账周期：YYYY-MM（如 2026-06）
- 销售对账（应收）：按 project × period，客户应付金额
- 供应对账（应付）：按 channel × period，厂商应付金额
- 财务总账：按 period，汇总全公司销售 - 供应 = 毛利
- 差异分析：销售 call_vol vs 供应 call_vol、客户报价 vs 实调
"""
from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field


# ──── 销售对账 ────

class ReconcileSales(SQLModel, table=True):
    """客户应收对账（按项目 × 月份）"""
    __tablename__ = "reconcile_sales"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    period: str = Field(index=True)            # YYYY-MM
    customer_name: str = ""

    # 调用量
    call_volume: float = 0.0                   # 实际调用量（按 price_unit 折算）
    call_volume_unit: str = "per_1k_token"

    # 金额
    final_price: float = 0.0                   # 成交单价
    amount_due: float = 0.0                    # 应收金额

    # 状态
    invoice_status: str = "待开票"             # 待开票 / 已开票 / 已收款 / 争议
    diff_amount: float = 0.0                   # 与客户报价单差异金额

    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ──── 供应对账 ────

class ReconcileSupply(SQLModel, table=True):
    """通道应付对账（按通道 × 月份）"""
    __tablename__ = "reconcile_supply"

    id: Optional[int] = Field(default=None, primary_key=True)
    channel_id: int = Field(foreign_key="channel.id", index=True)
    supplier_id: int = Field(foreign_key="supplier.id", index=True)
    period: str = Field(index=True)            # YYYY-MM

    # 调用量
    call_volume: float = 0.0
    call_volume_unit: str = "per_1k_token"

    # 金额
    cost_price: float = 0.0                    # 通道成本单价
    amount_payable: float = 0.0                # 应付金额

    # 状态
    bill_status: str = "待付款"                # 待付款 / 已收票 / 已付款 / 争议
    diff_amount: float = 0.0                   # 与厂商账单差异

    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ──── 财务总账 ────

class ReconcileSummary(SQLModel, table=True):
    """财务总账（按月份）"""
    __tablename__ = "reconcile_summary"

    id: Optional[int] = Field(default=None, primary_key=True)
    period: str = Field(unique=True, index=True)   # YYYY-MM

    # 收入
    total_revenue: float = 0.0                # 销售总账单（应收汇总）
    invoice_count: int = 0                     # 已开票项目数

    # 支出
    total_cost: float = 0.0                    # 供应总账单（应付汇总）
    paid_count: int = 0                        # 已付款通道数

    # 测试成本（项目测试期间成本）
    test_cost: float = 0.0

    # 毛利
    gross_profit: float = 0.0                  # total_revenue - total_cost
    final_profit: float = 0.0                  # gross_profit - test_cost
    gross_margin: Optional[float] = None        # 毛利率 %

    status: str = "草稿"                       # 草稿 / 已复核 / 已锁定
    finalized_at: Optional[datetime] = None
    remarks: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ──── 差异分析 ────

class ReconcileDiff(SQLModel, table=True):
    """对账差异分析（销售 vs 供应调用量、客户报价 vs 实调）"""
    __tablename__ = "reconcile_diff"

    id: Optional[int] = Field(default=None, primary_key=True)
    period: str = Field(index=True)            # YYYY-MM
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    channel_id: Optional[int] = Field(default=None, foreign_key="channel.id")

    # 差异类型
    diff_type: str = "调用量差异"              # 调用量差异 / 报价差异 / 厂商账单差异

    # 数据
    sales_call_volume: float = 0.0             # 销售侧计费
    supply_call_volume: float = 0.0            # 供应侧计费
    diff_volume: float = 0.0                   # 差异量
    diff_amount: float = 0.0                   # 差异金额
    diff_pct: Optional[float] = None           # 差异百分比

    # 原因
    reason: Optional[str] = None               # 文本原因
    resolution: Optional[str] = None           # 处理结果

    status: str = "未处理"                     # 未处理 / 已解释 / 已处理 / 已结案
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
