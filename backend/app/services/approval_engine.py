"""审批引擎：统一驱动各业务的审批流转。

核心能力：
- resolve_approvers：把节点的审批人定义解析为具体 user_id（复用组织架构，不另维护名单）
- match_flow：按 business_type + 触发条件匹配审批模板
- start_approval：发起审批，创建实例并把审批人快照固化
- act：审批/驳回，推进节点，结束时回写业务状态
- cancel：发起人撤回
- get_pending_for_user：「我的待办」

审批人定义（节点的 approver_type / approver_value）：
- role        → 持有该 RBAC 角色 code 的全部用户（节点内或签：任一通过即可）
- leader      → 发起人的直属上级（User.leader_id）
- dept_manager→ 发起人所属部门（逐级向上）最近的部门负责人
- user        → 指定 user_id
"""
import json
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from typing import Optional

from sqlmodel import Session, select

from app.models.approval import ApprovalFlow, ApprovalInstance, ApprovalRecord
from app.models.user import User


def _now() -> datetime:
    return now()


# ──────────────────────────── 审批人解析 ────────────────────────────

def _resolve_dept_manager(submitter: User, db: Session) -> list[int]:
    """从发起人所属部门逐级向上，取最近一个有效部门负责人。"""
    from app.models.department import Department
    dept_id = submitter.department_id
    visited: set[int] = set()
    while dept_id and dept_id not in visited:
        visited.add(dept_id)
        dept = db.get(Department, dept_id)
        if not dept:
            break
        if dept.manager_id and dept.manager_id != submitter.id:
            return [dept.manager_id]
        dept_id = dept.parent_id
    return []


def resolve_approvers(approver_type: str, approver_value: str, submitter: User, db: Session) -> list[int]:
    """把单个节点的审批人定义解析成 user_id 列表（去掉发起人自己，避免自审）"""
    ids: list[int] = []

    if approver_type == "user":
        try:
            ids = [int(approver_value)]
        except (TypeError, ValueError):
            ids = []

    elif approver_type == "leader":
        if submitter.leader_id:
            ids = [submitter.leader_id]

    elif approver_type == "dept_manager":
        ids = _resolve_dept_manager(submitter, db)

    elif approver_type == "dept_or_leader":
        # 「部门负责人/分管领导」：两者并集，节点内或签（任一通过即可）
        merged: set[int] = set()
        if submitter.leader_id:
            merged.add(submitter.leader_id)
        merged.update(_resolve_dept_manager(submitter, db))
        ids = list(merged)

    elif approver_type == "role":
        from app.models.rbac import Role, UserRole, DepartmentRole
        role = db.exec(select(Role).where(Role.code == approver_value)).first()
        if role:
            uids = set(db.exec(select(UserRole.user_id).where(UserRole.role_id == role.id)).all())
            dept_ids = list(db.exec(
                select(DepartmentRole.department_id).where(DepartmentRole.role_id == role.id)
            ).all())
            if dept_ids:
                members = db.exec(select(User.id).where(User.department_id.in_(dept_ids))).all()
                uids.update(members)
            ids = list(uids)

    # 去掉已停用账号（不强制排除发起人自己，是否允许自审由管理员配置决定）
    ids = list(set(ids))
    if ids:
        active = db.exec(
            select(User.id).where(User.id.in_(ids), User.status == "active", User.is_active == True)  # noqa: E712
        ).all()
        ids = list(active)
    return ids


# ──────────────────────────── 模板匹配 ────────────────────────────

def _eval_condition(cond_json: Optional[str], target_obj) -> bool:
    """评估触发条件。空条件=无条件触发。"""
    if not cond_json:
        return True
    try:
        cond = json.loads(cond_json)
    except (TypeError, ValueError):
        return True
    if not cond:
        return True
    field = cond.get("field")
    op = cond.get("op")
    val = cond.get("value")
    actual = getattr(target_obj, field, None) if field else None
    if actual is None:
        return False
    try:
        if op == ">=":
            return actual >= val
        if op == ">":
            return actual > val
        if op == "<=":
            return actual <= val
        if op == "<":
            return actual < val
        if op == "==":
            return actual == val
        if op == "!=":
            return actual != val
    except TypeError:
        return False
    return False


def match_flow(business_type: str, target_obj, db: Session) -> Optional[ApprovalFlow]:
    """按业务类型 + 触发条件匹配第一个命中的启用模板"""
    flows = db.exec(
        select(ApprovalFlow).where(
            ApprovalFlow.business_type == business_type,
            ApprovalFlow.is_active == True,  # noqa: E712
        )
    ).all()
    for flow in flows:
        if _eval_condition(flow.trigger_condition, target_obj):
            return flow
    return None


# ──────────────────────────── 发起审批 ────────────────────────────

def get_active_instance(target_type: str, target_id: int, db: Session) -> Optional[ApprovalInstance]:
    """获取某业务数据进行中的审批实例"""
    return db.exec(
        select(ApprovalInstance).where(
            ApprovalInstance.target_type == target_type,
            ApprovalInstance.target_id == target_id,
            ApprovalInstance.status == "pending",
        )
    ).first()


def start_approval(target_type: str, target_id: int, target_obj, title: str,
                   submitter: User, db: Session) -> Optional[ApprovalInstance]:
    """发起审批。返回实例；若该业务类型无匹配模板（无需审批）返回 None。"""
    existing = get_active_instance(target_type, target_id, db)
    if existing:
        raise ValueError("该数据已有进行中的审批")

    flow = match_flow(target_type, target_obj, db)
    if not flow:
        return None  # 无需审批

    nodes = json.loads(flow.nodes or "[]")
    nodes.sort(key=lambda n: n.get("order", 0))
    snapshot = []
    for n in nodes:
        approver_ids = resolve_approvers(
            n.get("approver_type", ""), str(n.get("approver_value", "")), submitter, db
        )
        snapshot.append({
            "name": n.get("name", ""),
            "order": n.get("order", 0),
            "approver_type": n.get("approver_type", ""),
            "approver_value": n.get("approver_value", ""),
            # 节点类型：approval（审批意见，同意/驳回）| execution（执行确认，如出纳付款、盖章）
            "node_kind": n.get("node_kind", "approval"),
            # 执行节点的动作按钮文案，如「确认付款」「确认盖章」；为空时前端用默认「通过」
            "action_label": n.get("action_label", ""),
            "approver_ids": approver_ids,
            "status": "pending",
            "decided_by": None,
            "decided_at": None,
        })

    inst = ApprovalInstance(
        flow_id=flow.id,
        flow_code=flow.code,
        target_type=target_type,
        target_id=target_id,
        title=title,
        status="pending",
        current_node_index=0,
        nodes_snapshot=json.dumps(snapshot, ensure_ascii=False),
        submitted_by=submitter.id,
        submitted_at=_now(),
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)

    db.add(ApprovalRecord(
        instance_id=inst.id, node_index=-1, node_name="发起申请",
        approver_id=submitter.id, action="submit", comment="",
    ))
    db.commit()

    # 跳过开头连续的「无审批人」节点（自动通过），避免流程卡死
    _auto_skip_empty(inst, submitter.id, db)
    db.refresh(inst)
    # 邮件通知当前节点的审批人
    _notify_current_node(inst)
    return inst


def _auto_skip_empty(instance: ApprovalInstance, actor_id: int, db: Session) -> None:
    """从 current_node_index 起，跳过审批人为空的节点（系统自动通过）。
    若全部跳完则整单通过。"""
    snapshot = json.loads(instance.nodes_snapshot)
    idx = instance.current_node_index
    changed = False
    while idx < len(snapshot) and not snapshot[idx].get("approver_ids"):
        snapshot[idx]["status"] = "approved"
        snapshot[idx]["decided_at"] = _now().isoformat()
        db.add(ApprovalRecord(
            instance_id=instance.id, node_index=idx, node_name=snapshot[idx]["name"],
            approver_id=actor_id, action="approve", comment="（无可用审批人，系统自动通过）",
        ))
        idx += 1
        changed = True
    if changed:
        instance.current_node_index = idx
        instance.nodes_snapshot = json.dumps(snapshot, ensure_ascii=False)
        instance.updated_at = _now()
        db.add(instance)
        db.commit()
        if idx >= len(snapshot):
            _finish(instance, "approved", db)


# ──────────────────────────── 审批动作 ────────────────────────────

def act(instance: ApprovalInstance, approver: User, action: str, comment: str, db: Session) -> ApprovalInstance:
    """审批（approve）或驳回（reject）当前节点。"""
    if instance.status != "pending":
        raise ValueError("该审批已结束，无法操作")

    snapshot = json.loads(instance.nodes_snapshot)
    idx = instance.current_node_index
    if idx >= len(snapshot):
        raise ValueError("审批节点状态异常")
    node = snapshot[idx]

    if not approver.is_admin and approver.id not in node.get("approver_ids", []):
        raise PermissionError("您不是当前节点的审批人")

    if action == "reject":
        node["status"] = "rejected"
        node["decided_by"] = approver.id
        node["decided_at"] = _now().isoformat()
        instance.nodes_snapshot = json.dumps(snapshot, ensure_ascii=False)
        db.add(instance)
        db.add(ApprovalRecord(
            instance_id=instance.id, node_index=idx, node_name=node["name"],
            approver_id=approver.id, action="reject", comment=comment,
        ))
        db.commit()
        _finish(instance, "rejected", db)
        return instance

    if action == "approve":
        node["status"] = "approved"
        node["decided_by"] = approver.id
        node["decided_at"] = _now().isoformat()
        db.add(ApprovalRecord(
            instance_id=instance.id, node_index=idx, node_name=node["name"],
            approver_id=approver.id, action="approve", comment=comment,
        ))
        next_idx = idx + 1
        # 跳过后续无审批人的节点
        while next_idx < len(snapshot) and not snapshot[next_idx].get("approver_ids"):
            snapshot[next_idx]["status"] = "approved"
            snapshot[next_idx]["decided_at"] = _now().isoformat()
            db.add(ApprovalRecord(
                instance_id=instance.id, node_index=next_idx, node_name=snapshot[next_idx]["name"],
                approver_id=approver.id, action="approve", comment="（无可用审批人，系统自动通过）",
            ))
            next_idx += 1
        instance.current_node_index = next_idx
        instance.nodes_snapshot = json.dumps(snapshot, ensure_ascii=False)
        instance.updated_at = _now()
        db.add(instance)
        db.commit()
        db.refresh(instance)
        if next_idx >= len(snapshot):
            _finish(instance, "approved", db)
        else:
            _notify_current_node(instance)
        return instance

    raise ValueError("未知的审批动作")


def cancel(instance: ApprovalInstance, user: User, db: Session) -> ApprovalInstance:
    """发起人或管理员撤回审批"""
    if instance.status != "pending":
        raise ValueError("该审批已结束，无法撤回")
    if instance.submitted_by != user.id and not user.is_admin:
        raise PermissionError("只有发起人可以撤回审批")
    db.add(ApprovalRecord(
        instance_id=instance.id, node_index=instance.current_node_index,
        node_name="撤回", approver_id=user.id, action="cancel", comment="",
    ))
    db.commit()
    _finish(instance, "cancelled", db)
    return instance


def _notify_current_node(instance: ApprovalInstance) -> None:
    """邮件通知当前节点的审批人（后台线程，不阻塞请求）"""
    import threading
    snap_str = instance.nodes_snapshot
    idx = instance.current_node_index
    inst_id = instance.id
    title = instance.title

    def _run():
        try:
            from app.services.email_service import notify_approval_pending
            snap = json.loads(snap_str)
            if idx < len(snap):
                approver_ids = snap[idx].get("approver_ids", [])
                if approver_ids:
                    notify_approval_pending(instance, approver_ids)
        except Exception as e:
            import logging
            logging.getLogger("worktrack.approval").warning("审批通知邮件失败(#%s): %s", inst_id, e)

    threading.Thread(target=_run, daemon=True).start()


def _finish(instance: ApprovalInstance, status: str, db: Session) -> None:
    """结束实例并回写业务状态"""
    instance.status = status
    instance.finished_at = _now()
    instance.updated_at = _now()
    db.add(instance)
    db.commit()
    db.refresh(instance)
    _on_finished(instance, db)
    # 邮件通知发起人审批结果（后台线程，不阻塞请求）
    import threading
    submitted_by = instance.submitted_by
    inst_id = instance.id

    def _notify_finished():
        try:
            from app.services.email_service import notify_approval_finished, _get_user_emails
            email_map = _get_user_emails([submitted_by])
            submitter_email = email_map.get(submitted_by)
            notify_approval_finished(instance, submitter_email)
        except Exception as e:
            import logging
            logging.getLogger("worktrack.approval").warning("审批结果通知邮件失败(#%s): %s", inst_id, e)

    threading.Thread(target=_notify_finished, daemon=True).start()


def _on_finished(instance: ApprovalInstance, db: Session) -> None:
    """审批结束后的业务回调：把审批结果回写到对应业务实体的状态。

    新增业务接入时，在此扩展对应 target_type 的处理即可。
    """
    if instance.target_type == "contract":
        from app.models.contract import Contract
        c = db.get(Contract, instance.target_id)
        if c:
            if instance.status == "approved":
                c.status = "生效中"
            elif instance.status == "rejected":
                c.status = "已驳回"
            elif instance.status == "cancelled":
                c.status = "草稿"
            c.updated_at = _now()
            db.add(c)
            db.commit()

    elif instance.target_type == "reconcile_summary":
        from app.models.reconcile import ReconcileSummary
        s = db.get(ReconcileSummary, instance.target_id)
        if s:
            if instance.status == "approved":
                s.status = "已锁定"
                s.finalized_at = _now()
            elif instance.status in ("rejected", "cancelled"):
                s.status = "草稿"
                s.finalized_at = None
            s.updated_at = _now()
            db.add(s)
            db.commit()

    elif instance.target_type == "project":
        from app.models.project import Project
        p = db.get(Project, instance.target_id)
        if p:
            if instance.status == "approved":
                p.status = "进行中"
            elif instance.status == "rejected":
                p.status = "已驳回"
            elif instance.status == "cancelled":
                p.status = "待立项"
            p.updated_at = _now()
            db.add(p)
            db.commit()

    elif instance.target_type == "supplier":
        from app.models.supplier import Supplier
        s = db.get(Supplier, instance.target_id)
        if s:
            if instance.status == "approved":
                s.status = "合作中"
            elif instance.status == "rejected":
                s.status = "已拒绝"
            elif instance.status == "cancelled":
                s.status = "待审批"
            s.updated_at = _now()
            db.add(s)
            db.commit()

    elif instance.target_type == "channel":
        from app.models.channel import Channel
        c = db.get(Channel, instance.target_id)
        if c:
            if instance.status == "approved":
                c.status = "合作中"
            elif instance.status in ("rejected", "cancelled"):
                c.status = "待确认"
            c.updated_at = _now()
            db.add(c)
            db.commit()

    elif instance.target_type == "payment":
        from app.models.payment import PaymentRequest
        p = db.get(PaymentRequest, instance.target_id)
        if p:
            if instance.status == "approved":
                p.status = "已付款"   # 审批链含「出纳付款」执行节点，全部通过即已付款
            elif instance.status == "rejected":
                p.status = "已驳回"
            elif instance.status == "cancelled":
                p.status = "草稿"
            p.updated_at = _now()
            db.add(p)
            db.commit()

    elif instance.target_type == "seal":
        from app.models.seal import SealRequest
        s = db.get(SealRequest, instance.target_id)
        if s:
            if instance.status == "approved":
                s.status = "已盖章"   # 审批链含「盖章」执行节点，全部通过即已盖章
            elif instance.status == "rejected":
                s.status = "已驳回"
            elif instance.status == "cancelled":
                s.status = "草稿"
            s.updated_at = _now()
            db.add(s)
            db.commit()

    elif instance.target_type == "bill_reconcile":
        from app.models.bill_reconcile import BillReconcileSession
        s = db.get(BillReconcileSession, instance.target_id)
        if s:
            if instance.status == "approved":
                s.status = "approved"
            elif instance.status in ("rejected", "cancelled"):
                s.status = "compared"  # 退回到已比对，可重新修改再提交
            s.updated_at = _now()
            db.add(s)
            db.commit()

    elif instance.target_type == "leave":
        from app.models.leave_request import LeaveRequest
        from app.services import leave_balance_service
        lv = db.get(LeaveRequest, instance.target_id)
        if lv:
            if instance.status == "approved":
                lv.status = "已批准"
                # 扣减假期额度
                try:
                    leave_balance_service.apply_leave(lv, db, operator_id=instance.submitted_by)
                except Exception as e:
                    import logging
                    logging.getLogger("worktrack").warning(
                        "请假 #%s 扣减额度失败: %s", lv.id, e
                    )
            elif instance.status == "rejected":
                lv.status = "已驳回"
            elif instance.status == "cancelled":
                lv.status = "草稿"
            lv.updated_at = _now()
            db.add(lv)
            db.commit()

    elif instance.target_type == "overtime":
        from app.models.overtime_request import OvertimeRequest
        from app.services import leave_balance_service
        ot = db.get(OvertimeRequest, instance.target_id)
        if ot:
            if instance.status == "approved":
                ot.status = "已批准"
                # 若补偿方式为调休，授予调休额度
                try:
                    leave_balance_service.grant_overtime_compensate(ot, db)
                except Exception as e:
                    import logging
                    logging.getLogger("worktrack").warning(
                        "加班 #%s 授予调休额度失败: %s", ot.id, e
                    )
            elif instance.status == "rejected":
                ot.status = "已驳回"
            elif instance.status == "cancelled":
                ot.status = "草稿"
            ot.updated_at = _now()
            db.add(ot)
            db.commit()

    elif instance.target_type == "expense":
        from app.models.expense_request import ExpenseRequest
        e = db.get(ExpenseRequest, instance.target_id)
        if e:
            if instance.status == "approved":
                e.status = "已批准"
            elif instance.status == "rejected":
                e.status = "已驳回"
            elif instance.status == "cancelled":
                e.status = "草稿"
            e.updated_at = _now()
            db.add(e)
            db.commit()

    elif instance.target_type == "business_trip":
        from app.models.business_trip_request import BusinessTripRequest
        t = db.get(BusinessTripRequest, instance.target_id)
        if t:
            if instance.status == "approved":
                t.status = "已批准"
            elif instance.status == "rejected":
                t.status = "已驳回"
            elif instance.status == "cancelled":
                t.status = "草稿"
            t.updated_at = _now()
            db.add(t)
            db.commit()

    elif instance.target_type == "purchase":
        from app.models.purchase_request import PurchaseRequest
        p = db.get(PurchaseRequest, instance.target_id)
        if p:
            if instance.status == "approved":
                p.status = "已批准"
            elif instance.status == "rejected":
                p.status = "已驳回"
            elif instance.status == "cancelled":
                p.status = "草稿"
            p.updated_at = _now()
            db.add(p)
            db.commit()


# ──────────────────────────── 待办查询 ────────────────────────────

def get_pending_for_user(user: User, db: Session) -> list[ApprovalInstance]:
    """返回当前节点指派给该用户的进行中审批（我的待办）"""
    insts = db.exec(
        select(ApprovalInstance).where(ApprovalInstance.status == "pending")
    ).all()
    result = []
    for inst in insts:
        try:
            snap = json.loads(inst.nodes_snapshot)
        except (TypeError, ValueError):
            continue
        idx = inst.current_node_index
        if idx < len(snap) and user.id in snap[idx].get("approver_ids", []):
            result.append(inst)
    return result


def can_act(instance: ApprovalInstance, user: User) -> bool:
    """该用户能否对当前节点执行审批动作"""
    if instance.status != "pending":
        return False
    if user.is_admin:
        return True
    try:
        snap = json.loads(instance.nodes_snapshot)
    except (TypeError, ValueError):
        return False
    idx = instance.current_node_index
    return idx < len(snap) and user.id in snap[idx].get("approver_ids", [])
