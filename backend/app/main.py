from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings as app_settings
from app.database import init_db
from app.routers import daily_reports, customers, projects, meetings, scheduled_tasks, ai_agent, search, settings, logs, auth, users, dashboard, setup, files, contracts, wiki, rbac, monitor, data_export, shares, console, news, project_costs, suppliers, channels, reconcile, models, approval, model_change, contract_templates, bill_reconcile, model_usage, feedback, payments, seals
from app.routers import project_follow_ups
from app.routers import purchase_suppliers
from app.routers import leaves, overtimes, leave_balances
from app.routers import expenses, business_trips, purchases, assets
from app.routers import legal_entities, employee_loans
from app.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.utils.time import utc_now


def _seed_contract_templates(db):
    from app.models.contract_template import ContractTemplate
    templates = [
        ContractTemplate(
            name="商务服务合同",
            category="服务合同",
            description="适用于软件开发、技术服务、咨询服务等场景",
            content="""<div style="font-family: SimSun, serif; line-height: 2; padding: 40px;">
<h2 style="text-align:center; font-size: 20px; font-weight: bold;">商务服务合同</h2>
<p style="text-align:center;">合同编号：[合同编号]</p>
<br>
<p><strong>甲方（委托方）：</strong>[甲方名称]</p>
<p><strong>地址：</strong>[甲方地址]</p>
<p><strong>法定代表人：</strong>[甲方法人]</p>
<p><strong>联系电话：</strong>[甲方电话]</p>
<br>
<p><strong>乙方（服务方）：</strong>[乙方名称]</p>
<p><strong>地址：</strong>[乙方地址]</p>
<p><strong>法定代表人：</strong>[乙方法人]</p>
<p><strong>联系电话：</strong>[乙方电话]</p>
<br>
<p>甲乙双方经友好协商，就乙方为甲方提供以下服务事宜，订立本合同，共同遵守执行。</p>
<br>
<h3>一、服务内容</h3>
<p>[详细描述服务内容和交付物]</p>
<br>
<h3>二、服务期限</h3>
<p>服务期限自 [开始日期] 至 [结束日期]，共计 [X] 个月。</p>
<br>
<h3>三、合同金额及付款方式</h3>
<p>本合同服务费用总计人民币 <strong>[合同金额]</strong> 元（大写：[金额大写]）。</p>
<p>付款方式：[付款方式描述，如：合同签订后付 30%，验收合格后付 70%]</p>
<br>
<h3>四、双方权利与义务</h3>
<p>4.1 甲方应当按时支付服务费用，并提供必要的配合和资料。</p>
<p>4.2 乙方应当按约定完成服务内容，保证服务质量，对甲方的商业秘密负有保密义务。</p>
<br>
<h3>五、验收标准</h3>
<p>[验收标准和验收流程]</p>
<br>
<h3>六、违约责任</h3>
<p>任何一方违反本合同约定，应向对方支付合同总金额 [X]% 的违约金，并赔偿由此给对方造成的实际损失。</p>
<br>
<h3>七、争议解决</h3>
<p>双方如发生争议，应首先协商解决；协商不成的，向[仲裁机构/甲方所在地人民法院]申请仲裁/提起诉讼。</p>
<br>
<h3>八、其他约定</h3>
<p>[其他需要约定的事项]</p>
<br>
<p>本合同一式两份，甲乙双方各执一份，自双方签字（盖章）之日起生效。</p>
<br><br>
<div style="display: flex; justify-content: space-between; margin-top: 40px;">
  <div>
    <p><strong>甲方（盖章）：</strong></p>
    <p>授权代表（签字）：</p>
    <p>日期：&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;月&nbsp;&nbsp;日</p>
  </div>
  <div>
    <p><strong>乙方（盖章）：</strong></p>
    <p>授权代表（签字）：</p>
    <p>日期：&nbsp;&nbsp;&nbsp;&nbsp;年&nbsp;&nbsp;月&nbsp;&nbsp;日</p>
  </div>
</div>
</div>""",
        ),
        ContractTemplate(
            name="采购合同",
            category="采购合同",
            description="适用于产品采购、设备购买等场景",
            content="""<div style="font-family: SimSun, serif; line-height: 2; padding: 40px;">
<h2 style="text-align:center; font-size: 20px; font-weight: bold;">采购合同</h2>
<p style="text-align:center;">合同编号：[合同编号]</p>
<br>
<p><strong>买方（甲方）：</strong>[甲方名称]</p>
<p><strong>卖方（乙方）：</strong>[乙方名称]</p>
<br>
<p>甲乙双方经协商一致，订立本采购合同。</p>
<br>
<h3>一、采购内容</h3>
<table border="1" style="width:100%; border-collapse: collapse;">
  <tr><th>序号</th><th>产品名称</th><th>规格型号</th><th>数量</th><th>单价（元）</th><th>金额（元）</th></tr>
  <tr><td>1</td><td>[产品名称]</td><td>[规格型号]</td><td>[数量]</td><td>[单价]</td><td>[金额]</td></tr>
</table>
<p>合计金额：人民币 <strong>[总金额]</strong> 元（大写：[金额大写]）</p>
<br>
<h3>二、交货时间与地点</h3>
<p>交货时间：[交货日期]</p>
<p>交货地点：[交货地址]</p>
<br>
<h3>三、付款方式</h3>
<p>[付款条款，如：合同签订后 X 个工作日内付款]</p>
<br>
<h3>四、质量标准与验收</h3>
<p>[质量标准说明] 甲方收到货物后 [X] 个工作日内完成验收。</p>
<br>
<h3>五、违约责任</h3>
<p>[违约责任条款]</p>
<br>
<h3>六、争议解决</h3>
<p>双方争议协商解决，协商不成提交[仲裁机构]仲裁。</p>
<br>
<p>本合同一式两份，甲乙双方各执一份，自双方签字盖章后生效。</p>
<br><br>
<div style="display: flex; justify-content: space-between; margin-top: 40px;">
  <div><p><strong>甲方（盖章）：</strong></p><p>签字：</p><p>日期：</p></div>
  <div><p><strong>乙方（盖章）：</strong></p><p>签字：</p><p>日期：</p></div>
</div>
</div>""",
        ),
        ContractTemplate(
            name="保密协议（NDA）",
            category="保密协议",
            description="适用于商务谈判、技术合作前的保密约定",
            content="""<div style="font-family: SimSun, serif; line-height: 2; padding: 40px;">
<h2 style="text-align:center; font-size: 20px; font-weight: bold;">保密协议</h2>
<p style="text-align:center;">（Non-Disclosure Agreement）</p>
<br>
<p><strong>披露方（甲方）：</strong>[甲方名称]</p>
<p><strong>接收方（乙方）：</strong>[乙方名称]</p>
<br>
<p>鉴于双方拟就 [合作事项] 进行洽谈合作，为保护各自的商业秘密，双方达成以下协议：</p>
<br>
<h3>一、保密信息定义</h3>
<p>本协议所称"保密信息"是指甲方在合作过程中向乙方披露的技术资料、商业计划、客户信息、财务数据及其他明确标注为保密的信息。</p>
<br>
<h3>二、保密义务</h3>
<p>2.1 乙方应将保密信息严格保密，不得向任何第三方披露。</p>
<p>2.2 乙方仅可将保密信息用于评估本次合作，不得用于任何其他目的。</p>
<p>2.3 乙方应采取与保护其自身保密信息同等的保护措施，但不得低于合理谨慎的标准。</p>
<br>
<h3>三、保密期限</h3>
<p>本协议保密期限为 [X] 年，自双方签署之日起算。</p>
<br>
<h3>四、违约责任</h3>
<p>乙方违反本协议，应向甲方支付违约金人民币 [金额] 元，并赔偿甲方因此遭受的全部损失。</p>
<br>
<h3>五、例外情形</h3>
<p>下列情形不受本协议约束：（1）信息已为公众所知；（2）乙方能证明其已从其他合法渠道独立获知该信息；（3）法律法规要求披露。</p>
<br>
<p>本协议一式两份，双方各执一份，自签署之日起生效。</p>
<br><br>
<div style="display: flex; justify-content: space-between; margin-top: 40px;">
  <div><p><strong>甲方（签字/盖章）：</strong></p><p>日期：</p></div>
  <div><p><strong>乙方（签字/盖章）：</strong></p><p>日期：</p></div>
</div>
</div>""",
        ),
        ContractTemplate(
            name="销售合同",
            category="销售合同",
            description="适用于产品销售、软件授权销售等场景",
            content="""<div style="font-family: SimSun, serif; line-height: 2; padding: 40px;">
<h2 style="text-align:center; font-size: 20px; font-weight: bold;">销售合同</h2>
<p style="text-align:center;">合同编号：[合同编号]</p>
<br>
<p><strong>卖方（甲方）：</strong>[甲方名称]</p>
<p><strong>买方（乙方）：</strong>[乙方名称]</p>
<br>
<h3>一、销售内容</h3>
<p>甲方向乙方出售：[产品/服务名称]，具体规格及数量见附件。</p>
<br>
<h3>二、合同金额</h3>
<p>合同总价款为人民币 <strong>[合同金额]</strong> 元（大写：[金额大写]），含增值税。</p>
<br>
<h3>三、付款条款</h3>
<p>[付款安排，如：签约后 3 个工作日内付全款，或分期安排]</p>
<br>
<h3>四、交付方式与时间</h3>
<p>交付方式：[交付方式]</p>
<p>预计交付时间：[交付时间]</p>
<br>
<h3>五、售后服务与保修</h3>
<p>[售后服务承诺与保修条款]</p>
<br>
<h3>六、知识产权</h3>
<p>[知识产权归属约定]</p>
<br>
<h3>七、违约责任</h3>
<p>[违约责任条款]</p>
<br>
<h3>八、争议解决</h3>
<p>双方争议协商解决，协商不成向[甲方所在地人民法院]提起诉讼。</p>
<br>
<p>本合同一式两份，甲乙双方各执一份，自签字盖章之日起生效。</p>
<br><br>
<div style="display: flex; justify-content: space-between; margin-top: 40px;">
  <div><p><strong>甲方（盖章）：</strong></p><p>签字：</p><p>日期：</p></div>
  <div><p><strong>乙方（盖章）：</strong></p><p>签字：</p><p>日期：</p></div>
</div>
</div>""",
        ),
    ]
    for t in templates:
        db.add(t)
    db.commit()


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
        if not last_log or (now - last_log.created_at) > timedelta(minutes=15):
            write_log("info", "system", "WorkTrack 服务已启动", details=f"版本: 1.0.0", db=db)
    # 种子：初始化默认合同模板（幂等，已有则跳过）
    from app.models.contract_template import ContractTemplate
    with Session(engine) as db:
        if db.exec(select(ContractTemplate)).first() is None:
            _seed_contract_templates(db)

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

    # 清理遗留的 fetch_ai_news ScheduledTask 数据库记录（已迁移为内置系统任务）
    try:
        from sqlmodel import Session as _Session
        from app.database import engine as _engine
        from app.models.scheduled_task import ScheduledTask as _ST
        with _Session(_engine) as _db:
            old_tasks = _db.exec(
                select(_ST).where(_ST.action_type == "fetch_ai_news")
            ).all()
            for t in old_tasks:
                _db.delete(t)
            if old_tasks:
                _db.commit()
                print(f"[scheduler] 已清理 {len(old_tasks)} 条遗留 fetch_ai_news 定时任务记录", flush=True)
    except Exception as _e:
        print(f"[scheduler] 清理遗留任务失败: {_e}", flush=True)

    yield

    # Shutdown
    from app.services.scheduler import shutdown_scheduler
    shutdown_scheduler()


def create_app() -> FastAPI:
    app = FastAPI(
        title="WorkTrack",
        description="个人工作管理平台 - 日报、客户项目、会议纪要，集成 AI 与 MCP 服务",
        version="2.8.0",
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
    app.include_router(contract_templates.router)
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
    app.include_router(approval.router)
    app.include_router(model_change.router)
    app.include_router(bill_reconcile.router)
    app.include_router(model_usage.router)
    app.include_router(feedback.router)
    app.include_router(payments.router)
    app.include_router(seals.router)
    app.include_router(project_follow_ups.router)
    app.include_router(purchase_suppliers.router)
    app.include_router(leaves.router)
    app.include_router(overtimes.router)
    app.include_router(leave_balances.router)
    app.include_router(expenses.router)
    app.include_router(business_trips.router)
    app.include_router(purchases.router)
    app.include_router(assets.router)
    app.include_router(legal_entities.router)
    app.include_router(employee_loans.router)

    # 挂载 MCP 服务（带 API Key 认证）
    from app.mcp_server import mcp, MCPAuthMiddleware
    app.mount("/mcp", mcp.http_app(middleware=[MCPAuthMiddleware]))

    @app.get("/")
    def root():
        return {"message": "WorkTrack API is running", "version": "2.8.0"}

    @app.get("/health")
    def health_check():
        return {"status": "healthy"}

    return app


app = create_app()
