from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select
from typing import Optional
from datetime import datetime

from app.database import get_session
from app.models.project_follow_up import ProjectFollowUp
from app.models.project import Project
from app.models.user import User
from app.auth import get_current_user, require_permission, has_permission
from app.utils.time import now

router = APIRouter(prefix="/api/v1/projects", tags=["项目跟进"])


class FollowUpCreate(BaseModel):
    track: str = "sales"   # sales | tech
    content: str


class FollowUpOut(BaseModel):
    id: int
    project_id: int
    user_id: int
    user_name: str = ""
    track: str
    content: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.get("/{project_id}/follow-ups", response_model=list[FollowUpOut])
def list_follow_ups(
    project_id: int,
    track: Optional[str] = None,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:read")),
):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    stmt = select(ProjectFollowUp).where(ProjectFollowUp.project_id == project_id)
    if track:
        stmt = stmt.where(ProjectFollowUp.track == track)
    stmt = stmt.order_by(ProjectFollowUp.created_at.desc())
    rows = db.exec(stmt).all()

    user_ids = {r.user_id for r in rows}
    users = {u.id: u.name for u in db.exec(select(User).where(User.id.in_(user_ids))).all()} if user_ids else {}

    result = []
    for r in rows:
        out = FollowUpOut(
            id=r.id,
            project_id=r.project_id,
            user_id=r.user_id,
            user_name=users.get(r.user_id, ""),
            track=r.track,
            content=r.content,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        result.append(out)
    return result


@router.post("/{project_id}/follow-ups", response_model=FollowUpOut)
def create_follow_up(
    project_id: int,
    body: FollowUpCreate,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:read")),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.track == "tech" and not has_permission(current_user, "project:follow_tech", db):
        raise HTTPException(status_code=403, detail="无技术跟进写入权限，需要 project:follow_tech 权限")

    record = ProjectFollowUp(
        project_id=project_id,
        user_id=current_user.id,
        track=body.track,
        content=body.content,
        created_at=now(),
        updated_at=now(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return FollowUpOut(
        id=record.id,
        project_id=record.project_id,
        user_id=record.user_id,
        user_name=current_user.name,
        track=record.track,
        content=record.content,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.delete("/{project_id}/follow-ups/{follow_up_id}")
def delete_follow_up(
    project_id: int,
    follow_up_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("project:read")),
):
    record = db.get(ProjectFollowUp, follow_up_id)
    if not record or record.project_id != project_id:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    if record.user_id != current_user.id and not _is_admin_or_manager(current_user):
        raise HTTPException(status_code=403, detail="只能删除自己的跟进记录")
    db.delete(record)
    db.commit()
    return {"ok": True}


def _is_admin_or_manager(user: User) -> bool:
    return getattr(user, 'is_admin', False)
