"""审批 Schema"""
from typing import Optional, Literal, Any
from pydantic import BaseModel


class ApprovalActionIn(BaseModel):
    """审批/驳回请求体"""
    action: Literal["approve", "reject"]
    comment: str = ""


class ApprovalSubmitIn(BaseModel):
    """通用发起审批请求体（按业务 target 发起）"""
    target_type: str
    target_id: int
    title: str = ""


# ── 审批流模板 CRUD ──

class ApprovalNodeIn(BaseModel):
    """单个审批节点定义"""
    name: str                                           # 节点名称，如「法务审批」
    approver_type: Literal["role", "leader", "dept_manager", "dept_or_leader", "user"]
    approver_value: str = ""                            # role code 或 user_id；leader/dept_manager/dept_or_leader 留空
    order: int = 0
    node_kind: Literal["approval", "execution"] = "approval"   # 审批意见 | 执行确认（出纳付款 / 盖章）
    action_label: str = ""                              # 执行节点动作文案，如「确认付款」「确认盖章」
    sign_mode: Literal["or", "and"] = "or"               # 或签（任一人通过即可）| 会签（全部人通过才算通过，任一人驳回即整单驳回）


class ApprovalFlowCreate(BaseModel):
    code: str                                           # 唯一标识
    name: str
    business_type: str                                  # 与 target_type 对应
    description: str = ""
    is_active: bool = True
    trigger_condition: Optional[dict] = None            # {"field","op","value"} 或 None
    nodes: list[ApprovalNodeIn] = []


class ApprovalFlowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    trigger_condition: Optional[Any] = None             # None 表示不改；False/空 dict 表示清空
    nodes: Optional[list[ApprovalNodeIn]] = None
