from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class CustomerContact(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="customer.id", index=True)
    name: str
    phone: str = ""
    email: str = ""
    position: str = ""
    is_primary: bool = False
    created_at: datetime = Field(default_factory=datetime.now)
