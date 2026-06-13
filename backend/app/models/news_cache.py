from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class NewsCache(SQLModel, table=True):
    """AI 资讯缓存（每日 RSS 抓取后落地，避免每次 Dashboard 都打外网）"""
    __tablename__ = "newscache"  # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    # RSS 条目的唯一标识（guid），用于去重
    guid: str = Field(index=True, unique=True, max_length=200)
    # 标题、链接、来源、描述
    title: str = Field(max_length=500)
    url: str = Field(max_length=1000)
    source: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    # 分类（按 author 来源简单归类：官方博客 / 社区 / 媒体 / 社交 / 其他）
    category: Optional[str] = Field(default=None, max_length=50, index=True)
    # RSS 原始发布时间 + 我们入库时间
    pub_date: Optional[datetime] = Field(default=None, index=True)
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
