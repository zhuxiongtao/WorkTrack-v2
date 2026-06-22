"""
首次运行 Setup API
- 检测是否需要初始化
- 测试数据库连接
- 创建管理员用户并初始化默认数据
- 支持配置安全密钥、AI密钥、存储路径等
"""
import os
import secrets
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select, text
from sqlmodel import create_engine as sm_create_engine

from app.database import engine, get_session, DEFAULT_FIELD_OPTIONS, _init_default_options_in_session, _init_rbac_data
from app.models.user import User
from app.models.field_option import FieldOption
from app.rate_limit import limiter

router = APIRouter(prefix="/api/v1/setup", tags=["setup"])


def _admin_exists() -> bool:
    """系统是否已初始化（存在任意管理员）"""
    try:
        with Session(engine) as session:
            return session.exec(select(User).where(User.is_admin == True)).first() is not None
    except Exception:
        return False


class SetupStatusResponse(BaseModel):
    needs_setup: bool
    db_ok: bool
    message: str = ""


class TestDbRequest(BaseModel):
    db_url: str = Field(..., description="完整数据库连接字符串，如 postgresql://user:pass@host:5432/db")


class TestDbResponse(BaseModel):
    ok: bool
    error: str = ""


class InitializeRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=8, max_length=128)
    name: str = Field(default="管理员", max_length=128)
    jwt_secret_key: str = Field(default="", description="JWT密钥，留空则自动生成（推荐设置）")
    llm_api_key: str = Field(default="", description="LLM API密钥")
    llm_base_url: str = Field(default="https://api.deepseek.com/v1", description="LLM API基础URL")
    llm_model_name: str = Field(default="deepseek-chat", description="LLM模型名称")
    embedding_api_key: str = Field(default="", description="Embedding API密钥，留空复用LLM密钥")
    embedding_base_url: str = Field(default="", description="Embedding基础URL，留空复用LLM URL")
    tavily_api_key: str = Field(default="", description="Tavily搜索API密钥")


class InitializeResponse(BaseModel):
    ok: bool
    user: dict = {}
    config_summary: dict = {}


@router.get("/status", response_model=SetupStatusResponse)
def setup_status():
    """检查是否需要初始化"""
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
            admin = session.exec(select(User).where(User.is_admin == True)).first()
            if admin:
                return SetupStatusResponse(needs_setup=False, db_ok=True, message="系统已初始化")
            return SetupStatusResponse(needs_setup=True, db_ok=True, message="需要创建管理员用户")
    except Exception as e:
        return SetupStatusResponse(needs_setup=True, db_ok=False, message=f"数据库连接失败: {str(e)}")


@router.post("/test-db", response_model=TestDbResponse)
@limiter.limit("5/minute")
def test_db(request: Request, req: TestDbRequest):
    """测试数据库连接是否可用（仅在系统未初始化时开放，避免被滥用为 SSRF 探测内网）"""
    if _admin_exists():
        raise HTTPException(status_code=403, detail="系统已初始化，该接口已禁用")
    # 仅允许 PostgreSQL 连接串，禁止 file:// 等其他 scheme 被用于探测
    if not req.db_url.startswith(("postgresql://", "postgresql+")):
        return TestDbResponse(ok=False, error="仅支持 postgresql 连接串")
    try:
        test_engine = sm_create_engine(req.db_url, echo=False)
        with Session(test_engine) as session:
            session.exec(text("SELECT 1"))
        return TestDbResponse(ok=True)
    except Exception as e:
        return TestDbResponse(ok=False, error=str(e))


@router.post("/initialize", response_model=InitializeResponse)
@limiter.limit("5/minute")
def initialize(request: Request, req: InitializeRequest):
    """初始化系统：创建管理员用户、配置密钥、初始化默认数据"""
    import traceback
    import logging
    logger = logging.getLogger("worktrack")

    try:
        with Session(engine) as session:
            existing_admin = session.exec(select(User).where(User.is_admin == True)).first()
            if existing_admin:
                raise HTTPException(status_code=400, detail="系统已初始化，请直接登录")

        from passlib.context import CryptContext
        pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

        config_summary = {}

        with Session(engine) as session:
            existing_user = session.exec(select(User).where(User.username == req.username)).first()
            if existing_user:
                raise HTTPException(status_code=400, detail=f"用户名 '{req.username}' 已存在")

            admin = User(
                username=req.username,
                password_hash=pwd_ctx.hash(req.password),
                name=req.name,
                is_admin=True,
            )
            session.add(admin)
            session.commit()
            session.refresh(admin)

            _init_default_options_in_session(session)
            _init_rbac_data(engine)

            config_summary["admin_created"] = True

        # 配置JWT密钥：用户指定 > 环境变量 > 自动生成
        jwt_key = req.jwt_secret_key
        if not jwt_key:
            jwt_key = os.getenv("JWT_SECRET_KEY", "")
        if not jwt_key:
            jwt_key = secrets.token_urlsafe(32)
            config_summary["jwt_secret_key"] = "自动生成（重启后Token将失效，建议设置环境变量）"
        else:
            config_summary["jwt_secret_key"] = "已设置"
            os.environ["JWT_SECRET_KEY"] = jwt_key
        from app.config import settings
        settings.jwt_secret_key = jwt_key

        # 配置AI密钥（写入SystemPreference持久化）
        from app.models.system_preference import SystemPreference
        ai_configs = {}
        if req.llm_api_key:
            ai_configs["llm_api_key"] = req.llm_api_key
        if req.llm_base_url and req.llm_base_url != "https://api.deepseek.com/v1":
            ai_configs["llm_base_url"] = req.llm_base_url
        if req.llm_model_name and req.llm_model_name != "deepseek-chat":
            ai_configs["llm_model_name"] = req.llm_model_name
        if req.embedding_api_key:
            ai_configs["embedding_api_key"] = req.embedding_api_key
        if req.embedding_base_url:
            ai_configs["embedding_base_url"] = req.embedding_base_url
        if req.tavily_api_key:
            ai_configs["tavily_api_key"] = req.tavily_api_key

        if ai_configs:
            with Session(engine) as session:
                for key, value in ai_configs.items():
                    existing = session.exec(
                        select(SystemPreference).where(
                            SystemPreference.key == key,
                            SystemPreference.user_id == None,
                        )
                    ).first()
                    if existing:
                        existing.value = value
                    else:
                        session.add(SystemPreference(key=key, value=value, user_id=None))
                session.commit()
            config_summary["ai_configured"] = True
        else:
            config_summary["ai_configured"] = False

        return InitializeResponse(
            ok=True,
            user={
                "id": admin.id,
                "username": admin.username,
                "name": admin.name,
                "is_admin": admin.is_admin,
            },
            config_summary=config_summary,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("初始化失败: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"初始化失败: {str(e)}")
