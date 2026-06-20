"""供应商模型变更管理数据模型

流程：
  ModelChangeEvent（变更事件）
    └── ModelChangeStage × 4（阶段：影响评估 → 供应商协调 → 平台配置 → 客户通知）
         └── ModelChangeCustomerTask × N（阶段4展开，每客户/项目一条跟进记录）

阶段状态机：pending → in_progress → awaiting_approval → approved / rejected
事件状态机：draft → active → completed / cancelled
"""
from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ──── 变更类型 ────────────────────────────────────────────────────────────────

CHANGE_TYPES = [
    "model_ga",          # 预览版转正式 GA
    "model_update",      # 模型版本更新
    "model_deprecated",  # 模型下线
    "pricing_change",    # 价格调整
    "quota_change",      # 配额/限流调整
    "endpoint_change",   # API 地址变更
    "other",
]

STAGE_TYPES = [
    "assessment",        # 阶段1：影响评估
    "supplier_action",   # 阶段2：供应商侧资源协调
    "platform_action",   # 阶段3：平台配置调整
    "customer_notify",   # 阶段4：客户通知与跟进
]

STAGE_TYPE_NAMES = {
    "assessment":      "影响评估",
    "supplier_action": "供应商侧资源协调",
    "platform_action": "平台配置调整",
    "customer_notify": "客户通知与跟进",
}

RISK_LEVELS = ["low", "medium", "high"]


# ──── 变更事件主表 ─────────────────────────────────────────────────────────────

class ModelChangeEvent(SQLModel, table=True):
    """供应商模型变更事件"""
    __tablename__ = "model_change_event"

    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(max_length=200)                   # 变更标题
    change_type: str = Field(max_length=30, index=True)  # CHANGE_TYPES
    supplier_id: int = Field(foreign_key="supplier.id", index=True)
    channel_ids: str = Field(default="[]")               # JSON 数组，涉及的通道 ID 列表
    effective_date: Optional[datetime] = Field(default=None)  # 上游生效日期
    source: str = Field(default="", max_length=200)      # 消息来源（供应商邮件/官网公告/BD沟通）
    description: str = Field(default="")                 # 变更背景与详情

    # 旧值 / 新值（JSON，用于记录变更前后的配置）
    old_value: Optional[str] = Field(default=None)       # JSON
    new_value: Optional[str] = Field(default=None)       # JSON

    risk_level: str = Field(default="medium", max_length=10)  # low / medium / high
    affected_projects: str = Field(default="[]")         # JSON 数组，影响评估后填入

    # 事件状态
    status: str = Field(default="draft", max_length=20, index=True)
    # draft → active → completed / cancelled

    created_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


# ──── 阶段记录 ────────────────────────────────────────────────────────────────

class ModelChangeStage(SQLModel, table=True):
    """变更流程阶段（固定4阶段，按 order 顺序推进）"""
    __tablename__ = "model_change_stage"

    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: int = Field(foreign_key="model_change_event.id", index=True)
    stage_type: str = Field(max_length=30)   # STAGE_TYPES
    name: str = Field(max_length=100)        # 可自定义名称
    order: int                               # 1-4，执行顺序

    # 状态
    # pending → in_progress → awaiting_approval → approved → completed
    # (rejected 回退到上一阶段 in_progress 或让发起人修改)
    status: str = Field(default="pending", max_length=30, index=True)

    # 执行人
    assigned_to: Optional[int] = Field(default=None, foreign_key="user.id")
    assigned_by: Optional[int] = Field(default=None, foreign_key="user.id")
    assigned_at: Optional[datetime] = Field(default=None)

    # 执行记录
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    action_summary: Optional[str] = Field(default=None)   # 执行摘要
    feedback: Optional[str] = Field(default=None)          # 阶段反馈（外部回复/测试结果等）
    attachments: str = Field(default="[]")                  # JSON，附件 URL 列表

    # 审批（阶段完成后提交审批，通过才能进入下一阶段）
    approval_required: bool = Field(default=True)
    approver_id: Optional[int] = Field(default=None, foreign_key="user.id")
    approved_at: Optional[datetime] = Field(default=None)
    approval_note: Optional[str] = Field(default=None)     # 审批意见

    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


# ──── 客户跟进子任务 ──────────────────────────────────────────────────────────

class ModelChangeCustomerTask(SQLModel, table=True):
    """阶段4 客户通知展开的每条跟进任务（一个受影响项目对应一条）"""
    __tablename__ = "model_change_customer_task"

    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: int = Field(foreign_key="model_change_event.id", index=True)
    stage_id: int = Field(foreign_key="model_change_stage.id", index=True)

    customer_id: int = Field(foreign_key="customer.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")

    # 跟进负责人
    assigned_to: Optional[int] = Field(default=None, foreign_key="user.id")

    # 状态: pending / contacted / confirmed / no_response
    status: str = Field(default="pending", max_length=20, index=True)

    # 通知记录
    contact_method: Optional[str] = Field(default=None, max_length=30)
    # email / phone / meeting / platform_msg
    contacted_at: Optional[datetime] = Field(default=None)
    customer_deadline: Optional[datetime] = Field(default=None)  # 客户承诺的适配完成时间
    confirmed_at: Optional[datetime] = Field(default=None)

    customer_response: Optional[str] = Field(default=None)   # 客户反馈原文
    notes: Optional[str] = Field(default=None)               # 跟进备注（可多轮追加）

    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
