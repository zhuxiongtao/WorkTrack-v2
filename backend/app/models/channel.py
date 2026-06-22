"""通道（Channel）表：MaaS 平台一个供应商可挂 N 个通道

每个通道是某种模型族（Anthropic / GPT / Gemini 等）的具体供给形态：
- 官网通道（IAM 账号）
- 号池（CC 号池、bedrock 号池）
- 逆向号池
- 官方聚合通道（Azure / Google）
"""
from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field


class Channel(SQLModel, table=True):
    __tablename__ = "channel"

    id: Optional[int] = Field(default=None, primary_key=True)
    supplier_id: int = Field(foreign_key="supplier.id", index=True)

    # 通道基本
    model_type: str = ""           # 模型族：Anthropic Claude / OpenAI GPT / Google Gemini / 自定义
    name: str                       # 通道名称：AWS通道 / CC号池 / bedrock号池 / 逆向 / 官方通道 / Azure通道
    code: str = ""                  # 简码
    kind: str = "官网通道"          # 官网通道 / 号池 / 逆向 / 官方聚合 / 其他
    status: str = "合作中"          # 合作中 / 暂停 / 已终止

    # 价格 & 商务
    cost_price: float = 0.0         # 通道成本价（按 token 或按次，由 price_unit 决定）
    price_unit: str = "per_1k_token"  # per_1k_token / per_request / per_month
    discount_rate: float = 1.0      # 折扣率：0.85 = 85 折（用于销售报价）
    suggested_markup: float = 0.2   # 建议加价率（销售定价参考）：0.2 = 20% 加价

    # 合同
    contract_start: Optional[str] = None  # YYYY-MM
    contract_end: Optional[str] = None

    # SLA & 技术指标（JSON 字符串存储）
    sla_json: Optional[str] = None   # {"cache_hit_rate": 0.7, "tpm": 10000, "rpm": 60, "avg_latency_ms": 800}

    # 库存与状态（聚合统计字段，每次交付/归还时更新）
    inventory_total: int = 0         # 库存总数
    inventory_available: int = 0     # 在库可用数
    active_projects: int = 0         # 活跃关联项目数
    monthly_cost: float = 0.0        # 当月累计成本（冗余字段，便于查询）

    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
