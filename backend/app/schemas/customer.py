from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class CustomerCreate(BaseModel):
    name: str
    industry: Optional[str] = None
    contact: Optional[str] = None
    status: str = "潜在"
    core_products: Optional[str] = None
    business_scope: Optional[str] = None
    scale: Optional[str] = None
    profile: Optional[str] = None
    recent_news: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    contact: Optional[str] = None
    status: Optional[str] = None
    core_products: Optional[str] = None
    business_scope: Optional[str] = None
    scale: Optional[str] = None
    profile: Optional[str] = None
    recent_news: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None


class CustomerOut(BaseModel):
    id: int
    user_id: int
    name: str
    industry: Optional[str] = None
    contact: Optional[str] = None
    status: str
    core_products: Optional[str] = None
    business_scope: Optional[str] = None
    scale: Optional[str] = None
    profile: Optional[str] = None
    recent_news: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None
    created_at: datetime


class CompanySearchRequest(BaseModel):
    keyword: str


class CompanyInfoRequest(BaseModel):
    company_name: str


class CustomerContactCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    position: str = ""
    is_primary: bool = False


class CustomerContactUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    position: Optional[str] = None
    is_primary: Optional[bool] = None


class CustomerContactOut(BaseModel):
    id: int
    customer_id: int
    name: str
    phone: str
    email: str
    position: str
    is_primary: bool
    created_at: datetime
