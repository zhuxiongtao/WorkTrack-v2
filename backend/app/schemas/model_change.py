from typing import Optional
from datetime import datetime
from pydantic import BaseModel


# ── 变更事件 ──────────────────────────────────────────────────────────────────

class ModelChangeEventCreate(BaseModel):
    title: str
    change_type: str
    supplier_id: int
    channel_ids: list[int] = []
    effective_date: Optional[datetime] = None
    source: str = ""
    description: str = ""
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    risk_level: str = "medium"


class ModelChangeEventUpdate(BaseModel):
    title: Optional[str] = None
    change_type: Optional[str] = None
    channel_ids: Optional[list[int]] = None
    effective_date: Optional[datetime] = None
    source: Optional[str] = None
    description: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    risk_level: Optional[str] = None


class StageOut(BaseModel):
    id: int
    event_id: int
    stage_type: str
    name: str
    order: int
    status: str
    assigned_to: Optional[int]
    assigned_to_name: Optional[str]
    assigned_by: Optional[int]
    assigned_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    action_summary: Optional[str]
    feedback: Optional[str]
    attachments: list[str]
    approval_required: bool
    approver_id: Optional[int]
    approver_name: Optional[str]
    approved_at: Optional[datetime]
    approval_note: Optional[str]
    created_at: datetime
    updated_at: datetime


class CustomerTaskOut(BaseModel):
    id: int
    event_id: int
    stage_id: int
    customer_id: int
    customer_name: Optional[str]
    project_id: Optional[int]
    project_name: Optional[str]
    assigned_to: Optional[int]
    assigned_to_name: Optional[str]
    status: str
    contact_method: Optional[str]
    contacted_at: Optional[datetime]
    customer_deadline: Optional[datetime]
    confirmed_at: Optional[datetime]
    customer_response: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime


class ModelChangeEventOut(BaseModel):
    id: int
    title: str
    change_type: str
    supplier_id: int
    supplier_name: Optional[str]
    channel_ids: list[int]
    effective_date: Optional[datetime]
    source: str
    description: str
    old_value: Optional[str]
    new_value: Optional[str]
    risk_level: str
    affected_projects: list[int]
    status: str
    created_by: int
    created_by_name: Optional[str]
    created_at: datetime
    updated_at: datetime
    stages: list[StageOut] = []
    customer_tasks: list[CustomerTaskOut] = []


class ModelChangeEventListItem(BaseModel):
    id: int
    title: str
    change_type: str
    supplier_id: int
    supplier_name: Optional[str]
    risk_level: str
    status: str
    effective_date: Optional[datetime]
    created_by: int
    created_by_name: Optional[str]
    created_at: datetime
    updated_at: datetime
    current_stage_order: Optional[int]    # 当前激活阶段序号
    current_stage_name: Optional[str]
    affected_count: int                    # 受影响项目数


# ── 阶段操作 ──────────────────────────────────────────────────────────────────

class StageAssignIn(BaseModel):
    assigned_to: int


class StageCompleteIn(BaseModel):
    action_summary: str
    feedback: Optional[str] = None
    attachments: list[str] = []


class StageApproveIn(BaseModel):
    approved: bool          # True=通过, False=驳回
    note: Optional[str] = None


# ── 客户任务 ──────────────────────────────────────────────────────────────────

class CustomerTaskUpdate(BaseModel):
    assigned_to: Optional[int] = None
    status: Optional[str] = None
    contact_method: Optional[str] = None
    contacted_at: Optional[datetime] = None
    customer_deadline: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    customer_response: Optional[str] = None
    notes: Optional[str] = None
