"""职位管理路由"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select
from app.database import get_session
from app.auth import require_permission, get_current_user
from app.models.user import User
from app.models.job_title import JobTitle

router = APIRouter(prefix="/api/v1/job-titles", tags=["job-titles"])


class JobTitleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sort_order: int = 0


class JobTitleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None


class JobTitleOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    sort_order: int

    model_config = {"from_attributes": True}


@router.get("", response_model=List[JobTitleOut])
def list_job_titles(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    return db.exec(select(JobTitle).order_by(JobTitle.sort_order, JobTitle.name)).all()


@router.post("", response_model=JobTitleOut, status_code=201)
def create_job_title(
    body: JobTitleCreate,
    _: User = Depends(require_permission("user:manage_roles")),
    db: Session = Depends(get_session),
):
    if db.exec(select(JobTitle).where(JobTitle.name == body.name.strip())).first():
        raise HTTPException(status_code=400, detail="职位名称已存在")
    jt = JobTitle(name=body.name.strip(), description=body.description, sort_order=body.sort_order)
    db.add(jt)
    db.commit()
    db.refresh(jt)
    return jt


@router.put("/{jt_id}", response_model=JobTitleOut)
def update_job_title(
    jt_id: int,
    body: JobTitleUpdate,
    _: User = Depends(require_permission("user:manage_roles")),
    db: Session = Depends(get_session),
):
    jt = db.get(JobTitle, jt_id)
    if not jt:
        raise HTTPException(status_code=404, detail="职位不存在")
    if body.name is not None:
        name = body.name.strip()
        conflict = db.exec(select(JobTitle).where(JobTitle.name == name, JobTitle.id != jt_id)).first()
        if conflict:
            raise HTTPException(status_code=400, detail="职位名称已存在")
        jt.name = name
    if body.description is not None:
        jt.description = body.description
    if body.sort_order is not None:
        jt.sort_order = body.sort_order
    db.add(jt)
    db.commit()
    db.refresh(jt)
    return jt


@router.delete("/{jt_id}", status_code=204)
def delete_job_title(
    jt_id: int,
    _: User = Depends(require_permission("user:manage_roles")),
    db: Session = Depends(get_session),
):
    jt = db.get(JobTitle, jt_id)
    if not jt:
        raise HTTPException(status_code=404, detail="职位不存在")
    db.delete(jt)
    db.commit()
