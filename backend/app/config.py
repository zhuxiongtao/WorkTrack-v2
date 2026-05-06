from pydantic_settings import BaseSettings
import os


class Settings(BaseSettings):
    # 对话模型配置
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: str = ""
    llm_model_name: str = "deepseek-chat"

    # Embedding 模型配置（默认复用对话模型配置）
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model_name: str = "text-embedding-3-small"

    # Chroma 持久化目录
    chroma_persist_dir: str = "./data/chroma"

    # 数据库连接（默认使用本地 PostgreSQL）
    database_url: str = "postgresql://worktrack:worktrack@localhost:5432/worktrack"

    # JWT
    jwt_secret_key: str = "change-me-in-production"

    # 安全配置
    allow_registration: bool = False
    cors_origins: str = "http://localhost:5173"
    login_max_attempts: int = 5
    login_lockout_minutes: int = 30
    password_min_length: int = 8

    # 是否在首次启动时自动创建默认管理员（本地开发 True，Docker 生产 False）
    auto_create_admin: bool = True

    # Tavily 搜索 API Key（兜底用，优先使用系统偏好设置）
    tavily_api_key: str = ""

    @property
    def effective_embedding_base_url(self) -> str:
        return self.embedding_base_url or self.llm_base_url

    @property
    def effective_embedding_api_key(self) -> str:
        return self.embedding_api_key or self.llm_api_key

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
