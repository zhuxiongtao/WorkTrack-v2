from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SealCreate(BaseModel):
    seal_type: str = "公章"               # 公章 / 财务章 / 法人章
    title: str
    reason: str = ""
    copies: int = 1
    is_contract_related: bool = False
    contract_id: Optional[int] = None
    attachments: Optional[str] = None


class SealUpdate(BaseModel):
    seal_type: Optional[str] = None
    title: Optional[str] = None
    reason: Optional[str] = None
    copies: Optional[int] = None
    is_contract_related: Optional[bool] = None
    contract_id: Optional[int] = None
    attachments: Optional[str] = None


class SealOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None       # 申请人姓名
    seal_type: str
    title: str
    reason: str
    copies: int
    is_contract_related: bool
    contract_id: Optional[int] = None
    contract_title: Optional[str] = None  # 关联合同标题（展示用）
    attachments: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime
