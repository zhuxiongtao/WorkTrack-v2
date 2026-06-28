"""员工入职申请 schemas"""
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class HireCreate(BaseModel):
    """创建入职申请"""
    candidate_name: str
    candidate_username: str
    candidate_email: str
    candidate_phone: Optional[str] = None
    job_title: Optional[str] = None
    department_id: Optional[int] = None
    leader_id: Optional[int] = None
    first_work_date: Optional[date] = None
    hire_date: date
    is_admin: bool = False
    use_shared_models: bool = False
    salary: Optional[str] = None
    reason: str = ""
    attachments: Optional[str] = None


class HireUpdate(BaseModel):
    """编辑入职申请（仅草稿状态可编辑）"""
    candidate_name: Optional[str] = None
    candidate_username: Optional[str] = None
    candidate_email: Optional[str] = None
    candidate_phone: Optional[str] = None
    job_title: Optional[str] = None
    department_id: Optional[int] = None
    leader_id: Optional[int] = None
    first_work_date: Optional[date] = None
    hire_date: Optional[date] = None
    is_admin: Optional[bool] = None
    use_shared_models: Optional[bool] = None
    salary: Optional[str] = None
    reason: Optional[str] = None
    attachments: Optional[str] = None


class HireOut(BaseModel):
    """入职申请输出"""
    id: int
    user_id: int
    user_name: Optional[str] = None  # 申请人姓名
    candidate_name: str
    candidate_username: str
    candidate_email: str
    candidate_phone: Optional[str] = None
    job_title: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None  # 部门名（前端展示）
    leader_id: Optional[int] = None
    leader_name: Optional[str] = None  # 汇报上级姓名（前端展示）
    first_work_date: Optional[date] = None
    hire_date: date
    is_admin: bool
    use_shared_models: bool
    salary: Optional[str] = None
    reason: str
    attachments: Optional[str] = None
    status: str
    created_user_id: Optional[int] = None
    created_user_name: Optional[str] = None  # 入职后创建的账号姓名（前端展示）
    onboarded_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
