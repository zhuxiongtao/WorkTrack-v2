from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class Customer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=1, foreign_key="user.id", index=True)
    name: str
    industry: Optional[str] = None
    contact: Optional[str] = None
    status: str = "潜在"  # 潜在/接洽中/已签约/维护中
    core_products: Optional[str] = None      # 核心产品/明星产品
    business_scope: Optional[str] = None     # 主营业务
    scale: Optional[str] = None             # 规模人数
    profile: Optional[str] = None           # 公司简介
    recent_news: Optional[str] = None       # 近期动向
    logo_url: Optional[str] = None          # 公司Logo URL
    website: Optional[str] = None           # 公司官网/产品官网
    created_at: datetime = Field(default_factory=datetime.now)
