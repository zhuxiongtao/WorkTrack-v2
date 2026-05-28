from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings as app_settings
from app.database import init_db
from app.routers import daily_reports, customers, projects, meetings, scheduled_tasks, ai_agent, search, settings, logs, auth, users, dashboard, setup, files, contracts, wiki, rbac, monitor, data_export, shares, console
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
