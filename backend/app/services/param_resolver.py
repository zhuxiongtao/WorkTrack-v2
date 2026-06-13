"""
参数分级解析器（P0）

层级优先级（从高到低）：
  1. func_overrides  - 函数内硬编码（最强，例如 meeting_extract 强制 json_object）
  2. preset 字段     - TaskModelConfig.preset_id 引用的预设模板
  3. task override  - TaskModelConfig.override_*（业务级覆盖）
  4. model default  - ProviderModel.default_*（模型出厂默认）
  5. 兜底           - 函数内硬编码默认（如 temperature=0.7）

返回的 dict 是"实际生效的最终参数"，调用方在创建 chat completion 时直接展开。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlmodel import Session

from app.models.model_provider import (
    ModelProvider,
    ModelParamPreset,
    ProviderModel,
    TaskModelConfig,
)

logger = logging.getLogger("worktrack")


# ===== 思考档位映射 =====
# 不同厂商的"思考档位"命名不同，统一抽象为 5 档
THINKING_MODE_VALUES = ("off", "low", "medium", "high", "auto")
RESPONSE_FORMAT_VALUES = ("text", "json_object", "json_schema")


def _safe_json_loads(value: str | None, default):
    """解析 JSON 字符串字段，失败时返回 default"""
    if not value:
        return default
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return default


def _load_preset(db: Session, preset_id: int | None) -> ModelParamPreset | None:
    """加载预设模板（如有）"""
    if not preset_id:
        return None
    try:
        return db.get(ModelParamPreset, preset_id)
    except Exception as e:
        logger.warning("加载预设失败 preset_id=%s: %s", preset_id, e)
        return None


def resolve_chat_params(
    db: Session,
    *,
    model: ProviderModel | None = None,
    task_cfg: TaskModelConfig | None = None,
    func_overrides: dict[str, Any] | None = None,
    func_defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    解析 chat 调用的最终参数。

    Args:
        db: 数据库会话（用于加载 preset）
        model: ProviderModel 实例（可选）
        task_cfg: TaskModelConfig 实例（可选）
        func_overrides: 函数级"硬约束"（最高优先级，强制压过一切）
            常用键: response_format, extra_body, stream
            如: {"response_format": "json_object"}  # 强制 JSON 输出
        func_defaults: 函数级"软默认"（最低优先级，仅在 L1-L4 都未配置时生效）
            常用键: temperature, max_tokens
            如: {"temperature": 0.3}  # 业务建议温度，但允许用户配置覆盖

    Returns:
        dict: 最终生效的参数字典
            - temperature: float
            - top_p: float | None
            - max_tokens: int | None
            - response_format: dict | None
            - thinking_mode: str | None
            - thinking_budget: int | None
            - frequency_penalty: float | None
            - presence_penalty: float | None
            - stop: list[str] | None
            - extra_body: dict | None
    """
    func_overrides = func_overrides or {}
    func_defaults = func_defaults or {}
    preset = _load_preset(db, task_cfg.preset_id) if (db and task_cfg) else None

    result: dict[str, Any] = {}

    # ---------- L5 函数内软默认（最低优先级） ----------
    for k, v in func_defaults.items():
        if v is not None:
            result[k] = v

    # ---------- L2 模型默认 ----------
    if model is not None:
        if model.default_temperature is not None:
            result["temperature"] = model.default_temperature
        if model.default_top_p is not None:
            result["top_p"] = model.default_top_p
        if model.default_max_tokens is not None:
            result["max_tokens"] = model.default_max_tokens
        if model.default_frequency_penalty is not None:
            result["frequency_penalty"] = model.default_frequency_penalty
        if model.default_presence_penalty is not None:
            result["presence_penalty"] = model.default_presence_penalty
        if model.default_thinking_mode is not None:
            result["thinking_mode"] = model.default_thinking_mode
        if model.default_thinking_budget is not None:
            result["thinking_budget"] = model.default_thinking_budget
        if model.default_response_format is not None:
            result["response_format_type"] = model.default_response_format
            result["response_format"] = _format_to_openai(model.default_response_format, model.default_json_schema)
        if model.default_stop is not None:
            result["stop"] = _safe_json_loads(model.default_stop, None)
        model_extra = _safe_json_loads(model.extra_params_json, None)
        if model_extra:
            result["extra_body"] = dict(model_extra)

    # ---------- L3.5 预设覆盖 ----------
    if preset is not None:
        if preset.temperature is not None:
            result["temperature"] = preset.temperature
        if preset.top_p is not None:
            result["top_p"] = preset.top_p
        if preset.max_tokens is not None:
            result["max_tokens"] = preset.max_tokens
        if preset.frequency_penalty is not None:
            result["frequency_penalty"] = preset.frequency_penalty
        if preset.presence_penalty is not None:
            result["presence_penalty"] = preset.presence_penalty
        if preset.thinking_mode is not None:
            result["thinking_mode"] = preset.thinking_mode
        if preset.thinking_budget is not None:
            result["thinking_budget"] = preset.thinking_budget
        if preset.response_format is not None:
            result["response_format_type"] = preset.response_format
            result["response_format"] = _format_to_openai(preset.response_format, preset.json_schema)
        if preset.stop is not None:
            result["stop"] = _safe_json_loads(preset.stop, None)
        preset_extra = _safe_json_loads(preset.extra_params_json, None)
        if preset_extra:
            result["extra_body"] = {**(result.get("extra_body") or {}), **preset_extra}

    # ---------- L3 任务覆盖 ----------
    if task_cfg is not None:
        if task_cfg.override_temperature is not None:
            result["temperature"] = task_cfg.override_temperature
        if task_cfg.override_top_p is not None:
            result["top_p"] = task_cfg.override_top_p
        if task_cfg.override_max_tokens is not None:
            result["max_tokens"] = task_cfg.override_max_tokens
        if task_cfg.override_frequency_penalty is not None:
            result["frequency_penalty"] = task_cfg.override_frequency_penalty
        if task_cfg.override_presence_penalty is not None:
            result["presence_penalty"] = task_cfg.override_presence_penalty
        if task_cfg.override_thinking_mode is not None:
            result["thinking_mode"] = task_cfg.override_thinking_mode
        if task_cfg.override_thinking_budget is not None:
            result["thinking_budget"] = task_cfg.override_thinking_budget
        if task_cfg.override_response_format is not None:
            result["response_format_type"] = task_cfg.override_response_format
            result["response_format"] = _format_to_openai(task_cfg.override_response_format, task_cfg.override_json_schema)
        if task_cfg.override_stop is not None:
            result["stop"] = _safe_json_loads(task_cfg.override_stop, None)
        task_extra = _safe_json_loads(task_cfg.override_extra_params_json, None)
        if task_extra:
            result["extra_body"] = {**(result.get("extra_body") or {}), **task_extra}

    # ---------- L1 函数内硬约束（最高优先级） ----------
    for k, v in func_overrides.items():
        if v is not None:
            if k == "response_format" and isinstance(v, str):
                result["response_format_type"] = v
                result["response_format"] = _format_to_openai(v, result.get("response_format_schema"))
            else:
                result[k] = v

    # 辅助字段（resolver 内部用，OpenAI/Gemini/Vertex SDK 不认识，必须剔除）
    _AUX_KEYS = {"response_format_type", "thinking_mode", "thinking_budget"}
    return {
        k: v for k, v in result.items()
        if v is not None and v != "" and k not in _AUX_KEYS
    }


def _format_to_openai(format_type: str, schema: str | None) -> dict | None:
    """将存储的简化格式转为 OpenAI response_format 字段"""
    if not format_type or format_type == "text":
        return None
    if format_type == "json_object":
        return {"type": "json_object"}
    if format_type == "json_schema":
        try:
            parsed = json.loads(schema) if schema else None
        except (ValueError, TypeError):
            parsed = None
        if parsed:
            return {"type": "json_schema", "json_schema": parsed}
        return {"type": "json_object"}
    return None


def get_model_capabilities(model: ProviderModel | None) -> dict[str, Any]:
    """
    提取模型能力标签（合并模型表配置 + 名称启发式推断）

    用于：
    - 前端 UI 展示
    - ai_service 自动判断能否使用某种调用方式（如 thinking、function calling）
    """
    caps = {
        "supports_streaming": True,
        "supports_function_calling": False,
        "supports_vision": False,
        "supports_json_mode": False,
        "supports_thinking": False,
        "supports_system_prompt": True,
        "context_window": None,
    }
    if not model:
        return caps
    # 用表里配置（如果显式设了）
    if model.supports_streaming is not None:
        caps["supports_streaming"] = bool(model.supports_streaming)
    if model.supports_function_calling is not None:
        caps["supports_function_calling"] = bool(model.supports_function_calling)
    if model.supports_vision is not None:
        caps["supports_vision"] = bool(model.supports_vision)
    if model.supports_json_mode is not None:
        caps["supports_json_mode"] = bool(model.supports_json_mode)
    if model.supports_thinking is not None:
        caps["supports_thinking"] = bool(model.supports_thinking)
    if model.supports_system_prompt is not None:
        caps["supports_system_prompt"] = bool(model.supports_system_prompt)
    if model.context_window is not None:
        caps["context_window"] = int(model.context_window)
    return caps


def detect_capabilities_from_name(model_name: str) -> dict[str, Any]:
    """
    根据模型名启发式推断能力（用于 fetch-models 时自动填充）
    仅返回未在表中显式配置时的兜底建议。
    """
    low = model_name.lower()
    caps = {
        "supports_function_calling": False,
        "supports_vision": False,
        "supports_json_mode": True,  # 现代 chat 模型基本都支持
        "supports_thinking": False,
    }
    # 函数调用
    if any(k in low for k in ["gpt-4", "gpt-3.5", "claude-3", "claude-4", "gemini", "deepseek", "qwen", "glm-4", "mimo", "mistral"]):
        caps["supports_function_calling"] = True
    # 视觉
    vision_kw = ["vision", "vl-", "gpt-4o", "gpt-4-vision", "claude-3", "claude-4",
                 "qwen-vl", "qwen2-vl", "glm-4v", "internvl", "gemini-2.5", "gemini-2.0",
                 "gemini-1.5", "minicpm-v", "ocr", "llava", "yi-vl", "cogvlm", "pixtral"]
    if any(k in low for k in vision_kw):
        caps["supports_vision"] = True
    # 思考
    thinking_kw = ["o1", "o3", "o4", "deepseek-r1", "qwq", "reasoner", "thinking",
                   "gemini-2.5", "exp-1206", "exp-1127"]
    if any(k in low for k in thinking_kw):
        caps["supports_thinking"] = True
    return caps
