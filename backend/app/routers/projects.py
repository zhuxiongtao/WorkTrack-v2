from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select
from app.database import get_session
from app.models.project import Project
from app.models.meeting_note import MeetingNote
from app.models.user import User
from app.auth import get_current_user
from app.schemas import ProjectCreate, ProjectUpdate, ProjectOut, MeetingNoteOut
from app.services.vector_store import index_document, delete_document
from app.services.ai_service import generate_project_analysis

router = APIRouter(prefix="/api/v1/projects", tags=["项目"])


@router.get("", response_model=list[ProjectOut])
def list_projects(
    customer_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(Project).where(Project.user_id == current_user.id).order_by(Project.created_at.desc())
    if customer_id:
        query = query.where(Project.customer_id == customer_id)
    if status:
        query = query.where(Project.status == status)
    return db.exec(query).all()


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(data: ProjectCreate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    meeting_ids = data.meeting_ids or []
    create_data = data.model_dump(exclude={"meeting_ids"})
    create_data["user_id"] = current_user.id
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
        db.commit()
    background_tasks.add_task(
        index_document,
        collection_name="projects",
        doc_id=str(project.id),
        text=f"{project.name}\n{project.customer_name}\n{project.progress or ''}",
        metadata={"status": project.status, "user_id": project.user_id},
    )
    return project


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取单个项目详情"""
    project = db.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, data: ProjectUpdate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    project = db.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    from datetime import datetime
    meeting_ids = data.meeting_ids
    update_data = data.model_dump(exclude_unset=True, exclude={"meeting_ids"})
    for key, value in update_data.items():
        setattr(project, key, value)
    project.updated_at = datetime.now()
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
    background_tasks.add_task(
        index_document,
        collection_name="projects",
        doc_id=str(project.id),
        text=f"{project.name}\n{project.customer_name}\n{project.progress or ''}",
        metadata={"status": project.status, "user_id": project.user_id},
    )
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    project = db.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    db.delete(project)
    db.commit()
    background_tasks.add_task(delete_document, "projects", str(project_id))


@router.post("/{project_id}/ai-analysis")
def ai_analyze_project(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """触发 AI 项目分析，结果自动保存到项目"""
    project = db.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    analysis = generate_project_analysis(project_id, db, current_user.id)
    project.analysis = analysis
    from datetime import datetime
    project.updated_at = datetime.now()
    db.add(project)
    db.commit()
    return {"project_id": project_id, "analysis": analysis}


@router.get("/{project_id}/meetings", response_model=list[MeetingNoteOut])
def get_project_meetings(project_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取关联到项目的会议列表"""
    project = db.get(Project, project_id)
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    meetings = db.exec(
        select(MeetingNote).where(MeetingNote.project_id == project_id).order_by(MeetingNote.meeting_date.desc())
    ).all()
    return meetings
