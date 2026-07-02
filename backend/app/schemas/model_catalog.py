from typing import Optional
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict


class ModelCatalogOut(BaseModel):
    id: int
    name: str
    version_id: Optional[str] = None
    provider: Optional[str] = None
    region: str
    modality: Optional[str] = None
    release_date: Optional[date] = None
    description: Optional[str] = None
    source_url: Optional[str] = None
    confidence: Optional[float] = None
    is_active: bool
    last_seen_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[int] = None
    input_price: Optional[float] = None
    output_price: Optional[float] = None
    cache_read_price: Optional[float] = None
    cache_write_price: Optional[float] = None
    price_currency: str = "USD"
    price_unit: str = "美元/百万tokens"
    price_tiers: Optional[str] = None
    suppliers_list: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ModelCatalogUpdate(BaseModel):
    name: Optional[str] = None
    version_id: Optional[str] = None
    provider: Optional[str] = None
    region: Optional[str] = None
    modality: Optional[str] = None
    release_date: Optional[date] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    input_price: Optional[float] = None
    output_price: Optional[float] = None
    cache_read_price: Optional[float] = None
    cache_write_price: Optional[float] = None
    price_currency: Optional[str] = None
    price_unit: Optional[str] = None
    suppliers_list: Optional[str] = None


class ModelCatalogListItem(BaseModel):
    """给业务侧消费的精简形态（chip 列表）"""
    id: int
    name: str
    version_id: Optional[str] = None
    provider: Optional[str] = None
    region: str
    modality: Optional[str] = None
    input_price: Optional[float] = None
    output_price: Optional[float] = None
    cache_read_price: Optional[float] = None
    cache_write_price: Optional[float] = None
    price_currency: str = "USD"
    price_unit: str = "美元/百万tokens"
    price_tiers: Optional[str] = None
    suppliers_list: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ModelRefreshStatus(BaseModel):
    last_refresh_at: Optional[datetime] = None
    last_refresh_status: Optional[str] = None
    last_refresh_count: int = 0
    last_error: Optional[str] = None
    next_run_at: Optional[datetime] = None
    enabled: bool = True
    cron: str = "0 3 * * 1"


class ModelRefreshTriggerResult(BaseModel):
    success: bool
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    translated: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
