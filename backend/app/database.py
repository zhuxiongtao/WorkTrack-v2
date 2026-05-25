from sqlmodel import create_engine, SQLModel, Session, select
from app.config import settings
import os

# 确保数据目录存在（ChromaDB 等仍需要本地数据目录）
data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
if not os.path.exists(data_dir):
    os.makedirs(data_dir, exist_ok=True)

engine = create_engine(settings.database_url, echo=False)


def init_db():
    """初始化数据库：创建所有表，添加默认数据"""
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
    )
    SQLModel.metadata.create_all(engine)
    # 动态为 wiki_space 新增密码共享与失效时间所需字段，保障向下兼容
    from sqlmodel import text
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE wiki_space ADD COLUMN IF NOT EXISTS share_password VARCHAR(100) DEFAULT NULL;"))
            conn.execute(text("ALTER TABLE wiki_space ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;"))
            conn.commit()
        except Exception:
            pass
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
            except Exception:
                conn.rollback()
    # 非生产模式自动创建默认管理员（生产使用初始化向导）
    if settings.auto_create_admin:
        _ensure_admin_user(engine)
    # 创建默认字段选项
    _init_default_options(engine)
    # 初始化 RBAC 权限和角色
    _init_rbac_data(engine)


def _ensure_admin_user(engine):
    """确保存在管理员用户；为旧无密码用户补充凭据"""
    from app.models.user import User
    from passlib.context import CryptContext

    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

    with Session(engine) as session:
        from sqlmodel import select as sm_select
        users = session.exec(sm_select(User)).all()

        if not users:
            # 无用户：创建默认管理员
            session.add(User(
                id=1,
                username="admin",
                password_hash=pwd_ctx.hash("admin123"),
                name="管理员",
                is_admin=True,
            ))
            session.commit()
            return

        # 为旧用户补充 username/password
        for u in users:
            if not u.username:
                u.username = f"user{u.id}"
            if not u.password_hash:
                u.password_hash = pwd_ctx.hash("admin123")
            if not u.name:
                u.name = "默认用户"
        session.commit()


def get_session():
    """获取数据库会话（依赖注入）"""
    with Session(engine) as session:
        yield session


def _init_default_options(engine):
    """初始化默认字段选项"""
    from app.models.field_option import FieldOption
    defaults = {
        "industry": ["互联网", "金融", "教育", "医疗", "制造业", "零售", "房地产", "能源", "物流", "其他"],
        "sales_person": ["张三", "李四", "王五"],
        "project_status": ["进行中", "已完成", "暂停", "已取消", "待启动"],
        "cloud": ["阿里云", "腾讯云", "华为云", "AWS", "Azure", "GCP", "私有部署", "其他"],
    }
    with Session(engine) as session:
        existing = session.exec(select(FieldOption)).first()
        if not existing:
            for category, values in defaults.items():
                for i, val in enumerate(values):
                    session.add(FieldOption(category=category, value=val, sort_order=i))
            session.commit()


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
    # 日报/周报
    ("report:read", "查看报告", "report", "read"),
    ("report:create", "创建报告", "report", "create"),
    ("report:edit", "编辑报告", "report", "edit"),
    ("report:delete", "删除报告", "report", "delete"),
    ("report:view_all", "查看全部报告", "report", "view_all"),
    # 会议纪要
    ("meeting:read", "查看会议", "meeting", "read"),
    ("meeting:create", "创建会议", "meeting", "create"),
    ("meeting:edit", "编辑会议", "meeting", "edit"),
    ("meeting:delete", "删除会议", "meeting", "delete"),
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
    # 运维监控
    ("monitor:read", "查看运维监控", "monitor", "read"),
]

ROLE_DEFS = {
    "admin": {
        "name": "系统管理员",
        "description": "系统运维管理员，负责用户管理、系统配置、运维监控与模型供应商管理",
        "perms": [
            "user:read", "user:create", "user:edit", "user:delete", "user:manage_roles",
            "settings:read", "settings:edit",
            "log:read",
            "monitor:read",
            "ai:use", "ai:manage_own", "ai:manage_shared",
        ],
    },
    "dept_leader": {
        "name": "部门领导",
        "description": "部门领导，可查看本部门数据并有部分管理权限",
        "perms": [
            "user:read",
            "project:read", "project:create", "project:edit",
            "customer:read", "customer:create", "customer:edit",
            "contract:read", "contract:parse",
            "report:read", "report:create", "report:edit",
            "meeting:read",
            "ai:use", "ai:manage_own",
            "wiki:read", "wiki:create", "wiki:edit",
            "settings:read",
            "dashboard:read",
            "task:read", "task:create",
            "log:read",
        ],
    },
    "sales": {
        "name": "销售",
        "description": "销售人员，管理项目和客户",
        "perms": [
            "project:read", "project:create", "project:edit", "project:delete",
            "customer:read", "customer:create", "customer:edit", "customer:delete",
            "contract:read", "contract:create", "contract:edit", "contract:delete", "contract:parse",
            "report:read", "report:create",
            "ai:use",
            "wiki:read",
            "dashboard:read",
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
            "report:read", "report:create",
            "dashboard:read",
        ],
    },
    "operations": {
        "name": "运营",
        "description": "运营人员，查看报告和客户数据",
        "perms": [
            "report:read",
            "meeting:read", "meeting:create", "meeting:edit",
            "customer:read",
            "project:read",
            "wiki:read",
            "ai:use",
            "dashboard:read",
        ],
    },
    "business": {
        "name": "商务",
        "description": "商务人员，管理合同和客户",
        "perms": [
            "contract:read", "contract:create", "contract:edit", "contract:delete", "contract:parse",
            "customer:read", "customer:create", "customer:edit",
            "project:read",
            "report:read",
            "ai:use",
            "dashboard:read",
        ],
    },
    "boss": {
        "name": "老板",
        "description": "企业老板，拥有全系统所有业务板块的查看与审查权限，不具备创建和编辑特权",
        "perms": [
            "user:read",
            "project:read", "project:view_all",
            "customer:read",
            "contract:read",
            "report:read", "report:view_all",
            "meeting:read",
            "ai:use",
            "wiki:read",
            "settings:read",
            "dashboard:read",
            "task:read",
            "log:read",
        ],
    },
    "user": {
        "name": "普通用户",
        "description": "基础用户，查看和记录个人数据",
        "perms": [
            "project:read",
            "report:read", "report:create",
            "meeting:read", "meeting:create",
            "ai:use",
            "wiki:read",
            "dashboard:read",
        ],
    },
}


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
            elif is_first_deploy:
                # 首次部署：创建所有预置角色
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

