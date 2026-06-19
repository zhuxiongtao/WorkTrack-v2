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
            elif task.action_type == "fetch_ai_news":
                from app.services.news_fetcher import fetch_ai_news
                result = fetch_ai_news()
                if not result.get("success"):
                    raise Exception(result.get("error", "fetch_ai_news failed"))
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
    # 注册内置的「模型目录自动刷新」任务
    try:
        _register_model_catalog_refresh()
    except Exception as e:
        print(f"[scheduler] 注册 model_catalog_refresh 失败: {e}", flush=True)
    # 注册内置的「AI 对话历史清理」任务
    try:
        _register_chat_cleanup()
        print("[scheduler] 已注册 system_chat_cleanup (每天 03:10)", flush=True)
    except Exception as e:
        print(f"[scheduler] 注册 system_chat_cleanup 失败: {e}", flush=True)


def _register_model_catalog_refresh():
    """注册模型目录自动刷新任务（每天/每周 Tavily 拉取最新模型）
    - 通过环境变量 MODEL_REFRESH_CRON 控制（默认 每周一 03:00）
    - 通过环境变量 MODEL_REFRESH_ENABLED 关闭（默认开启）
    """
    import os
    from apscheduler.triggers.cron import CronTrigger as _Cron
    enabled = os.getenv("MODEL_REFRESH_ENABLED", "true").lower() != "false"
    if not enabled:
        print("[scheduler] MODEL_REFRESH_ENABLED=false, 跳过 model_catalog_refresh 注册", flush=True)
        return
    cron_expr = os.getenv("MODEL_REFRESH_CRON", "0 3 * * 1")
    trigger = _Cron.from_crontab(cron_expr)
    # 替换已存在的同名 job
    try:
        scheduler.remove_job("model_catalog_refresh")
    except Exception:
        pass
    scheduler.add_job(
        _execute_model_catalog_refresh,
        trigger=trigger,
        id="model_catalog_refresh",
        name="模型目录自动刷新（Tavily）",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )
    print(f"[scheduler] 已注册 model_catalog_refresh cron='{cron_expr}'", flush=True)


def _execute_model_catalog_refresh():
    """scheduler 回调：调 fetcher 完成刷新 + 写日志"""
    from app.routers.logs import write_log
    try:
        from app.services.model_catalog_fetcher import refresh_and_record
        res = refresh_and_record()
        if res.get("success"):
            msg = (
                f"模型目录刷新成功: 新增 {res.get('inserted',0)}, "
                f"更新 {res.get('updated',0)}, 降级 {res.get('deactivated',0)}, "
                f"耗时 {res.get('duration_ms',0)}ms"
            )
            write_log("info", "task", msg, db=None)
        else:
            write_log("error", "task", f"模型目录刷新失败: {res.get('error','unknown')}", details=res.get("error",""), db=None)
    except Exception as e:
        from app.routers.logs import write_log
        write_log("error", "task", f"模型目录刷新异常: {e}", details=str(e), db=None)


def cleanup_chat_history():
    """系统级任务：清理过期 AI 对话历史（每天凌晨自动执行）

    规则一：conversation.updated_at < now - retention_days → 删整个对话（按时间过期）
    规则二：用户消息总条数 > max_messages_per_user → 删最旧的对话，直到降回上限
    两个规则都可通过 config 关闭（设为 0）。
    """
    from datetime import timedelta, timezone
    from sqlalchemy import delete as sa_delete, func
    from app.models.chat import ChatConversation, ChatMessage
    from app.routers.logs import write_log

    retention_days = settings.ai_chat_retention_days
    max_messages = settings.ai_chat_max_messages_per_user
    deleted_age = 0
    deleted_count = 0

    with Session(engine) as db:
        # ── 规则一：时间过期 ──────────────────────────────────────────────
        if retention_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
            old_convs = db.exec(
                select(ChatConversation).where(ChatConversation.updated_at < cutoff)
            ).all()
            for conv in old_convs:
                db.execute(sa_delete(ChatMessage).where(ChatMessage.conversation_id == conv.id))
                db.delete(conv)
                deleted_age += 1
            db.commit()

        # ── 规则二：每用户消息条数上限 ────────────────────────────────────
        if max_messages > 0:
            user_ids = db.exec(select(ChatConversation.user_id).distinct()).all()
            for uid in user_ids:
                # 当前用户消息总条数
                total = db.exec(
                    select(func.count(ChatMessage.id))
                    .join(ChatConversation, ChatConversation.id == ChatMessage.conversation_id)
                    .where(ChatConversation.user_id == uid)
                ).one()
                if total <= max_messages:
                    continue
                # 按最旧优先逐个删对话，直到降回上限
                old_convs = db.exec(
                    select(ChatConversation)
                    .where(ChatConversation.user_id == uid)
                    .order_by(ChatConversation.updated_at.asc())
                ).all()
                for conv in old_convs:
                    if total <= max_messages:
                        break
                    msg_cnt = db.exec(
                        select(func.count(ChatMessage.id))
                        .where(ChatMessage.conversation_id == conv.id)
                    ).one()
                    db.execute(sa_delete(ChatMessage).where(ChatMessage.conversation_id == conv.id))
                    db.delete(conv)
                    total -= msg_cnt
                    deleted_count += 1
            db.commit()

        write_log(
            "info", "system",
            f"AI 对话历史清理完成：过期删 {deleted_age} 个会话，超量删 {deleted_count} 个会话",
            db=db,
        )

    return {"deleted_by_age": deleted_age, "deleted_by_count": deleted_count}


def _register_chat_cleanup():
    """注册 AI 对话历史清理任务（每天 03:10 执行，避免与模型刷新撞车）"""
    try:
        scheduler.remove_job("system_chat_cleanup")
    except Exception:
        pass
    scheduler.add_job(
        cleanup_chat_history,
        trigger=CronTrigger(hour=3, minute=10),
        id="system_chat_cleanup",
        name="AI 对话历史自动清理",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )


def shutdown_scheduler():
    """关闭调度器"""
    scheduler.shutdown(wait=False)
