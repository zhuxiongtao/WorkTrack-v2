from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


# ===== 用户 =====
class UserOut(BaseModel):
    id: int
    username: str
    name: str
    email: Optional[str] = None
    is_admin: bool
    is_active: bool
    failed_login_attempts: int
    locked_until: Optional[str] = None
    last_login_at: Optional[str] = None
    created_at: Optional[str] = None


class UserCreate(BaseModel):
    username: str
    password: str
    name: str = ""
    email: Optional[str] = None
    is_admin: bool = False


class UserUpdate(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    is_admin: Optional[bool] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ===== 日报 =====
class DailyReportCreate(BaseModel):
    user_id: Optional[int] = None
    report_date: date
    content_md: str
    files_json: Optional[str] = None


class DailyReportUpdate(BaseModel):
    content_md: Optional[str] = None
    report_date: Optional[date] = None
    ai_summary: Optional[str] = None
    files_json: Optional[str] = None


class DailyReportOut(BaseModel):
    id: int
    user_id: int
    report_date: date
    content_md: str
    ai_summary: Optional[str] = None
    files_json: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ===== 客户 =====
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


# ===== 项目 =====
class ProjectCreate(BaseModel):
    customer_name: str = ""
    name: str
    opportunity_amount: Optional[float] = None
    deal_amount: Optional[float] = None
    currency: str = "CNY"  # CNY-人民币, USD-美元
    product: Optional[str] = None
    project_scenario: Optional[str] = None
    sales_person: Optional[str] = None
    status: str = ""
    progress: Optional[str] = None
    cloud_provider: Optional[str] = None
    files_json: Optional[str] = None
    start_date: Optional[date] = None
    termination_date: Optional[date] = None
    deadline: Optional[date] = None
    customer_id: Optional[int] = None
    meeting_ids: Optional[list[int]] = None


class ProjectUpdate(BaseModel):
    customer_name: Optional[str] = None
    name: Optional[str] = None
    opportunity_amount: Optional[float] = None
    deal_amount: Optional[float] = None
    currency: Optional[str] = None
    product: Optional[str] = None
    project_scenario: Optional[str] = None
    sales_person: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[str] = None
    cloud_provider: Optional[str] = None
    files_json: Optional[str] = None
    start_date: Optional[date] = None
    termination_date: Optional[date] = None
    deadline: Optional[date] = None
    customer_id: Optional[int] = None
    meeting_ids: Optional[list[int]] = None


class ProjectOut(BaseModel):
    id: int
    user_id: int
    customer_name: str
    name: str
    opportunity_amount: Optional[float] = None
    deal_amount: Optional[float] = None
    currency: str = "CNY"
    product: Optional[str] = None
    project_scenario: Optional[str] = None
    sales_person: Optional[str] = None
    status: str
    progress: Optional[str] = None
    analysis: Optional[str] = None
    cloud_provider: Optional[str] = None
    files_json: Optional[str] = None
    start_date: Optional[date] = None
    termination_date: Optional[date] = None
    deadline: Optional[date] = None
    customer_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


# ===== 会议纪要 =====
class MeetingNoteCreate(BaseModel):
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    title: str
    content_md: str = ""
    attendees: Optional[str] = None
    audio_url: Optional[str] = None
    files_json: Optional[str] = None
    meeting_date: datetime


class MeetingNoteUpdate(BaseModel):
    title: Optional[str] = None
    content_md: Optional[str] = None
    attendees: Optional[str] = None
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    audio_url: Optional[str] = None
    files_json: Optional[str] = None


class MeetingNoteOut(BaseModel):
    id: int
    user_id: int
    customer_id: Optional[int] = None
    project_id: Optional[int] = None
    title: str
    content_md: str
    ai_summary: Optional[str] = None
    attendees: Optional[str] = None
    audio_url: Optional[str] = None
    files_json: Optional[str] = None
    meeting_date: datetime
    created_at: datetime
