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
    "industry": ["互联网", "金融", "教育", "医疗", "制造业", "零售", "房地产", "能源", "物流", "其他"],
    "sales_person": ["张三", "李四", "王五"],
    "project_status": ["进行中", "已完成", "暂停", "已取消", "待启动"],
    "cloud": ["阿里云", "腾讯云", "华为云", "AWS", "Azure", "GCP", "私有部署", "其他"],
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
            "contract:read", "contract:create", "contract:edit", "contract:delete", "contract:parse", "contract:view_all",
            "report:read", "report:create", "report:edit", "report:submit", "report:delete", "report:view_all",
            "meeting:read", "meeting:create", "meeting:edit", "meeting:delete", "meeting:view_all",
            "wiki:read", "wiki:create", "wiki:edit", "wiki:delete", "wiki:manage_space",
            # AI
            "ai:use", "ai:manage_own", "ai:manage_shared",
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
        ],
    },
    "dept_leader": {
        "name": "部门领导",
        "description": "部门领导，通过部门负责人机制自动获得本部门及子部门数据可见性，无需 view_all",
        "perms": [
            "project:read", "project:create", "project:edit",
            "customer:read", "customer:create", "customer:edit",
            "contract:read", "contract:parse",
            "report:read", "report:create", "report:edit",
            "meeting:read", "meeting:create",
            "ai:use", "ai:manage_own",
            "wiki:read", "wiki:create", "wiki:edit",
            "settings:read",
            "dashboard:read",
            "task:read", "task:create",
            "log:read",
            # 管理总览与分享
            "management:console",
            "share:create", "share:read", "share:comment",
        ],
    },
    "sales": {
        "name": "销售",
        "description": "销售人员，管理项目和客户",
        "perms": [
            "project:read", "project:create", "project:edit", "project:delete",
            "customer:read", "customer:create", "customer:edit", "customer:delete",
            "contract:read", "contract:create", "contract:edit", "contract:delete", "contract:parse",
            "report:read", "report:create", "report:submit",
            "ai:use",
            "wiki:read",
            "dashboard:read",
            # 分享
            "share:create", "share:read", "share:comment",
        ],
    },
    "tech": {
        "name": "技术",
        "description": "技术人员，管理会议和 Wiki",
        "perms": [
            "project:read",
            "meeting:read", "meeting:create", "meeting:edit", "meeting:delete",
            "wiki:read", "wiki:create", "wiki:edit",
            "ai:use", "ai:manage_own",
            "report:read", "report:create", "report:submit",
            "dashboard:read",
            # 分享
            "share:create", "share:read", "share:comment",
        ],
    },
    "operations": {
        "name": "运营",
        "description": "运营人员，查看报告和客户数据",
        "perms": [
            "report:read", "report:submit",
            "meeting:read", "meeting:create", "meeting:edit",
            "customer:read",
            "project:read",
            "wiki:read",
            "ai:use",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
        ],
    },
    "business": {
        "name": "商务",
        "description": "商务人员，管理合同和客户",
        "perms": [
            "contract:read", "contract:create", "contract:edit", "contract:delete", "contract:parse",
            "customer:read", "customer:create", "customer:edit",
            "project:read",
            "report:read", "report:submit",
            "ai:use",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
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
            "ai:use", "wiki:read",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
        ],
    },
    "legal": {
        "name": "法务",
        "description": "法务人员，负责合同审查与合规把关；作为合同审批链的法务节点",
        "ensure_exists": True,
        "perms": [
            "contract:read", "contract:view_all", "contract:parse",
            "project:read", "customer:read",
            "ai:use", "wiki:read",
            "dashboard:read",
            "share:create", "share:read", "share:comment",
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
            "ai:use",
            "wiki:read",
            "settings:read",
            "dashboard:read",
            "task:read",
            "log:read",
            "management:console",
            "share:read", "share:comment",
        ],
    },
    "user": {
        "name": "普通用户",
        "description": "基础用户，查看和记录个人数据",
        "perms": [
            "project:read",
            "report:read", "report:create", "report:submit",
            "meeting:read", "meeting:create",
            "ai:use",
            "wiki:read",
            "dashboard:read",
            "share:read", "share:comment",
        ],
    },
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
        "description": "合同提交后依次经法务审查、财务审批、总经理审批，全部通过方可生效",
        "nodes": [
            {"name": "法务审查", "approver_type": "role", "approver_value": "legal", "order": 1},
            {"name": "财务审批", "approver_type": "role", "approver_value": "finance", "order": 2},
            {"name": "总经理审批", "approver_type": "role", "approver_value": "boss", "order": 3},
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
        needs_commit = False
        for code, name, module, action in PERMISSION_DEFS:
            if code not in existing_codes:
                perm = Permission(code=code, name=name, module=module, action=action)
                session.add(perm)
                session.flush()
                perm_map[code] = perm
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
                # 已存在的系统角色：增量同步权限（仅补充新增权限，不清除用户手动修改的权限）
                existing_rp = session.exec(select(RolePermission).where(RolePermission.role_id == role.id)).all()
                existing_perm_ids = {rp.permission_id for rp in existing_rp}
                # 同步名称和描述
                role.name = role_def["name"]
                role.description = role_def["description"]
                session.add(role)
                session.commit()

                # 仅补充 ROLE_DEFS 中有但数据库中尚未分配的权限
                perms = role_def["perms"]
                perm_codes_to_add = perms if perms != "all" else list(perm_map.keys())
                for _code in perm_codes_to_add:
                    if _code in perm_map and perm_map[_code].id not in existing_perm_ids:
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

