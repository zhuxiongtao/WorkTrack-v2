from sqlmodel import create_engine, SQLModel, Session, select
from app.config import settings
import os

data_dir = settings.effective_data_root
if not os.path.exists(data_dir):
    os.makedirs(data_dir, exist_ok=True)

_connect_args = {}
_engine_kwargs = {}
if settings.database_url.startswith("postgresql"):
    # Windows 上的 embedded PG (pgserver) 只接受 GMT 作为 session timezone
    _connect_args = {"options": "-c timezone=GMT"}
    _engine_kwargs = {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_recycle": 1800,
        "pool_pre_ping": True,
    }

engine = create_engine(settings.database_url, echo=False, connect_args=_connect_args, **_engine_kwargs)


def init_db():
    """初始化数据库：确保 Alembic 迁移已执行，添加默认数据"""
    import logging
    from app.models import (  # noqa: F401 - 确保所有模型注册到 SQLModel.metadata
        User,
        Department,
        DailyReport,
        Customer,
        Project,
        MeetingNote,
        ScheduledTask,
        ModelProvider,
        TaskModelConfig,
        ProviderModel,
        FieldOption,
        ChatConversation,
        ChatMessage,
        SystemPreference,
        LogEntry,
        AIPrompt,
        WeeklySummary,
        ApprovalFlow,
        ApprovalInstance,
        ApprovalRecord,
    )
    logger = logging.getLogger("worktrack")
    # 注意：表结构由 Alembic 迁移管理（entrypoint.sh 中自动执行 alembic upgrade head）
    # 此处仅做运行时兼容性补丁和默认数据初始化
    from sqlmodel import text
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE wiki_space ADD COLUMN IF NOT EXISTS share_password VARCHAR(100) DEFAULT NULL;"))
            conn.execute(text("ALTER TABLE wiki_space ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;"))
            # HR 档案日期（参加工作日期→法定年假工龄；入职日期→司龄）
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS first_work_date DATE DEFAULT NULL;'))
            conn.execute(text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS hire_date DATE DEFAULT NULL;'))
            # 报销明细与关联出差申请
            conn.execute(text('ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS items TEXT DEFAULT NULL;'))
            conn.execute(text('ALTER TABLE expense_request ADD COLUMN IF NOT EXISTS trip_id INTEGER DEFAULT NULL REFERENCES business_trip_request(id);'))
            conn.commit()
        except Exception as e:
            logger.debug("ALTER TABLE skipped: %s", e)
    # RBAC 关联表唯一约束（幂等添加）
    with engine.connect() as conn:
        for constraint_sql in [
            "ALTER TABLE rbac_role_permission ADD CONSTRAINT uq_role_perm UNIQUE (role_id, permission_id);",
            "ALTER TABLE rbac_user_role ADD CONSTRAINT uq_user_role UNIQUE (user_id, role_id);",
            "ALTER TABLE rbac_department_role ADD CONSTRAINT uq_dept_role UNIQUE (department_id, role_id);",
        ]:
            try:
                conn.execute(text(constraint_sql))
                conn.commit()
            except Exception as e:
                logger.debug("ADD CONSTRAINT skipped: %s", e)
                conn.rollback()
    # 非生产模式自动创建默认管理员（生产使用初始化向导）
    if settings.auto_create_admin:
        _ensure_admin_user(engine)
    # 创建默认字段选项
    _init_default_options(engine)
    # 初始化 RBAC 权限和角色
    _init_rbac_data(engine)
    # 初始化审批流预置模板
    _init_approval_flows(engine)
    # 初始化默认公司主体（幂等：按 name 唯一）
    _init_legal_entities(engine)


def _ensure_admin_user(engine):
    """确保存在管理员用户；为旧无密码用户补充凭据"""
    import logging
    import secrets as _secrets
    from app.models.user import User
    from passlib.context import CryptContext

    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    logger = logging.getLogger("worktrack")

    admin_pwd = settings.admin_password or _secrets.token_urlsafe(12)

    with Session(engine) as session:
        from sqlmodel import select as sm_select
        users = session.exec(sm_select(User)).all()

        if not users:
            session.add(User(
                id=1,
                username="admin",
                password_hash=pwd_ctx.hash(admin_pwd),
                name="管理员",
                is_admin=True,
            ))
            session.commit()
            if not settings.admin_password:
                logger.warning("⚠️  默认管理员已创建，随机密码: %s（请立即登录修改）", admin_pwd)
            else:
                logger.info("默认管理员已创建，密码使用 ADMIN_PASSWORD 配置")
            return

        for u in users:
            if not u.username:
                u.username = f"user{u.id}"
            if not u.password_hash:
                random_pwd = _secrets.token_urlsafe(12)
                u.password_hash = pwd_ctx.hash(random_pwd)
                logger.warning("⚠️  用户 %s (id=%d) 密码已重置为随机值，请联系管理员重置", u.username, u.id)
            if not u.name:
                u.name = "默认用户"
        session.commit()


def get_session():
    """获取数据库会话（依赖注入）"""
    with Session(engine) as session:
        yield session


DEFAULT_FIELD_OPTIONS = {
    "product": ["AI 对话平台", "RAG 知识库", "Agent 平台", "模型微调", "推理 API", "向量数据库", "数据标注", "其他"],
    "project_status": ["进行中", "已完成", "暂停", "已取消", "待启动", "已签约", "已结束", "已流失"],
    "project_scenario": [
        "智能客服 / 客服机器人",
        "知识库问答（RAG）",
        "文档处理与分析",
        "代码辅助 / Copilot",
        "内容生成与创作",
        "数据分析与报告",
        "企业搜索增强",
        "工作流自动化",
        "AI Agent / 任务规划",
        "多模态理解（图文/语音）",
        "垂直行业大模型定制",
        "模型评测与对比",
    ],
    "cloud": [
        "自建 AI 网关",
        "具备访问海外模型的网络能力",
        "聚合平台对外服务",
        "私有化部署（K8s/Docker）",
        "公有云（已有账户）",
        "裸金属 / GPU 服务器",
        "自建向量数据库 / 知识库",
        "API 网关已有",
        "混合云架构",
        "无技术团队（纯 API 接入）",
    ],
}


def _init_default_options_in_session(session):
    """在已有 session 中初始化默认字段选项（仅当不存在时）"""
    from app.models.field_option import FieldOption
    existing = session.exec(select(FieldOption)).first()
    if not existing:
        for category, values in DEFAULT_FIELD_OPTIONS.items():
            for i, val in enumerate(values):
                session.add(FieldOption(category=category, value=val, sort_order=i))
        session.commit()


def _init_default_options(engine):
    """初始化默认字段选项"""
    with Session(engine) as session:
        _init_default_options_in_session(session)


# ===== RBAC 预置数据 =====

PERMISSION_DEFS = [
    # 用户与角色管理
    ("user:read", "查看用户", "user", "read"),
    ("user:create", "创建用户", "user", "create"),
    ("user:edit", "编辑用户", "user", "edit"),
    ("user:delete", "删除用户", "user", "delete"),
    ("user:manage_roles", "管理角色分配", "user", "manage_roles"),
    # 项目管理
    ("project:read", "查看项目", "project", "read"),
    ("project:create", "创建项目", "project", "create"),
    ("project:edit", "编辑项目", "project", "edit"),
    ("project:delete", "删除项目", "project", "delete"),
    ("project:view_all", "查看全部项目", "project", "view_all"),
    ("project:follow_tech", "写入技术跟进记录", "project", "follow_tech"),
    # 客户管理
    ("customer:read", "查看客户", "customer", "read"),
    ("customer:create", "创建客户", "customer", "create"),
    ("customer:edit", "编辑客户", "customer", "edit"),
    ("customer:delete", "删除客户", "customer", "delete"),
    # 合同管理
    ("contract:read", "查看合同", "contract", "read"),
    ("contract:create", "创建合同", "contract", "create"),
    ("contract:edit", "编辑合同", "contract", "edit"),
    ("contract:delete", "删除合同", "contract", "delete"),
    ("contract:parse", "解析合同", "contract", "parse"),
    ("contract:view_all", "查看全部合同", "contract", "view_all"),
    ("contract:archive", "历史合同归档", "contract", "archive"),
    # 日报/周报
    ("report:read", "查看报告", "report", "read"),
    ("report:create", "创建报告", "report", "create"),
    ("report:edit", "编辑报告", "report", "edit"),
    ("report:submit", "提交报告", "report", "submit"),
    ("report:delete", "删除报告", "report", "delete"),
    ("report:view_all", "查看全部报告", "report", "view_all"),
    # 会议纪要
    ("meeting:read", "查看会议", "meeting", "read"),
    ("meeting:create", "创建会议", "meeting", "create"),
    ("meeting:edit", "编辑会议", "meeting", "edit"),
    ("meeting:delete", "删除会议", "meeting", "delete"),
    ("meeting:view_all", "查看全部会议", "meeting", "view_all"),
    # AI 与模型供应商
    ("ai:use", "使用AI", "ai", "use"),
    ("ai:manage_own", "管理自有供应商", "ai", "manage_own"),
    ("ai:manage_shared", "管理共享供应商", "ai", "manage_shared"),
    # Wiki
    ("wiki:read", "查看Wiki", "wiki", "read"),
    ("wiki:create", "创建Wiki", "wiki", "create"),
    ("wiki:edit", "编辑Wiki", "wiki", "edit"),
    ("wiki:delete", "删除Wiki", "wiki", "delete"),
    ("wiki:manage_space", "管理空间", "wiki", "manage_space"),
    # 系统设置
    ("settings:read", "查看设置", "settings", "read"),
    ("settings:edit", "编辑设置", "settings", "edit"),
    # 数据看板
    ("dashboard:read", "查看看板", "dashboard", "read"),
    # 定时任务
    ("task:read", "查看任务", "task", "read"),
    ("task:create", "创建任务", "task", "create"),
    ("task:edit", "编辑任务", "task", "edit"),
    ("task:delete", "删除任务", "task", "delete"),
    # 运行日志
    ("log:read", "查看日志", "log", "read"),
    ("log:clear", "清空日志", "log", "clear"),
    # 运维监控
    ("monitor:read", "查看运维监控", "monitor", "read"),
    # 数据管理
    ("data:export", "导出数据", "data", "export"),
    ("data:import", "导入数据", "data", "import"),
    # 客户全局查看（跨部门）
    ("customer:view_all", "查看全部客户", "customer", "view_all"),
    # 管理总览
    ("management:console", "管理总览", "management", "console"),
    # 数据分享
    ("share:create", "创建分享", "share", "create"),
    ("share:read", "查看分享", "share", "read"),
    ("share:comment", "评论分享", "share", "comment"),
    # 上游管理（供应商 / 通道）
    ("upstream:read", "查看上游", "upstream", "read"),
    ("upstream:edit", "管理上游", "upstream", "edit"),
    # 财务对账
    ("reconcile:read", "查看对账", "reconcile", "read"),
    ("reconcile:edit", "编辑对账", "reconcile", "edit"),
    # 模型变更（上游 LLM 模型上下线 / 价格变动追踪，独立于「管理总览」）
    ("model:read", "查看模型变更", "model", "read"),
    ("model:edit", "管理模型变更", "model", "edit"),
    # 意见反馈（提交端零门槛，仅后台聚合管理需要此权限）
    ("feedback:manage", "管理意见反馈", "feedback", "manage"),
    # 付款申请（员工报销 / 供应商付款 / 工资 / 其他；发起仅需登录，view_all 供财务/出纳/老板查看全部）
    ("payment:view_all", "查看全部付款申请", "payment", "view_all"),
    # 盖章申请（公章 / 财务章 / 法人章；发起仅需登录，view_all 供法务/印章管理员/老板查看全部）
    ("seal:view_all", "查看全部盖章申请", "seal", "view_all"),
    # OA 办公模块（请假 / 加班 / 采购供应商；发起仅需登录，view_all/manage 供 HR/管理员）
    ("leave:view_all", "查看全部请假", "leave", "view_all"),
    ("leave:manage", "管理假期额度", "leave", "manage"),
    ("overtime:view_all", "查看全部加班", "overtime", "view_all"),
    ("purchase_supplier:read", "查看采购供应商", "purchase_supplier", "read"),
    ("purchase_supplier:manage", "管理采购供应商", "purchase_supplier", "manage"),
    # P2 OA 模块（报销/出差/采购/资产）
    ("expense:view_all", "查看全部报销", "expense", "view_all"),
    ("expense:pay", "执行报销付款", "expense", "pay"),
    ("trip:view_all", "查看出差申请", "trip", "view_all"),
    ("purchase:view_all", "查看全部采购", "purchase", "view_all"),
    ("purchase:manage", "管理采购执行", "purchase", "manage"),
    ("asset:read", "查看企业资产", "asset", "read"),
    ("asset:manage", "管理企业资产", "asset", "manage"),
    # 员工入职申请（HR 专属发起，view_all 供审批人查看，manage 供 HR 执行入职建账号）
    ("hire:read", "查看入职申请", "hire", "read"),
    ("hire:view_all", "查看全部入职申请", "hire", "view_all"),
    ("hire:manage", "发起入职申请并执行入职建账号", "hire", "manage"),
    # 审批流配置（创建/修改/启停/删除审批流，仅管理员）
    ("approval:manage", "管理审批流", "approval", "manage"),
]

ROLE_DEFS = {
    "admin": {
        "name": "系统管理员",
        "description": "系统管理员，拥有全部业务模块权限和系统管理权限",
        "perms": [
            # 用户与角色管理
            "user:read", "user:create", "user:edit", "user:delete", "user:manage_roles",
            # 全部业务模块
            "project:read", "project:create", "project:edit", "project:delete", "project:view_all",
            "customer:read", "customer:create", "customer:edit", "customer:delete", "customer:view_all",
            "contract:read", "contract:create", "contract:edit", "contract:delete", "contract:parse", "contract:view_all", "contract:archive",
            "report:read", "report:create", "report:edit", "report:submit", "report:delete", "report:view_all",
            "meeting:read", "meeting:create", "meeting:edit", "meeting:delete", "meeting:view_all",
            "wiki:read", "wiki:create", "wiki:edit", "wiki:delete", "wiki:manage_space",
            # AI
            "ai:use", "ai:manage_own", "ai:manage_shared",
            # 上游与对账
            "upstream:read", "upstream:edit",
            "reconcile:read", "reconcile:edit",
            # 模型变更
            "model:read", "model:edit",
            # 系统管理与运维
            "settings:read", "settings:edit",
            "dashboard:read",
            "task:read", "task:create", "task:edit", "task:delete",
            "log:read", "log:clear",
            "monitor:read",
            "data:export", "data:import",
            # 管理总览与分享
            "management:console",
            "share:create", "share:read", "share:comment",
            # 意见反馈管理
            "feedback:manage",
            # 付款 / 盖章申请全局查看
            "payment:view_all", "seal:view_all",
            # OA 办公模块
            "leave:view_all", "leave:manage", "overtime:view_all",
            "purchase_supplier:read", "purchase_supplier:manage",
            # P2 OA 模块
            "expense:view_all", "expense:pay",
            "trip:view_all",
            "purchase:view_all", "purchase:manage",
            "asset:read", "asset:manage",
            # 员工入职申请
            "hire:read", "hire:view_all", "hire:manage",
            # 审批流配置
            "approval:manage",
        ],
    },
    "dept_leader": {
        "name": "部门领导",
        "description": "部门领导，通过部门负责人机制自动获得本部门及子部门数据可见性，无需 view_all",
        "perms": [
            "user:read",
            "project:read", "project:create", "project:edit",
            "customer:read", "customer:create", "customer:edit",
            "contract:read", "contract:parse",
            "report:read", "report:create", "report:edit",
            "meeting:read", "meeting:create",
            "ai:use", "ai:manage_own",
            "wiki:read", "wiki:create", "wiki:edit",
            "upstream:read",
            "reconcile:read",
            "settings:read",
            "dashboard:read",
            "task:read", "task:create",
            "log:read",
            # 管理总览与分享
            "management:console",
            "share:create", "share:read", "share:comment",
            # OA 办公：部门领导需查看下属请假/加班/报销/出差/采购申请
            "leave:view_all", "overtime:view_all",
            "expense:view_all", "trip:view_all", "purchase:view_all",
            # 员工入职申请（审批本部门入职）
            "hire:view_all",
            # 资产查看
            "asset:read",
        ],
    },
    "sales": {
        "name": "销售",
        "description": "销售人员，负责项目拓展和客户维护，跟进合同签署（删除权归管理员，防止误删丢失审计链）",
        "perms": [
            "project:read", "project:create", "project:edit",
            "customer:read", "customer:create", "customer:edit",
            "contract:read", "contract:create", "contract:edit", "contract:parse", "contract:archive",
            "report:read", "report:create", "report:submit",
            "ai:use",
            "wiki:read",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
            # 资产查看
            "asset:read",
        ],
    },
    "tech": {
        "name": "技术",
        "description": "技术人员，负责项目交付、会议协作和技术文档管理",
        "perms": [
            "project:read", "project:follow_tech",
            "meeting:read", "meeting:create", "meeting:edit", "meeting:delete",
            "wiki:read", "wiki:create", "wiki:edit",
            "ai:use", "ai:manage_own",
            "report:read", "report:create", "report:submit",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
            # 资产查看
            "asset:read",
        ],
    },
    "operations": {
        "name": "运营",
        "description": "运营人员，跟进日常运营数据，协助会议记录",
        "perms": [
            "report:read", "report:create", "report:submit",
            "meeting:read", "meeting:create", "meeting:edit",
            "customer:read",
            "project:read",
            "wiki:read",
            "ai:use",
            "dashboard:read",
            "share:read", "share:comment",
            # 资产查看
            "asset:read",
        ],
    },
    "business": {
        "name": "商务",
        "description": "商务人员，负责合同谈判、客户对接和上游供应商管理（删除权归管理员）",
        "perms": [
            "contract:read", "contract:create", "contract:edit", "contract:parse", "contract:archive",
            "customer:read", "customer:create", "customer:edit",
            "project:read",
            "report:read", "report:submit",
            "upstream:read", "upstream:edit",
            "ai:use",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
            # 资产查看
            "asset:read",
        ],
    },
    "finance": {
        "name": "财务",
        "description": "财务人员，负责对账复核、合同财务审批与回款管理；作为合同审批链的财务节点",
        "ensure_exists": True,
        "perms": [
            "contract:read", "contract:view_all",
            "project:read", "customer:read",
            "report:read", "report:submit",
            "upstream:read",
            "reconcile:read", "reconcile:edit",
            "ai:use", "wiki:read",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
            # 财务作为付款/盖章审批链的财务初审节点，需查看全部申请
            "payment:view_all", "seal:view_all",
            # OA 办公：财务作为报销/采购审批链的财务节点，需查看全部申请
            "expense:view_all", "purchase:view_all",
            # 差旅报销核对需要查看出差申请
            "trip:view_all",
            # 资产查看
            "asset:read",
        ],
    },
    "legal": {
        "name": "法务",
        "description": "法务人员，负责合同审查与合规把关，需查看供应商资质；作为合同审批链的法务节点",
        "ensure_exists": True,
        "perms": [
            "contract:read", "contract:view_all", "contract:parse",
            "project:read", "customer:read",
            "upstream:read",
            "ai:use", "wiki:read",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
            # 法务作为盖章审批链的法务初审节点，需查看全部盖章申请
            "seal:view_all",
            # 资产查看
            "asset:read",
        ],
    },
    "boss": {
        "name": "老板",
        "description": "企业老板，拥有全系统所有业务板块的查看与审查权限，不具备创建和编辑特权",
        "perms": [
            "user:read",
            "project:read", "project:view_all",
            "customer:read", "customer:view_all",
            "contract:read", "contract:view_all",
            "report:read", "report:view_all",
            "meeting:read", "meeting:view_all",
            "upstream:read",
            "reconcile:read",
            "model:read",
            "ai:use",
            "wiki:read",
            "settings:read",
            "dashboard:read",
            "task:read",
            "log:read",
            "management:console",
            "share:read", "share:comment",
            # 付款 / 盖章申请全局查看
            "payment:view_all", "seal:view_all",
            # OA 办公模块全局查看
            "leave:view_all", "overtime:view_all",
            # P2 OA 模块全局查看
            "expense:view_all", "trip:view_all", "purchase:view_all",
            "purchase_supplier:read",
            "asset:read", "asset:manage",
            # 员工入职申请（总经理终审）
            "hire:view_all",
        ],
    },
    "hr": {
        "name": "人事",
        "description": "人事专员，负责员工假期额度管理、请假/加班审批与考勤统计",
        "ensure_exists": True,
        "perms": [
            "user:read",
            "leave:view_all", "leave:manage",
            "overtime:view_all",
            "purchase_supplier:read",
            "expense:view_all", "trip:view_all",
            # 人事负责资产领用管理（办公设备分配）
            "asset:read", "asset:manage",
            # 员工入职申请（HR 发起 + 复核 + 执行入职建账号）
            "hire:read", "hire:view_all", "hire:manage",
            "report:read", "report:submit",
            "meeting:read",
            "wiki:read",
            "ai:use",
            "dashboard:read",
            "share:read", "share:comment",
        ],
    },
    "cashier": {
        "name": "出纳",
        "description": "财务出纳，负责付款执行；作为付款审批链的「出纳付款」执行节点，可查看全部付款申请",
        "ensure_exists": True,
        "perms": [
            "payment:view_all",
            "expense:view_all", "expense:pay",
            "reconcile:read",
            "dashboard:read",
            "ai:use",
            "share:read", "share:comment",
            # 资产查看
            "asset:read",
        ],
    },
    "seal_keeper": {
        "name": "印章管理员",
        "description": "印章管理员，负责用印盖章执行；作为盖章审批链的「盖章」执行节点，可查看全部盖章申请",
        "ensure_exists": True,
        "perms": [
            "seal:view_all",
            "dashboard:read",
            "ai:use",
            "share:read", "share:comment",
            # 资产查看
            "asset:read",
        ],
    },
    "user": {
        "name": "普通用户",
        "description": "基础用户，记录个人日报周报，参与会议和协作",
        "perms": [
            "project:read",
            "report:read", "report:create", "report:submit",
            "meeting:read", "meeting:create",
            "ai:use",
            "wiki:read",
            "dashboard:read",
            "share:read", "share:comment",
            # 资产查看
            "asset:read",
        ],
    },
}


# ===== 系统角色权限「回收」清单 =====
# 背景：_init_rbac_data 的权限同步是"仅新增、不删除"（避免抹掉管理员手动定制）。
# 当某个系统角色需要"收回"历史上误授的权限时，必须在此显式声明，启动时会幂等删除。
# 仅作用于这里列出的 (角色, 权限) 组合，不影响任何其它授权。
ROLE_PERM_REVOCATIONS = {
    # 销售/商务收回物理删除权（删除归管理员，防止一线误删丢失审计链）
    "sales": ["project:delete", "customer:delete", "contract:delete"],
    "business": ["contract:delete"],
    # 运营不再拥有创建分享（与角色定义对齐，仅保留查看/评论）
    "operations": ["share:create"],
}


# ===== 审批流预置数据 =====
# 节点 approver_type: role（按角色 code）| leader（直属上级）| dept_manager（部门负责人）| user（指定 user_id）
# trigger_condition: None=该类业务一律走审批；或 {"field","op","value"} 按业务字段触发
#   例：{"field":"contract_amount","op":">=","value":500000} 仅 50 万以上合同走审批
APPROVAL_FLOW_DEFS = [
    {
        "code": "contract_approval",
        "name": "合同审批",
        "business_type": "contract",
        "is_system": True,
        "trigger_condition": None,
        "description": "合同提交后依次经部门负责人/分管领导、法务初审、财务初审、总经理审批，最后用印盖章方可生效",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "法务初审", "approver_type": "role", "approver_value": "legal", "order": 2},
            {"name": "财务初审", "approver_type": "role", "approver_value": "finance", "order": 3},
            {"name": "总经理审批", "approver_type": "role", "approver_value": "boss", "order": 4},
            {"name": "盖章", "approver_type": "role", "approver_value": "seal_keeper", "order": 5,
             "node_kind": "execution", "action_label": "确认盖章"},
        ],
    },
    {
        "code": "payment_approval",
        "name": "付款申请审批",
        "business_type": "payment",
        "is_system": True,
        "trigger_condition": None,
        "description": "付款申请（供应商付款/员工报销/工资/其他）依次经部门负责人或分管领导、财务初审、总经理审批，最后由出纳执行付款",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "财务初审", "approver_type": "role", "approver_value": "finance", "order": 2},
            {"name": "总经理审批", "approver_type": "role", "approver_value": "boss", "order": 3},
            {"name": "出纳付款", "approver_type": "role", "approver_value": "cashier", "order": 4,
             "node_kind": "execution", "action_label": "确认付款"},
        ],
    },
    {
        "code": "seal_approval",
        "name": "盖章申请审批",
        "business_type": "seal",
        "is_system": True,
        "trigger_condition": None,
        "description": "用印申请（公章/财务章/法人章）依次经部门负责人或分管领导、法务初审、财务初审、总经理审批，最后由印章管理员盖章",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "法务初审", "approver_type": "role", "approver_value": "legal", "order": 2},
            {"name": "财务初审", "approver_type": "role", "approver_value": "finance", "order": 3},
            {"name": "总经理审批", "approver_type": "role", "approver_value": "boss", "order": 4},
            {"name": "盖章", "approver_type": "role", "approver_value": "seal_keeper", "order": 5,
             "node_kind": "execution", "action_label": "确认盖章"},
        ],
    },
    {
        "code": "reconcile_monthly",
        "name": "财务月结复核",
        "business_type": "reconcile_summary",
        "is_system": True,
        "trigger_condition": None,
        "description": "月度财务总账提交后经财务复核、总经理锁定，锁定后明细只读不可修改",
        "nodes": [
            {"name": "财务复核", "approver_type": "role", "approver_value": "finance", "order": 1},
            {"name": "总经理锁定", "approver_type": "role", "approver_value": "boss", "order": 2},
        ],
    },
    {
        "code": "supplier_approval",
        "name": "供应商新增审批",
        "business_type": "supplier",
        "is_system": True,
        "trigger_condition": None,
        "description": "新增供应商需经法务审核后由总经理批准，审批通过后供应商正式生效",
        "nodes": [
            {"name": "法务审核", "approver_type": "role", "approver_value": "legal", "order": 1},
            {"name": "总经理批准", "approver_type": "role", "approver_value": "boss", "order": 2},
        ],
    },
    {
        "code": "channel_price_change",
        "name": "通道价格变更审批",
        "business_type": "channel",
        "is_system": True,
        "trigger_condition": None,
        "description": "通道成本价格变更需经负责人审批确认后方可生效",
        "nodes": [
            {"name": "负责人审批", "approver_type": "role", "approver_value": "boss", "order": 1},
        ],
    },
    {
        "code": "project_charter",
        "name": "项目立项审批",
        "business_type": "project",
        "is_system": True,
        "trigger_condition": None,
        "description": "销售提交立项申请后，依次经销售部门主管、商务审核、老板批准，通过后项目正式立项",
        "nodes": [
            {"name": "部门主管审批", "approver_type": "dept_manager", "approver_value": "", "order": 1},
            {"name": "商务审核", "approver_type": "role", "approver_value": "business", "order": 2},
            {"name": "老板批准", "approver_type": "role", "approver_value": "boss", "order": 3},
        ],
    },
    {
        "code": "leave_approval",
        "name": "请假审批",
        "business_type": "leave",
        "is_system": True,
        "trigger_condition": None,
        "description": "员工请假依次经部门负责人/分管领导审批、人事复核备案，通过后扣减假期额度",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "人事复核", "approver_type": "role", "approver_value": "hr", "order": 2},
        ],
    },
    {
        "code": "overtime_approval",
        "name": "加班审批",
        "business_type": "overtime",
        "is_system": True,
        "trigger_condition": None,
        "description": "员工加班申请经部门负责人/分管领导审批、人事复核备案，通过后按补偿方式处理（调休授予额度/加班费）",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "人事复核", "approver_type": "role", "approver_value": "hr", "order": 2},
        ],
    },
    {
        "code": "expense_approval",
        "name": "报销审批",
        "business_type": "expense",
        "is_system": True,
        "trigger_condition": None,
        "description": "员工报销依次经部门负责人、财务审核、老板批准，通过后由出纳执行付款",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "财务审核", "approver_type": "role", "approver_value": "finance", "order": 2},
            {"name": "老板批准", "approver_type": "role", "approver_value": "boss", "order": 3},
            {"name": "出纳付款", "approver_type": "role", "approver_value": "cashier", "order": 4, "node_kind": "execution", "action_label": "确认付款"},
        ],
    },
    {
        "code": "business_trip_approval",
        "name": "出差审批",
        "business_type": "business_trip",
        "is_system": True,
        "trigger_condition": None,
        "description": "员工出差申请经部门负责人/分管领导审批、老板批准，通过后可出差",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "老板批准", "approver_type": "role", "approver_value": "boss", "order": 2},
        ],
    },
    {
        "code": "purchase_approval",
        "name": "采购审批",
        "business_type": "purchase",
        "is_system": True,
        "trigger_condition": None,
        "description": "采购申请依次经部门负责人、财务审核、老板批准，通过后执行采购和入库",
        "nodes": [
            {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
            {"name": "财务审核", "approver_type": "role", "approver_value": "finance", "order": 2},
            {"name": "老板批准", "approver_type": "role", "approver_value": "boss", "order": 3},
        ],
    },
    {
        "code": "hire_approval",
        "name": "员工入职审批",
        "business_type": "hire",
        "is_system": True,
        "trigger_condition": None,
        "description": "员工入职申请依次经用人部门负责人、人事复核、总经理审批，最后由 HR 执行入职创建账号",
        "nodes": [
            {"name": "用人部门负责人", "approver_type": "target_dept_manager", "approver_value": "", "order": 1},
            {"name": "人事复核", "approver_type": "role", "approver_value": "hr", "order": 2},
            {"name": "总经理审批", "approver_type": "role", "approver_value": "boss", "order": 3},
            {"name": "HR 执行入职", "approver_type": "role", "approver_value": "hr", "order": 4, "node_kind": "execution", "action_label": "确认入职"},
        ],
    },
]


def _init_approval_flows(engine):
    """初始化审批流预置模板（幂等）。已存在的系统模板仅补建，不覆盖用户修改。"""
    import json as _json
    from app.models.approval import ApprovalFlow
    with Session(engine) as session:
        existing_codes = {f.code for f in session.exec(select(ApprovalFlow)).all()}
        for fd in APPROVAL_FLOW_DEFS:
            if fd["code"] in existing_codes:
                continue
            session.add(ApprovalFlow(
                code=fd["code"],
                name=fd["name"],
                business_type=fd["business_type"],
                is_active=True,
                is_system=fd.get("is_system", False),
                trigger_condition=_json.dumps(fd["trigger_condition"], ensure_ascii=False) if fd.get("trigger_condition") else None,
                nodes=_json.dumps(fd["nodes"], ensure_ascii=False),
                description=fd.get("description", ""),
            ))
        session.commit()


def _init_rbac_data(engine):
    """初始化 RBAC 预置权限和角色数据（幂等）"""
    from app.models.rbac import Permission, Role, RolePermission, UserRole

    with Session(engine) as session:
        # 1. 创建权限
        existing_perms = session.exec(select(Permission)).all()
        existing_codes = {p.code for p in existing_perms}

        perm_map = {}  # code → Permission object
        newly_created_perm_codes = set()  # 本次启动新建的权限码（用于判定是否给已有角色授默认权限）
        needs_commit = False
        for code, name, module, action in PERMISSION_DEFS:
            if code not in existing_codes:
                perm = Permission(code=code, name=name, module=module, action=action)
                session.add(perm)
                session.flush()
                perm_map[code] = perm
                newly_created_perm_codes.add(code)
                needs_commit = True
            else:
                # 使用已有权限
                for p in existing_perms:
                    if p.code == code:
                        # 修复编码损坏的权限名称
                        if '\ufffd' in p.name and '\ufffd' not in name:
                            p.name = name
                            needs_commit = True
                        perm_map[code] = p
                        break

        if needs_commit:
            session.commit()

        # 2. 创建角色并分配权限（仅首次部署时自动创建，已存在的角色同步权限，已删除的角色不再重建）
        existing_roles = session.exec(select(Role)).all()
        existing_role_codes = {r.code for r in existing_roles}
        is_first_deploy = len(existing_roles) == 0

        for role_code, role_def in ROLE_DEFS.items():
            existing_role = next((r for r in existing_roles if r.code == role_code), None)
            if existing_role:
                role = existing_role
                # 已存在的系统角色：仅为「本次新引入的权限码」补默认授权。
                # 关键：不能补充所有 ROLE_DEFS 里的权限——否则管理员在后台手动「删除」的权限
                # 会在每次容器重启时被重新加回（这是历史 bug）。只有当某权限码是本版本新增、
                # 数据库里之前根本不存在时，才按 ROLE_DEFS 给相关角色授权。
                existing_rp = session.exec(select(RolePermission).where(RolePermission.role_id == role.id)).all()
                existing_perm_ids = {rp.permission_id for rp in existing_rp}
                # 同步名称和描述
                role.name = role_def["name"]
                role.description = role_def["description"]
                session.add(role)
                session.commit()

                # 仅补充「本次新建的权限码」中、ROLE_DEFS 声明该角色应有、且尚未分配的
                perms = role_def["perms"]
                perm_codes_default = perms if perms != "all" else list(perm_map.keys())
                for _code in perm_codes_default:
                    if (
                        _code in newly_created_perm_codes
                        and _code in perm_map
                        and perm_map[_code].id not in existing_perm_ids
                    ):
                        session.add(RolePermission(role_id=role.id, permission_id=perm_map[_code].id))
                session.commit()
            elif is_first_deploy or role_def.get("ensure_exists"):
                # 首次部署创建全部预置角色；标记 ensure_exists 的关键角色（如审批链依赖）
                # 在后续版本新增时也确保创建，不受"已删除角色不重建"策略影响
                role = Role(
                    name=role_def["name"],
                    code=role_code,
                    description=role_def["description"],
                    is_system=True,
                )
                session.add(role)
                session.flush()

                perms = role_def["perms"]
                if perms == "all":
                    for _code, perm_obj in perm_map.items():
                        session.add(RolePermission(role_id=role.id, permission_id=perm_obj.id))
                else:
                    for _code in perms:
                        if _code in perm_map:
                            session.add(RolePermission(role_id=role.id, permission_id=perm_map[_code].id))
                session.commit()
            # else: 角色已被删除，不再自动重建

        # 修复系统预置角色的 is_system 标记
        for role_code in ROLE_DEFS:
            role_obj = next((r for r in existing_roles if r.code == role_code), None)
            if role_obj and not role_obj.is_system:
                role_obj.is_system = True
                session.add(role_obj)
        session.commit()

        # 2.5 权限回收（幂等）：删除 ROLE_PERM_REVOCATIONS 中显式声明要收回的授权
        revoked = 0
        for role_code, perm_codes in ROLE_PERM_REVOCATIONS.items():
            role_obj = next((r for r in existing_roles if r.code == role_code), None)
            if not role_obj:
                continue
            for pc in perm_codes:
                perm_obj = perm_map.get(pc)
                if not perm_obj:
                    continue
                rp = session.exec(
                    select(RolePermission).where(
                        RolePermission.role_id == role_obj.id,
                        RolePermission.permission_id == perm_obj.id,
                    )
                ).first()
                if rp:
                    session.delete(rp)
                    revoked += 1
        if revoked:
            session.commit()

        # 重新查询角色列表（首次部署时 existing_roles 为空，但角色已创建）
        existing_roles = session.exec(select(Role)).all()

        # 确保 is_admin 用户拥有 admin 角色
        admin_role = next((r for r in existing_roles if r.code == "admin"), None)
        if admin_role:
            from app.models.user import User as UserModel
            admin_users = session.exec(select(UserModel).where(UserModel.is_admin == True)).all()
            for au in admin_users:
                existing_ur = session.exec(
                    select(UserRole).where(UserRole.user_id == au.id, UserRole.role_id == admin_role.id)
                ).first()
                if not existing_ur:
                    session.add(UserRole(user_id=au.id, role_id=admin_role.id))
            session.commit()

    # ── 3. 预制合同模板种子（幂等：按 name+category 去重）──
    _seed_contract_templates(engine)


# ──────────────────────────────────────────────────
# 合同模板预制数据
# ──────────────────────────────────────────────────
_CONTRACT_TEMPLATES = [
    {
        "name": "标准销售合同模板",
        "category": "销售合同",
        "description": "适用于软件/SaaS/AI 服务销售，含服务范围、验收、付款节点条款",
        "content": """<h2 style="text-align:center">销售合同</h2>
<p><strong>合同编号：</strong>[合同编号]</p>
<p><strong>签订日期：</strong>[签订日期]</p>
<p>甲方（买方）：[甲方名称]，统一社会信用代码：[甲方信用代码]</p>
<p>乙方（卖方）：[乙方名称]，统一社会信用代码：[乙方信用代码]</p>
<h3>第一条 服务内容</h3>
<p>乙方向甲方提供 [服务名称/产品名称]，具体内容详见附件《服务说明书》。</p>
<h3>第二条 合同金额及付款方式</h3>
<p>合同总金额：人民币 [合同金额] 元（大写：[金额大写]）。</p>
<p>付款安排：合同签订后 [N] 个工作日内支付预付款 [比例]%；验收合格后 [N] 个工作日内支付尾款。</p>
<h3>第三条 服务期限</h3>
<p>自 [开始日期] 起至 [结束日期] 止，共 [期限] 个月。</p>
<h3>第四条 验收标准</h3>
<p>双方按《验收标准》进行验收，甲方应在收到验收申请后 [N] 个工作日内完成验收。</p>
<h3>第五条 违约责任</h3>
<p>任何一方未按约定履行义务，应向守约方支付合同总金额 [N]% 的违约金。</p>
<h3>第六条 争议解决</h3>
<p>本合同在履行过程中如发生争议，双方协商解决；协商不成，提交 [仲裁机构/法院] 解决。</p>
<p>本合同一式两份，甲乙双方各执一份，具有同等法律效力。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________　　　　　　日期：________________</p>""",
    },
    {
        "name": "标准采购合同模板",
        "category": "采购合同",
        "description": "适用于向供应商采购商品或服务，含质量保证、交付、付款条款",
        "content": """<h2 style="text-align:center">采购合同</h2>
<p><strong>合同编号：</strong>[合同编号]</p>
<p>甲方（采购方）：[甲方名称]</p>
<p>乙方（供应商）：[乙方名称]</p>
<h3>第一条 采购内容</h3>
<p>采购品名：[品名]，规格型号：[规格]，数量：[数量]，单价：[单价]，合计金额：[合计金额] 元。</p>
<h3>第二条 质量标准</h3>
<p>乙方提供的商品/服务须符合 [质量标准/国家标准]，并提供质保期 [N] 个月。</p>
<h3>第三条 交付方式</h3>
<p>乙方应于 [交付日期] 前完成交付，交付地点：[地址]。</p>
<h3>第四条 付款方式</h3>
<p>甲方在收到发票并验收合格后 [N] 个工作日内付款。</p>
<h3>第五条 违约责任</h3>
<p>乙方逾期交付，每逾期一日按合同金额 0.1% 支付违约金。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "标准劳动合同模板",
        "category": "劳动合同",
        "description": "符合《劳动合同法》的标准劳动合同，含岗位、薪酬、社保、保密条款",
        "content": """<h2 style="text-align:center">劳动合同</h2>
<p><strong>合同编号：</strong>[合同编号]</p>
<p>用人单位（甲方）：[公司名称]，统一社会信用代码：[信用代码]，法定代表人：[法代姓名]</p>
<p>劳动者（乙方）：[员工姓名]，身份证号：[身份证号]，联系方式：[电话]</p>
<h3>第一条 劳动合同期限</h3>
<p>合同期限自 [开始日期] 起至 [结束日期] 止，其中试用期为 [试用期] 个月。</p>
<h3>第二条 工作内容及地点</h3>
<p>乙方担任 [岗位名称] 岗位，工作地点为 [工作地点]，岗位职责详见岗位说明书。</p>
<h3>第三条 工作时间</h3>
<p>执行标准工时制，每日工作不超过 8 小时，每周不超过 40 小时。</p>
<h3>第四条 劳动报酬</h3>
<p>试用期月薪：人民币 [试用期薪资] 元；转正后月薪：人民币 [正式薪资] 元，含基本工资及绩效工资。</p>
<p>工资于每月 [发薪日] 日以银行转账方式发放。</p>
<h3>第五条 社会保险及福利</h3>
<p>甲方按国家及地方规定为乙方缴纳社会保险及住房公积金。</p>
<h3>第六条 保密义务</h3>
<p>乙方应对甲方的商业秘密、技术秘密及客户信息严格保密，合同终止后保密义务仍持续 [N] 年。</p>
<h3>第七条 竞业限制</h3>
<p>乙方离职后 [N] 年内不得在与甲方存在竞争关系的单位任职，甲方按月支付竞业限制补偿金。</p>
<h3>第八条 合同解除</h3>
<p>双方按《劳动合同法》相关规定解除本合同。</p>
<p>甲方（公章/法人章）：________________　　乙方（签名）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "保密协议（NDA）模板",
        "category": "保密协议",
        "description": "适用于商务合作、技术对接前的双向保密约定",
        "content": """<h2 style="text-align:center">保密协议（NDA）</h2>
<p>披露方：[披露方名称]（以下简称"甲方"）</p>
<p>接收方：[接收方名称]（以下简称"乙方"）</p>
<p>鉴于双方就 [合作事项] 进行洽谈，双方同意就彼此披露的保密信息承担如下保密义务：</p>
<h3>第一条 保密信息定义</h3>
<p>保密信息包括但不限于：技术方案、商业计划、客户数据、财务信息、产品路线图及以任何形式标注为"保密"的信息。</p>
<h3>第二条 保密义务</h3>
<p>接收方不得向第三方披露保密信息，不得用于合作目的以外的任何用途，应采取不低于保护自身同类信息的措施加以保护。</p>
<h3>第三条 保密期限</h3>
<p>本协议自签署之日起生效，保密义务持续至保密信息进入公知领域或合同终止后 [N] 年，以较晚者为准。</p>
<h3>第四条 违约责任</h3>
<p>违约方须赔偿守约方因此遭受的全部损失，且损失赔偿额不低于人民币 [最低赔偿金额] 元。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "技术服务合同模板",
        "category": "技术合同",
        "description": "适用于软件开发、系统集成、AI 技术服务等技术类合同",
        "content": """<h2 style="text-align:center">技术服务合同</h2>
<p><strong>合同编号：</strong>[合同编号]</p>
<p>委托方（甲方）：[甲方名称]</p>
<p>服务方（乙方）：[乙方名称]</p>
<h3>第一条 技术服务内容</h3>
<p>乙方为甲方提供 [技术服务名称]，具体需求详见附件《技术需求说明书》。</p>
<h3>第二条 交付成果</h3>
<p>乙方应交付：[成果清单，如源代码、文档、培训等]，交付时间不晚于 [交付日期]。</p>
<h3>第三条 知识产权</h3>
<p>本合同项下由乙方专门为甲方开发的成果，知识产权归 [甲方/乙方/共有]。乙方保留对通用组件/底层框架的所有权。</p>
<h3>第四条 合同金额及付款</h3>
<p>服务费用共计人民币 [金额] 元，付款安排：签订合同后支付 [比例]%，里程碑一完成支付 [比例]%，验收合格后支付尾款。</p>
<h3>第五条 技术保障</h3>
<p>乙方提供 [N] 个月免费维护期，期满后提供有偿技术支持。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "服务合同通用模板",
        "category": "服务合同",
        "description": "通用服务合同，适用于咨询、运维、培训等各类服务",
        "content": """<h2 style="text-align:center">服务合同</h2>
<p>甲方（委托方）：[甲方名称]</p>
<p>乙方（服务方）：[乙方名称]</p>
<h3>第一条 服务内容</h3>
<p>乙方为甲方提供 [服务内容]，服务期限自 [开始日期] 至 [结束日期]。</p>
<h3>第二条 服务费用</h3>
<p>服务费用为人民币 [金额] 元，按 [月/季度/项目] 结算，甲方于每期结束后 [N] 日内付款。</p>
<h3>第三条 服务标准</h3>
<p>乙方应按照 [服务标准/SLA] 提供服务，响应时间不超过 [N] 小时。</p>
<h3>第四条 保密条款</h3>
<p>双方对合作中知悉的对方商业秘密负有保密义务。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "合作协议模板",
        "category": "合作协议",
        "description": "战略合作、渠道合作、联合运营等合作关系约定",
        "content": """<h2 style="text-align:center">合作协议</h2>
<p>甲方：[甲方名称]</p>
<p>乙方：[乙方名称]</p>
<p>鉴于双方在 [合作领域] 方面具有合作意愿，经友好协商，达成如下合作协议：</p>
<h3>第一条 合作内容</h3>
<p>双方在 [具体合作领域/项目] 方面开展合作，各自承担如下工作：</p>
<p>甲方职责：[甲方职责]</p>
<p>乙方职责：[乙方职责]</p>
<h3>第二条 合作期限</h3>
<p>合作期限自 [开始日期] 起至 [结束日期] 止，期满前 [N] 日双方协商续约事宜。</p>
<h3>第三条 利益分配</h3>
<p>双方按 [比例] 分配合作收益，具体结算周期为 [月/季度]。</p>
<h3>第四条 保密与排他</h3>
<p>合作期内，双方对合作项目内容及数据保密；[是否]约定排他合作条款。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "框架协议模板",
        "category": "框架协议",
        "description": "长期合作框架，具体项目/订单以补充协议或订单确认单为准",
        "content": """<h2 style="text-align:center">框架合作协议</h2>
<p>甲方：[甲方名称]</p>
<p>乙方：[乙方名称]</p>
<p>双方本着平等互利的原则，就长期合作事宜签订本框架协议，具体业务以各期《业务订单》/《补充协议》为准。</p>
<h3>第一条 合作范围</h3>
<p>本框架协议适用于双方在 [业务范围] 内开展的所有合作事项。</p>
<h3>第二条 框架期限</h3>
<p>本协议有效期 [N] 年，自 [开始日期] 起计算，期满自动续签，任一方提前 [N] 日书面通知可终止。</p>
<h3>第三条 定价机制</h3>
<p>各期业务价格按市场价格协商确定，并在对应订单中列明，本框架协议不承诺固定价格。</p>
<h3>第四条 结算方式</h3>
<p>按各期订单约定结算，乙方开具正规发票后甲方于 [N] 个工作日内付款。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "补充协议模板",
        "category": "补充协议",
        "description": "对已签订合同的条款进行补充或变更",
        "content": """<h2 style="text-align:center">补充协议</h2>
<p><strong>原合同编号：</strong>[原合同编号]</p>
<p>甲方：[甲方名称]</p>
<p>乙方：[乙方名称]</p>
<p>鉴于双方于 [原合同签署日期] 签订的《[原合同名称]》（以下简称"原合同"）在执行过程中出现 [变更原因]，双方协商一致，就以下事项达成补充约定：</p>
<h3>第一条 变更内容</h3>
<p>原合同第 [X] 条"[原条款标题]"修改为：[新内容]。</p>
<h3>第二条 新增条款</h3>
<p>[如有新增条款，在此说明]</p>
<h3>第三条 其他</h3>
<p>本补充协议与原合同具有同等法律效力，如有冲突，以本补充协议为准；本补充协议未涉及的条款仍按原合同执行。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
    {
        "name": "委托协议模板",
        "category": "委托协议",
        "description": "委托代理、业务外包、授权委托等场景",
        "content": """<h2 style="text-align:center">委托协议</h2>
<p>委托方（甲方）：[甲方名称]</p>
<p>受托方（乙方）：[乙方名称]</p>
<h3>第一条 委托事项</h3>
<p>甲方委托乙方办理 [委托事项]，具体范围及权限如下：[详细说明]。</p>
<h3>第二条 委托期限</h3>
<p>委托期限自 [开始日期] 至 [结束日期]，期满自动失效。</p>
<h3>第三条 委托报酬</h3>
<p>甲方向乙方支付委托报酬人民币 [金额] 元，于 [支付节点] 支付。</p>
<h3>第四条 乙方义务</h3>
<p>乙方应按甲方指示处理委托事务，不得超越授权范围，及时向甲方汇报进展。</p>
<h3>第五条 风险承担</h3>
<p>乙方在授权范围内的行为产生的法律后果由甲方承担；乙方超越授权范围的行为，后果由乙方自行承担。</p>
<p>甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>日期：________________</p>""",
    },
]


def _seed_contract_templates(db_engine):
    """幂等写入预制合同模板，已存在则跳过"""
    from app.models.contract_template import ContractTemplate
    from sqlmodel import Session, select

    with Session(db_engine) as session:
        for tpl in _CONTRACT_TEMPLATES:
            existing = session.exec(
                select(ContractTemplate).where(
                    ContractTemplate.name == tpl["name"],
                    ContractTemplate.category == tpl["category"],
                )
            ).first()
            if existing:
                continue
            session.add(ContractTemplate(
                name=tpl["name"],
                category=tpl["category"],
                description=tpl.get("description", ""),
                content=tpl["content"],
                is_active=True,
            ))
        session.commit()


# ──────────────────────────────────────────────────
# 公司主体（legal_entity）预制数据
# 注意：默认公司名通过系统偏好 invoice_company_name / invoice_company_short_name 配置。
# 首次部署若未设置偏好，则创建一个占位主体，提示管理员在「系统设置 → 报销设置 → 公司基础信息」中配置。
# ──────────────────────────────────────────────────
_PLACEHOLDER_LEGAL_ENTITY = {
    "name": "请在系统设置中配置公司主体",
    "short_name": "待配置",
    "tax_id": "",
    "balance": 0,
    "is_default": True,
    "is_active": True,
    "sort_order": 0,
}


def _get_system_pref(session, key: str, default: str = "") -> str:
    """读取全局系统偏好（user_id is None）"""
    from app.models.system_preference import SystemPreference
    pref = session.exec(
        select(SystemPreference).where(
            SystemPreference.key == key,
            SystemPreference.user_id == None,  # noqa: E711
        )
    ).first()
    return pref.value if pref else default


def _set_system_pref(session, key: str, value: str) -> None:
    """写入全局系统偏好（user_id is None），存在则更新"""
    from app.models.system_preference import SystemPreference
    pref = session.exec(
        select(SystemPreference).where(
            SystemPreference.key == key,
            SystemPreference.user_id == None,  # noqa: E711
        )
    ).first()
    if pref:
        pref.value = value
    else:
        session.add(SystemPreference(key=key, value=value, user_id=None))


def _init_legal_entities(engine):
    """幂等写入预制公司主体。默认公司名称从系统偏好读取（避免硬编码）。

    处理历史脏数据：
    - 「杭州远石科技有限公司」是早期样例名，迁移后自动删除（避免用户看到）
    - 若存在占位主体「请在系统设置中配置公司主体」，按当前系统偏好改名
    - 保证全表只有一条 is_default=True
    """
    from app.models.legal_entity import LegalEntity
    from sqlmodel import Session, select

    with Session(engine) as session:
        # 1) 读取配置的默认公司名（管理员在「系统设置 → 报销设置 → 公司基础信息」设置）
        name = _get_system_pref(session, "invoice_company_name", "").strip()
        short = _get_system_pref(session, "invoice_company_short_name", "").strip()
        tax_id = _get_system_pref(session, "invoice_company_tax_id", "").strip()
        target_name = name or _PLACEHOLDER_LEGAL_ENTITY["name"]
        target_short = short or _PLACEHOLDER_LEGAL_ENTITY["short_name"]

        all_ents = session.exec(select(LegalEntity)).all()
        if not all_ents:
            # 全新库：直接创建
            session.add(LegalEntity(
                name=target_name, short_name=target_short, tax_id=tax_id,
                balance=0, is_default=True, is_active=True, sort_order=0,
            ))
            session.commit()
            return

        # 2) 清理历史样例名「杭州远石科技有限公司」（早期硬编码遗留）
        legacy = session.exec(
            select(LegalEntity).where(LegalEntity.name == "杭州远石科技有限公司")
        ).all()
        for ent in legacy:
            # 如果当前表里没有同名的「真实主体」，则删除样例
            session.delete(ent)

        # 3) 找到「占位主体」并按系统偏好改名（用户首次配置时触发）
        placeholder = session.exec(
            select(LegalEntity).where(
                LegalEntity.name == _PLACEHOLDER_LEGAL_ENTITY["name"]
            )
        ).first()
        if placeholder:
            placeholder.name = target_name
            placeholder.short_name = target_short
            placeholder.tax_id = tax_id

        # 4) 若有「当前同名」主体已存在 → 不动；否则把第一条非占位主体改成目标名
        same = session.exec(
            select(LegalEntity).where(LegalEntity.name == target_name)
        ).first()
        if not same:
            # 找一条非样例/非占位的主体作为升级目标
            base = session.exec(select(LegalEntity).order_by(LegalEntity.id)).first()
            if base:
                base.name = target_name
                base.short_name = target_short
                base.tax_id = tax_id

        # 5) 保证全表只有一条 is_default=True（取消其它）
        all_ents_now = session.exec(select(LegalEntity)).all()
        defaults = [e for e in all_ents_now if e.is_default]
        # 优先保留「目标名」那条
        keep = None
        for e in all_ents_now:
            if e.name == target_name:
                keep = e
                break
        if not keep and all_ents_now:
            keep = all_ents_now[0]
        for e in all_ents_now:
            e.is_default = (e is keep)
        # 6) 若整表空了，兜底建一条
        if not all_ents_now:
            session.add(LegalEntity(
                name=target_name, short_name=target_short, tax_id=tax_id,
                balance=0, is_default=True, is_active=True, sort_order=0,
            ))
        session.commit()

