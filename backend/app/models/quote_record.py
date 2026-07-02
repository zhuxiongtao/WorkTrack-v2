from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class QuoteRecord(SQLModel, table=True):
    __tablename__ = "quote_record"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    title: Optional[str] = None
    customer_name: Optional[str] = None
    valid_days: int = 30
    notes: Optional[str] = None
    items_json: str = Field(default="[]")
    share_token: Optional[str] = Field(default=None, index=True)
    quote_number: Optional[str] = None
    contact_name: Optional[str] = None
    app_scenario: Optional[str] = None
    special_requirements: Optional[str] = None
    settlement_method: Optional[str] = None
    expires_at: datetime
    created_at: datetime
    updated_at: datetime
