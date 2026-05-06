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
    # 非生产模式自动创建默认管理员（生产使用初始化向导）
    if settings.auto_create_admin:
        _ensure_admin_user(engine)
    # 创建默认字段选项
    _init_default_options(engine)


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

