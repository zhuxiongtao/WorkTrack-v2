from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings as app_settings
from app.database import init_db
from app.routers import daily_reports, customers, projects, meetings, scheduled_tasks, ai_agent, search, settings, logs, auth, users, dashboard, setup, files, contracts


def create_app() -> FastAPI:
    app = FastAPI(
        title="WorkTrack",
        description="个人工作管理平台 - 日报、客户项目、会议纪要，集成 AI 与 MCP 服务",
        version="1.0.0",
        # 生产环境可关闭文档
        docs_url="/docs" if app_settings.cors_origins == "*" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if app_settings.cors_origins == "*" else None,
    )

    # CORS 中间件
    cors_origins = [origin.strip() for origin in app_settings.cors_origins.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins if cors_origins else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ===== 认证中间件 =====
    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        # 公开路径（无需认证）
        public_paths = [
            "/", "/health", "/mcp", "/docs", "/openapi.json",
            "/api/v1/meetings/audio",  # 会议录音文件（浏览器 audio 标签无法携带 auth header）
            "/api/v1/files",           # 上传的文件（图片/附件公开访问）
            "/api/v1/setup",           # 首次运行初始化向导
            "/api/v1/settings/branding",  # 品牌配置（Logo 文件、标题等公开读取）
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

    # 启动时初始化数据库和调度器
    @app.on_event("startup")
    def on_startup():
        init_db()
        from app.routers.logs import write_log
        from app.database import engine
        from sqlmodel import Session
        with Session(engine) as db:
            write_log("info", "system", "WorkTrack 服务已启动", details=f"版本: 1.0.0", db=db)
        from app.services.scheduler import start_scheduler
        start_scheduler()

    # 关闭时关闭调度器
    @app.on_event("shutdown")
    def on_shutdown():
        from app.services.scheduler import shutdown_scheduler
        shutdown_scheduler()

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
