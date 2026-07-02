"""供应商管理模型：MaaS 平台接入的模型供应商"""
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class Supplier(SQLModel, table=True):
    """模型供应商"""
    __tablename__ = "supplier"

    id: Optional[int] = Field(default=None, primary_key=True)

    # ── 基本信息 ──
    name: str  # 供应商名称，如 OpenAI、Anthropic、Google Cloud
    code: str = ""  # 简码，如 openai、anthropic、gcp（用于关联项目 upstream_channels）
    category: str = "模型厂商"  # 类型：模型厂商 / 云服务商 / 代理商 / 其他
    status: str = "合作中"  # 合作中 / 暂停 / 已终止

    # ── 联系信息 ──
    contact_person: Optional[str] = None  # 对接人
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None

    # ── 商务信息 ──
    settlement_currency: str = "USD"  # 结算币种
    payment_terms: Optional[str] = None  # 付款条件（兼容旧数据）
    settlement_method: Optional[str] = None  # 预付 / 月结 / 授信
    settlement_cycle_days: Optional[int] = None  # 结算周期（天）
    prepaid_balance: Optional[float] = None  # 预付余额（元，手填）
    credit_limit: Optional[float] = None  # 信用额度（元）
    current_month_consumed: Optional[float] = None  # 本月已消费（元，自动核算只读）
    contract_start: Optional[str] = None  # 合同起始（格式 "2026-01"）
    contract_end: Optional[str] = None  # 合同终止

    # ── 技术信息 ──
    api_endpoint: Optional[str] = None  # API 调用入口
    api_doc_url: Optional[str] = None  # API 文档地址
    models_provided: Optional[str] = None  # 提供的模型列表（逗号分隔）
    auth_type: Optional[str] = None  # 认证方式：API Key / OAuth / 其他
    im_group: Optional[str] = None  # 微信/飞书群

    # ── 业务统计（由系统自动计算/更新） ──
    total_cost: Optional[float] = None  # 累计通道费成本
    project_count: Optional[int] = None  # 关联项目数

    # ── 其他 ──
    remarks: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
