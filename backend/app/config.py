import secrets
import warnings
from pydantic_settings import BaseSettings
from pathlib import Path
import os

# 把 backend/.env 内容同步注入到 os.environ，
# 这样 pydantic-settings 读取后，下游的 os.getenv("DATABASE_URL") 也能拿到，
# 避免启动时反复弹“默认凭据”告警
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path, override=False)
except Exception:
    pass


class Settings(BaseSettings):
    # 对话模型配置
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: str = ""
    llm_model_name: str = "deepseek-chat"

    # Embedding 模型配置（默认复用对话模型配置）
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model_name: str = "text-embedding-3-small"

    # ===== 统一存储根目录 =====
    # 所有持久化文件（数据、上传、音频、向量、头像、品牌等）均在此目录下
    # 生产环境建议设置 DATA_ROOT 环境变量指向持久化卷路径（如 /app/data）
    data_root: str = ""

    # 数据库连接（默认使用本地 PostgreSQL，生产环境务必通过 DATABASE_URL 环境变量覆盖）
    database_url: str = "postgresql://worktrack:worktrack@localhost:5432/worktrack"

    # JWT（未设置时自动生成随机密钥并发出警告，生产环境务必设置 JWT_SECRET_KEY）
    jwt_secret_key: str = ""

    # 安全配置
    allow_registration: bool = False
    cors_origins: str = "http://localhost:5173"
    login_max_attempts: int = 5
    login_lockout_minutes: int = 30
    password_min_length: int = 8

    # 是否在首次启动时自动创建默认管理员（本地开发 True，Docker 生产 False）
    auto_create_admin: bool = True

    # 默认管理员密码（仅 auto_create_admin=True 时使用；未设置则自动生成随机密码并打印到日志）
    admin_password: str = ""

    # Tavily 搜索 API Key（兜底用，优先使用系统偏好设置）
    tavily_api_key: str = ""

    # 头像存储目录（留空则自动推导，可通过 AVATAR_DIR 环境变量覆盖）
    avatar_dir: str = ""

    @property
    def effective_data_root(self) -> str:
        """统一存储根目录，默认为 backend/ 目录下的 data"""
        if self.data_root:
            return self.data_root
        return str(Path(__file__).resolve().parent.parent / "data")

    @property
    def effective_chroma_dir(self) -> str:
        return os.path.join(self.effective_data_root, "chroma")

    @property
    def effective_audio_dir(self) -> str:
        return os.path.join(self.effective_data_root, "audio")

    @property
    def effective_avatar_dir(self) -> str:
        if self.avatar_dir:
            return self.avatar_dir
        return os.path.join(self.effective_data_root, "avatars")

    @property
    def effective_files_dir(self) -> str:
        return os.path.join(self.effective_data_root, "files")

    @property
    def effective_brand_dir(self) -> str:
        return os.path.join(self.effective_data_root, "brand")

    @property
    def effective_uploads_dir(self) -> str:
        return str(Path(__file__).resolve().parent.parent / "uploads")

    @property
    def effective_contracts_dir(self) -> str:
        return os.path.join(self.effective_uploads_dir, "contracts")

    @property
    def effective_embedding_base_url(self) -> str:
        return self.embedding_base_url or self.llm_base_url

    @property
    def effective_embedding_api_key(self) -> str:
        return self.embedding_api_key or self.llm_api_key

    def validate_security(self) -> None:
        """启动时校验安全配置，生产环境下关键密钥未设置时发出强烈警告"""
        if not self.jwt_secret_key or self.jwt_secret_key == "change-me-in-production":
            self.jwt_secret_key = secrets.token_urlsafe(32)
            warnings.warn(
                "⚠️  JWT_SECRET_KEY 未设置，已自动生成随机密钥。重启后已有 Token 将失效！"
                "生产环境请务必设置 JWT_SECRET_KEY 环境变量。"
                "建议使用: python -c \"import secrets; print(secrets.token_urlsafe(32))\"",
                stacklevel=2,
            )
        if "worktrack:worktrack" in self.database_url and os.getenv("DATABASE_URL") is None:
            warnings.warn(
                "⚠️  使用默认数据库凭据（worktrack:worktrack），这是严重安全隐患！"
                "生产环境请务必通过 DATABASE_URL 环境变量设置安全的连接串。",
                stacklevel=2,
            )
        if self.cors_origins == "*":
            warnings.warn(
                "⚠️  CORS_ORIGINS 设置为 *（允许所有来源），存在跨域安全风险！"
                "生产环境请设置具体的域名，如: https://your-domain.com",
                stacklevel=2,
            )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
settings.validate_security()
