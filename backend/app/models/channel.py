"""通道（Channel）表：MaaS 平台一个供应商可挂 N 个通道

通道状态由供应商合同有效期动态推算，通道本身只管理手动开关。
"""
from datetime import date, datetime
from typing import Optional
from app.utils.time import now
from sqlmodel import SQLModel, Field


def compute_channel_status(
    channel_status: str,
    contract_start: Optional[str],
    contract_end: Optional[str],
) -> str:
    """根据通道手动状态 + 供应商合同日期推算展示状态。"""
    if channel_status in ("暂停", "已终止"):
        return channel_status
    today = date.today()
    if contract_start:
        try:
            vf = datetime.strptime(contract_start, "%Y-%m").date()
            if vf > today:
                return "未生效"
        except ValueError:
            pass
    if not contract_end:
        return "长期有效"
    try:
        vu = datetime.strptime(contract_end, "%Y-%m").date()
        days_left = (vu - today).days
        if days_left < 0:
            return "已过期"
        if days_left <= 30:
            return "即将到期"
        return "生效中"
    except ValueError:
        return "生效中"


class Channel(SQLModel, table=True):
    __tablename__ = "channel"

    id: Optional[int] = Field(default=None, primary_key=True)
    supplier_id: int = Field(foreign_key="supplier.id", index=True)

    # 通道基本
    name: str
    code: str = ""
    api_protocol: str = "openai_compat"   # openai_compat / native / proxy / other
    status: str = "合作中"                 # 合作中 / 暂停 / 已终止（审批注入：待确认）

    # 通道成本与加价
    cost_discount: Optional[float] = None  # 上游成本折扣 0-1，如 0.5 = 5折（基于官方原价）
    markup: Optional[float] = None         # 加价折数 0-1，如 0.1 = 加价1折；对外售价 = cost_discount + markup
    cost_source: str = "manual"            # manual / import

    # 绑定模型
    scope_type: str = "all"               # all / family / single
    model_family: Optional[str] = None    # scope_type=family 时填写
    model_id: Optional[int] = None        # scope_type=single 时 FK to model_catalog

    # SLA & 技术指标（JSON 字符串）
    sla_json: Optional[str] = None

    # 聚合统计（自动更新）
    inventory_total: int = 0
    inventory_available: int = 0
    active_projects: int = 0
    monthly_cost: float = 0.0

    access_url: Optional[str] = None    # 接入地址（API Base URL）
    usage_url: Optional[str] = None     # 用量记录查看地址

    remarks: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
