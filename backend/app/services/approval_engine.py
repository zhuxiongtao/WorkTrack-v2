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
from app.models.department import Department
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


def resolve_approvers(
    approver_type: str,
    approver_value: str,
    submitter: User,
    db: Session,
    target_obj=None,
) -> list[int]:
    """把单个节点的审批人定义解析成 user_id 列表（去掉发起人自己，避免自审）

    target_obj: 业务对象（如 HireRequest），仅 target_dept_manager 类型用到，用于按业务对象所在部门解析负责人。
    """
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

    elif approver_type == "target_dept_manager":
        # 「业务对象所在部门负责人」：从 target_obj.department_id 解析
        # 适用场景：入职申请按候选人拟入职部门路由审批人，而非按申请人(HR)所在部门
        target_dept_id = (
            getattr(target_obj, "department_id", None) if target_obj else None
        )
        if target_dept_id:
            dept = db.get(Department, target_dept_id)
            if dept and dept.manager_id:
                ids = [dept.manager_id]

    elif approver_type == "role":
        from app.models.rbac import Role, UserRole, DepartmentRole

        role = db.exec(select(Role).where(Role.code == approver_value)).first()
        if role:
            uids = set(
                db.exec(
                    select(UserRole.user_id).where(UserRole.role_id == role.id)
                ).all()
            )
            dept_ids = list(
                db.exec(
                    select(DepartmentRole.department_id).where(
                        DepartmentRole.role_id == role.id
                    )
                ).all()
            )
            if dept_ids:
                members = db.exec(
                    select(User.id).where(User.department_id.in_(dept_ids))
                ).all()
                uids.update(members)
            ids = list(uids)

    # 去掉已停用账号（不强制排除发起人自己，是否允许自审由管理员配置决定）
    ids = list(set(ids))
    if ids:
        active = db.exec(
            select(User.id).where(
                User.id.in_(ids), User.status == "active", User.is_active == True
            )  # noqa: E712
        ).all()
        ids = list(active)
    return ids


# ──────────────────────────── 模板匹配 ────────────────────────────

# 金额字段 → 对应 unit 字段映射（存储单位可能是"万元"或"元"，触发条件阈值统一以"元"表达）
_AMOUNT_UNIT_FIELDS: dict[str, str] = {
    "contract_amount": "amount_unit",
    "opportunity_amount": "opportunity_amount_unit",
    "deal_amount": "deal_amount_unit",
    "amount": "amount_unit",
}


def _normalize_amount_to_yuan(value, unit_field: str, target_obj) -> float:
    """将金额字段按其 unit 归一化为元，便于与阈值（元）比较。"""
    unit = getattr(target_obj, unit_field, None) or "元"
    try:
        v = float(value)
        return v * 10000 if unit == "万元" else v
    except (TypeError, ValueError):
        return float("nan")


def _eval_condition(cond_json: Optional[str], target_obj) -> bool:
    """评估触发条件。空条件=无条件触发。

    金额字段自动按 amount_unit 归一化为元后与阈值比较，
    避免"50 万元"录入 amount=50 被误判为"不足阈值"。
    """
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

    # 金额字段：归一化为元再比较
    unit_field = _AMOUNT_UNIT_FIELDS.get(field)
    if unit_field:
        actual = _normalize_amount_to_yuan(actual, unit_field, target_obj)
        try:
            val = float(val)
        except (TypeError, ValueError):
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


def get_active_instance(
    target_type: str, target_id: int, db: Session
) -> Optional[ApprovalInstance]:
    """获取某业务数据进行中的审批实例"""
    return db.exec(
        select(ApprovalInstance).where(
            ApprovalInstance.target_type == target_type,
            ApprovalInstance.target_id == target_id,
            ApprovalInstance.status == "pending",
        )
    ).first()


def start_approval(
    target_type: str,
    target_id: int,
    target_obj,
    title: str,
    submitter: User,
    db: Session,
) -> Optional[ApprovalInstance]:
    """发起审批。返回实例；若该业务类型无匹配模板（无需审批）返回 None。

    预检：若匹配到审批流但所有节点审批人均为空，抛 ValueError 拒绝提交，
    避免本应审批的单据被 _auto_skip_empty 自动放行。
    """
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
            n.get("approver_type", ""),
            str(n.get("approver_value", "")),
            submitter,
            db,
            target_obj=target_obj,
        )
        snapshot.append(
            {
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
            }
        )

    # 预检：所有节点审批人均为空时拒绝提交（避免单据被自动放行）
    empty_nodes = [s["name"] for s in snapshot if not s.get("approver_ids")]
    if empty_nodes and len(empty_nodes) == len(snapshot):
        raise ValueError(
            "审批流配置异常：所有节点均无可用审批人，请联系管理员检查审批流配置或组织架构"
        )

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

    db.add(
        ApprovalRecord(
            instance_id=inst.id,
            node_index=-1,
            node_name="发起申请",
            approver_id=submitter.id,
            action="submit",
            comment="",
        )
    )
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
        db.add(
            ApprovalRecord(
                instance_id=instance.id,
                node_index=idx,
                node_name=snapshot[idx]["name"],
                approver_id=actor_id,
                action="approve",
                comment="（无可用审批人，系统自动通过）",
            )
        )
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


def act(
    instance: ApprovalInstance, approver: User, action: str, comment: str, db: Session
) -> ApprovalInstance:
    """审批（approve）或驳回（reject）当前节点。

    使用 SELECT FOR UPDATE 锁定实例行，防止并发审批同一实例导致状态不一致。
    """
    # 行级锁：防止并发审批同一实例（先刷新获取最新数据再锁定）
    db.refresh(instance)
    locked = db.exec(
        select(ApprovalInstance)
        .where(ApprovalInstance.id == instance.id)
        .with_for_update()
    ).first()
    if not locked or locked.status != "pending":
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
        db.add(
            ApprovalRecord(
                instance_id=instance.id,
                node_index=idx,
                node_name=node["name"],
                approver_id=approver.id,
                action="reject",
                comment=comment,
            )
        )
        db.commit()
        _finish(instance, "rejected", db)
        return instance

    if action == "approve":
        node["status"] = "approved"
        node["decided_by"] = approver.id
        node["decided_at"] = _now().isoformat()
        db.add(
            ApprovalRecord(
                instance_id=instance.id,
                node_index=idx,
                node_name=node["name"],
                approver_id=approver.id,
                action="approve",
                comment=comment,
            )
        )
        next_idx = idx + 1
        # 跳过后续无审批人的节点
        while next_idx < len(snapshot) and not snapshot[next_idx].get("approver_ids"):
            snapshot[next_idx]["status"] = "approved"
            snapshot[next_idx]["decided_at"] = _now().isoformat()
            db.add(
                ApprovalRecord(
                    instance_id=instance.id,
                    node_index=next_idx,
                    node_name=snapshot[next_idx]["name"],
                    approver_id=approver.id,
                    action="approve",
                    comment="（无可用审批人，系统自动通过）",
                )
            )
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
    """发起人或管理员撤回审批（行级锁防并发）"""
    db.refresh(instance)
    locked = db.exec(
        select(ApprovalInstance)
        .where(ApprovalInstance.id == instance.id)
        .with_for_update()
    ).first()
    if not locked or locked.status != "pending":
        raise ValueError("该审批已结束，无法撤回")
    if instance.submitted_by != user.id and not user.is_admin:
        raise PermissionError("只有发起人可以撤回审批")
    db.add(
        ApprovalRecord(
            instance_id=instance.id,
            node_index=instance.current_node_index,
            node_name="撤回",
            approver_id=user.id,
            action="cancel",
            comment="",
        )
    )
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

            logging.getLogger("worktrack.approval").warning(
                "审批通知邮件失败(#%s): %s", inst_id, e
            )

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
            from app.services.email_service import (
                notify_approval_finished,
                _get_user_emails,
            )

            email_map = _get_user_emails([submitted_by])
            submitter_email = email_map.get(submitted_by)
            notify_approval_finished(instance, submitter_email)
        except Exception as e:
            import logging

            logging.getLogger("worktrack.approval").warning(
                "审批结果通知邮件失败(#%s): %s", inst_id, e
            )

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
                p.status = "已付款"  # 审批链含「出纳付款」执行节点，全部通过即已付款
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
                s.status = "已盖章"  # 审批链含「盖章」执行节点，全部通过即已盖章
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
                # 扣减假期额度（失败时写补偿记录，不静默吞掉）
                try:
                    leave_balance_service.apply_leave(
                        lv, db, operator_id=instance.submitted_by
                    )
                except Exception as e:
                    import logging

                    logging.getLogger("worktrack").warning(
                        "请假 #%s 扣减额度失败: %s", lv.id, e
                    )
                    _write_error_record(
                        db, instance, f"⚠️ 假期额度扣减失败：{e}（需 HR 人工处理）"
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
                # 若补偿方式为调休，授予调休额度；加班费则创建付款申请
                try:
                    if ot.compensate_type == "加班费":
                        _create_overtime_payment(ot, db)
                    else:
                        leave_balance_service.grant_overtime_compensate(ot, db)
                except Exception as e:
                    import logging

                    logging.getLogger("worktrack").warning(
                        "加班 #%s 补偿处理失败: %s", ot.id, e
                    )
                    _write_error_record(
                        db, instance, f"⚠️ 加班补偿处理失败：{e}（需 HR 人工处理）"
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
                # 审批链含「出纳付款」执行节点，全部通过即视为已付款
                # 取最后一个 execution 节点的审批人作为付款操作人
                e.status = "已付款"
                try:
                    snap = json.loads(instance.nodes_snapshot or "[]")
                    exec_node = next(
                        (
                            n
                            for n in reversed(snap)
                            if n.get("node_kind") == "execution"
                        ),
                        None,
                    )
                    if exec_node and exec_node.get("decided_by"):
                        e.paid_by = exec_node["decided_by"]
                        e.paid_at = _now()
                except (TypeError, ValueError):
                    pass
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

    elif instance.target_type == "hire":
        from app.models.hire_request import HireRequest

        hr = db.get(HireRequest, instance.target_id)
        if hr:
            if instance.status == "approved":
                # 最后一个 execution 节点（HR 执行入职）通过后，自动创建用户账号
                _create_user_from_hire(hr, db)
            elif instance.status == "rejected":
                hr.status = "已驳回"
            elif instance.status == "cancelled":
                hr.status = "草稿"
            hr.updated_at = _now()
            db.add(hr)
            db.commit()


def _create_user_from_hire(hr, db: Session) -> None:
    """入职审批通过后自动建账号（复用 users.py:create_user 核心逻辑）。

    - 密码自动生成、首登强制改密
    - leader_id 若空则兜底为部门负责人
    - 角色按部门继承（DepartmentRole），无需单独分配
    - 发送欢迎邮件（失败不阻断）
    """
    from app.models.user import User
    from app.models.department import Department
    from app.auth import hash_password, generate_initial_password
    from app.routers.logs import write_log

    # 二次校验唯一性（防并发）
    existing = db.exec(
        select(User).where(User.username == hr.candidate_username)
    ).first()
    if existing:
        # 已存在用户，直接关联并标记已入职
        hr.created_user_id = existing.id
        hr.status = "已入职"
        hr.onboarded_at = _now()
        write_log(
            "warning",
            "hire",
            f"入职申请 #{hr.id} 审批通过，但用户名 {hr.candidate_username} 已存在，复用现有账号 #{existing.id}",
            db=db,
        )
        return

    # leader_id 兜底：若未指定，取部门负责人
    resolved_leader_id = hr.leader_id
    if hr.department_id:
        dept = db.get(Department, hr.department_id)
        if dept and dept.manager_id and hr.leader_id is None:
            resolved_leader_id = dept.manager_id

    initial_password = generate_initial_password()
    user = User(
        username=hr.candidate_username,
        password_hash=hash_password(initial_password),
        name=hr.candidate_name,
        email=hr.candidate_email,
        is_admin=hr.is_admin,
        use_shared_models=hr.use_shared_models,
        leader_id=resolved_leader_id,
        department_id=hr.department_id,
        job_title=hr.job_title,
        first_work_date=hr.first_work_date,
        hire_date=hr.hire_date,
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    hr.created_user_id = user.id
    hr.status = "已入职"
    hr.onboarded_at = _now()

    # 发送欢迎邮件（失败不阻断建号）
    try:
        from app.services.email_service import (
            is_email_configured,
            send_welcome_email,
            _get_frontend_url,
        )
        from app.config import settings

        if is_email_configured():
            base = (
                _get_frontend_url()
                or (settings.cors_origins.split(",")[0] or "").strip()
            )
            login_url = f"{base.rstrip('/')}/login" if base else ""
            send_welcome_email(
                to=user.email,
                username=user.username,
                password=initial_password,
                name=user.name,
                login_url=login_url,
            )
    except Exception:
        import logging

        logging.getLogger("worktrack").warning(
            "入职申请 #%s 建账号欢迎邮件发送失败 user=%s",
            hr.id,
            user.username,
            exc_info=True,
        )

    write_log(
        "info",
        "hire",
        f"入职申请 #{hr.id} 审批通过，已自动创建账号 #{user.id}（{user.username}），角色按部门继承",
        db=db,
    )


def _write_error_record(db: Session, instance: ApprovalInstance, message: str) -> None:
    """审批结束后业务回调失败时，写一条带 ⚠️ 标记的 ApprovalRecord 留痕。

    复用 action="approve"（避免引入新枚举），comment 中带 ⚠️ 前缀以便前端识别和过滤。
    """
    try:
        snap = json.loads(instance.nodes_snapshot or "[]")
        last_node_name = snap[-1].get("name", "") if snap else ""
        last_node_index = len(snap) - 1 if snap else 0
    except (TypeError, ValueError):
        last_node_name, last_node_index = "", 0

    rec = ApprovalRecord(
        instance_id=instance.id,
        node_index=last_node_index,
        node_name=last_node_name,
        approver_id=instance.submitted_by,
        action="approve",
        comment=message,
    )
    db.add(rec)
    db.commit()
    import logging

    logging.getLogger("worktrack").warning(
        "审批实例 #%s 业务回调异常已留痕：%s", instance.id, message
    )


def _create_overtime_payment(overtime, db: Session) -> None:
    """加班费补偿落地：创建一条草稿态 PaymentRequest，由 HR/出纳填金额后提交付款审批。

    设计取舍：
    - OvertimeRequest 模型无「时薪」字段，金额无法自动计算
    - 因此创建 amount=0 的草稿付款单，reason 写明加班时长和加班单 ID
    - HR/出纳根据公司薪资标准填金额后，走标准付款审批流程（payment_approval）
    """
    from app.models.payment import PaymentRequest
    from app.models.user import User

    applicant = db.get(User, overtime.user_id)
    applicant_name = (
        applicant.name or applicant.username
        if applicant
        else f"用户#{overtime.user_id}"
    )

    # 幂等：避免同一加班单重复创建付款单
    existing = db.exec(
        select(PaymentRequest).where(
            PaymentRequest.user_id == overtime.user_id,
            PaymentRequest.title == f"加班费-{overtime.title}",
            PaymentRequest.reason.like(f"%加班单 #{overtime.id}%"),
        )
    ).first()
    if existing:
        return

    p = PaymentRequest(
        user_id=overtime.user_id,
        payment_type="工资",
        title=f"加班费-{overtime.title}",
        amount=0,
        amount_unit="元",
        currency="CNY",
        payee=applicant_name,
        payee_account="",
        reason=(
            f"加班单 #{overtime.id} 审批通过，补偿方式=加班费。\n"
            f"加班时长：{overtime.hours} 小时\n"
            f"加班时段：{overtime.start_at.strftime('%Y-%m-%d %H:%M')} ~ "
            f"{overtime.end_at.strftime('%Y-%m-%d %H:%M')}\n"
            f"请 HR/出纳按公司薪资标准填写金额后提交付款审批。"
        ),
        status="草稿",
    )
    db.add(p)
    db.commit()
    import logging

    logging.getLogger("worktrack").info(
        "加班 #%s 补偿方式=加班费，已创建付款申请 #%s（草稿，待填金额）",
        overtime.id,
        p.id,
    )


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
