from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class ModelUsageLog(SQLModel, table=True):
    """每次 LLM API 调用的 token 消耗记录"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    provider_id: Optional[int] = Field(default=None, foreign_key="modelprovider.id", index=True)
    model_name: str = Field(index=True)
    task_type: str = Field(default="chat", index=True)  # chat / embedding / vision / speech_to_text
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    cache_read_tokens: int = Field(default=0)   # OpenAI cached_tokens / Anthropic cache_read_input_tokens
    cache_write_tokens: int = Field(default=0)  # Anthropic cache_creation_input_tokens
    total_tokens: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: now(), index=True)
