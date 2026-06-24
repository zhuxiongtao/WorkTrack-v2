from typing import Optional
from datetime import date, datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    customer_id: Optional[int] = Field(default=None, foreign_key="customer.id")
    customer_name: str = ""  # 客户名称
    name: str  # 项目名称
    opportunity_amount: Optional[float] = None  # 商机金额
    opportunity_amount_unit: str = "万元"         # 商机金额单位：元 | 万元
    deal_amount: Optional[float] = None          # 成交价格
    deal_amount_unit: str = "万元"                # 成交金额单位：元 | 万元
    currency: str = "CNY"                        # 币种: CNY-人民币 USD-美元
    start_date: Optional[date] = None  # 开始时间
    termination_date: Optional[date] = None  # 终止时间
    product: Optional[str] = None  # 涉及产品（选项管理）
    project_scenario: Optional[str] = None  # 项目场景（选项管理）
    sales_person: Optional[str] = None  # 销售（选项管理）
    tech_support_person: Optional[str] = None  # 技术支持（姓名冗余，保留兼容）
    tech_support_user_id: Optional[int] = Field(default=None, foreign_key="user.id")  # 技术支持用户 FK
    status: str = ""  # 状态（选项管理）
    progress: Optional[str] = None  # 进展记录
    analysis: Optional[str] = None  # AI 项目分析结果
    cloud_provider: Optional[str] = None  # 供应商/上游通道（逗号分隔多选）
    files_json: Optional[str] = Field(default=None, description="附件列表 JSON: [{name, path, size, type}]")
    deadline: Optional[date] = None

    # ====== MaaS 平台扩展字段 ======
    discount_rate: Optional[float] = None  # 客户折扣率（百分比，0-100，如 20 表示 8 折）
    cost_amount: Optional[float] = None  # 内部成本金额（元，cost = 供应商通道费合计，始终为元单位）
    gross_margin: Optional[float] = None  # 毛利率（百分比，自动计算：1 - cost/deal）
    upstream_channels: Optional[str] = None  # 上游供应商通道（逗号分隔多选 ID 或名称）
    models: Optional[str] = None  # 使用的模型（逗号分隔多选，与上游通道对应）
    monthly_call_volume: Optional[str] = None  # 预计月调用量（文本，可填 "1M tokens" / "5万次" 等）
    usage_scenario: Optional[str] = None  # 客户使用场景（自由文本 + 选项混合）
    contract_period: Optional[str] = None  # 合同周期（如 "1年" / "季度"）

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
