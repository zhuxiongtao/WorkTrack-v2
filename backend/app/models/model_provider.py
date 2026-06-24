from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlalchemy import Column, JSON
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
    # Vertex AI / GCP 专用字段
    project_id: Optional[str] = Field(default=None)  # GCP 项目 ID
    location: Optional[str] = Field(default=None)  # GCP 区域，如 us-central1
    gcp_label_team: Optional[str] = Field(default=None)  # GCP 账单标签：team
    gcp_label_app: Optional[str] = Field(default=None)   # GCP 账单标签：app
    gcp_label_env: Optional[str] = Field(default=None)   # GCP 账单标签：environment
    created_at: datetime = Field(default_factory=lambda: now())
    # 关联的模型列表
    models_rel: list["ProviderModel"] = Relationship(back_populates="provider", sa_relationship_kwargs={"cascade": "all, delete-orphan"})


class ProviderModel(SQLModel, table=True):
    """供应商下的具体模型配置（含默认参数 + 能力标签）"""
    id: Optional[int] = Field(default=None, primary_key=True)
    provider_id: int = Field(foreign_key="modelprovider.id", index=True)
    model_name: str  # 模型名称，如 deepseek-chat
    model_type: str = "chat"  # 主类型（向后兼容，详见 supported_task_types）
    # P1 多模态支持：JSON 数组字符串，列出该模型可执行的所有 task_type
    # 例：Gemini 3 flash → '["chat","vision"]'，whisper-1 → '["speech_to_text"]'
    # 实际为 PG JSON 列，序列化在 router 层完成
    supported_task_types: Optional[str] = Field(
        default=None,
        sa_column=Column("supported_task_types", JSON),
    )
    created_at: datetime = Field(default_factory=lambda: now())

    # ===== P0: 模型默认参数 =====
    # 基础采样
    default_temperature: Optional[float] = Field(default=None)         # 0.0 - 2.0
    default_top_p: Optional[float] = Field(default=None)                # 0.0 - 1.0
    default_max_tokens: Optional[int] = Field(default=None)             # 单次最大输出 token
    default_frequency_penalty: Optional[float] = Field(default=None)   # -2.0 - 2.0
    default_presence_penalty: Optional[float] = Field(default=None)    # -2.0 - 2.0
    default_stop: Optional[str] = Field(default=None)                  # JSON 数组字符串

    # 思考 / 推理（兼容 o-series / Gemini thinking / Claude extended_thinking / DeepSeek R1）
    default_thinking_mode: Optional[str] = Field(default=None)         # off / low / medium / high / auto
    default_thinking_budget: Optional[int] = Field(default=None)       # token 数

    # 输出控制
    default_response_format: Optional[str] = Field(default=None)       # text / json_object / json_schema
    default_json_schema: Optional[str] = Field(default=None)           # JSON Schema 字符串

    # 能力标签（自动推断 + 手动覆盖）
    context_window: Optional[int] = Field(default=None)                # 上下文窗口 token 数
    supports_streaming: Optional[bool] = Field(default=True)           # 默认 True
    supports_function_calling: Optional[bool] = Field(default=False)
    supports_vision: Optional[bool] = Field(default=False)
    supports_json_mode: Optional[bool] = Field(default=False)
    supports_thinking: Optional[bool] = Field(default=False)
    supports_system_prompt: Optional[bool] = Field(default=True)

    # 元数据
    extra_params_json: Optional[str] = Field(default=None)             # 厂商专属参数 JSON
    description: Optional[str] = Field(default=None)
    tags: Optional[str] = Field(default=None)                            # 逗号分隔

    provider: ModelProvider = Relationship(back_populates="models_rel")


class TaskModelConfig(SQLModel, table=True):
    """任务-模型映射配置（含任务级参数覆盖）"""
    id: Optional[int] = Field(default=None, primary_key=True)
    task_type: str = Field(index=True)  # chat / embedding / vision / speech_to_text / web_search
    provider_id: Optional[int] = Field(default=None, foreign_key="modelprovider.id")
    model_name: str = ""
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)  # NULL=平台共享

    # ===== P0: 任务级参数覆盖（None 表示继承模型默认） =====
    override_temperature: Optional[float] = Field(default=None)
    override_top_p: Optional[float] = Field(default=None)
    override_max_tokens: Optional[int] = Field(default=None)
    override_frequency_penalty: Optional[float] = Field(default=None)
    override_presence_penalty: Optional[float] = Field(default=None)
    override_stop: Optional[str] = Field(default=None)                 # JSON 数组字符串

    # 思考 / 推理
    override_thinking_mode: Optional[str] = Field(default=None)
    override_thinking_budget: Optional[int] = Field(default=None)

    # 输出控制
    override_response_format: Optional[str] = Field(default=None)
    override_json_schema: Optional[str] = Field(default=None)
    override_extra_params_json: Optional[str] = Field(default=None)    # 厂商专属参数 JSON

    # 预设引用
    preset_id: Optional[int] = Field(default=None, foreign_key="modelparampreset.id")  # 可选：引用预设模板

    required_capabilities: Optional[str] = Field(
        default=None,
        sa_column=Column("required_capabilities", JSON),
    )


class ModelParamPreset(SQLModel, table=True):
    """参数预设模板（可复用到多个模型/任务）"""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: str = ""
    # 平台预设 vs 个人预设
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)  # NULL=平台预设
    is_system: bool = Field(default=False)                             # 系统内置标记（不可删）

    # 采样参数
    temperature: Optional[float] = Field(default=None)
    top_p: Optional[float] = Field(default=None)
    max_tokens: Optional[int] = Field(default=None)
    frequency_penalty: Optional[float] = Field(default=None)
    presence_penalty: Optional[float] = Field(default=None)
    stop: Optional[str] = Field(default=None)                          # JSON 数组字符串

    # 思考 / 推理
    thinking_mode: Optional[str] = Field(default=None)
    thinking_budget: Optional[int] = Field(default=None)

    # 输出控制
    response_format: Optional[str] = Field(default=None)
    json_schema: Optional[str] = Field(default=None)
    extra_params_json: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
