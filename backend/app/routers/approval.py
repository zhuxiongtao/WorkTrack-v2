"""通用审批 API：待办、我的申请、实例详情、审批/驳回/撤回、模板查看。

审批的查看/操作端点仅要求登录；具体「能否操作」由审批引擎按节点审批人身份判定，
因此无需为每个角色单独配置审批权限，业务接入成本最低。
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.models.user import User
from app.models.approval import ApprovalFlow, ApprovalInstance, ApprovalRecord
from app.auth import get_current_user
from app.schemas.approval import ApprovalActionIn, ApprovalFlowCreate, ApprovalFlowUpdate
from app.services import approval_engine
from app.utils.time import BEIJING_TZ, now

router = APIRouter(prefix="/api/v1/approvals", tags=["审批"])


# ──────────────────────────── 辅助 ────────────────────────────

def _names(db: Session, ids: list[int]) -> dict[int, str]:
    """批量把 user_id 映射为显示名（name 优先，回退 username）"""
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


def _instance_brief(inst: ApprovalInstance, db: Session, current_user: User, name_map: dict[int, str]) -> dict:
    """列表项精简视图"""
    try:
        snap = json.loads(inst.nodes_snapshot)
    except (TypeError, ValueError):
        snap = []
    idx = inst.current_node_index
    cur = snap[idx] if 0 <= idx < len(snap) else {}
    current_node = cur.get("name", "")
    return {
        "id": inst.id,
        "flow_code": inst.flow_code,
        "title": inst.title,
        "target_type": inst.target_type,
        "target_id": inst.target_id,
        "status": inst.status,
        "current_node": current_node,
        "current_node_kind": cur.get("node_kind", "approval"),
        "current_action_label": cur.get("action_label", ""),
        "node_total": len(snap),
        "node_index": idx,
        "submitted_by": inst.submitted_by,
        "submitted_by_name": name_map.get(inst.submitted_by, ""),
        "submitted_at": inst.submitted_at,
        "finished_at": inst.finished_at,
        "can_act": approval_engine.can_act(inst, current_user),
    }


# ──────────────────────────── 待办 / 我的申请 ────────────────────────────

@router.get("/pending")
def list_pending(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """我的待办：当前节点指派给我的进行中审批"""
    insts = approval_engine.get_pending_for_user(current_user, db)
    name_map = _names(db, [i.submitted_by for i in insts])
    return [_instance_brief(i, db, current_user, name_map) for i in insts]


@router.get("/mine")
def list_mine(
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """我发起的审批"""
    query = select(ApprovalInstance).where(ApprovalInstance.submitted_by == current_user.id)
    if status:
        query = query.where(ApprovalInstance.status == status)
    insts = db.exec(query.order_by(ApprovalInstance.created_at.desc())).all()
    name_map = _names(db, [i.submitted_by for i in insts])
    return [_instance_brief(i, db, current_user, name_map) for i in insts]


# ──────────────────────────── 模板 ────────────────────────────

@router.get("/flows")
def list_flows(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """审批模板列表（查看）"""
    flows = db.exec(select(ApprovalFlow).order_by(ApprovalFlow.business_type)).all()
    out = []
    for f in flows:
        try:
            nodes = json.loads(f.nodes or "[]")
        except (TypeError, ValueError):
            nodes = []
        try:
            cond = json.loads(f.trigger_condition) if f.trigger_condition else None
        except (TypeError, ValueError):
            cond = None
        out.append({
            "id": f.id, "code": f.code, "name": f.name,
            "business_type": f.business_type, "is_active": f.is_active,
            "is_system": f.is_system, "trigger_condition": cond,
            "nodes": nodes, "description": f.description,
        })
    return out


def _flow_to_dict(f: ApprovalFlow) -> dict:
    try:
        nodes = json.loads(f.nodes or "[]")
    except (TypeError, ValueError):
        nodes = []
    try:
        cond = json.loads(f.trigger_condition) if f.trigger_condition else None
    except (TypeError, ValueError):
        cond = None
    return {
        "id": f.id, "code": f.code, "name": f.name,
        "business_type": f.business_type, "is_active": f.is_active,
        "is_system": f.is_system, "trigger_condition": cond,
        "nodes": nodes, "description": f.description,
        "created_at": f.created_at, "updated_at": f.updated_at,
    }


@router.post("/flows")
def create_flow(
    body: ApprovalFlowCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """新建审批流模板（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(403, "仅管理员可新建审批流")
    if db.exec(select(ApprovalFlow).where(ApprovalFlow.code == body.code)).first():
        raise HTTPException(400, f"code「{body.code}」已存在")
    nodes = [n.model_dump() for n in body.nodes]
    cond_json = json.dumps(body.trigger_condition, ensure_ascii=False) if body.trigger_condition else None
    flow = ApprovalFlow(
        code=body.code, name=body.name,
        business_type=body.business_type,
        description=body.description,
        is_active=body.is_active,
        is_system=False,
        trigger_condition=cond_json,
        nodes=json.dumps(nodes, ensure_ascii=False),
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return _flow_to_dict(flow)


@router.put("/flows/{flow_id}")
def update_flow(
    flow_id: int,
    body: ApprovalFlowUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """更新审批流模板（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(403, "仅管理员可修改审批流")
    flow = db.get(ApprovalFlow, flow_id)
    if not flow:
        raise HTTPException(404, "审批流不存在")
    from datetime import datetime, timezone
    if body.name is not None:
        flow.name = body.name
    if body.description is not None:
        flow.description = body.description
    if body.is_active is not None:
        flow.is_active = body.is_active
    if "trigger_condition" in (body.model_fields_set or set()):
        flow.trigger_condition = json.dumps(body.trigger_condition, ensure_ascii=False) if body.trigger_condition else None
    if body.nodes is not None:
        flow.nodes = json.dumps([n.model_dump() for n in body.nodes], ensure_ascii=False)
    flow.updated_at = now()
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return _flow_to_dict(flow)


@router.patch("/flows/{flow_id}/toggle")
def toggle_flow(
    flow_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """启用/停用审批流（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(403, "仅管理员可操作")
    from datetime import datetime, timezone
    flow = db.get(ApprovalFlow, flow_id)
    if not flow:
        raise HTTPException(404, "审批流不存在")
    flow.is_active = not flow.is_active
    flow.updated_at = now()
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return _flow_to_dict(flow)


@router.delete("/flows/{flow_id}")
def delete_flow(
    flow_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """删除审批流（仅管理员；系统预置不可删）"""
    if not current_user.is_admin:
        raise HTTPException(403, "仅管理员可删除审批流")
    flow = db.get(ApprovalFlow, flow_id)
    if not flow:
        raise HTTPException(404, "审批流不存在")
    if flow.is_system:
        raise HTTPException(400, "系统预置审批流不可删除，可停用")
    db.delete(flow)
    db.commit()
    return {"ok": True}


# ──────────────────────────── 按业务查实例 ────────────────────────────

@router.get("/by-target/{target_type}/{target_id}")
def get_by_target(
    target_type: str, target_id: int,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_session),
):
    """查某业务数据的审批实例（最新一条）。前端业务详情页用。返回 null 表示从未发起。"""
    inst = db.exec(
        select(ApprovalInstance)
        .where(ApprovalInstance.target_type == target_type, ApprovalInstance.target_id == target_id)
        .order_by(ApprovalInstance.created_at.desc())
    ).first()
    if not inst:
        return None
    return _instance_detail(inst, db, current_user)


# ──────────────────────────── 实例详情 ────────────────────────────

def _instance_detail(inst: ApprovalInstance, db: Session, current_user: User) -> dict:
    try:
        snap = json.loads(inst.nodes_snapshot)
    except (TypeError, ValueError):
        snap = []

    # 收集所有需要展示名字的 user_id
    all_ids = [inst.submitted_by]
    for n in snap:
        all_ids.extend(n.get("approver_ids", []))
        if n.get("decided_by"):
            all_ids.append(n["decided_by"])
    records = db.exec(
        select(ApprovalRecord).where(ApprovalRecord.instance_id == inst.id)
        .order_by(ApprovalRecord.created_at)
    ).all()
    all_ids.extend([r.approver_id for r in records])
    name_map = _names(db, all_ids)

    nodes_out = []
    for i, n in enumerate(snap):
        nodes_out.append({
            "name": n.get("name", ""),
            "order": n.get("order", 0),
            "status": n.get("status", "pending"),
            "node_kind": n.get("node_kind", "approval"),
            "action_label": n.get("action_label", ""),
            "approver_ids": n.get("approver_ids", []),
            "approver_names": [name_map.get(a, f"用户{a}") for a in n.get("approver_ids", [])],
            "decided_by": n.get("decided_by"),
            "decided_by_name": name_map.get(n.get("decided_by"), "") if n.get("decided_by") else "",
            "decided_at": n.get("decided_at"),
            "is_current": (i == inst.current_node_index and inst.status == "pending"),
        })

    records_out = [{
        "node_name": r.node_name,
        "action": r.action,
        "approver_id": r.approver_id,
        "approver_name": name_map.get(r.approver_id, f"用户{r.approver_id}"),
        "comment": r.comment,
        "created_at": r.created_at,
    } for r in records]

    return {
        "id": inst.id,
        "flow_code": inst.flow_code,
        "title": inst.title,
        "target_type": inst.target_type,
        "target_id": inst.target_id,
        "status": inst.status,
        "current_node_index": inst.current_node_index,
        "submitted_by": inst.submitted_by,
        "submitted_by_name": name_map.get(inst.submitted_by, ""),
        "submitted_at": inst.submitted_at,
        "finished_at": inst.finished_at,
        "nodes": nodes_out,
        "records": records_out,
        "can_act": approval_engine.can_act(inst, current_user),
        "can_cancel": inst.status == "pending" and (inst.submitted_by == current_user.id or current_user.is_admin),
    }


@router.get("/{instance_id}")
def get_instance(instance_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    inst = db.get(ApprovalInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="审批不存在")
    return _instance_detail(inst, db, current_user)


# ──────────────────────────── 审批动作 ────────────────────────────

@router.post("/{instance_id}/act")
def act_on_instance(
    instance_id: int, data: ApprovalActionIn,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_session),
):
    """审批通过 / 驳回当前节点"""
    inst = db.get(ApprovalInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="审批不存在")
    try:
        approval_engine.act(inst, current_user, data.action, data.comment, db)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _instance_detail(inst, db, current_user)


@router.post("/{instance_id}/cancel")
def cancel_instance(instance_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """撤回审批（仅发起人 / 管理员）"""
    inst = db.get(ApprovalInstance, instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="审批不存在")
    try:
        approval_engine.cancel(inst, current_user, db)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _instance_detail(inst, db, current_user)


# ──────────────────────────── 通用审批预览 ────────────────────────────

# target_type → 模型类 映射（各业务模块在此注册，供通用预览接口加载已有数据）
_TARGET_MODELS: dict[str, type] = {}


def register_target_model(target_type: str, model_cls: type) -> None:
    """注册业务模型，供通用 approval-preview 接口使用。"""
    _TARGET_MODELS[target_type] = model_cls


def _init_target_registry() -> None:
    """初始化预置业务模型注册（延迟导入避免循环依赖）"""
    if _TARGET_MODELS:
        return
    from app.models.contract import Contract
    from app.models.payment import PaymentRequest
    from app.models.seal import SealRequest
    from app.models.project import Project
    from app.models.supplier import Supplier
    from app.models.channel import Channel
    from app.models.reconcile import ReconcileSummary
    from app.models.bill_reconcile import BillReconcileSession
    from app.models.leave_request import LeaveRequest
    from app.models.overtime_request import OvertimeRequest
    from app.models.expense_request import ExpenseRequest
    from app.models.business_trip_request import BusinessTripRequest
    from app.models.purchase_request import PurchaseRequest
    _TARGET_MODELS.update({
        "contract": Contract,
        "payment": PaymentRequest,
        "seal": SealRequest,
        "project": Project,
        "supplier": Supplier,
        "channel": Channel,
        "reconcile_summary": ReconcileSummary,
        "bill_reconcile": BillReconcileSession,
        "leave": LeaveRequest,
        "overtime": OvertimeRequest,
        "expense": ExpenseRequest,
        "business_trip": BusinessTripRequest,
        "purchase": PurchaseRequest,
    })


class _PreviewData:
    """用 dict 模拟业务对象，供 match_flow 评估触发条件（新建预览场景）"""
    def __init__(self, data: dict):
        for k, v in data.items():
            setattr(self, k, v)


@router.post("/preview")
def preview_approval(
    data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """通用审批预览：解析某业务提交审批后的节点和审批人（真实姓名）。

    Body:
      { "target_type": "payment", "target_id": 12 }              # 已有数据预览
      { "target_type": "payment", "target_data": { ... } }       # 新建预览（未保存）

    返回:
      { "nodes": [{ name, order, approver_type, approver_names, node_kind }], "no_flow": bool }
    """
    _init_target_registry()
    target_type = data.get("target_type")
    if not target_type:
        raise HTTPException(400, "请提供 target_type")

    target_id = data.get("target_id")
    target_data = data.get("target_data")

    # 加载业务对象
    if target_id:
        model_cls = _TARGET_MODELS.get(target_type)
        if not model_cls:
            raise HTTPException(400, f"未注册的业务类型: {target_type}")
        target_obj = db.get(model_cls, target_id)
        if not target_obj:
            raise HTTPException(404, "业务数据不存在")
    elif target_data:
        target_obj = _PreviewData(target_data)
    else:
        raise HTTPException(400, "请提供 target_id 或 target_data")

    flow = approval_engine.match_flow(target_type, target_obj, db)
    if not flow:
        return {"nodes": [], "no_flow": True}

    nodes = json.loads(flow.nodes or "[]")
    nodes.sort(key=lambda n: n.get("order", 0))

    result = []
    for n in nodes:
        approver_ids = approval_engine.resolve_approvers(
            n.get("approver_type", ""), str(n.get("approver_value", "")), current_user, db
        )
        names = []
        if approver_ids:
            users = db.exec(select(User).where(User.id.in_(approver_ids))).all()
            names = [u.name or u.username for u in users]
        result.append({
            "name": n.get("name", ""),
            "order": n.get("order", 0),
            "approver_type": n.get("approver_type", ""),
            "approver_names": names,
            "node_kind": n.get("node_kind", "approval"),
            "action_label": n.get("action_label", ""),
        })
    return {"nodes": result, "no_flow": False}
