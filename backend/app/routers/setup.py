"""
首次运行 Setup API
- 检测是否需要初始化
- 测试数据库连接
- 创建管理员用户并初始化默认数据
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select, text
from sqlmodel import create_engine as sm_create_engine

from app.database import engine, get_session
from app.models.user import User
from app.models.field_option import FieldOption

router = APIRouter(prefix="/api/v1/setup", tags=["setup"])


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
    password: str = Field(..., min_length=6, max_length=128)
    name: str = Field(default="管理员", max_length=128)


class InitializeResponse(BaseModel):
    ok: bool
    user: dict = {}


@router.get("/status", response_model=SetupStatusResponse)
def setup_status():
    """检查是否需要初始化"""
    try:
        # 测试数据库连接
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
            # 检查是否存在至少一个管理员用户
            admin = session.exec(select(User).where(User.is_admin == True)).first()
            if admin:
                return SetupStatusResponse(needs_setup=False, db_ok=True, message="系统已初始化")
            return SetupStatusResponse(needs_setup=True, db_ok=True, message="需要创建管理员用户")
    except Exception as e:
        return SetupStatusResponse(needs_setup=True, db_ok=False, message=f"数据库连接失败: {str(e)}")


@router.post("/test-db", response_model=TestDbResponse)
def test_db(req: TestDbRequest):
    """测试数据库连接是否可用"""
    try:
        test_engine = sm_create_engine(req.db_url, echo=False)
        with Session(test_engine) as session:
            session.exec(text("SELECT 1"))
        return TestDbResponse(ok=True)
    except Exception as e:
        return TestDbResponse(ok=False, error=str(e))


@router.post("/initialize", response_model=InitializeResponse)
def initialize(req: InitializeRequest):
    """初始化系统：创建管理员用户和默认数据"""
    import traceback
    import logging
    logger = logging.getLogger("setup")

    try:
        # 检查是否已经初始化
        with Session(engine) as session:
            existing_admin = session.exec(select(User).where(User.is_admin == True)).first()
            if existing_admin:
                raise HTTPException(status_code=400, detail="系统已初始化，请直接登录")

        # 创建管理员用户
        from passlib.context import CryptContext
        pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

        with Session(engine) as session:
            # 检查用户名是否已存在
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

            # 初始化默认字段选项（如果不存在）
            _init_default_options(session)

            return InitializeResponse(
                ok=True,
                user={
                    "id": admin.id,
                    "username": admin.username,
                    "name": admin.name,
                    "is_admin": admin.is_admin,
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"初始化失败: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"初始化失败: {str(e)}")


def _init_default_options(session):
    """初始化默认字段选项（仅当不存在时）"""
    existing = session.exec(select(FieldOption)).first()
    if existing:
        return

    defaults = {
        "industry": ["互联网", "金融", "教育", "医疗", "制造业", "零售", "房地产", "能源", "物流", "其他"],
        "sales_person": ["张三", "李四", "王五"],
        "project_status": ["进行中", "已完成", "暂停", "已取消", "待启动"],
        "cloud": ["阿里云", "腾讯云", "华为云", "AWS", "Azure", "GCP", "私有部署", "其他"],
    }
    for category, values in defaults.items():
        for i, val in enumerate(values):
            session.add(FieldOption(category=category, value=val, sort_order=i))
    session.commit()
