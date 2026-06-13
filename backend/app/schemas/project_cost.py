"""项目成本利润 Schema"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class CostItemCreate(BaseModel):
    project_id: int
    category: str = "通道费"
    supplier_id: Optional[int] = None
    description: str = ""
    amount: float = 0.0
    cost_month: Optional[str] = None
    remarks: Optional[str] = None


class CostItemUpdate(BaseModel):
    category: Optional[str] = None
    supplier_id: Optional[int] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    cost_month: Optional[str] = None
    remarks: Optional[str] = None


class CostItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    user_id: Optional[int] = None
    category: str
    supplier_id: Optional[int] = None
    description: str
    amount: float
    cost_month: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ProjectProfitSummary(BaseModel):
    """单个项目的成本利润汇总"""
    project_id: int
    project_name: str
    customer_name: str = ""
    currency: str = "CNY"
    opportunity_amount: Optional[float] = None
    deal_amount: Optional[float] = None
    total_cost: float = 0.0
    gross_profit: Optional[float] = None
    gross_margin: Optional[float] = None
    sales_person: Optional[str] = None
    status: str = ""
    cost_items: list[CostItemOut] = []


class CategoryCostItem(BaseModel):
    """按类别汇总"""
    category: str
    amount: float = 0.0
    count: int = 0


class MonthlyCostItem(BaseModel):
    """按月份汇总"""
    month: str  # "2026-06"
    amount: float = 0.0
    count: int = 0


class SalesProfitItem(BaseModel):
    """按销售汇总"""
    sales_person: str
    project_count: int = 0
    total_deal: float = 0.0
    total_cost: float = 0.0
    gross_profit: float = 0.0
    gross_margin: Optional[float] = None


class OverallProfitSummary(BaseModel):
    """整体成本利润汇总"""
    total_projects: int = 0
    total_deal: float = 0.0
    total_cost: float = 0.0
    total_gross_profit: float = 0.0
    overall_margin: Optional[float] = None
    by_currency: dict[str, dict] = {}
    by_category: list[CategoryCostItem] = []
    by_month: list[MonthlyCostItem] = []
    by_sales: list[SalesProfitItem] = []
    top_margin_projects: list[ProjectProfitSummary] = []
    low_margin_projects: list[ProjectProfitSummary] = []
