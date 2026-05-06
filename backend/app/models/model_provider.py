from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field, Relationship


class ModelProvider(SQLModel, table=True):
    """AI 模型供应商配置"""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    base_url: str
    api_key: str = ""
    is_active: bool = True
    provider_type: str = "chat"
    models: str = ""  # 已弃用，保留用于兼容旧表结构
    default_model: str = ""  # 已弃用，保留用于兼容旧表结构
    supported_models_json: str = ""  # API自动拉取的模型JSON缓存
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)  # NULL=平台共享
    created_at: datetime = Field(default_factory=datetime.now)
    # 关联的模型列表
    models_rel: list["ProviderModel"] = Relationship(back_populates="provider", sa_relationship_kwargs={"cascade": "all, delete-orphan"})


class ProviderModel(SQLModel, table=True):
    """供应商下的具体模型配置"""
    id: Optional[int] = Field(default=None, primary_key=True)
    provider_id: int = Field(foreign_key="modelprovider.id", index=True)
    model_name: str  # 模型名称，如 deepseek-chat
    model_type: str = "chat"  # chat / embedding / speech_to_text / vision
    created_at: datetime = Field(default_factory=datetime.now)
    provider: ModelProvider = Relationship(back_populates="models_rel")


class TaskModelConfig(SQLModel, table=True):
    """任务-模型映射配置"""
    id: Optional[int] = Field(default=None, primary_key=True)
    task_type: str = Field(index=True)  # chat / embedding / vision / speech_to_text / web_search
    provider_id: Optional[int] = Field(default=None, foreign_key="modelprovider.id")
    model_name: str = ""
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)  # NULL=平台共享
