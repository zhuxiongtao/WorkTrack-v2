from typing import Optional
from datetime import datetime, date, timezone
from sqlmodel import SQLModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ModelCatalog(SQLModel, table=True):
    """模型目录：Tavily 联网采集 + LLM 结构化抽取产出
    采集入库默认 is_active=False，需要管理员在「业务管理 → 模型管理」中审校确认后才对业务可见。
    """
    __tablename__ = "modelcatalog"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=255, index=True)  # GPT-5 / Claude 4.5 Sonnet
    version_id: Optional[str] = Field(default=None, max_length=255, index=True)  # gpt-5-2025-08-07
    provider: Optional[str] = Field(default=None, max_length=120, index=True)  # OpenAI
    region: str = Field(max_length=20, index=True)  # domestic / international
    modality: Optional[str] = Field(default=None, max_length=40)  # text / multimodal / code / embedding
    release_date: Optional[date] = None
    description: Optional[str] = None
    source_url: Optional[str] = Field(default=None, max_length=1000)
    confidence: Optional[float] = None  # 0.0 ~ 1.0
    is_active: bool = Field(default=False, index=True)
    last_seen_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[int] = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
