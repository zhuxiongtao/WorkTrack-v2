from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class LegalEntityCreate(BaseModel):
    name: str
    short_name: str
    tax_id: Optional[str] = None
    balance: float = 0
    is_default: bool = False
    is_active: bool = True
    sort_order: int = 0


class LegalEntityUpdate(BaseModel):
    name: Optional[str] = None
    short_name: Optional[str] = None
    tax_id: Optional[str] = None
    balance: Optional[float] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class LegalEntityOut(BaseModel):
    id: int
    name: str
    short_name: str
    tax_id: Optional[str] = None
    balance: float
    is_default: bool
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
