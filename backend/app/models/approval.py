"""审批引擎数据模型：审批模板 + 审批实例 + 审批留痕

设计要点：
- ApprovalFlow（模板）：按 business_type 匹配，trigger_condition 决定是否触发，nodes 定义多级节点
- ApprovalInstance（实例）：创建时把节点+解析出的审批人快照到 nodes_snapshot，
  避免审批进行中组织架构变动导致审批人漂移
- ApprovalRecord（留痕）：每一次审批动作落一条，构成完整审计轨迹
"""
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class ApprovalFlow(SQLModel, table=True):
    """审批模板：定义某类业务在何种条件下、按什么节点链审批"""
    __tablename__ = "approval_flow"

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(unique=True, index=True, max_length=50)   # "contract_approval"
    name: str = Field(max_length=100)                            # "合同审批"
    business_type: str = Field(index=True, max_length=30)        # 对应 ApprovalInstance.target_type，如 "contract"
    is_active: bool = Field(default=True)
    is_system: bool = Field(default=False)                       # 系统预置，不可删除

    # 触发条件 JSON：{"field":"contract_amount","op":">=","value":500000}
    # 为空表示无条件触发（该类业务一律走审批）
    trigger_condition: Optional[str] = Field(default=None)

    # 节点定义 JSON 数组（按 order 升序）：
    # [{"name":"法务审批","approver_type":"role","approver_value":"legal","order":1}, ...]
    # approver_type: role | leader | dept_manager | user
    nodes: str = Field(default="[]")

    description: str = Field(default="", max_length=200)
    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())


class ApprovalInstance(SQLModel, table=True):
    """审批实例：一条具体业务数据发起的审批流"""
    __tablename__ = "approval_instance"

    id: Optional[int] = Field(default=None, primary_key=True)
    flow_id: int = Field(foreign_key="approval_flow.id", index=True)
    flow_code: str = Field(default="", max_length=50)            # 冗余便于查询

    target_type: str = Field(index=True, max_length=30)         # "contract"
    target_id: int = Field(index=True)
    title: str = Field(default="", max_length=200)              # "合同《XXX》审批"

    # pending（审批中）/ approved（通过）/ rejected（驳回）/ cancelled（撤回）
    status: str = Field(default="pending", index=True, max_length=20)
    current_node_index: int = Field(default=0)                  # 当前待审节点序号

    # 节点快照 JSON 数组，创建时把审批人解析好固化：
    # [{"name","order","approver_ids":[1,2],"status":"pending|approved|rejected",
    #   "decided_by":null,"decided_at":null}]
    nodes_snapshot: str = Field(default="[]")

    submitted_by: int = Field(foreign_key="user.id", index=True)
    submitted_at: datetime = Field(default_factory=lambda: now())
    finished_at: Optional[datetime] = Field(default=None)

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())


class ApprovalRecord(SQLModel, table=True):
    """审批留痕：每一次审批动作一条，审计轨迹"""
    __tablename__ = "approval_record"

    id: Optional[int] = Field(default=None, primary_key=True)
    instance_id: int = Field(foreign_key="approval_instance.id", index=True)
    node_index: int = Field(default=0)
    node_name: str = Field(default="", max_length=100)
    approver_id: int = Field(foreign_key="user.id", index=True)
    # submit（发起）/ approve（同意）/ reject（驳回）/ cancel（撤回）
    action: str = Field(max_length=20)
    comment: str = Field(default="", max_length=500)
    created_at: datetime = Field(default_factory=lambda: now())
