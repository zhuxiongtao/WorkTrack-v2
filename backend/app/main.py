from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings as app_settings
from app.database import init_db
from app.routers import daily_reports, customers, projects, meetings, scheduled_tasks, ai_agent, search, settings, logs, auth, users, dashboard, setup, files, contracts, wiki, rbac, monitor, data_export, shares, console, news, project_costs, suppliers, channels, reconcile, models
from app.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.utils.time import utc_now, ensure_utc


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    from app.routers.logs import write_log
    from app.database import engine
    from sqlmodel import Session, select, desc
    from app.models.log_entry import LogEntry
    from datetime import datetime, timedelta
    with Session(engine) as db:
        stmt = select(LogEntry).where(
            LogEntry.category == "system",
            LogEntry.message == "WorkTrack 服务已启动"
        ).order_by(desc(LogEntry.created_at)).limit(1)
        last_log = db.exec(stmt).first()

        now = utc_now()
        if not last_log or (now - ensure_utc(last_log.created_at)) > timedelta(minutes=15):
            write_log("info", "system", "WorkTrack 服务已启动", details=f"版本: 1.0.0", db=db)
    from app.services.scheduler import start_scheduler
    start_scheduler()

    # 启动时尝试首次抓取 AI 资讯（失败不影响服务启动）
    try:
        from app.services.news_fetcher import fetch_ai_news
        import logging as _logging
        _logging.getLogger("worktrack.news").info("启动时首次抓取 AI 资讯...")
        fetch_ai_news()
    except Exception as _e:
        import logging as _logging
        _logging.getLogger("worktrack.news").warning("启动时抓取 AI 资讯失败: %s", _e)

    # 幂等创建/同步"AI 资讯抓取"默认定时任务（每 2 小时）
    try:
        from sqlmodel import Session as _Session
        from app.database import engine as _engine
        from app.models.scheduled_task import ScheduledTask as _ST
        from app.services.scheduler import _register_task as _reg, unregister_task as _unreg
        import json as _json
        with _Session(_engine) as _db:
            existing = _db.exec(
                select(_ST).where(_ST.action_type == "fetch_ai_news")
            ).all()
            target_cron = "0 8 * * *"  # 每天 08:00
            print(f"[scheduler] AI 资讯默认任务: existing={len(existing)} target_cron={target_cron}", flush=True)
            if not existing:
                task = _ST(
                    name="AI 资讯自动抓取（每天）",
                    trigger_type="cron",
                    trigger_config=_json.dumps({"cron": target_cron}, ensure_ascii=False),
                    action_type="fetch_ai_news",
                    action_params=None,
                    enabled=True,
                )
                _db.add(task)
                _db.commit()
                _db.refresh(task)
                print(f"[scheduler] 已创建 id={task.id}", flush=True)
                try:
                    _reg(task)
                    print(f"[scheduler] 已注册到 scheduler id={task.id}", flush=True)
                except Exception as _re:
                    print(f"[scheduler] 注册失败 id={task.id}: {_re}", flush=True)
            else:
                for t in existing:
                    try:
                        cfg = _json.loads(t.trigger_config or "{}")
                        if cfg.get("cron") != target_cron:
                            cfg["cron"] = target_cron
                            t.trigger_config = _json.dumps(cfg, ensure_ascii=False)
                            _db.add(t)
                            _db.commit()
                            _db.refresh(t)
                        if t.enabled:
                            try:
                                _unreg(t.id)
                            except Exception:
                                pass
                            _reg(t)
                            print(f"[scheduler] 已同步 id={t.id} cron={cfg.get('cron')}", flush=True)
                    except Exception as _ie:
                        print(f"[scheduler] 同步失败 id={t.id}: {_ie}", flush=True)
                        continue
        from app.services.scheduler import scheduler as _sched
        _jobs = _sched.get_jobs()
        print(f"[scheduler] 当前 scheduler jobs={len(_jobs)}", flush=True)
        for _j in _jobs:
            print(f"[scheduler]   job id={_j.id} name={_j.name} next={_j.next_run_time}", flush=True)
    except Exception as _e:
        print(f"[scheduler] 初始化失败: {_e}", flush=True)

    yield

    # Shutdown
    from app.services.scheduler import shutdown_scheduler
    shutdown_scheduler()


def create_app() -> FastAPI:
    app = FastAPI(
        title="WorkTrack",
        description="个人工作管理平台 - 日报、客户项目、会议纪要，集成 AI 与 MCP 服务",
        version="1.0.0",
        docs_url="/docs" if app_settings.cors_origins != "*" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if app_settings.cors_origins != "*" else None,
        lifespan=lifespan,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    from app.exceptions import WorkTrackError
    app.add_exception_handler(WorkTrackError, lambda req, exc: JSONResponse(
        status_code=500, content={"detail": exc.message}
    ))

    # CORS 中间件
    cors_origins = [origin.strip() for origin in app_settings.cors_origins.split(",") if origin.strip()]
    is_wildcard = cors_origins == ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins if cors_origins else ["*"],
        allow_credentials=not is_wildcard,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ===== 认证中间件 =====
    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        # 公开路径（无需认证）
        public_paths = [
            "/", "/health", "/mcp", "/docs", "/openapi.json",
            "/api/v1/setup",           # 首次运行初始化向导
            "/api/v1/settings/branding",  # 品牌配置（Logo 文件、标题等公开读取）
            "/api/v1/wiki/public",      # 公开分享的 AI 文档外链访问端点
            "/api/v1/customers/logo",   # 公司 logo 代理(给 <img> 用,不会带 Authorization)
        ]
        path = request.url.path
        if any(path == p or path.startswith(p + "/") for p in public_paths) or path.startswith("/api/v1/auth/"):
            return await call_next(request)

        # API 路由需要认证
        if path.startswith("/api/"):
            from app.auth import decode_token
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return JSONResponse(status_code=401, content={"detail": "请先登录"})
            token = auth_header[7:]
            payload = decode_token(token)
            if payload is None:
                return JSONResponse(status_code=401, content={"detail": "令牌无效或已过期"})

        return await call_next(request)

    # 注册业务路由
    app.include_router(daily_reports.router)
    app.include_router(customers.router)
    app.include_router(projects.router)
    app.include_router(meetings.router)
    app.include_router(scheduled_tasks.router)
    app.include_router(ai_agent.router)
    app.include_router(search.router)
    app.include_router(settings.router)
    app.include_router(logs.router)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(dashboard.router)
    app.include_router(setup.router)
    app.include_router(files.router)
    app.include_router(contracts.router)
    app.include_router(wiki.router)
    app.include_router(rbac.router)
    app.include_router(monitor.router)
    app.include_router(data_export.router)
    app.include_router(shares.router)
    app.include_router(console.router)
    app.include_router(news.router)
    app.include_router(project_costs.router)
    app.include_router(suppliers.router)
    app.include_router(channels.router)
    app.include_router(reconcile.router)
    app.include_router(models.router)

    # 挂载 MCP 服务（带 API Key 认证）
    from app.mcp_server import mcp, MCPAuthMiddleware
    app.mount("/mcp", mcp.http_app(middleware=[MCPAuthMiddleware]))

    @app.get("/")
    def root():
        return {"message": "WorkTrack API is running", "version": "1.0.0"}

    @app.get("/health")
    def health_check():
        return {"status": "healthy"}

    return app


app = create_app()
