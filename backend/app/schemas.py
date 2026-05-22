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
    status: Optional[str] = "draft"


class DailyReportUpdate(BaseModel):
    content_md: Optional[str] = None
    report_date: Optional[date] = None
    ai_summary: Optional[str] = None
    files_json: Optional[str] = None
    status: Optional[str] = None


class DailyReportOut(BaseModel):
    id: int
    user_id: int
    report_date: date
    content_md: str
    ai_summary: Optional[str] = None
    files_json: Optional[str] = None
    status: str = "draft"
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


class ContractCreate(BaseModel):
    title: str
    contract_no: str = ""
    customer_id: int
    project_id: Optional[int] = None
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: str = ""
    party_b: str = ""
    contract_amount: Optional[float] = None
    currency: str = "CNY"
    payment_terms: Optional[str] = None
    remarks: Optional[str] = None


class ContractUpdate(BaseModel):
    title: Optional[str] = None
    contract_no: Optional[str] = None
    project_id: Optional[int] = None
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    contract_amount: Optional[float] = None
    currency: Optional[str] = None
    payment_terms: Optional[str] = None
    status: Optional[str] = None
    remarks: Optional[str] = None


class ContractOut(BaseModel):
    id: int
    user_id: int
    customer_id: int
    project_id: Optional[int] = None
    title: str
    contract_no: str
    file_path: str
    file_name: str
    file_type: str
    file_size: int
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: str
    party_b: str
    contract_amount: Optional[float] = None
    currency: str
    payment_terms: Optional[str] = None
    key_clauses: Optional[str] = None
    summary: Optional[str] = None
    status: str
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ===== Wiki 模块 =====

class WikiSpaceCreate(BaseModel):
    name: str
    description: str = ""
    cover_type: str = "gradient-1"
    cover_url: str = ""


class WikiSpaceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    cover_type: Optional[str] = None
    cover_url: Optional[str] = None
    share_password: Optional[str] = None
    share_expires_at: Optional[datetime] = None


class WikiSpaceOut(BaseModel):
    id: int
    name: str
    description: str
    owner_id: int
    is_public: bool
    cover_type: str
    cover_url: str
    share_password: Optional[str] = None
    share_expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    is_owner: bool = False
    is_shared: bool = False
    is_page_collaborative: bool = False


class WikiPageCreate(BaseModel):
    space_id: int
    parent_id: Optional[int] = None
    title: str
    content: str = ""


class WikiPageUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class WikiPageOut(BaseModel):
    id: int
    space_id: int
    parent_id: Optional[int] = None
    title: str
    content: str = ""
    sort_order: int
    created_by: int
    updated_by: int
    created_at: datetime
    updated_at: datetime
    creator_name: Optional[str] = None
    editor_names: list[str] = []
    my_permission: str = "viewer"


class WikiPageTreeNode(BaseModel):
    """页面树节点，用于前端目录树渲染"""
    id: int
    title: str
    parent_id: Optional[int] = None
    sort_order: int
    children: list["WikiPageTreeNode"] = []


class WikiPermissionCreate(BaseModel):
    target_type: str  # "space" 或 "page"
    target_id: int
    subject_type: str  # "user" 或 "group"
    subject_id: int
    permission: str  # "viewer" / "editor" / "admin"


class WikiPermissionOut(BaseModel):
    id: int
    target_type: str
    target_id: int
    subject_type: str
    subject_id: int
    permission: str


class WikiPageVersionOut(BaseModel):
    id: int
    page_id: int
    content: str
    version: int
    created_by: int
    created_at: datetime


class WikiUserGroupCreate(BaseModel):
    name: str


class WikiUserGroupOut(BaseModel):
    id: int
    name: str
    owner_id: int
    created_at: datetime
    member_count: int = 0


class WikiUserGroupMemberAdd(BaseModel):
    user_id: int
