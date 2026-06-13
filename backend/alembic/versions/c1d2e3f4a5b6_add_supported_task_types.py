"""add_supported_task_types_to_providermodel

P1 多模态支持：
- ProviderModel.supported_task_types: JSON 数组，列出该模型可执行的 task_type
- 解决原 model_type 单选枚举无法表达多模态模型（如 Gemini 3.0 flash 同时是 chat + vision）
- 数据迁移：用 model_type + 模型名推断回填

Revision ID: c1d2e3f4a5b6
Revises: b9c8d7e6f5a4
Create Date: 2026-06-04 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import json


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, tuple, None] = 'b9c8d7e6f5a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 多模态关键词（从 settings.py 镜像）
MULTIMODAL_VISION_KEYWORDS = [
    "vision", "vl-", "image", "ocr", "video", "kolors", "wan-",
    "gemini",
    "gpt-4o", "gpt-4-turbo", "gpt-4-vision",
    "claude-3", "claude-4",
    "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qvq",
    "glm-4v", "glm-4.1v", "glm-4.5v",
    "internvl", "minicpm-v", "mimo-v2-omni",
    "doubao-1.5-vision", "doubao-vision",
    "step-1v", "step-1o", "yi-vision", "yi-vl",
]
SPEECH_KEYWORDS = ["asr", "speech", "transcribe", "whisper", "transcriber", "parakeet", "sensevoice"]
EMBEDDING_KEYWORDS = ["embed", "bge-", "bce-", "m3e-", "bge-m3"]


def infer_supported_task_types(name: str) -> list:
    low = (name or "").lower()
    if not low:
        return ["chat"]
    if any(k in low for k in EMBEDDING_KEYWORDS):
        return ["embedding"]
    if any(k in low for k in SPEECH_KEYWORDS):
        return ["speech_to_text"]
    has_vision = any(k in low for k in MULTIMODAL_VISION_KEYWORDS)
    types = ["chat"]
    if has_vision:
        types.append("vision")
    return types


def backward_compat_task_types(model_type: str, model_name: str) -> list:
    if model_type == "vision":
        return ["chat", "vision"]
    if model_type == "speech_to_text":
        return ["speech_to_text"]
    if model_type == "embedding":
        return ["embedding"]
    if model_type == "web_search":
        return ["chat"]
    return infer_supported_task_types(model_name)


def upgrade() -> None:
    # 1) 加列
    op.add_column(
        'providermodel',
        sa.Column('supported_task_types', sa.JSON(), nullable=True),
    )
    # 2) 回填已有数据
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, model_name, model_type, supported_task_types FROM providermodel")).fetchall()
    for r in rows:
        if r.supported_task_types:
            continue  # 已填过
        types = backward_compat_task_types(r.model_type, r.model_name)
        bind.execute(
            sa.text("UPDATE providermodel SET supported_task_types = :t WHERE id = :id"),
            {"t": json.dumps(types), "id": r.id},
        )


def downgrade() -> None:
    op.drop_column('providermodel', 'supported_task_types')
