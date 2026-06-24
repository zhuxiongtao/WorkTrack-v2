from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class Customer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    name: str
    industry: Optional[str] = None
    contact: Optional[str] = None
    status: str = "潜在"  # 潜在/接洽中/已签约/维护中
    core_products: Optional[str] = None      # 核心产品/明星产品
    business_scope: Optional[str] = None     # 主营业务
    scale: Optional[str] = None             # 规模人数
    profile: Optional[str] = None           # 公司简介
    recent_news: Optional[str] = None       # 近期动向
    recent_news_evidence: Optional[str] = None  # 近期动向来源 JSON: [{"url":..., "title":..., "domain":...}, ...]
    logo_url: Optional[str] = None          # 公司Logo URL
    website: Optional[str] = None           # 公司官网/产品官网
    ai_initiatives: Optional[str] = None     # AI 领域动向（基于真实联网搜索）
    ai_evidence: Optional[str] = None        # AI 动向的来源映射 JSON: [{"text":..., "url":..., "domain":...}, ...]
    created_at: datetime = Field(default_factory=lambda: now())
