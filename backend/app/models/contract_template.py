from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class ContractTemplate(SQLModel, table=True):
    __tablename__ = "contract_template"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    category: str = ""  # 销售合同/采购合同/服务合同/保密协议 etc.
    content: str = ""   # HTML 模板正文（含占位符如 [甲方名称]）
    is_active: bool = True
    created_by: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
