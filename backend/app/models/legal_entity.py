"""公司主体（我方名义）

报销时发票抬头对应的我方公司主体，例如：
- 杭州远石科技有限公司
- 杭州远石软件技术有限公司
"""
from datetime import datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field


class LegalEntity(SQLModel, table=True):
    __tablename__ = "legal_entity"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=200, index=True)
    short_name: str = Field(max_length=50)
    tax_id: Optional[str] = Field(default=None, max_length=50)
    balance: float = Field(default=0, description="账户余额快照，由财务维护")
    is_default: bool = Field(default=False, description="是否默认主体")
    is_active: bool = Field(default=True, index=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
