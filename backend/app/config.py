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

    # 运行环境：development | production
    # production 下关键密钥缺失/使用默认值将直接拒绝启动（见 validate_security）
    app_env: str = "development"

    # 安全配置
    allow_registration: bool = False
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://10.10.10.12:5173"
    login_max_attempts: int = 5
    login_lockout_minutes: int = 30
    password_min_length: int = 8

    # 是否在首次启动时自动创建默认管理员（本地开发 True，Docker 生产 False）
    auto_create_admin: bool = True

    # 默认管理员密码（仅 auto_create_admin=True 时使用；未设置则自动生成随机密码并打印到日志）
    admin_password: str = ""

    # 前端地址（用于邮件等场景拼接完整链接）
    frontend_url: str = ""

    # Tavily 搜索 API Key（兜底用，优先使用系统偏好设置）
    tavily_api_key: str = ""

    # 头像存储目录（留空则自动推导，可通过 AVATAR_DIR 环境变量覆盖）
    avatar_dir: str = ""

    # AI 对话历史保留策略
    # 超过 retention_days 天未更新的对话自动删除（0 = 永不按时间删除）
    ai_chat_retention_days: int = 30
    # 每个用户最多保留的消息条数（user + assistant 合计），超出后删除最旧的对话（0 = 不限）
    ai_chat_max_messages_per_user: int = 200

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

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() in ("production", "prod")

    def validate_security(self) -> None:
        """启动时校验安全配置。

        - 生产环境（APP_ENV=production）：关键密钥缺失/使用默认值直接抛错拒绝启动，
          避免带病上线（弱凭据、可伪造 Token、跨域全开）。
        - 非生产环境：保持「自动生成随机密钥 + 告警」的开发友好行为。
        """
        jwt_missing = (not self.jwt_secret_key) or self.jwt_secret_key == "change-me-in-production"
        db_default = "worktrack:worktrack" in self.database_url and os.getenv("DATABASE_URL") is None
        cors_wildcard = self.cors_origins == "*"

        if self.is_production:
            # 仅对真正致命的两项硬失败（弱凭据/可伪造 Token），避免误伤现有部署
            problems = []
            if jwt_missing:
                problems.append(
                    "JWT_SECRET_KEY 未设置（生产环境必须显式配置稳定密钥；缺失会导致重启即登出，且自动生成的密钥存在被推断/伪造风险）"
                )
            if db_default:
                problems.append(
                    "使用默认数据库凭据 worktrack:worktrack（生产环境必须通过 DATABASE_URL 或 DB_PASSWORD 设置安全凭据）"
                )
            if problems:
                raise RuntimeError(
                    "❌ 生产环境（APP_ENV=production）安全配置校验未通过，已拒绝启动：\n  - "
                    + "\n  - ".join(problems)
                    + "\n请在环境变量/.env 中补全后重启。"
                )
            # CORS 通配仅告警（与 credentials 的组合已在 main.py 处理），不阻断启动
            if cors_wildcard:
                warnings.warn(
                    "⚠️  生产环境 CORS_ORIGINS=*（允许所有来源），建议改为具体域名以收紧跨域。",
                    stacklevel=2,
                )
            return

        # ===== 非生产环境：自动兜底 + 告警 =====
        if jwt_missing:
            self.jwt_secret_key = secrets.token_urlsafe(32)
            warnings.warn(
                "⚠️  JWT_SECRET_KEY 未设置，已自动生成随机密钥。重启后已有 Token 将失效！"
                "生产环境请务必设置 JWT_SECRET_KEY 环境变量。"
                "建议使用: python -c \"import secrets; print(secrets.token_urlsafe(32))\"",
                stacklevel=2,
            )
        if db_default:
            warnings.warn(
                "⚠️  使用默认数据库凭据（worktrack:worktrack），这是严重安全隐患！"
                "生产环境请务必通过 DATABASE_URL 环境变量设置安全的连接串。",
                stacklevel=2,
            )
        if cors_wildcard:
            warnings.warn(
                "⚠️  CORS_ORIGINS 设置为 *（允许所有来源），存在跨域安全风险！"
                "生产环境请设置具体的域名，如: https://your-domain.com",
                stacklevel=2,
            )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
settings.validate_security()
