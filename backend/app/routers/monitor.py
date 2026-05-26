import os
import time
import logging
import psutil
from fastapi import APIRouter, Depends
from sqlmodel import Session, select, func
from app.database import get_session, engine
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
from app.config import settings

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/monitor", tags=["运维监控"])

_stats_cache: dict = {"data": None, "expires_at": 0}
_stats_cache_ttl = 30


@router.post("/stats/refresh")
def refresh_stats(
    current_user: User = Depends(require_permission("monitor:read")),
):
    """手动刷新监控缓存"""
    _stats_cache["data"] = None
    _stats_cache["expires_at"] = 0
    return {"ok": True}


@router.get("/stats")
def get_monitor_stats(
    current_user: User = Depends(require_permission("monitor:read")),
    db: Session = Depends(get_session),
):
    """运维监控：全局业务统计 + 系统资源 + 数据库详情（30秒缓存）"""
    now = time.time()
    if _stats_cache["data"] and now < _stats_cache["expires_at"]:
        return _stats_cache["data"]

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
    data_dir = settings.effective_data_root
    uploads_dir = settings.effective_uploads_dir

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
    chroma_size = get_dir_size(settings.effective_chroma_dir) if os.path.exists(settings.effective_chroma_dir) else 0
    audio_size = get_dir_size(settings.effective_audio_dir) if os.path.exists(settings.effective_audio_dir) else 0

    # ===== 数据库详细统计 =====
    db_size = 0
    db_tables = []
    db_connections = {}
    db_index_size = 0
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            # 1. 数据库总大小
            result = conn.execute(text(
                "SELECT pg_database_size(current_database())"
            )).scalar()
            db_size = result or 0

            # 2. 各表占用（数据+索引），按大小降序
            table_rows = conn.execute(text("""
                SELECT
                    schemaname || '.' || tablename AS table_name,
                    pg_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) AS data_bytes,
                    pg_indexes_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) AS index_bytes,
                    pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) AS total_bytes
                FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY total_bytes DESC
            """)).fetchall()
            db_tables = [
                {
                    "table": r[0],
                    "data_bytes": r[1],
                    "index_bytes": r[2],
                    "total_bytes": r[3],
                }
                for r in table_rows
            ]
            db_index_size = sum(r[2] for r in table_rows)

            # 3. 连接池状态
            conn_stats = conn.execute(text("""
                SELECT
                    state,
                    count(*) AS cnt
                FROM pg_stat_activity
                WHERE datname = current_database()
                GROUP BY state
                ORDER BY cnt DESC
            """)).fetchall()
            for r in conn_stats:
                db_connections[r[0]] = r[1]

            # 4. 行数估算（从 pg_stat_user_tables）
            row_estimates = {}
            try:
                est_rows = conn.execute(text("""
                    SELECT relname, n_live_tup
                    FROM pg_stat_user_tables
                    ORDER BY n_live_tup DESC
                """)).fetchall()
                row_estimates = {r[0]: r[1] for r in est_rows}
            except Exception:
                pass
            for t in db_tables:
                table_short = t["table"].split(".")[-1]
                t["row_estimate"] = row_estimates.get(table_short, 0)

            # 4. 数据库配置信息
            db_settings_rows = conn.execute(text("""
                SELECT name, setting
                FROM pg_settings
                WHERE name IN ('shared_buffers', 'work_mem', 'effective_cache_size', 'max_connections', 'wal_segment_size')
            """)).fetchall()
            db_settings = {r[0]: r[1] for r in db_settings_rows}

    except Exception as e:
        logger.warning("数据库详细统计查询失败: %s", e)
        db_settings = {}

    # ===== 应用连接池状态 =====
    pool_status = {}
    try:
        pool = engine.pool
        pool_status = {
            "size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "total": pool.size() + pool.overflow(),
        }
    except Exception:
        pass

    result = {
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
            "database_index_bytes": db_index_size,
            "data_bytes": data_size,
            "uploads_bytes": uploads_size,
            "chroma_bytes": chroma_size,
            "audio_bytes": audio_size,
            "total_bytes": db_size + data_size + uploads_size,
        },
        "database": {
            "total_bytes": db_size,
            "index_bytes": db_index_size,
            "tables": db_tables,
            "connections": db_connections,
            "settings": db_settings,
            "pool": pool_status,
        },
    }

    _stats_cache["data"] = result
    _stats_cache["expires_at"] = now + _stats_cache_ttl
    return result
