from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class ScheduledTask(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    trigger_type: str  # cron/interval/date
    trigger_config: str  # JSON: {cron: "...", hour: ...}
    action_type: str  # ai_summarize_daily / ai_analyze_project 等
    action_params: Optional[str] = None  # JSON 附加参数
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.now)
