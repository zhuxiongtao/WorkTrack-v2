"""项目成本利润模型：支持多条成本明细，自动汇总计算毛利率"""
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class ProjectCost(SQLModel, table=True):
    """项目成本明细条目"""
    __tablename__ = "project_cost"

    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)

    # 成本类别：通道费 / 人力 / 硬件 / 软件 / 其他
    category: str = "通道费"
    # 关联供应商（通道费时选择对应供应商）
    supplier_id: Optional[int] = Field(default=None, foreign_key="supplier.id", index=True)
    # 明细描述
    description: str = ""
    # 金额（与项目同币种）
    amount: float = 0.0
    # 发生月份（可选，用于按月统计）
    cost_month: Optional[str] = None  # 格式 "2026-06"
    # 备注
    remarks: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
