"""供应商模型变更管理 API

事件状态机: draft → active → completed / cancelled
阶段状态机: pending → in_progress → awaiting_approval → approved → completed
                                  ↗ (approval_required=False 跳过审批)
"""
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, col

from app.database import get_session
from app.auth import get_current_user, require_permission
from app.models.user import User
from app.models.supplier import Supplier
from app.models.channel import Channel
from app.models.project import Project
from app.models.customer import Customer
from app.models.project_cost import ProjectCost
from app.models.model_change import (
    ModelChangeEvent,
    ModelChangeStage,
    ModelChangeCustomerTask,
    STAGE_TYPES,
    STAGE_TYPE_NAMES,
)
from app.schemas.model_change import (
    ModelChangeEventCreate,
    ModelChangeEventUpdate,
    ModelChangeEventOut,
    ModelChangeEventListItem,
    StageOut,
    StageAssignIn,
    StageCompleteIn,
    StageApproveIn,
    CustomerTaskOut,
    CustomerTaskUpdate,
)

router = APIRouter(prefix="/api/v1/model-changes", tags=["模型变更管理"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── 辅助函数 ─────────────────────────────────────────────────────────────────

def _user_names(db: Session, ids: list[Optional[int]]) -> dict[int, str]:
    clean = [i for i in ids if i]
    if not clean:
        return {}
    rows = db.exec(select(User).where(User.id.in_(clean))).all()
    return {u.id: (u.name or u.username) for u in rows}


def _parse_json_ids(raw: str) -> list[int]:
    try:
        return [int(x) for x in json.loads(raw or "[]")]
    except Exception:
        return []


def _stage_out(stage: ModelChangeStage, names: dict[int, str]) -> StageOut:
    return StageOut(
        id=stage.id,
        event_id=stage.event_id,
        stage_type=stage.stage_type,
        name=stage.name,
        order=stage.order,
        status=stage.status,
        assigned_to=stage.assigned_to,
        assigned_to_name=names.get(stage.assigned_to) if stage.assigned_to else None,
        assigned_by=stage.assigned_by,
        assigned_at=stage.assigned_at,
        started_at=stage.started_at,
        completed_at=stage.completed_at,
        action_summary=stage.action_summary,
        feedback=stage.feedback,
        attachments=_parse_json_ids(stage.attachments) if False else json.loads(stage.attachments or "[]"),
        approval_required=stage.approval_required,
        approver_id=stage.approver_id,
        approver_name=names.get(stage.approver_id) if stage.approver_id else None,
        approved_at=stage.approved_at,
        approval_note=stage.approval_note,
        created_at=stage.created_at,
        updated_at=stage.updated_at,
    )


def _customer_task_out(
    task: ModelChangeCustomerTask,
    names: dict[int, str],
    customer_names: dict[int, str],
    project_names: dict[int, str],
) -> CustomerTaskOut:
    return CustomerTaskOut(
        id=task.id,
        event_id=task.event_id,
        stage_id=task.stage_id,
        customer_id=task.customer_id,
        customer_name=customer_names.get(task.customer_id),
        project_id=task.project_id,
        project_name=project_names.get(task.project_id) if task.project_id else None,
        assigned_to=task.assigned_to,
        assigned_to_name=names.get(task.assigned_to) if task.assigned_to else None,
        status=task.status,
        contact_method=task.contact_method,
        contacted_at=task.contacted_at,
        customer_deadline=task.customer_deadline,
        confirmed_at=task.confirmed_at,
        customer_response=task.customer_response,
        notes=task.notes,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _get_event_or_404(event_id: int, db: Session) -> ModelChangeEvent:
    event = db.get(ModelChangeEvent, event_id)
    if not event:
        raise HTTPException(404, "变更事件不存在")
    return event


def _build_event_out(event: ModelChangeEvent, db: Session) -> ModelChangeEventOut:
    stages = db.exec(
        select(ModelChangeStage).where(ModelChangeStage.event_id == event.id)
        .order_by(col(ModelChangeStage.order))
    ).all()
    tasks = db.exec(
        select(ModelChangeCustomerTask).where(ModelChangeCustomerTask.event_id == event.id)
    ).all()

    # 收集所有需要映射的 user ids
    user_ids = [event.created_by]
    for s in stages:
        user_ids += [s.assigned_to, s.assigned_by, s.approver_id]
    for t in tasks:
        user_ids.append(t.assigned_to)
    names = _user_names(db, user_ids)

    supplier = db.get(Supplier, event.supplier_id)

    # customer / project 名称
    cust_ids = list({t.customer_id for t in tasks})
    proj_ids = list({t.project_id for t in tasks if t.project_id})
    cust_names: dict[int, str] = {}
    proj_names: dict[int, str] = {}
    if cust_ids:
        for c in db.exec(select(Customer).where(Customer.id.in_(cust_ids))).all():
            cust_names[c.id] = c.name
    if proj_ids:
        for p in db.exec(select(Project).where(Project.id.in_(proj_ids))).all():
            proj_names[p.id] = p.name

    return ModelChangeEventOut(
        id=event.id,
        title=event.title,
        change_type=event.change_type,
        supplier_id=event.supplier_id,
        supplier_name=supplier.name if supplier else None,
        channel_ids=_parse_json_ids(event.channel_ids),
        effective_date=event.effective_date,
        source=event.source,
        description=event.description,
        old_value=event.old_value,
        new_value=event.new_value,
        risk_level=event.risk_level,
        affected_projects=_parse_json_ids(event.affected_projects),
        status=event.status,
        created_by=event.created_by,
        created_by_name=names.get(event.created_by),
        created_at=event.created_at,
        updated_at=event.updated_at,
        stages=[_stage_out(s, names) for s in stages],
        customer_tasks=[_customer_task_out(t, names, cust_names, proj_names) for t in tasks],
    )


# ── 变更事件 CRUD ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ModelChangeEventListItem])
def list_events(
    status: Optional[str] = None,
    risk_level: Optional[str] = None,
    supplier_id: Optional[int] = None,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:read")),
):
    query = select(ModelChangeEvent).order_by(col(ModelChangeEvent.id).desc())
    if status:
        query = query.where(ModelChangeEvent.status == status)
    if risk_level:
        query = query.where(ModelChangeEvent.risk_level == risk_level)
    if supplier_id:
        query = query.where(ModelChangeEvent.supplier_id == supplier_id)
    events = db.exec(query).all()

    supplier_ids = list({e.supplier_id for e in events})
    supplier_map: dict[int, str] = {}
    if supplier_ids:
        for s in db.exec(select(Supplier).where(Supplier.id.in_(supplier_ids))).all():
            supplier_map[s.id] = s.name

    user_ids = [e.created_by for e in events]
    names = _user_names(db, user_ids)

    result = []
    for event in events:
        stages = db.exec(
            select(ModelChangeStage).where(ModelChangeStage.event_id == event.id)
            .order_by(col(ModelChangeStage.order))
        ).all()
        active = next((s for s in stages if s.status in ("in_progress", "awaiting_approval")), None)
        affected = _parse_json_ids(event.affected_projects)
        result.append(ModelChangeEventListItem(
            id=event.id,
            title=event.title,
            change_type=event.change_type,
            supplier_id=event.supplier_id,
            supplier_name=supplier_map.get(event.supplier_id),
            risk_level=event.risk_level,
            status=event.status,
            effective_date=event.effective_date,
            created_by=event.created_by,
            created_by_name=names.get(event.created_by),
            created_at=event.created_at,
            updated_at=event.updated_at,
            current_stage_order=active.order if active else None,
            current_stage_name=active.name if active else None,
            affected_count=len(affected),
        ))
    return result


@router.post("", response_model=ModelChangeEventOut)
def create_event(
    body: ModelChangeEventCreate,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    now = _now()
    event = ModelChangeEvent(
        title=body.title,
        change_type=body.change_type,
        supplier_id=body.supplier_id,
        channel_ids=json.dumps(body.channel_ids),
        effective_date=body.effective_date,
        source=body.source,
        description=body.description,
        old_value=body.old_value,
        new_value=body.new_value,
        risk_level=body.risk_level,
        affected_projects="[]",
        status="draft",
        created_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(event)
    db.flush()  # 获取 event.id

    # 自动创建4个阶段
    for i, stage_type in enumerate(STAGE_TYPES, start=1):
        stage = ModelChangeStage(
            event_id=event.id,
            stage_type=stage_type,
            name=STAGE_TYPE_NAMES[stage_type],
            order=i,
            status="pending",
            approval_required=(stage_type in ("assessment", "platform_action")),
            created_at=now,
            updated_at=now,
        )
        db.add(stage)

    db.commit()
    db.refresh(event)
    return _build_event_out(event, db)


@router.get("/{event_id}", response_model=ModelChangeEventOut)
def get_event(
    event_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:read")),
):
    event = _get_event_or_404(event_id, db)
    return _build_event_out(event, db)


@router.put("/{event_id}", response_model=ModelChangeEventOut)
def update_event(
    event_id: int,
    body: ModelChangeEventUpdate,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    event = _get_event_or_404(event_id, db)
    if event.status == "completed":
        raise HTTPException(400, "已完成的变更事件不可修改")
    data = body.model_dump(exclude_unset=True)
    if "channel_ids" in data:
        data["channel_ids"] = json.dumps(data["channel_ids"])
    for k, v in data.items():
        setattr(event, k, v)
    event.updated_at = _now()
    db.add(event)
    db.commit()
    db.refresh(event)
    return _build_event_out(event, db)


@router.delete("/{event_id}")
def delete_event(
    event_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    event = _get_event_or_404(event_id, db)
    # cascade: delete child records first
    stages = db.exec(select(ModelChangeStage).where(ModelChangeStage.event_id == event_id)).all()
    for s in stages:
        tasks = db.exec(select(ModelChangeCustomerTask).where(ModelChangeCustomerTask.stage_id == s.id)).all()
        for t in tasks:
            db.delete(t)
        db.delete(s)
    remaining_tasks = db.exec(select(ModelChangeCustomerTask).where(ModelChangeCustomerTask.event_id == event_id)).all()
    for t in remaining_tasks:
        db.delete(t)
    db.delete(event)
    db.commit()
    return {"ok": True}


# ── 影响评估（自动分析 + 生成客户任务） ──────────────────────────────────────

@router.post("/{event_id}/analyze", response_model=ModelChangeEventOut)
def analyze_impact(
    event_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    """
    自动影响分析：通过 supplier_id → ProjectCost → Project → Customer
    分析受影响的项目，更新 affected_projects，并为阶段4生成客户跟进任务。
    """
    event = _get_event_or_404(event_id, db)
    if event.status == "cancelled":
        raise HTTPException(400, "已取消的事件不可分析")

    # 找出使用该供应商的所有 project_id
    cost_rows = db.exec(
        select(ProjectCost.project_id).where(
            ProjectCost.supplier_id == event.supplier_id
        ).distinct()
    ).all()
    project_ids = list({r for r in cost_rows if r})

    # 更新 affected_projects
    event.affected_projects = json.dumps(project_ids)

    # 如果指定了 channel_ids，进一步筛选（Channel.supplier_id 匹配，但 ProjectCost 无直接 channel 关联）
    # 目前以 supplier 维度为准，channel_ids 仅作为元数据记录

    # 找阶段4 (customer_notify)
    stage4 = db.exec(
        select(ModelChangeStage).where(
            ModelChangeStage.event_id == event.id,
            ModelChangeStage.stage_type == "customer_notify",
        )
    ).first()
    if not stage4:
        raise HTTPException(500, "阶段4不存在，请检查事件阶段是否完整")

    # 删除旧的客户任务（重新分析场景）
    old_tasks = db.exec(
        select(ModelChangeCustomerTask).where(
            ModelChangeCustomerTask.event_id == event.id,
            ModelChangeCustomerTask.stage_id == stage4.id,
        )
    ).all()
    for t in old_tasks:
        db.delete(t)

    # 按项目生成客户跟进任务
    now = _now()
    seen_customer_project: set[tuple[int, int]] = set()
    for pid in project_ids:
        project = db.get(Project, pid)
        if not project:
            continue
        cid = project.customer_id
        if not cid:
            continue
        key = (cid, pid)
        if key in seen_customer_project:
            continue
        seen_customer_project.add(key)
        task = ModelChangeCustomerTask(
            event_id=event.id,
            stage_id=stage4.id,
            customer_id=cid,
            project_id=pid,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        db.add(task)

    # 激活事件（如果还是 draft）
    if event.status == "draft":
        event.status = "active"
    event.updated_at = now

    db.add(event)
    db.commit()
    db.refresh(event)
    return _build_event_out(event, db)


# ── 阶段操作 ─────────────────────────────────────────────────────────────────

def _get_stage_or_404(event_id: int, stage_id: int, db: Session) -> ModelChangeStage:
    stage = db.exec(
        select(ModelChangeStage).where(
            ModelChangeStage.id == stage_id,
            ModelChangeStage.event_id == event_id,
        )
    ).first()
    if not stage:
        raise HTTPException(404, "阶段不存在")
    return stage


def _next_stage(event_id: int, current_order: int, db: Session) -> Optional[ModelChangeStage]:
    return db.exec(
        select(ModelChangeStage).where(
            ModelChangeStage.event_id == event_id,
            ModelChangeStage.order == current_order + 1,
        )
    ).first()


@router.post("/{event_id}/stages/{stage_id}/assign", response_model=StageOut)
def assign_stage(
    event_id: int,
    stage_id: int,
    body: StageAssignIn,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    """为阶段指派执行人"""
    event = _get_event_or_404(event_id, db)
    if event.status == "cancelled":
        raise HTTPException(400, "已取消的事件不可操作")
    stage = _get_stage_or_404(event_id, stage_id, db)
    if stage.status == "completed":
        raise HTTPException(400, "阶段已完成，不可重新指派")
    assignee = db.get(User, body.assigned_to)
    if not assignee:
        raise HTTPException(404, "指派的用户不存在")

    now = _now()
    stage.assigned_to = body.assigned_to
    stage.assigned_by = current_user.id
    stage.assigned_at = now
    stage.updated_at = now
    db.add(stage)
    db.commit()
    db.refresh(stage)

    names = _user_names(db, [stage.assigned_to, stage.assigned_by, stage.approver_id])
    return _stage_out(stage, names)


@router.post("/{event_id}/stages/{stage_id}/start", response_model=StageOut)
def start_stage(
    event_id: int,
    stage_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    """开始执行阶段 (pending → in_progress)"""
    event = _get_event_or_404(event_id, db)
    if event.status == "cancelled":
        raise HTTPException(400, "已取消的事件不可操作")
    stage = _get_stage_or_404(event_id, stage_id, db)
    if stage.status != "pending":
        raise HTTPException(400, f"当前阶段状态为 {stage.status}，无法开始")

    # 检查前序阶段是否已完成
    if stage.order > 1:
        prev = db.exec(
            select(ModelChangeStage).where(
                ModelChangeStage.event_id == event_id,
                ModelChangeStage.order == stage.order - 1,
            )
        ).first()
        if prev and prev.status != "completed":
            raise HTTPException(400, f"前序阶段「{prev.name}」尚未完成，请先完成前序阶段")

    now = _now()
    stage.status = "in_progress"
    stage.started_at = now
    stage.updated_at = now
    db.add(stage)
    db.commit()
    db.refresh(stage)
    names = _user_names(db, [stage.assigned_to, stage.assigned_by, stage.approver_id])
    return _stage_out(stage, names)


@router.post("/{event_id}/stages/{stage_id}/complete", response_model=StageOut)
def complete_stage(
    event_id: int,
    stage_id: int,
    body: StageCompleteIn,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    """完成阶段执行 (in_progress → awaiting_approval 或直接 completed)"""
    event = _get_event_or_404(event_id, db)
    if event.status == "cancelled":
        raise HTTPException(400, "已取消的事件不可操作")
    stage = _get_stage_or_404(event_id, stage_id, db)
    if stage.status != "in_progress":
        raise HTTPException(400, f"当前阶段状态为 {stage.status}，无法完成")

    now = _now()
    stage.action_summary = body.action_summary
    stage.feedback = body.feedback
    stage.attachments = json.dumps(body.attachments)
    stage.updated_at = now

    if stage.approval_required:
        stage.status = "awaiting_approval"
    else:
        stage.status = "completed"
        stage.completed_at = now
        _advance_or_close(event, stage, db, now)

    db.add(stage)
    db.commit()
    db.refresh(stage)
    names = _user_names(db, [stage.assigned_to, stage.assigned_by, stage.approver_id])
    return _stage_out(stage, names)


@router.post("/{event_id}/stages/{stage_id}/approve", response_model=StageOut)
def approve_stage(
    event_id: int,
    stage_id: int,
    body: StageApproveIn,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    """审批通过/驳回 (awaiting_approval → completed / in_progress)"""
    event = _get_event_or_404(event_id, db)
    if event.status == "cancelled":
        raise HTTPException(400, "已取消的事件不可操作")
    stage = _get_stage_or_404(event_id, stage_id, db)
    if stage.status != "awaiting_approval":
        raise HTTPException(400, f"当前阶段状态为 {stage.status}，不在待审批状态")

    now = _now()
    stage.approver_id = current_user.id
    stage.approved_at = now
    stage.approval_note = body.note
    stage.updated_at = now

    if body.approved:
        stage.status = "completed"
        stage.completed_at = now
        _advance_or_close(event, stage, db, now)
    else:
        # 驳回：退回执行
        stage.status = "in_progress"
        stage.approved_at = None
        stage.completed_at = None

    db.add(stage)
    db.commit()
    db.refresh(stage)
    names = _user_names(db, [stage.assigned_to, stage.assigned_by, stage.approver_id])
    return _stage_out(stage, names)


def _advance_or_close(
    event: ModelChangeEvent,
    completed_stage: ModelChangeStage,
    db: Session,
    now: datetime,
) -> None:
    """阶段完成后：激活下一阶段；若是最后阶段则关闭事件。"""
    nxt = _next_stage(event.id, completed_stage.order, db)
    if nxt:
        # 下一阶段自动开始（如果已指派）或保持 pending
        pass  # 由前端点击"开始"来激活，保持手动控制粒度
    else:
        # 没有下一阶段 → 事件完成
        event.status = "completed"
        event.updated_at = now
        db.add(event)


# ── 客户跟进任务 ──────────────────────────────────────────────────────────────

@router.get("/{event_id}/customer-tasks", response_model=list[CustomerTaskOut])
def list_customer_tasks(
    event_id: int,
    status: Optional[str] = None,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:read")),
):
    _get_event_or_404(event_id, db)
    query = select(ModelChangeCustomerTask).where(ModelChangeCustomerTask.event_id == event_id)
    if status:
        query = query.where(ModelChangeCustomerTask.status == status)
    tasks = db.exec(query).all()

    user_ids = [t.assigned_to for t in tasks]
    names = _user_names(db, user_ids)

    cust_ids = list({t.customer_id for t in tasks})
    proj_ids = list({t.project_id for t in tasks if t.project_id})
    cust_names: dict[int, str] = {}
    proj_names: dict[int, str] = {}
    if cust_ids:
        for c in db.exec(select(Customer).where(Customer.id.in_(cust_ids))).all():
            cust_names[c.id] = c.name
    if proj_ids:
        for p in db.exec(select(Project).where(Project.id.in_(proj_ids))).all():
            proj_names[p.id] = p.name

    return [_customer_task_out(t, names, cust_names, proj_names) for t in tasks]


@router.put("/{event_id}/customer-tasks/{task_id}", response_model=CustomerTaskOut)
def update_customer_task(
    event_id: int,
    task_id: int,
    body: CustomerTaskUpdate,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:edit")),
):
    task = db.exec(
        select(ModelChangeCustomerTask).where(
            ModelChangeCustomerTask.id == task_id,
            ModelChangeCustomerTask.event_id == event_id,
        )
    ).first()
    if not task:
        raise HTTPException(404, "客户任务不存在")

    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(task, k, v)
    task.updated_at = _now()
    db.add(task)
    db.commit()
    db.refresh(task)

    names = _user_names(db, [task.assigned_to])
    customer = db.get(Customer, task.customer_id)
    project = db.get(Project, task.project_id) if task.project_id else None
    cust_names = {task.customer_id: customer.name} if customer else {}
    proj_names = {task.project_id: project.name} if project else {}
    return _customer_task_out(task, names, cust_names, proj_names)
