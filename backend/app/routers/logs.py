from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from sqlalchemy import delete as sa_delete
from app.database import get_session
from app.models.log_entry import LogEntry

router = APIRouter(prefix="/api/v1/logs", tags=["日志"])


def write_log(
    level: str,
    category: str,
    message: str,
    details: Optional[str] = None,
    db: Optional[Session] = None,
):
    """写入一条日志。如果 db 为 None，则直接使用 engine 新建 session"""
    entry = LogEntry(level=level, category=category, message=message, details=details)
    if db is not None:
        db.add(entry)
        db.commit()
    else:
        from app.database import engine
        with Session(engine) as s:
            s.add(entry)
            s.commit()


def write_error(category: str, message: str, details: Optional[str] = None):
    """快捷写入一条 error 级别日志"""
    write_log("error", category, message, details)


@router.get("")
def list_logs(
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_session),
):
    """查询日志列表，支持按级别/分类筛选"""
    query = select(LogEntry).order_by(LogEntry.created_at.desc())
    if level:
        query = query.where(LogEntry.level == level)
    if category:
        query = query.where(LogEntry.category == category)

    total = db.exec(select(func.count(LogEntry.id))).one()
    rows = db.exec(query.offset(offset).limit(limit)).all()
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "level": r.level,
                "category": r.category,
                "message": r.message,
                "details": r.details,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.delete("/clear")
def clear_logs(db: Session = Depends(get_session)):
    """清空所有日志"""
    db.exec(sa_delete(LogEntry))
    db.commit()
    return {"ok": True}
