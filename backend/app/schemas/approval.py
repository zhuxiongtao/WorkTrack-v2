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
    approver_type: Literal["role", "leader", "dept_manager", "user"]
    approver_value: str = ""                            # role code 或 user_id；leader/dept_manager 留空
    order: int = 0


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
