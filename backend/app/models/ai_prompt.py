from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class AIPrompt(SQLModel, table=True):
    """AI 任务提示词配置 —— 用户可自定义每个 AI 场景的 system prompt 和用户消息模板"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=0, index=True)
    task_type: str = Field(index=True, max_length=50)
    system_prompt: str = Field(default="", max_length=2000)
    user_prompt_template: str = Field(default="", max_length=2000)
    updated_at: datetime = Field(default_factory=datetime.now)
