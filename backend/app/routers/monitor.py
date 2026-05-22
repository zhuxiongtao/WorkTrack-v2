import os
import psutil
from fastapi import APIRouter, Depends
from sqlmodel import Session, select, func
from app.database import get_session
from app.models.user import User
from app.models.customer import Customer
from app.models.daily_report import DailyReport
from app.models.project import Project
from app.models.meeting_note import MeetingNote
from app.models.contract import Contract
from app.models.weekly_summary import WeeklySummary
from app.models.scheduled_task import ScheduledTask
from app.models.model_provider import ModelProvider
from app.auth import require_permission

router = APIRouter(prefix="/api/v1/monitor", tags=["运维监控"])


@router.get("/stats")
def get_monitor_stats(
    current_user: User = Depends(require_permission("monitor:read")),
    db: Session = Depends(get_session),
):
    """运维监控：全局业务统计 + 系统资源"""

    # ===== 业务统计 =====
    total_users = db.exec(select(func.count(User.id))).one()
    active_users = db.exec(select(func.count(User.id)).where(User.is_active == True, User.status == "active")).one()

    total_customers = db.exec(select(func.count(Customer.id))).one()

    total_reports = db.exec(select(func.count(DailyReport.id))).one()
    draft_reports = db.exec(select(func.count(DailyReport.id)).where(DailyReport.status == "draft")).one()
    submitted_reports = db.exec(select(func.count(DailyReport.id)).where(DailyReport.status == "submitted")).one()

    total_weekly_summaries = db.exec(select(func.count(WeeklySummary.id))).one()

    total_projects = db.exec(select(func.count(Project.id))).one()
    project_status_counts = {}
    for row in db.exec(select(Project.status, func.count(Project.id)).group_by(Project.status)).all():
        project_status_counts[row[0] or "未设置"] = row[1]

    total_meetings = db.exec(select(func.count(MeetingNote.id))).one()
    total_contracts = db.exec(select(func.count(Contract.id))).one()
    total_scheduled_tasks = db.exec(select(func.count(ScheduledTask.id))).one()
    total_providers = db.exec(select(func.count(ModelProvider.id))).one()

    # ===== 系统资源 =====
    cpu_percent = psutil.cpu_percent(interval=1)
    memory_info = psutil.virtual_memory()
    disk_info = psutil.disk_usage("/")

    # ===== 存储统计 =====
    data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")

    def get_dir_size(path):
        total = 0
        if os.path.exists(path):
            for dirpath, dirnames, filenames in os.walk(path):
                for f in filenames:
                    try:
                        total += os.path.getsize(os.path.join(dirpath, f))
                    except OSError:
                        pass
        return total

    data_size = get_dir_size(data_dir)
    uploads_size = get_dir_size(uploads_dir)
    chroma_size = get_dir_size(os.path.join(data_dir, "chroma")) if os.path.exists(os.path.join(data_dir, "chroma")) else 0
    audio_size = get_dir_size(os.path.join(data_dir, "audio")) if os.path.exists(os.path.join(data_dir, "audio")) else 0

    db_size = 0
    try:
        from sqlalchemy import text
        with db.engine.connect() as conn:
            result = conn.execute(text(
                "SELECT pg_database_size(current_database())"
            )).scalar()
            db_size = result or 0
    except Exception:
        pass

    return {
        "business": {
            "users": {"total": total_users, "active": active_users},
            "customers": {"total": total_customers},
            "reports": {
                "total": total_reports,
                "draft": draft_reports,
                "submitted": submitted_reports,
            },
            "weekly_summaries": {"total": total_weekly_summaries},
            "projects": {
                "total": total_projects,
                "by_status": project_status_counts,
            },
            "meetings": {"total": total_meetings},
            "contracts": {"total": total_contracts},
            "scheduled_tasks": {"total": total_scheduled_tasks},
            "model_providers": {"total": total_providers},
        },
        "system": {
            "cpu_percent": cpu_percent,
            "memory": {
                "total": memory_info.total,
                "used": memory_info.used,
                "percent": memory_info.percent,
                "available": memory_info.available,
            },
            "disk": {
                "total": disk_info.total,
                "used": disk_info.used,
                "percent": disk_info.percent,
                "free": disk_info.free,
            },
        },
        "storage": {
            "database_bytes": db_size,
            "data_bytes": data_size,
            "uploads_bytes": uploads_size,
            "chroma_bytes": chroma_size,
            "audio_bytes": audio_size,
            "total_bytes": db_size + data_size + uploads_size,
        },
    }
