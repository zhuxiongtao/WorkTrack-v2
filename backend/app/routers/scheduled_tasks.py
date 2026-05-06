from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.database import get_session
from app.models.scheduled_task import ScheduledTask
from app.services.scheduler import _register_task, unregister_task

router = APIRouter(prefix="/api/v1/scheduled-tasks", tags=["定时任务"])


@router.get("")
def list_tasks(db: Session = Depends(get_session)):
    tasks = db.exec(select(ScheduledTask).order_by(ScheduledTask.created_at.desc())).all()
    return tasks


@router.post("", status_code=201)
def create_task(task: ScheduledTask, db: Session = Depends(get_session)):
    db.add(task)
    db.commit()
    db.refresh(task)
    if task.enabled:
        _register_task(task)
    return task


@router.put("/{task_id}")
def update_task(task_id: int, data: dict, db: Session = Depends(get_session)):
    task = db.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    for key, value in data.items():
        if hasattr(task, key):
            setattr(task, key, value)
    db.add(task)
    db.commit()
    db.refresh(task)
    # 重新注册任务
    unregister_task(task_id)
    if task.enabled:
        _register_task(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_session)):
    task = db.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    unregister_task(task_id)
    db.delete(task)
    db.commit()
