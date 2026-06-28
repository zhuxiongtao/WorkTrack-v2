from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select
from app.database import get_session
from app.models.project import Project
from app.models.meeting_note import MeetingNote
from app.models.user import User
from app.auth import get_current_user, require_permission
from app.schemas import ProjectCreate, ProjectUpdate, ProjectOut, MeetingNoteOut
from app.services.vector_store import index_document, delete_document
from app.services.ai_service import generate_project_analysis
from app.utils.time import BEIJING_TZ, now, utc_now

router = APIRouter(prefix="/api/v1/projects", tags=["项目"])


def _contract_info(db: Session, project_ids: list[int]) -> dict[int, dict]:
    """批量查询一组项目的合同信息：数量 + 最早开始/最晚结束日期"""
    if not project_ids:
        return {}
    from app.models.contract import Contract
    from sqlmodel import func
    rows = db.exec(
        select(
            Contract.project_id,
            func.count(Contract.id),
            func.min(Contract.start_date),
            func.max(Contract.end_date),
        )
        .where(Contract.project_id.in_(project_ids))
        .group_by(Contract.project_id)
    ).all()
    return {
        pid: {"count": cnt, "min_start": min_s, "max_end": max_e}
        for pid, cnt, min_s, max_e in rows
    }


def _calc_period_label(min_start, max_end) -> str:
    """根据合同日期范围计算周期标签"""
    if not min_start or not max_end:
        return ""
    from datetime import date
    # 兼容 string / date
    if isinstance(min_start, str):
        min_start = date.fromisoformat(min_start)
    if isinstance(max_end, str):
        max_end = date.fromisoformat(max_end)
    days = (max_end - min_start).days
    if days <= 0:
        return ""
    if days <= 35:
        return "月度"
    if days <= 100:
        return "季度"
    if days <= 200:
        return "半年"
    if days <= 380:
        return "1年"
    if days <= 760:
        return "2年"
    return "3年+"


def _enrich(db: Session, project, info: dict):
    """把 SQLModel Project 转成 ProjectOut 并注入合同相关字段"""
    out = ProjectOut.model_validate(project)
    out.contract_count = info.get("count", 0)
    # 有合同时自动计算合同周期（覆盖手填值）
    if out.contract_count > 0:
        label = _calc_period_label(info.get("min_start"), info.get("max_end"))
        if label:
            out.contract_period = label
    return out


@router.get("/selector")
def project_selector(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """下拉选择器用——仅返回 {id, name, customer_id}，任何登录用户可访问，不需要 project:read 权限"""
    rows = db.exec(select(Project.id, Project.name, Project.customer_id).order_by(Project.name)).all()
    return [{"id": r[0], "name": r[1], "customer_id": r[2]} for r in rows]


@router.get("", response_model=list[ProjectOut])
def list_projects(
    user_id: Optional[int] = Query(None),
    user_ids: Optional[str] = Query(None, description="逗号分隔的用户ID列表，如 1,2,3"),
    customer_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("project:read")),
    db: Session = Depends(get_session),
):
    from app.auth import check_data_access, get_visible_user_ids

    # 多用户模式（团队视图）
    if user_ids:
        try:
            requested_ids = [int(x.strip()) for x in user_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="user_ids 格式错误，请用逗号分隔的数字")

        # 获取可见范围并取交集
        visible = get_visible_user_ids(current_user, db, module="project")
        if visible is None:
            validated_ids = requested_ids
        else:
            validated_ids = [uid for uid in requested_ids if uid in visible]

        if not validated_ids:
            return []

        query = select(Project).where(Project.user_id.in_(validated_ids)).order_by(Project.created_at.desc())
        if customer_id:
            query = query.where(Project.customer_id == customer_id)
        if status:
            query = query.where(Project.status == status)
        projects = db.exec(query).all()
        info = _contract_info(db, [p.id for p in projects])
        return [_enrich(db, p, info.get(p.id, {})) for p in projects]

    # 单用户模式（保持向后兼容）
    target_uid = user_id if user_id is not None else current_user.id
    if not check_data_access(target_uid, current_user, db):
        raise HTTPException(status_code=403, detail="无权查看该用户的项目列表")

    query = select(Project).where(Project.user_id == target_uid).order_by(Project.created_at.desc())
    if customer_id:
        query = query.where(Project.customer_id == customer_id)
    if status:
        query = query.where(Project.status == status)
    projects = db.exec(query).all()
    info = _contract_info(db, [p.id for p in projects])
    return [_enrich(db, p, info.get(p.id, {})) for p in projects]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(data: ProjectCreate, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("project:create")), db: Session = Depends(get_session)):
    meeting_ids = data.meeting_ids or []
    contract_ids = data.contract_ids or []
    create_data = data.model_dump(exclude={"meeting_ids", "contract_ids"})
    create_data["user_id"] = current_user.id
    if not create_data.get("status"):
        create_data["status"] = "待立项"
    # 销售负责人默认为创建者，若未显式指定 user_id 则回填当前用户
    if not create_data.get("sales_person_user_id"):
        create_data["sales_person_user_id"] = current_user.id
        if not create_data.get("sales_person"):
            create_data["sales_person"] = current_user.name or current_user.username
    project = Project(**create_data)
    db.add(project)
    db.commit()
    db.refresh(project)
    # 关联会议纪要（仅关联当前用户自己的会议）
    if meeting_ids:
        for mid in meeting_ids:
            meeting = db.get(MeetingNote, mid)
            if meeting and meeting.user_id == current_user.id:
                meeting.project_id = project.id
    # 关联合同
    if contract_ids:
        from app.models.contract import Contract
        for cid in contract_ids:
            contract = db.get(Contract, cid)
            if contract:
                contract.project_id = project.id
    if meeting_ids or contract_ids:
        db.commit()
    background_tasks.add_task(
        index_document,
        collection_name="projects",
        doc_id=str(project.id),
        text=f"{project.name}\n{project.customer_name}\n{project.progress or ''}",
        metadata={"status": project.status, "user_id": project.user_id},
    )
    return _enrich(db, project, {})


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, current_user: User = Depends(require_permission("project:read")), db: Session = Depends(get_session)):
    """获取单个项目详情"""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 统一角色权限核验（部门负责人、老板、创作者）
    from app.auth import check_data_access, check_share_access
    if not check_data_access(project.user_id, current_user, db):
        # DataShare fallback
        if not check_share_access("project", project_id, current_user, db):
            raise HTTPException(status_code=403, detail="无权查看该项目")

    info = _contract_info(db, [project.id])
    return _enrich(db, project, info.get(project.id, {}))


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, data: ProjectUpdate, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("project:edit")), db: Session = Depends(get_session)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    from app.auth import check_data_access
    if not check_data_access(project.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权编辑该项目")
    meeting_ids = data.meeting_ids
    contract_ids = data.contract_ids
    update_data = data.model_dump(exclude={"meeting_ids", "contract_ids"}, exclude_unset=True)
    for key, value in update_data.items():
        setattr(project, key, value)
    if project.deal_amount and project.deal_amount > 0 and project.cost_amount is not None:
        deal_yuan = project.deal_amount * 10000 if project.deal_amount_unit == '万元' else project.deal_amount
        project.gross_margin = round((1 - project.cost_amount / deal_yuan) * 100, 2)
    else:
        project.gross_margin = None
    project.updated_at = utc_now()
    db.add(project)
    db.commit()
    db.refresh(project)
    # 更新会议关联（如果提供了 meeting_ids）
    if meeting_ids is not None:
        # 清除旧关联
        old_meetings = db.exec(select(MeetingNote).where(MeetingNote.project_id == project_id)).all()
        for m in old_meetings:
            m.project_id = None
        # 设置新关联（仅关联当前用户自己的会议）
        for mid in meeting_ids:
            meeting = db.get(MeetingNote, mid)
            if meeting and meeting.user_id == current_user.id:
                meeting.project_id = project_id
        db.commit()
    # 更新合同关联（如果提供了 contract_ids）
    if contract_ids is not None:
        from app.models.contract import Contract
        # 解除本项目原有合同关联
        old_contracts = db.exec(select(Contract).where(Contract.project_id == project_id)).all()
        for c in old_contracts:
            c.project_id = None
        # 设置新关联
        for cid in contract_ids:
            contract = db.get(Contract, cid)
            if contract:
                contract.project_id = project_id
        db.commit()
    background_tasks.add_task(
        index_document,
        collection_name="projects",
        doc_id=str(project.id),
        text=f"{project.name}\n{project.customer_name}\n{project.progress or ''}",
        metadata={"status": project.status, "user_id": project.user_id},
    )
    info = _contract_info(db, [project.id])
    return _enrich(db, project, info.get(project.id, {}))


@router.get("/{project_id}/contracts")
def get_project_contracts(project_id: int, current_user: User = Depends(require_permission("project:read")), db: Session = Depends(get_session)):
    """获取关联到本项目的合同列表（含团队可见范围）"""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    from app.auth import check_data_access, check_share_access
    if not check_data_access(project.user_id, current_user, db):
        if not check_share_access("project", project_id, current_user, db):
            raise HTTPException(status_code=403, detail="无权查看该项目")
    from app.models.contract import Contract
    contracts = db.exec(
        select(Contract).where(Contract.project_id == project_id).order_by(Contract.sign_date.desc(), Contract.created_at.desc())
    ).all()
    return contracts


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("project:delete")), db: Session = Depends(get_session)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    from app.auth import check_data_access
    if not check_data_access(project.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权删除该项目")

    # 清除关联表中的 project_id 引用，避免 FK 约束报错
    from sqlmodel import text as sql_text
    db.execute(sql_text("UPDATE meetingnote SET project_id = NULL WHERE project_id = :pid"), {"pid": project_id})
    db.execute(sql_text("UPDATE contract SET project_id = NULL WHERE project_id = :pid"), {"pid": project_id})
    db.execute(sql_text("UPDATE reconcile_sales SET project_id = NULL WHERE project_id = :pid"), {"pid": project_id})
    db.execute(sql_text("UPDATE reconcile_diff SET project_id = NULL WHERE project_id = :pid"), {"pid": project_id})
    db.execute(sql_text("UPDATE model_change_customer_task SET project_id = NULL WHERE project_id = :pid"), {"pid": project_id})
    # project_cost 属于项目本身，一并删除
    db.execute(sql_text("DELETE FROM project_cost WHERE project_id = :pid"), {"pid": project_id})

    db.delete(project)
    db.commit()
    background_tasks.add_task(delete_document, "projects", str(project_id))


@router.post("/{project_id}/ai-analysis")
def ai_analyze_project(project_id: int, current_user: User = Depends(require_permission("project:edit")), db: Session = Depends(get_session)):
    """触发 AI 项目分析，结果自动保存到项目"""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    from app.auth import check_data_access
    if not check_data_access(project.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权分析该项目")
    analysis = generate_project_analysis(project_id, db, current_user.id)
    project.analysis = analysis
    project.updated_at = utc_now()
    db.add(project)
    db.commit()
    return {"project_id": project_id, "analysis": analysis}


@router.get("/{project_id}/meetings", response_model=list[MeetingNoteOut])
def get_project_meetings(project_id: int, current_user: User = Depends(require_permission("project:read")), db: Session = Depends(get_session)):
    """获取关联到项目的会议列表"""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    from app.auth import check_data_access
    if not check_data_access(project.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权查看该项目")
    meetings = db.exec(
        select(MeetingNote).where(MeetingNote.project_id == project_id).order_by(MeetingNote.meeting_date.desc())
    ).all()
    return meetings


@router.post("/{project_id}/submit-approval")
def submit_project_charter(
    project_id: int,
    current_user: User = Depends(require_permission("project:edit")),
    db: Session = Depends(get_session),
):
    """提交项目立项申请，发起多级审批流。"""
    from datetime import datetime, timezone
    from app.services import approval_engine

    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    from app.auth import check_data_access
    if not check_data_access(project.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权操作该项目")
    if approval_engine.get_active_instance("project", project_id, db):
        raise HTTPException(status_code=400, detail="该项目已有进行中的立项审批")

    try:
        inst = approval_engine.start_approval(
            "project", project_id, project,
            f"项目《{project.name}》立项申请", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if inst is None:
        project.status = "进行中"
        project.updated_at = now()
        db.add(project)
        db.commit()
        return {"approval_id": None, "status": project.status, "message": "无需审批，项目已直接立项"}

    if inst.status == "pending":
        project.status = "审批中"
        project.updated_at = now()
        db.add(project)
        db.commit()

    return {"approval_id": inst.id, "status": project.status, "message": "立项申请已提交审批"}
