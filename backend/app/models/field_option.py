from typing import Optional
from sqlmodel import SQLModel, Field


class FieldOption(SQLModel, table=True):
    """可管理的字段选项（行业、销售、状态等）"""
    id: Optional[int] = Field(default=None, primary_key=True)
    category: str  # 选项分类：industry / sales_person / project_status
    value: str  # 选项值
    sort_order: int = 0
