import json
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.date import DateTrigger
from sqlmodel import Session, select
from datetime import date, datetime

from app.database import engine
from app.config import settings
from app.models.scheduled_task import ScheduledTask
from app.models.daily_report import DailyReport

# 创建调度器，使用 SQLAlchemy 持久化
jobstores = {
    "default": SQLAlchemyJobStore(url=settings.database_url)
}
scheduler = BackgroundScheduler(jobstores=jobstores, timezone="Asia/Shanghai")


def execute_task(task_id: int):
    """执行定时任务的实际逻辑"""
    from app.routers.logs import write_log
    with Session(engine) as db:
        task = db.get(ScheduledTask, task_id)
        if not task or not task.enabled:
            return

        try:
            if task.action_type == "ai_summarize_daily":
                _action_summarize_today(db)
            elif task.action_type == "ai_analyze_project":
                params = json.loads(task.action_params or "{}")
                _action_analyze_project(db, params.get("project_id"))
            write_log("info", "task", f"任务执行成功: {task.name}", db=db)
        except Exception as e:
            write_log("error", "task", f"任务执行失败: {task.name}", details=str(e), db=db)


def _action_summarize_today(db: Session):
    """AI 总结今日日报"""
    from app.services.ai_service import summarize_daily_report
    from app.routers.logs import write_log

    today = date.today()
    reports = db.exec(
        select(DailyReport).where(DailyReport.report_date == today)
    ).all()
    for report in reports:
        if not report.ai_summary:
            try:
                summary = summarize_daily_report(report.content_md, db)
                report.ai_summary = summary
                db.add(report)
            except Exception as e:
                write_log("error", "task", f"日报AI总结失败 [report_id={report.id}]: {str(e)[:150]}", details=str(e), db=db)
    db.commit()


def _action_analyze_project(db: Session, project_id: int):
    """AI 分析项目"""
    from app.services.ai_service import generate_project_analysis
    from app.routers.logs import write_log

    try:
        generate_project_analysis(project_id, db)
    except Exception as e:
        write_log("error", "task", f"项目分析失败 [project_id={project_id}]: {str(e)[:150]}", details=str(e), db=db)


def load_tasks_from_db():
    """从数据库加载并注册所有启用的定时任务"""
    from app.routers.logs import write_log
    with Session(engine) as db:
        tasks = db.exec(select(ScheduledTask).where(ScheduledTask.enabled == True)).all()
        for task in tasks:
            try:
                _register_task(task)
            except Exception as e:
                write_log("error", "task", f"注册任务失败 [{task.name}]: {str(e)[:150]}", details=str(e))


def _register_task(task: ScheduledTask):
    """注册单个定时任务到调度器"""
    config = json.loads(task.trigger_config)

    if task.trigger_type == "cron":
        trigger = CronTrigger.from_crontab(config.get("cron", "0 18 * * *"))
    elif task.trigger_type == "interval":
        trigger = IntervalTrigger(
            hours=config.get("hours", 24),
            minutes=config.get("minutes", 0),
        )
    elif task.trigger_type == "date":
        trigger = DateTrigger(
            run_date=datetime.fromisoformat(config["run_date"])
        )
    else:
        raise ValueError(f"不支持的触发器类型: {task.trigger_type}")

    scheduler.add_job(
        execute_task,
        trigger=trigger,
        args=[task.id],
        id=f"task_{task.id}",
        name=task.name,
        replace_existing=True,
    )


def unregister_task(task_id: int):
    """从调度器移除任务"""
    try:
        scheduler.remove_job(f"task_{task_id}")
    except Exception:
        pass


def start_scheduler():
    """启动调度器"""
    scheduler.start()
    load_tasks_from_db()


def shutdown_scheduler():
    """关闭调度器"""
    scheduler.shutdown(wait=False)
