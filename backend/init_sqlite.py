"""本地 SQLite 数据库初始化脚本（跳过 Alembic，直接用 SQLModel 建表）"""
import sys
import os
import logging
sys.path.insert(0, os.path.dirname(__file__))

from sqlmodel import SQLModel, Session, select
from app.database import engine
from app.models import (  # noqa: F401
    User, Department, DailyReport, Customer, CustomerContact, Contract, Project, MeetingNote,
    MeetingPermission, MeetingComment,
    ScheduledTask, ModelProvider, TaskModelConfig, ProviderModel,
    FieldOption, ChatConversation, ChatMessage, SystemPreference,
    LogEntry, AIPrompt, WeeklySummary,
    UserGroup, UserGroupMember, WikiSpace, WikiPage, WikiPermission, WikiPageVersion,
    Permission, Role, RolePermission, UserRole, GroupRole, DepartmentRole,
    DataShare, DataShareComment,
)

print("Creating tables...")
SQLModel.metadata.create_all(engine)
print("Tables created successfully!")

# 初始化默认数据（跳过 PostgreSQL 特定操作）
print("Initializing default data...")

from app.database import _init_default_options, _init_rbac_data
from app.config import settings
import secrets

# 创建默认管理员
from passlib.context import CryptContext
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger("worktrack")

admin_pwd = settings.admin_password or secrets.token_urlsafe(12)

with Session(engine) as session:
    users = session.exec(select(User)).all()

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
            print(f"⚠️  Default admin created, random password: {admin_pwd}")
        else:
            print("Default admin created, password set from ADMIN_PASSWORD config")

_init_default_options(engine)
_init_rbac_data(engine)
print("Default data initialized!")
print("SQLite database is ready!")
