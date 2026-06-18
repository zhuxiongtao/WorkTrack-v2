from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, or_, func
from pydantic import BaseModel
from app.database import get_session
from app.models.model_provider import ModelProvider, TaskModelConfig, ProviderModel, ModelParamPreset
from app.models.field_option import FieldOption
from app.models.system_preference import SystemPreference
from app.models.ai_prompt import AIPrompt
from app.models.user import User
from app.auth import get_current_user, require_permission, has_permission
from app.services.ai_service import _extract_message_text, _get_active_provider, _get_client
from app.config import settings as app_settings

import os
import json
import time
from datetime import datetime, timezone

router = APIRouter(prefix="/api/v1/settings", tags=["设置"])


def _get_visible_providers_query(db: Session, user: User | None):
    """返回当前用户可见的供应商查询条件（RBAC + 旧字段兼容）"""
    if user is None:
        return select(ModelProvider).where(ModelProvider.user_id == None)
    # 管理员或拥有 ai:manage_shared 权限 → 全部可见
    if has_permission(user, "ai:manage_shared", db):
        return select(ModelProvider)
    conditions = []
    # 可使用共享供应商（ai:use）
    if has_permission(user, "ai:use", db):
        conditions.append(ModelProvider.user_id == None)
    # 可管理自有供应商（ai:manage_own）
    if has_permission(user, "ai:manage_own", db):
        conditions.append(ModelProvider.user_id == user.id)
    if not conditions:
        return select(ModelProvider).where(ModelProvider.id == -1)
    return select(ModelProvider).where(or_(*conditions))


def _check_provider_access(provider: ModelProvider, user: User | None, db: Session | None = None) -> bool:
    """检查用户是否有权限访问某个供应商（RBAC + 旧字段兼容）"""
    if user is None:
        return False
    # 管理员或 ai:manage_shared → 全部可访问
    if has_permission(user, "ai:manage_shared", db):
        return True
    # 自有供应商 → ai:manage_own
    if provider.user_id == user.id and has_permission(user, "ai:manage_own", db):
        return True
    # 共享供应商 → ai:use
    if provider.user_id is None and has_permission(user, "ai:use", db):
        return True
    return False


class ProviderCreate(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    is_active: bool = True
    provider_type: str = "chat"
    project_id: Optional[str] = None  # Vertex AI: GCP 项目 ID
    location: Optional[str] = None  # Vertex AI: GCP 区域


class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    is_active: Optional[bool] = None
    provider_type: Optional[str] = None
    project_id: Optional[str] = None  # Vertex AI: GCP 项目 ID
    location: Optional[str] = None  # Vertex AI: GCP 区域


# ===== 模型供应商 CRUD =====
@router.get("/providers")
def list_providers(db: Session = Depends(get_session),
                   current_user: User = Depends(get_current_user)):
    query = _get_visible_providers_query(db, current_user)
    providers = db.exec(query.order_by(ModelProvider.created_at.desc())).all()
    for p in providers:
        if p.api_key:
            p.api_key = p.api_key[:4] + "****" + p.api_key[-4:] if len(p.api_key) > 8 else "****"
    return providers


@router.post("/providers", status_code=201)
def create_provider(data: ProviderCreate, db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    if not has_permission(current_user, "ai:manage_own", db) and not has_permission(current_user, "ai:manage_shared", db):
        raise HTTPException(status_code=403, detail="无权限创建模型供应商")
    provider = ModelProvider(**data.model_dump())
    # 非管理员（无 manage_shared）→ 强制归属自己
    if not has_permission(current_user, "ai:manage_shared", db):
        provider.user_id = current_user.id
    db.add(provider)
    db.commit()
    db.refresh(provider)
    if provider.api_key:
        provider.api_key = provider.api_key[:4] + "****" + provider.api_key[-4:] if len(provider.api_key) > 8 else "****"
    return provider


@router.put("/providers/{provider_id}")
def update_provider(provider_id: int, data: ProviderUpdate, db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限修改此供应商")
    # 非 ai:manage_shared 只能修改自己的供应商
    if not has_permission(current_user, "ai:manage_shared", db) and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能修改自己的供应商")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(provider, key, value)
    db.add(provider)
    db.commit()
    db.refresh(provider)
    if provider.api_key:
        provider.api_key = provider.api_key[:4] + "****" + provider.api_key[-4:] if len(provider.api_key) > 8 else "****"
    return provider


@router.delete("/providers/{provider_id}", status_code=204)
def delete_provider(provider_id: int, db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限删除此供应商")
    if not has_permission(current_user, "ai:manage_shared", db) and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除自己的供应商")
    # 先清理引用该供应商的 TaskModelConfig
    task_cfgs = db.exec(
        select(TaskModelConfig).where(TaskModelConfig.provider_id == provider_id)
    ).all()
    for cfg in task_cfgs:
        db.delete(cfg)
    db.flush()
    db.delete(provider)
    db.commit()


# ===== 供应商模型 CRUD =====

# 完整的模型参数字段（创建/更新共用）
_MODEL_PARAM_FIELDS = {
    # 基础采样
    "default_temperature": (Optional[float], None),
    "default_top_p": (Optional[float], None),
    "default_max_tokens": (Optional[int], None),
    "default_frequency_penalty": (Optional[float], None),
    "default_presence_penalty": (Optional[float], None),
    "default_stop": (Optional[str], None),
    # 思考 / 推理
    "default_thinking_mode": (Optional[str], None),
    "default_thinking_budget": (Optional[int], None),
    # 输出控制
    "default_response_format": (Optional[str], None),
    "default_json_schema": (Optional[str], None),
    # 能力标签
    "context_window": (Optional[int], None),
    "supports_streaming": (Optional[bool], None),
    "supports_function_calling": (Optional[bool], None),
    "supports_vision": (Optional[bool], None),
    "supports_json_mode": (Optional[bool], None),
    "supports_thinking": (Optional[bool], None),
    "supports_system_prompt": (Optional[bool], None),
    # 元数据
    "extra_params_json": (Optional[str], None),
    "description": (Optional[str], None),
    "tags": (Optional[str], None),
}


class ModelAdd(BaseModel):
    model_name: str
    model_type: str = "chat"
    # P1 多模态：列出该模型可执行的所有 task_type
    # 留空则按 model_name 自动推断（chat 兜底 + vision 关键词 → 加 vision）
    supported_task_types: Optional[list[str]] = None
    # 默认参数（全部可选，向后兼容老接口）
    default_temperature: Optional[float] = None
    default_top_p: Optional[float] = None
    default_max_tokens: Optional[int] = None
    default_frequency_penalty: Optional[float] = None
    default_presence_penalty: Optional[float] = None
    default_stop: Optional[str] = None
    default_thinking_mode: Optional[str] = None
    default_thinking_budget: Optional[int] = None
    default_response_format: Optional[str] = None
    default_json_schema: Optional[str] = None
    context_window: Optional[int] = None
    supports_streaming: Optional[bool] = None
    supports_function_calling: Optional[bool] = None
    supports_vision: Optional[bool] = None
    supports_json_mode: Optional[bool] = None
    supports_thinking: Optional[bool] = None
    supports_system_prompt: Optional[bool] = None
    extra_params_json: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None


def _serialize_model(m: ProviderModel) -> dict:
    """完整序列化 ProviderModel（含 P0 新字段）"""
    # P1 多模态：把 JSON 字符串反序列化成 list
    stt = m.supported_task_types
    if isinstance(stt, str) and stt:
        try:
            stt = json.loads(stt)
        except Exception:
            stt = [stt]
    if not stt:
        stt = backward_compat_task_types(m.model_type or "chat", m.model_name)
    return {
        "id": m.id,
        "model_name": m.model_name,
        "model_type": m.model_type,
        "supported_task_types": stt,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "default_temperature": m.default_temperature,
        "default_top_p": m.default_top_p,
        "default_max_tokens": m.default_max_tokens,
        "default_frequency_penalty": m.default_frequency_penalty,
        "default_presence_penalty": m.default_presence_penalty,
        "default_stop": m.default_stop,
        "default_thinking_mode": m.default_thinking_mode,
        "default_thinking_budget": m.default_thinking_budget,
        "default_response_format": m.default_response_format,
        "default_json_schema": m.default_json_schema,
        "context_window": m.context_window,
        "supports_streaming": m.supports_streaming,
        "supports_function_calling": m.supports_function_calling,
        "supports_vision": m.supports_vision,
        "supports_json_mode": m.supports_json_mode,
        "supports_thinking": m.supports_thinking,
        "supports_system_prompt": m.supports_system_prompt,
        "extra_params_json": m.extra_params_json,
        "description": m.description,
        "tags": m.tags,
    }


def _guess_model_type(name: str) -> str:
    """根据模型名称智能推断类型（支持多模态模型族识别）"""
    low = name.lower()
    if any(k in low for k in ["asr", "speech", "transcribe", "whisper",
                               "transcriber", "parakeet", "sensevoice"]):
        return "speech_to_text"
    if any(k in low for k in ["embed", "bge-", "bce-"]):
        return "embedding"
    if any(k in low for k in ["search", "tavily", "serp", "crawl"]):
        return "web_search"
    if any(k in low for k in [
        "vision", "vl-", "image", "ocr", "video", "kolors", "wan-",
        # Known multimodal model families (natively support vision)
        "gemini-2.5", "gemini-2.0", "gemini-1.5",
        "gpt-4o", "gpt-4-turbo", "gpt-4-vision",
        "claude-3", "claude-4",
        "qwen-vl", "qwen2-vl",
        "glm-4v", "internvl", "minicpm-v",
        "mimo-v2-omni",
    ]):
        return "vision"
    return "chat"


# ===== 多模态支持：模型可执行的 task_type 列表 =====
# 一个模型可以是多模态（如 Gemini 3 flash 同时是 chat + vision）
# 这个 list 决定它能绑定到哪些 task_type
MULTIMODAL_VISION_KEYWORDS = [
    "vision", "vl-", "image", "ocr", "video", "kolors", "wan-",
    "gemini",            # 全系 Gemini 1.0/1.5/2.0/2.5/3.0 都支持 vision
    "gpt-4o", "gpt-4-turbo", "gpt-4-vision",
    "claude-3", "claude-4",
    "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qvq",
    "glm-4v", "glm-4.1v", "glm-4.5v",
    "internvl",
    "minicpm-v",
    "mimo-v2-omni",
    "doubao-1.5-vision", "doubao-vision",
    "step-1v", "step-1o",
    "yi-vision", "yi-vl",
]
SPEECH_KEYWORDS = ["asr", "speech", "transcribe", "whisper", "transcriber", "parakeet", "sensevoice"]
EMBEDDING_KEYWORDS = ["embed", "bge-", "bce-", "m3e-", "bge-m3"]
SEARCH_KEYWORDS = ["search", "tavily", "serp", "crawl"]


def infer_supported_task_types(name: str) -> list[str]:
    """
    根据模型名推断它可执行的 task_type 列表。

    返回：['chat', 'vision'] / ['embedding'] / ['speech_to_text'] 等
    永远包含 'chat' 兜底（除非是纯 embedding/asr）。
    """
    low = (name or "").lower()
    if not low:
        return ["chat"]
    types: list[str] = []
    # 1) embedding
    if any(k in low for k in EMBEDDING_KEYWORDS):
        return ["embedding"]
    # 2) speech_to_text
    if any(k in low for k in SPEECH_KEYWORDS):
        return ["speech_to_text"]
    # 3) vision
    has_vision = any(k in low for k in MULTIMODAL_VISION_KEYWORDS)
    # 4) 默认 chat
    types.append("chat")
    if has_vision:
        types.append("vision")
    return types


def backward_compat_task_types(model_type: str, model_name: str) -> list[str]:
    """
    老数据迁移：根据 model_type 字段（单选枚举）回填 supported_task_types
    优先用 infer，没有再用 model_type 兜底。
    """
    if model_type in ("vision",):
        return ["chat", "vision"]
    if model_type in ("speech_to_text",):
        return ["speech_to_text"]
    if model_type in ("embedding",):
        return ["embedding"]
    if model_type in ("web_search",):
        return ["chat"]
    return infer_supported_task_types(model_name)


@router.get("/providers/{provider_id}/models")
def list_provider_models(provider_id: int, db: Session = Depends(get_session),
                         current_user: User = Depends(get_current_user)):
    """获取供应商下已配置的模型列表（含默认参数）"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限访问此供应商")
    models = db.exec(
        select(ProviderModel).where(ProviderModel.provider_id == provider_id).order_by(ProviderModel.created_at)
    ).all()
    return [_serialize_model(m) for m in models]


@router.post("/providers/{provider_id}/models", status_code=201)
def add_provider_model(provider_id: int, data: ModelAdd, db: Session = Depends(get_session),
                       current_user: User = Depends(get_current_user)):
    """给供应商添加一个模型（可携带默认参数）"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限操作此供应商")
    if not has_permission(current_user, "ai:manage_shared", db) and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能管理自己的供应商模型")
    existing = db.exec(
        select(ProviderModel).where(
            ProviderModel.provider_id == provider_id,
            ProviderModel.model_name == data.model_name,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="该模型已存在")
    mtype = data.model_type if data.model_type != "chat" else _guess_model_type(data.model_name)
    # P1 多模态：决定 supported_task_types
    # 优先级：用户显式传 > model_name 推断
    if data.supported_task_types:
        supported = data.supported_task_types
    else:
        # 用 _guess_model_type 决定的 mtype 反推 + name 推断
        supported = infer_supported_task_types(data.model_name)
        # 推断的 chat 默认要包含 model_type（避免老 vision-only 模型升级后丢了 vision 标签）
        if mtype == "vision" and "vision" not in supported:
            supported.append("vision")
    # 自动按模型名推断能力（如果用户没显式设）
    from app.services.param_resolver import detect_capabilities_from_name
    detected = detect_capabilities_from_name(data.model_name)
    payload = data.model_dump(exclude={"model_name", "model_type", "supported_task_types"})
    # 合并 detected（用户显式 None 优先，detected 只在用户未填时填入）
    for k, v in detected.items():
        if payload.get(k) is None and v is not None:
            payload[k] = v
    # 兜底一致性：若 supported_task_types 含 vision / speech_to_text / embedding
    # 且对应 supports_* 仍为 None 或 False，强制打开（防止命名不在关键词表里被误判）
    stt_lower = {s.lower() for s in (supported or [])}
    if "vision" in stt_lower and not payload.get("supports_vision"):
        payload["supports_vision"] = True
    model = ProviderModel(
        provider_id=provider_id,
        model_name=data.model_name,
        model_type=mtype,
        supported_task_types=json.dumps(supported, ensure_ascii=False) if supported else None,
        **payload,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return _serialize_model(model)


@router.delete("/providers/{provider_id}/models/{model_id}", status_code=204)
def remove_provider_model(provider_id: int, model_id: int, db: Session = Depends(get_session),
                          current_user: User = Depends(get_current_user)):
    """删除供应商下的一个模型"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限操作此供应商")
    if not has_permission(current_user, "ai:manage_shared", db) and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能管理自己的供应商模型")
    model = db.get(ProviderModel, model_id)
    if not model or model.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="模型不存在")
    # 清理引用该模型的 TaskModelConfig
    model_name = model.model_name
    stale_cfgs = db.exec(
        select(TaskModelConfig).where(
            TaskModelConfig.provider_id == provider_id,
            TaskModelConfig.model_name == model_name,
        )
    ).all()
    for cfg in stale_cfgs:
        db.delete(cfg)
    db.delete(model)
    db.commit()


class ModelUpdate(BaseModel):
    model_type: Optional[str] = None
    model_name: Optional[str] = None
    # P1 多模态
    supported_task_types: Optional[list[str]] = None
    # 默认参数（全部可选）
    default_temperature: Optional[float] = None
    default_top_p: Optional[float] = None
    default_max_tokens: Optional[int] = None
    default_frequency_penalty: Optional[float] = None
    default_presence_penalty: Optional[float] = None
    default_stop: Optional[str] = None
    default_thinking_mode: Optional[str] = None
    default_thinking_budget: Optional[int] = None
    default_response_format: Optional[str] = None
    default_json_schema: Optional[str] = None
    context_window: Optional[int] = None
    supports_streaming: Optional[bool] = None
    supports_function_calling: Optional[bool] = None
    supports_vision: Optional[bool] = None
    supports_json_mode: Optional[bool] = None
    supports_thinking: Optional[bool] = None
    supports_system_prompt: Optional[bool] = None
    extra_params_json: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None


@router.put("/providers/{provider_id}/models/{model_id}")
def update_provider_model(provider_id: int, model_id: int, data: ModelUpdate, db: Session = Depends(get_session),
                          current_user: User = Depends(get_current_user)):
    """更新模型的类型/名称/默认参数"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限操作此供应商")
    if not has_permission(current_user, "ai:manage_shared", db) and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能管理自己的供应商模型")
    model = db.get(ProviderModel, model_id)
    if not model or model.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="模型不存在")
    if data.model_type is not None:
        if data.model_type not in ("chat", "embedding", "speech_to_text", "vision", "web_search"):
            raise HTTPException(status_code=400, detail="无效的模型类型，可选: chat, embedding, speech_to_text, vision, web_search")
        model.model_type = data.model_type
    if data.model_name is not None:
        dup = db.exec(
            select(ProviderModel).where(
                ProviderModel.provider_id == provider_id,
                ProviderModel.model_name == data.model_name,
                ProviderModel.id != model_id,
            )
        ).first()
        if dup:
            raise HTTPException(status_code=409, detail="该模型名已存在")
        model.model_name = data.model_name
    update_payload = data.model_dump(exclude={"model_type", "model_name"}, exclude_unset=True)
    # 多模态：list → JSON 字符串
    if "supported_task_types" in update_payload and isinstance(update_payload["supported_task_types"], list):
        update_payload["supported_task_types"] = json.dumps(update_payload["supported_task_types"], ensure_ascii=False)
    for key, value in update_payload.items():
        setattr(model, key, value)
    db.add(model)
    db.commit()
    db.refresh(model)
    return _serialize_model(model)


@router.post("/providers/{provider_id}/models/{model_id}/test")
def test_provider_model(provider_id: int, model_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """测试单个模型连通性（按 model_type 调用相应 API）"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限操作此供应商")
    model = db.get(ProviderModel, model_id)
    if not model or model.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="模型不存在")
    try:
        from app.services.ai_service import _get_client, _is_vertex_ai
        client = _get_client(provider.base_url, provider.api_key, provider)
        mtype = model.model_type or "chat"
        if mtype == "speech_to_text":
            # 用一段静默音频测 ASR 模型（不需要实际音频内容）
            import base64, io, wave, struct
            wav_buf = io.BytesIO()
            with wave.open(wav_buf, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(16000)
                # 0.5 秒静默
                for _ in range(8000):
                    wf.writeframes(struct.pack("<h", 0))
            wav_buf.seek(0)
            try:
                resp = client.audio.transcriptions.create(
                    model=model.model_name, file=("test.wav", wav_buf, "audio/wav")
                )
                return {"success": True, "message": f"ASR 模型 {model.model_name} 可用", "reply": getattr(resp, "text", str(resp))[:50]}
            except Exception as e:
                err = str(e)[:300]
                # 部分 ASR 端点用 multipart/form-data 而非 JSON
                if "503" in err or "not_found" in err.lower() or "不支持" in err:
                    return {"success": False, "message": f"模型 {model.model_name} ASR 调用失败: {err}"}
                return {"success": True, "message": f"ASR 端点已连通（忽略静默输入报错: {str(e)[:80]}）"}
        elif mtype == "embedding":
            # Vertex AI 原生不支持 OpenAI 兼容的 embeddings API
            if _is_vertex_ai(provider):
                return {"success": True, "message": f"Embedding {model.model_name} 就绪（Vertex AI 原生路径）", "reply": "ok"}
            try:
                resp = client.embeddings.create(model=model.model_name, input=["test"])
                dim = len(resp.data[0].embedding) if resp.data else 0
                return {"success": True, "message": f"Embedding {model.model_name} 可用，维度={dim}", "reply": f"dim={dim}"}
            except Exception as e:
                return {"success": False, "message": str(e)[:200]}
        else:
            response = client.chat.completions.create(
                model=model.model_name,
                messages=[{"role": "user", "content": "回复OK"}],
                max_tokens=10,
            )
            return {
                "success": True,
                "message": f"模型 {model.model_name} 可用",
                "reply": _extract_message_text(response.choices[0].message)[:50],
            }
    except Exception as e:
        return {"success": False, "message": str(e)[:200]}


@router.post("/providers/{provider_id}/test")
def test_provider(provider_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """测试模型供应商连接"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    result = {"success": False, "message": "", "models_found": 0}
    try:
        from app.services.ai_service import _get_client, _is_vertex_ai
        # 判断是否为Gemini（Google AI Studio）
        def _is_gemini(p: ModelProvider) -> bool:
            return "generativelanguage.googleapis.com" in (p.base_url or "")
        # 判断是否为Anthropic（Claude）
        def _is_anthropic(p: ModelProvider) -> bool:
            return "api.anthropic.com" in (p.base_url or "")
        
        client = _get_client(provider.base_url, provider.api_key, provider)
        # 先测试模型列表
        try:
            if _is_vertex_ai(provider):
                from google import genai
                from app.services.ai_service import _get_vertex_credentials
                credentials = _get_vertex_credentials(provider)
                gclient = genai.Client(
                    vertexai=True,
                    project=provider.project_id,
                    location=provider.location or "global",
                    credentials=credentials,
                )
                models_data = list(gclient.models.list())
                model_ids = [m.name for m in models_data if "publishers/" in (getattr(m, 'name', ''))]
                result["models_found"] = len(model_ids)
                result["sample_models"] = model_ids[:8]
            elif _is_gemini(provider):
                # Gemini使用原生SDK获取模型列表
                from google import genai
                import logging
                logger = logging.getLogger("worktrack")
                try:
                    logger.info("正在测试Gemini连接...")
                    gclient = genai.Client(api_key=provider.api_key)
                    logger.info("Gemini客户端初始化成功")
                    try:
                        models_data = gclient.models.list()
                        model_ids = []
                        for m in models_data:
                            model_id = getattr(m, 'name', '') or getattr(m, 'id', '')
                            if model_id:
                                if model_id.startswith('models/'):
                                    model_id = model_id[7:]
                                model_ids.append(model_id)
                        result["models_found"] = len(model_ids)
                        result["sample_models"] = model_ids[:10]
                        logger.info(f"成功获取到{len(model_ids)}个Gemini模型")
                    except Exception as api_err:
                        logger.error(f"Gemini models.list()调用失败: {str(api_err)}", exc_info=True)
                        # 如果获取失败，使用预设模型
                        sample_gemini_models = [
                            "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", 
                            "gemini-1.5-pro", "gemini-1.5-flash"
                        ]
                        result["models_found"] = 10
                        result["sample_models"] = sample_gemini_models
                except Exception as e:
                    logger.error(f"Gemini连接测试失败: {str(e)}", exc_info=True)
            elif _is_anthropic(provider):
                # Anthropic直接用预设模型
                sample_anthropic_models = [
                    "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", 
                    "claude-3-5-haiku-20241022", "claude-3-opus-20240229"
                ]
                result["models_found"] = 6
                result["sample_models"] = sample_anthropic_models
            else:
                models_resp = client.models.list()
                model_ids = [m.id for m in models_resp.data]
                result["models_found"] = len(model_ids)
                result["sample_models"] = model_ids[:8]
        except Exception:
            pass
        # 再测试对话 — 从 ProviderModel 获取候选模型，逐个尝试
        provider_models = db.exec(
            select(ProviderModel).where(ProviderModel.provider_id == provider_id).order_by(ProviderModel.created_at)
        ).all()
        candidates = [m.model_name for m in provider_models]
        
        # 根据供应商类型智能选择默认测试模型
        if not candidates:
            if _is_gemini(provider):
                candidates.append("gemini-2.5-flash")
            elif _is_vertex_ai(provider):
                candidates.append("gemini-2.5-flash")
            elif "api.anthropic.com" in (provider.base_url or ""):
                candidates.append("claude-3-5-sonnet-20241022")
            elif "api.deepseek.com" in (provider.base_url or ""):
                candidates.append("deepseek-chat")
            elif "dashscope.aliyuncs.com" in (provider.base_url or ""):
                candidates.append("qwen-turbo")
            elif "api.siliconflow.cn" in (provider.base_url or ""):
                candidates.append("Qwen/Qwen2.5-7B-Instruct")
            elif "api.xiaomimimo.com" in (provider.base_url or ""):
                candidates.append("mimo-v2.5-pro")
            elif "api.minimax.chat" in (provider.base_url or ""):
                candidates.append("abab6.5s-chat")
            else:
                candidates.append("gpt-3.5-turbo")
        
        priority_kw = ["chat", "instruct", "deepseek", "qwen", "gpt", "claude", "llama", "glm", "yi-", "moonshot", "mimo", "gemini"]
        non_chat_kw = ["embed", "bge-", "stable-diffusion", "sd-", "tts-", "whisper", "dall-e"]
        def model_priority(m: str) -> int:
            low = m.lower()
            for kw in non_chat_kw:
                if kw in low:
                    return 100
            for i, kw in enumerate(priority_kw):
                if kw in low:
                    return i
            return 50
        candidates.sort(key=model_priority)
        # 尝试前 5 个
        last_error = ""
        for model in candidates[:5]:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "回复OK"}],
                    max_tokens=10,
                )
                result["success"] = True
                result["message"] = f"连接成功，模型 {model} 可用"
                result["test_model"] = model
                result["reply"] = _extract_message_text(response.choices[0].message)[:50]
                break
            except Exception as e:
                last_error = str(e)[:100]
        if not result["success"]:
            result["message"] = f"对话测试失败: {last_error}"
    except Exception as e:
        result["message"] = str(e)[:200]
    return result


@router.post("/providers/{provider_id}/fetch-models")
def fetch_provider_models(provider_id: int, db: Session = Depends(get_session),
                          current_user: User = Depends(get_current_user)):
    """从供应商API拉取可用模型列表"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user, db):
        raise HTTPException(status_code=403, detail="无权限拉取模型列表")
    if not has_permission(current_user, "ai:manage_shared", db) and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能管理自己的供应商")

    try:
        from app.services.ai_service import _is_vertex_ai, _get_vertex_credentials
        # 判断是否为Gemini（Google AI Studio）
        def _is_gemini(p: ModelProvider) -> bool:
            return "generativelanguage.googleapis.com" in (p.base_url or "")
        # 判断是否为Anthropic（Claude）
        def _is_anthropic(p: ModelProvider) -> bool:
            return "api.anthropic.com" in (p.base_url or "")
        
        if _is_vertex_ai(provider):
            from google import genai
            credentials = _get_vertex_credentials(provider)
            client = genai.Client(
                vertexai=True,
                project=provider.project_id,
                location=provider.location or "global",
                credentials=credentials,
            )
            # 使用Google Gen AI SDK的list方法获取模型
            models = []
            seen = set()
            try:
                models_data = client.models.list()
                for m in models_data:
                    model_id = getattr(m, 'name', '') or getattr(m, 'id', '') or getattr(m, 'model_id', '')
                    if model_id:
                        if "/" in model_id:
                            short_name = model_id.split("/")[-1]
                        else:
                            short_name = model_id
                        if short_name and short_name not in seen:
                            seen.add(short_name)
                            owned_by = getattr(m, 'owned_by', '') or 'google'
                            models.append({"id": short_name, "owned_by": owned_by})
            except Exception as api_err:
                import logging
                logging.getLogger("worktrack").warning("Vertex AI模型列表API调用失败: %s，使用兜底模型列表", api_err)
            # 如果 API 拉取失败或为空，使用常见模型列表作为兜底
            if not models:
                models = [
                    {"id": "gemini-2.5-flash", "owned_by": "google"},
                    {"id": "gemini-2.5-pro", "owned_by": "google"},
                    {"id": "gemini-2.0-flash", "owned_by": "google"},
                    {"id": "gemini-2.0-flash-lite", "owned_by": "google"},
                    {"id": "gemini-1.5-pro", "owned_by": "google"},
                    {"id": "gemini-1.5-flash", "owned_by": "google"},
                    {"id": "claude-3-5-sonnet@20241022", "owned_by": "anthropic"},
                    {"id": "claude-3-5-haiku@20241022", "owned_by": "anthropic"},
                    {"id": "claude-3-opus@20240229", "owned_by": "anthropic"},
                    {"id": "mistral-large@2411", "owned_by": "mistralai"},
                    {"id": "llama-3.3-70b-instruct", "owned_by": "meta"},
                ]
        elif _is_gemini(provider):
            # Gemini（Google AI Studio）使用原生SDK获取模型列表
            from google import genai
            models = []
            seen = set()
            try:
                import logging
                logger = logging.getLogger("worktrack")
                logger.info("正在初始化Gemini客户端...")
                gclient = genai.Client(api_key=provider.api_key)
                logger.info("Gemini客户端初始化成功，正在获取模型列表...")
                
                # 尝试获取模型列表
                try:
                    models_data = gclient.models.list()
                    logger.info("Gemini models.list()调用成功，开始处理返回结果...")
                    
                    # 处理模型数据
                    for m in models_data:
                        # 获取模型ID
                        model_id = getattr(m, 'name', '') or getattr(m, 'id', '')
                        if not model_id:
                            continue
                        # 清理模型名
                        if model_id.startswith('models/'):
                            model_id = model_id[7:]
                        if model_id and model_id not in seen:
                            seen.add(model_id)
                            models.append({"id": model_id, "owned_by": "google"})
                    logger.info(f"成功获取到{len(models)}个Gemini模型")
                except Exception as api_err:
                    logger.error(f"Gemini models.list()调用失败: {str(api_err)}", exc_info=True)
                    raise
            except Exception as e:
                import logging
                logger = logging.getLogger("worktrack")
                logger.error(f"Gemini模型列表获取失败: {str(e)}", exc_info=True)
            # 如果API获取失败或为空，使用兜底列表
            if not models:
                models = [
                    {"id": "gemini-2.5-flash", "owned_by": "google"},
                    {"id": "gemini-2.5-pro", "owned_by": "google"},
                    {"id": "gemini-2.0-flash", "owned_by": "google"},
                    {"id": "gemini-2.0-flash-lite", "owned_by": "google"},
                    {"id": "gemini-2.0-pro-exp-02-05", "owned_by": "google"},
                    {"id": "gemini-1.5-pro", "owned_by": "google"},
                    {"id": "gemini-1.5-flash", "owned_by": "google"},
                    {"id": "gemini-1.5-pro-latest", "owned_by": "google"},
                    {"id": "gemini-1.5-flash-latest", "owned_by": "google"},
                    {"id": "text-embedding-004", "owned_by": "google"},
                ]
        elif _is_anthropic(provider):
            # Anthropic（Claude）使用预设模型列表
            models = [
                {"id": "claude-3-7-sonnet-20250219", "owned_by": "anthropic"},
                {"id": "claude-3-5-sonnet-20241022", "owned_by": "anthropic"},
                {"id": "claude-3-5-haiku-20241022", "owned_by": "anthropic"},
                {"id": "claude-3-opus-20240229", "owned_by": "anthropic"},
                {"id": "claude-3-sonnet-20240229", "owned_by": "anthropic"},
                {"id": "claude-3-haiku-20240307", "owned_by": "anthropic"},
            ]
        else:
            from openai import OpenAI
            base_url = provider.base_url
            api_key = provider.api_key
            client = OpenAI(base_url=base_url, api_key=api_key, timeout=15)
            resp = client.models.list()
            models = [{"id": m.id, "owned_by": getattr(m, "owned_by", "")} for m in resp.data]
        import json
        provider.supported_models_json = json.dumps(models, ensure_ascii=False)
        db.add(provider)
        db.commit()
        return {"success": True, "count": len(models), "models": models}
    except Exception as e:
        import logging
        logging.getLogger("worktrack").error("拉取模型列表失败: %s", e, exc_info=True)
        return {"success": False, "message": str(e)[:200]}


# ===== 任务-模型配置 =====

class TaskModelUpdate(BaseModel):
    task_type: str
    provider_id: Optional[int] = None
    model_name: str = ""
    # 任务级参数覆盖（None 表示继承模型默认）
    override_temperature: Optional[float] = None
    override_top_p: Optional[float] = None
    override_max_tokens: Optional[int] = None
    override_frequency_penalty: Optional[float] = None
    override_presence_penalty: Optional[float] = None
    override_stop: Optional[str] = None
    override_thinking_mode: Optional[str] = None
    override_thinking_budget: Optional[int] = None
    override_response_format: Optional[str] = None
    override_json_schema: Optional[str] = None
    override_extra_params_json: Optional[str] = None
    preset_id: Optional[int] = None


def _serialize_task_config(c: TaskModelConfig) -> dict:
    """序列化 TaskModelConfig"""
    return {
        "task_type": c.task_type,
        "provider_id": c.provider_id,
        "model_name": c.model_name,
        "user_id": c.user_id,
        "override_temperature": c.override_temperature,
        "override_top_p": c.override_top_p,
        "override_max_tokens": c.override_max_tokens,
        "override_frequency_penalty": c.override_frequency_penalty,
        "override_presence_penalty": c.override_presence_penalty,
        "override_stop": c.override_stop,
        "override_thinking_mode": c.override_thinking_mode,
        "override_thinking_budget": c.override_thinking_budget,
        "override_response_format": c.override_response_format,
        "override_json_schema": c.override_json_schema,
        "override_extra_params_json": c.override_extra_params_json,
        "preset_id": c.preset_id,
    }


@router.get("/task-models")
def get_task_models(db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    """获取任务模型配置：用户私有 +（有权限时）共享，自动清理无效配置"""
    can_manage = has_permission(current_user, "ai:manage_shared", db)
    use_shared = can_manage or has_permission(current_user, "ai:use", db)
    uid = current_user.id if not can_manage else None

    conditions: list = []
    if uid is not None:
        conditions.append(TaskModelConfig.user_id == uid)
    if use_shared:
        conditions.append(TaskModelConfig.user_id == None)
    if not conditions:
        return {}

    configs = db.exec(
        select(TaskModelConfig).where(or_(*conditions))
    ).all()

    # 批量预加载 provider 和 model，避免 N+1
    provider_ids = {c.provider_id for c in configs if c.provider_id}
    providers: dict[int, ModelProvider] = {}
    if provider_ids:
        for p in db.exec(select(ModelProvider).where(ModelProvider.id.in_(provider_ids))).all():
            providers[p.id] = p

    valid_models: set[tuple[int, str]] = set()
    if provider_ids:
        for m in db.exec(
            select(ProviderModel.provider_id, ProviderModel.model_name).where(
                ProviderModel.provider_id.in_(provider_ids)
            )
        ).all():
            valid_models.add((m.provider_id, m.model_name))

    result = {}
    stale_ids = []
    for c in configs:
        provider = providers.get(c.provider_id) if c.provider_id else None
        if not provider:
            stale_ids.append(c.id)
            continue
        if c.model_name and (c.provider_id, c.model_name) not in valid_models:
            stale_ids.append(c.id)
            continue
        cfg = _serialize_task_config(c)
        cfg["provider_name"] = provider.name
        if c.user_id is None and c.task_type not in result:
            result[c.task_type] = cfg
        elif c.user_id is not None:
            result[c.task_type] = cfg
    # 清理无效配置（批量删除）
    if stale_ids:
        stale_configs = db.exec(select(TaskModelConfig).where(TaskModelConfig.id.in_(stale_ids))).all()
        for stale in stale_configs:
            db.delete(stale)
        db.commit()
    return result


@router.put("/task-models")
def update_task_model(data: TaskModelUpdate, db: Session = Depends(get_session),
                      current_user: User = Depends(get_current_user)):
    """更新任务模型配置：管理员更新共享的，普通用户更新自己的"""
    can_manage_shared = has_permission(current_user, "ai:manage_shared", db)
    uid = None if can_manage_shared else current_user.id

    config = db.exec(
        select(TaskModelConfig).where(
            TaskModelConfig.task_type == data.task_type,
            TaskModelConfig.user_id == uid,
        )
    ).first()
    if not config:
        config = TaskModelConfig(
            task_type=data.task_type,
            provider_id=data.provider_id,
            model_name=data.model_name,
            user_id=uid,
            override_temperature=data.override_temperature,
            override_top_p=data.override_top_p,
            override_max_tokens=data.override_max_tokens,
            override_frequency_penalty=data.override_frequency_penalty,
            override_presence_penalty=data.override_presence_penalty,
            override_stop=data.override_stop,
            override_thinking_mode=data.override_thinking_mode,
            override_thinking_budget=data.override_thinking_budget,
            override_response_format=data.override_response_format,
            override_json_schema=data.override_json_schema,
            override_extra_params_json=data.override_extra_params_json,
            preset_id=data.preset_id,
        )
        db.add(config)
    else:
        config.provider_id = data.provider_id
        config.model_name = data.model_name
        update_payload = data.model_dump(
            exclude={"task_type", "provider_id", "model_name"},
            exclude_unset=False,
        )
        for key, value in update_payload.items():
            setattr(config, key, value)
        db.add(config)
    db.commit()
    db.refresh(config)
    out = _serialize_task_config(config)
    if config.provider_id:
        p = db.get(ModelProvider, config.provider_id)
        out["provider_name"] = p.name if p else None
    return out


# ===== 参数预设 CRUD =====

class PresetCreate(BaseModel):
    name: str
    description: str = ""
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    thinking_mode: Optional[str] = None
    thinking_budget: Optional[int] = None
    response_format: Optional[str] = None


class PresetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    thinking_mode: Optional[str] = None
    thinking_budget: Optional[int] = None
    response_format: Optional[str] = None


def _serialize_preset(p: ModelParamPreset) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "user_id": p.user_id,
        "is_system": p.is_system,
        "temperature": p.temperature,
        "top_p": p.top_p,
        "max_tokens": p.max_tokens,
        "thinking_mode": p.thinking_mode,
        "thinking_budget": p.thinking_budget,
        "response_format": p.response_format,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/model-presets")
def list_presets(db: Session = Depends(get_session),
                 current_user: User = Depends(get_current_user)):
    """列出所有可见预设：平台预设（is_system=True）+ 当前用户的个人预设"""
    presets = db.exec(
        select(ModelParamPreset).where(
            or_(
                ModelParamPreset.is_system == True,
                ModelParamPreset.user_id == current_user.id,
                ModelParamPreset.user_id == None,  # NULL=平台预设
            )
        ).order_by(ModelParamPreset.is_system.desc(), ModelParamPreset.id)
    ).all()
    return [_serialize_preset(p) for p in presets]


@router.post("/model-presets", status_code=201)
def create_preset(data: PresetCreate, db: Session = Depends(get_session),
                  current_user: User = Depends(get_current_user)):
    """创建个人预设（user_id 强制为当前用户）"""
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="预设名称不能为空")
    preset = ModelParamPreset(
        user_id=current_user.id,
        is_system=False,
        **data.model_dump(),
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return _serialize_preset(preset)


@router.put("/model-presets/{preset_id}")
def update_preset(preset_id: int, data: PresetUpdate, db: Session = Depends(get_session),
                  current_user: User = Depends(get_current_user)):
    """更新个人预设（系统预设不可改）"""
    preset = db.get(ModelParamPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="预设不存在")
    if preset.is_system or preset.user_id is None:
        raise HTTPException(status_code=403, detail="系统预设不可修改")
    if preset.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能修改自己的预设")
    payload = data.model_dump(exclude_unset=False)
    for key, value in payload.items():
        setattr(preset, key, value)
    from datetime import datetime, timezone
    preset.updated_at = datetime.now(timezone.utc)
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return _serialize_preset(preset)


@router.delete("/model-presets/{preset_id}", status_code=204)
def delete_preset(preset_id: int, db: Session = Depends(get_session),
                  current_user: User = Depends(get_current_user)):
    """删除个人预设（系统预设不可删）"""
    preset = db.get(ModelParamPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="预设不存在")
    if preset.is_system or preset.user_id is None:
        raise HTTPException(status_code=403, detail="系统预设不可删除")
    if preset.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除自己的预设")
    # 清理引用该 preset 的 TaskModelConfig
    from sqlmodel import update as sql_update
    db.exec(
        sql_update(TaskModelConfig)
        .where(TaskModelConfig.preset_id == preset_id)
        .values(preset_id=None)
    )
    db.delete(preset)
    db.commit()


# ===== 字段选项管理 =====

class FieldOptionCreate(BaseModel):
    category: str
    value: str
    sort_order: int = 0


class FieldOptionBatchUpdate(BaseModel):
    category: str
    values: List[str]


@router.get("/field-options")
def list_field_options(category: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取字段选项，可按分类筛选"""
    query = select(FieldOption).order_by(FieldOption.sort_order, FieldOption.id)
    if category:
        query = query.where(FieldOption.category == category)
    return db.exec(query).all()


@router.post("/field-options", status_code=201)
def create_field_option(data: FieldOptionCreate, db: Session = Depends(get_session),
                        _admin: User = Depends(require_permission("settings:edit"))):
    opt = FieldOption(**data.model_dump())
    db.add(opt)
    db.commit()
    db.refresh(opt)
    return opt


@router.put("/field-options/{option_id}")
def update_field_option(option_id: int, data: FieldOptionCreate, db: Session = Depends(get_session),
                        _admin: User = Depends(require_permission("settings:edit"))):
    opt = db.get(FieldOption, option_id)
    if not opt:
        raise HTTPException(status_code=404, detail="选项不存在")
    opt.category = data.category
    opt.value = data.value
    opt.sort_order = data.sort_order
    db.add(opt)
    db.commit()
    db.refresh(opt)
    return opt


@router.delete("/field-options/{option_id}", status_code=204)
def delete_field_option(option_id: int, db: Session = Depends(get_session),
                        _admin: User = Depends(require_permission("settings:edit"))):
    opt = db.get(FieldOption, option_id)
    if not opt:
        raise HTTPException(status_code=404, detail="选项不存在")
    db.delete(opt)
    db.commit()


@router.post("/field-options/batch")
def batch_update_field_options(data: FieldOptionBatchUpdate, db: Session = Depends(get_session),
                               _admin: User = Depends(require_permission("settings:edit"))):
    """批量更新某个分类的全部选项"""
    # 删除旧的
    old = db.exec(select(FieldOption).where(FieldOption.category == data.category)).all()
    for o in old:
        db.delete(o)
    # 添加新的
    for i, val in enumerate(data.values):
        db.add(FieldOption(category=data.category, value=val.strip(), sort_order=i))
    db.commit()
    return {"category": data.category, "count": len(data.values)}


@router.get("/field-options/categories")
def list_field_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取所有选项分类"""
    opts = db.exec(select(FieldOption)).all()
    categories = list(set(o.category for o in opts))
    return sorted(categories)


# ===== 系统偏好设置 =====

@router.get("/preferences")
def get_preferences(db: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """获取当前用户的偏好设置（用户设置优先，全局设置为默认）"""
    all_prefs = db.exec(
        select(SystemPreference).where(
            or_(SystemPreference.user_id == current_user.id, SystemPreference.user_id == None)
        )
    ).all()
    # 用户级设置优先于全局设置
    result = {}
    for p in all_prefs:
        if p.user_id is None and p.key in result:
            continue  # 用户已有设置，不覆盖
        result[p.key] = p.value
    return result


class PreferenceUpdate(BaseModel):
    key: str
    value: str


@router.put("/preferences")
def update_preference(data: PreferenceUpdate, db: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """更新当前用户的单个偏好设置"""
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == data.key,
            SystemPreference.user_id == current_user.id,
        )
    ).first()
    if pref:
        pref.value = data.value
    else:
        pref = SystemPreference(key=data.key, value=data.value, user_id=current_user.id)
        db.add(pref)
    db.commit()
    db.refresh(pref)
    return {"key": pref.key, "value": pref.value}


# ===== Tavily 联网搜索配置 =====

class TavilyConfigUpdate(BaseModel):
    api_key: str


@router.get("/tavily-config")
def get_tavily_config(db: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    """获取当前用户的 Tavily API Key（脱敏返回）"""
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "tavily_api_key",
            SystemPreference.user_id == current_user.id,
        )
    ).first()
    raw = pref.value if pref else ""
    masked = (raw[:4] + "****" + raw[-4:]) if len(raw) > 8 else ("****" if raw else "")
    return {"api_key": masked, "has_key": bool(raw)}


@router.put("/tavily-config")
def update_tavily_config(data: TavilyConfigUpdate, db: Session = Depends(get_session),
                         current_user: User = Depends(get_current_user)):
    """更新当前用户的 Tavily API Key；提交脱敏占位值时忽略"""
    if not data.api_key or "****" in data.api_key:
        return {"message": "Tavily API Key 未变更"}
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "tavily_api_key",
            SystemPreference.user_id == current_user.id,
        )
    ).first()
    if pref:
        pref.value = data.api_key
    else:
        db.add(SystemPreference(key="tavily_api_key", value=data.api_key, user_id=current_user.id))
    db.commit()
    return {"message": "Tavily API Key 已保存"}


# ===== AI 提示词配置 =====

# 预设默认提示词
DEFAULT_PROMPTS = {
    "daily_summary": {
        "task_type": "daily_summary",
        "label": "📋 日报总结",
        "desc": "单篇日报 AI 总结时使用的提示词",
        "system_prompt": "你是工作效率助手。将日报内容提炼为简洁摘要，突出今日完成的关键事项与重要进展。输出 3-5 条以「•」开头的要点，每条不超过 30 字，语言简洁直接。",
        "user_prompt_template": "请总结以下工作日报：\n{content}",
        "variables": ["{content}"],
    },
    "weekly_summary": {
        "task_type": "weekly_summary",
        "label": "📊 周报总结",
        "desc": "在周报页面生成整周 AI 总结时使用的提示词",
        "system_prompt": "你是工作效率助手。根据本周日报内容生成结构化周报总结。\n要求：\n1. 本周主要完成事项（3-5 条要点）\n2. 重要进展与成果\n3. 待解决的问题或风险\n用 markdown 格式输出，结构清晰，总字数控制在 400 字以内。",
        "user_prompt_template": "请总结本周（{week_range}）的工作情况：\n\n{reports_content}",
        "variables": ["{week_range}", "{reports_content}"],
    },
    "meeting_organize": {
        "task_type": "meeting_organize",
        "label": "🎙️ 会议纪要整理",
        "desc": "录音转文字后 AI 整理会议纪要时使用的提示词",
        "system_prompt": "你是专业的会议纪要助手。将语音转写内容整理为规范的会议纪要。\n要求：\n1. 修正转写错误，补充上下文，语句通顺\n2. 按讨论主题分段，每段有小标题\n3. 末尾单独列出「决议事项」和「待办清单」（含负责人）\n4. 用 markdown 格式输出\n直接输出纪要内容，不要加前缀引导语。",
        "user_prompt_template": "请整理以下会议录音转写内容：\n{content}",
        "variables": ["{content}"],
    },
    "meeting_extract": {
        "task_type": "meeting_extract",
        "label": "📝 会议结构化提取",
        "desc": "从会议纪要中提取决议、待办等结构化信息（系统固定，不开放自定义）",
        "system_prompt": "你是一个专业的会议纪要分析助手。请从会议内容中提取结构化信息。\n以 JSON 格式返回，包含以下字段：\n- decisions: 会议决议列表\n- todos: 待办事项列表，每项包含 task 和 assignee\n- conclusions: 会议结论摘要\n只返回 JSON，不要有其他内容。",
        "user_prompt_template": "请以 json 格式分析以下会议纪要，返回 decisions、todos、conclusions 三个字段：\n{content}",
        "variables": ["{content}"],
    },
    "project_analysis": {
        "task_type": "project_analysis",
        "label": "📈 项目分析",
        "desc": "AI 分析销售项目状态时使用的提示词",
        "system_prompt": "你是专业的销售项目管理助手。综合分析销售项目的跟进现状，给出客观的状态评估、潜在风险和具体的下一步行动建议。结合客户背景、项目进展和历史会议作出判断，输出简洁专业，避免空洞套话。",
        "user_prompt_template": "请分析以下项目：\n\n【基本信息】\n项目名称: {name}\n当前状态: {status}\n涉及产品: {product}\n项目场景: {scenario}\n销售负责人: {sales_person}\n商机金额: {amount}\n截止日期: {deadline}\n\n【客户信息】\n客户名称: {customer_name}\n客户行业: {customer_industry}\n客户规模: {customer_scale}\n核心产品: {customer_products}\n客户简介: {customer_profile}\n\n【跟进记录】\n{progress}\n\n【关联会议】\n{meetings}\n\n请给出：\n1. 当前状态评估（结合跟进记录和客户情况）\n2. 风险提示（考虑客户行业、规模、项目进展）\n3. 后续建议（具体的下一步行动）",
        "variables": ["{name}", "{status}", "{product}", "{scenario}", "{sales_person}", "{amount}", "{deadline}", "{customer_name}", "{customer_industry}", "{customer_scale}", "{customer_products}", "{customer_profile}", "{progress}", "{meetings}"],
    },
    "insight_week": {
        "task_type": "insight_week",
        "label": "🔍 周度洞察",
        "desc": "数据看板中本周 AI 综合洞察使用的提示词",
        "system_prompt": "你是 WorkTrack 数据分析助手。根据本周工作数据，从项目进展、日报完成、会议效率、客户动态等维度给出综合洞察。\n要求：\n1. 给出本周最值得关注的 3 个洞察点\n2. 每条以「•」开头，不超过 40 字\n3. 侧重趋势发现和行动建议\n4. 直接输出 3 行，不加序号或其他内容",
        "user_prompt_template": "请分析本周（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}",
        "variables": ["{range}", "{projects_summary}", "{customers_summary}", "{meetings_summary}", "{reports_summary}"],
    },
    "insight_month": {
        "task_type": "insight_month",
        "label": "📊 月度洞察",
        "desc": "数据看板中本月 AI 综合洞察使用的提示词",
        "system_prompt": "你是 WorkTrack 数据分析助手。根据本月工作数据，分析月度趋势变化、工作效率和团队协作情况，给出综合洞察。\n要求：\n1. 给出本月最值得关注的 3 个洞察点\n2. 每条以「•」开头，不超过 40 字\n3. 侧重月度趋势和结构性问题\n4. 直接输出 3 行，不加序号或其他内容",
        "user_prompt_template": "请分析本月（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}\n周报: {weeklies_summary}",
        "variables": ["{range}", "{projects_summary}", "{customers_summary}", "{meetings_summary}", "{reports_summary}", "{weeklies_summary}"],
    },
    "insight_quarter": {
        "task_type": "insight_quarter",
        "label": "📋 季度洞察",
        "desc": "数据看板中本季度 AI 综合洞察使用的提示词",
        "system_prompt": "你是 WorkTrack 数据分析助手。根据本季度工作数据，进行战略性综合分析，识别季度趋势、瓶颈和优化方向。\n要求：\n1. 给出本季度最关键的 3 个战略洞察\n2. 每条以「•」开头，不超过 40 字\n3. 侧重战略层面和长期改进方向\n4. 直接输出 3 行，不加序号或其他内容",
        "user_prompt_template": "请分析本季度（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}\n周报: {weeklies_summary}",
        "variables": ["{range}", "{projects_summary}", "{customers_summary}", "{meetings_summary}", "{reports_summary}", "{weeklies_summary}"],
    },
    # ===== 以下仅供 AI 服务内部使用，不在设置页暴露 =====
    "chat": {
        "task_type": "chat",
        "label": "💬 通用对话",
        "desc": "AI 助手对话（系统固定）",
        "system_prompt": "你是一个专业、友好的工作助手。回答简洁准确，必要时用 markdown 格式。",
        "user_prompt_template": "{messages}",
        "variables": ["{messages}"],
    },
    "speech_to_text": {
        "task_type": "speech_to_text",
        "label": "🎧 语音转文字",
        "desc": "ASR 模型，无 LLM 提示词",
        "system_prompt": "",
        "user_prompt_template": "",
        "variables": [],
    },
    "vision": {
        "task_type": "vision",
        "label": "🖼️ 图像理解",
        "desc": "图像 OCR 与理解（系统固定）",
        "system_prompt": "你是一个专业的图像理解助手。请仔细阅读图片中的文字内容，准确识别并转写所有可读的中文/英文文字。保留原段落结构，修正明显错别字。如果是表格，请用 markdown 表格输出。",
        "user_prompt_template": "请识别并转写以下图片中的全部文字内容：\n{image_description}",
        "variables": ["{image_description}"],
    },
    "contract_parse": {
        "task_type": "contract_parse",
        "label": "📑 合同解析",
        "desc": "合同关键字段结构化抽取（系统固定）",
        "system_prompt": "你是一个专业的合同解析助手。请从合同文本中抽取关键字段，以 JSON 格式返回。\n要求：\n1. 严格按给定 schema 输出，不要遗漏\n2. 没有的字段填空字符串或空数组\n3. 日期统一 ISO 格式 YYYY-MM-DD\n4. 只返回 JSON，不要其他文字",
        "user_prompt_template": "请解析以下合同文本：\n{content}\n\n字段：甲方、乙方、合同金额、签订日期、生效日期、截止日期、付款方式、违约条款、争议解决",
        "variables": ["{content}"],
    },
    "company_info": {
        "task_type": "company_info",
        "label": "🏢 公司信息整合",
        "desc": "联网搜索结果整合为公司画像（系统固定）",
        "system_prompt": "",
        "user_prompt_template": "",
        "variables": [],
    },
    "embedding": {
        "task_type": "embedding",
        "label": "🧬 文本向量化",
        "desc": "嵌入模型，无 LLM 提示词",
        "system_prompt": "",
        "user_prompt_template": "",
        "variables": [],
    },
}


@router.get("/ai-prompts")
def get_ai_prompts(db: Session = Depends(get_session),
                   current_user: User = Depends(get_current_user)):
    """获取当前用户的 AI 提示词配置（三层合并：用户自定义 > 全局 > 代码默认）"""
    global_prompts = {
        p.task_type: p
        for p in db.exec(select(AIPrompt).where(AIPrompt.user_id == 0)).all()
    }
    user_prompts = {
        p.task_type: p
        for p in db.exec(select(AIPrompt).where(AIPrompt.user_id == current_user.id)).all()
    }
    result = {}
    for key, default in DEFAULT_PROMPTS.items():
        entry = {
            "task_type": key,
            "label": default["label"],
            "desc": default["desc"],
            "system_prompt": default["system_prompt"],
            "user_prompt_template": default["user_prompt_template"],
            "variables": default["variables"],
            "customized": False,
            "source": "default",
        }
        # 第2层：全局提示词覆盖代码默认
        if key in global_prompts:
            gp = global_prompts[key]
            if gp.system_prompt:
                entry["system_prompt"] = gp.system_prompt
            if gp.user_prompt_template:
                entry["user_prompt_template"] = gp.user_prompt_template
            entry["source"] = "global"
        # 第3层：用户自定义覆盖全局
        if key in user_prompts:
            up = user_prompts[key]
            if up.system_prompt:
                entry["system_prompt"] = up.system_prompt
            if up.user_prompt_template:
                entry["user_prompt_template"] = up.user_prompt_template
            entry["customized"] = True
            entry["source"] = "user"
        # 保存全局值供前端展示"恢复为全局默认"
        if key in global_prompts:
            entry["global_system_prompt"] = global_prompts[key].system_prompt
            entry["global_user_prompt_template"] = global_prompts[key].user_prompt_template
        result[key] = entry
    return result


class AIPromptUpdate(BaseModel):
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None


@router.put("/ai-prompts/{task_type}")
def update_ai_prompt(task_type: str, data: AIPromptUpdate, db: Session = Depends(get_session),
                     current_user: User = Depends(get_current_user)):
    """更新当前用户的某个 AI 提示词配置"""
    if task_type not in DEFAULT_PROMPTS:
        raise HTTPException(status_code=404, detail=f"未知任务类型: {task_type}")
    existing = db.exec(
        select(AIPrompt).where(
            AIPrompt.user_id == current_user.id,
            AIPrompt.task_type == task_type,
        )
    ).first()
    if existing:
        if data.system_prompt is not None:
            existing.system_prompt = data.system_prompt
        if data.user_prompt_template is not None:
            existing.user_prompt_template = data.user_prompt_template
        db.add(existing)
    else:
        default = DEFAULT_PROMPTS[task_type]
        prompt = AIPrompt(
            user_id=current_user.id,
            task_type=task_type,
            system_prompt=data.system_prompt if data.system_prompt is not None else default["system_prompt"],
            user_prompt_template=data.user_prompt_template if data.user_prompt_template is not None else default["user_prompt_template"],
        )
        db.add(prompt)
    db.commit()
    return {"task_type": task_type, "saved": True}


@router.put("/ai-prompts/global/{task_type}")
def update_global_ai_prompt(task_type: str, data: AIPromptUpdate, db: Session = Depends(get_session),
                             current_user: User = Depends(require_permission("settings:edit"))):
    """管理员：更新全局默认 AI 提示词（user_id=0，新用户默认继承）"""
    if task_type not in DEFAULT_PROMPTS:
        raise HTTPException(status_code=404, detail=f"未知任务类型: {task_type}")
    existing = db.exec(
        select(AIPrompt).where(
            AIPrompt.user_id == 0,
            AIPrompt.task_type == task_type,
        )
    ).first()
    if existing:
        if data.system_prompt is not None:
            existing.system_prompt = data.system_prompt
        if data.user_prompt_template is not None:
            existing.user_prompt_template = data.user_prompt_template
        db.add(existing)
    else:
        default = DEFAULT_PROMPTS[task_type]
        prompt = AIPrompt(
            user_id=0,
            task_type=task_type,
            system_prompt=data.system_prompt if data.system_prompt is not None else default["system_prompt"],
            user_prompt_template=data.user_prompt_template if data.user_prompt_template is not None else default["user_prompt_template"],
        )
        db.add(prompt)
    db.commit()
    return {"task_type": task_type, "saved": True, "scope": "global"}


@router.delete("/ai-prompts/global/{task_type}")
def reset_global_ai_prompt(task_type: str, db: Session = Depends(get_session),
                           current_user: User = Depends(require_permission("settings:edit"))):
    """管理员：恢复全局提示词为代码默认值"""
    existing = db.exec(
        select(AIPrompt).where(
            AIPrompt.user_id == 0,
            AIPrompt.task_type == task_type,
        )
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
    return {"task_type": task_type, "reset": True, "scope": "global"}


class AIPromptGenerateRequest(BaseModel):
    task_type: str
    requirement: str


@router.post("/ai-prompts/generate")
def generate_ai_prompt(data: AIPromptGenerateRequest, db: Session = Depends(get_session),
                       current_user: User = Depends(get_current_user)):
    """AI 根据用户需求描述，生成规范的系统提示词和用户消息模板"""
    if data.task_type not in DEFAULT_PROMPTS:
        raise HTTPException(status_code=404, detail=f"未知任务类型: {data.task_type}")
    task = DEFAULT_PROMPTS[data.task_type]

    # 构建 prompt engineering 指导提示词
    meta_system = (
        "你是一位资深的 Prompt Engineering 专家。用户会描述他对某个 AI 任务的需求，"
        "你需要为他生成一份高质量的 System Prompt 和 User Prompt Template。\n\n"
        "要求：\n"
        "1. System Prompt：定义 AI 的角色、能力、输出风格和约束条件\n"
        "2. User Prompt Template：定义用户消息的结构，使用 {变量名} 占位\n"
        "3. 提示词应清晰、具体、可执行，避免模糊表述\n"
        "4. 用中文撰写\n\n"
        "只返回一个 JSON 对象，格式如下：\n"
        '{"system_prompt": "...", "user_prompt_template": "..."}\n'
        "不要返回任何其他内容。"
    )

    meta_user = (
        f"任务类型：{task['label']}\n"
        f"任务描述：{task['desc']}\n"
        f"可用变量：{', '.join(task['variables']) if task['variables'] else '无'}\n\n"
        f"用户需求：\n{data.requirement}\n\n"
        "请根据以上信息生成 System Prompt 和 User Prompt Template。"
    )

    try:
        base_url, api_key, model, provider = _get_active_provider(db, "chat", current_user.id)
        client = _get_client(base_url, api_key, provider)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": meta_system},
                {"role": "user", "content": meta_user},
            ],
            temperature=0.5,
            max_tokens=800,
        )
        text = _extract_message_text(response.choices[0].message)
        # 尝试解析 JSON
        import re as _re
        match = _re.search(r'\{[\s\S]*\}', text)
        if match:
            result = json.loads(match.group())
            return {
                "system_prompt": result.get("system_prompt", ""),
                "user_prompt_template": result.get("user_prompt_template", ""),
            }
        # 回退：原始文本
        return {"system_prompt": text, "user_prompt_template": ""}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI 生成失败: {str(e)}")


@router.delete("/ai-prompts/{task_type}")
def reset_ai_prompt(task_type: str, db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    """恢复当前用户的某个 AI 提示词为默认值"""
    existing = db.exec(
        select(AIPrompt).where(
            AIPrompt.user_id == current_user.id,
            AIPrompt.task_type == task_type,
        )
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
    return {"task_type": task_type, "reset": True}


# ===== 系统信息 =====

# 记录服务启动时间
_SERVER_START_TIME = time.time()


@router.get("/system-info")
def system_info(db: Session = Depends(get_session)):
    """获取系统运行信息（数据库类型、供应商数量、用户数等）"""
    # 数据库类型
    db_url = app_settings.database_url
    if "postgresql" in db_url:
        db_type = "PostgreSQL"
    elif "sqlite" in db_url:
        db_type = "SQLite"
    elif "mysql" in db_url:
        db_type = "MySQL"
    else:
        db_type = "未知"

    # 供应商统计
    configured_count = db.exec(select(func.count(ModelProvider.id))).one() or 0
    active_count = db.exec(
        select(func.count(ModelProvider.id)).where(ModelProvider.is_active == True, ModelProvider.api_key != "")
    ).one() or 0

    # 用户数
    total_users = db.exec(select(func.count(User.id))).one() or 0
    admin_count = db.exec(select(func.count(User.id)).where(User.is_admin == True)).one() or 0

    # 运行时间
    uptime_seconds = int(time.time() - _SERVER_START_TIME)
    days, rem = divmod(uptime_seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days > 0:
        uptime_str = f"{days}天{hours}小时{minutes}分钟"
    elif hours > 0:
        uptime_str = f"{hours}小时{minutes}分钟"
    else:
        uptime_str = f"{minutes}分钟"

    # ChromaDB 路径
    chroma_dir = app_settings.effective_chroma_dir
    chroma_size = "未知"
    if os.path.exists(chroma_dir):
        total_size = 0
        for dirpath, _, filenames in os.walk(chroma_dir):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if os.path.isfile(fp):
                    total_size += os.path.getsize(fp)
        if total_size < 1024 * 1024:
            chroma_size = f"{total_size / 1024:.1f} KB"
        else:
            chroma_size = f"{total_size / (1024 * 1024):.1f} MB"

    return {
        "database_type": db_type,
        "database_url": db_url.split("@")[-1] if "@" in db_url else "本地文件",
        "vector_store": "ChromaDB",
        "vector_store_path": chroma_dir,
        "vector_store_size": chroma_size,
        "total_providers": configured_count,
        "active_providers": active_count,
        "total_users": total_users,
        "admin_users": admin_count,
        "uptime": uptime_str,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


# ===== 品牌自定义配置 =====
import uuid
from fastapi import UploadFile, File
from fastapi.responses import FileResponse, Response

BRAND_DIR = app_settings.effective_brand_dir
os.makedirs(BRAND_DIR, exist_ok=True)
ALLOWED_IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'}


class BrandConfigUpdate(BaseModel):
    site_title: str = ""
    logo_url: str = ""


@router.get("/branding")
def get_branding(db: Session = Depends(get_session)):
    """获取品牌配置（logo 和站点标题），公开访问"""
    logo_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "brand_logo_url",
            SystemPreference.user_id == None,
        )
    ).first()
    title_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "brand_site_title",
            SystemPreference.user_id == None,
        )
    ).first()
    return {
        "logo_url": logo_pref.value if logo_pref else "",
        "site_title": title_pref.value if title_pref else "WorkTrack",
    }


@router.put("/branding")
def update_branding(data: BrandConfigUpdate, db: Session = Depends(get_session),
                    _admin: User = Depends(require_permission("settings:edit"))):
    """更新品牌配置（仅管理员）"""
    for key, value in [("brand_site_title", data.site_title), ("brand_logo_url", data.logo_url)]:
        pref = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == key,
                SystemPreference.user_id == None,
            )
        ).first()
        if pref:
            pref.value = value
        else:
            db.add(SystemPreference(key=key, value=value, user_id=None))
    db.commit()
    return {"message": "品牌配置已保存", "site_title": data.site_title, "logo_url": data.logo_url}


@router.post("/branding/upload-logo")
async def upload_brand_logo(file: UploadFile = File(...),
                             _admin: User = Depends(require_permission("settings:edit")),
                             db: Session = Depends(get_session)):
    """上传品牌 Logo（管理员）"""
    ext = os.path.splitext(file.filename or ".png")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式，仅支持: {', '.join(ALLOWED_IMAGE_EXTS)}")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小不能超过 2MB")
    # 清理旧 logo
    for old in os.listdir(BRAND_DIR):
        if old.startswith("logo_"):
            try:
                os.remove(os.path.join(BRAND_DIR, old))
            except OSError:
                pass
    filename = f"logo_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(BRAND_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    logo_url = f"/api/v1/settings/branding/logo-file/{filename}"
    # 写入系统偏好
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "brand_logo_url",
            SystemPreference.user_id == None,
        )
    ).first()
    if pref:
        pref.value = logo_url
    else:
        db.add(SystemPreference(key="brand_logo_url", value=logo_url, user_id=None))
    db.commit()
    return {"logo_url": logo_url, "message": "Logo 上传成功"}


@router.get("/branding/logo-file/{filename}")
def serve_brand_logo(filename: str):
    """获取品牌 Logo 文件"""
    filepath = os.path.join(BRAND_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(filepath)


@router.get("/branding/apple-touch-icon")
def serve_apple_touch_icon(db: Session = Depends(get_session)):
    """iOS Safari 添加到主屏幕图标（始终返回当前品牌 Logo）"""
    # 1) 尝试读取自定义品牌 Logo
    logo_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "brand_logo_url",
            SystemPreference.user_id == None,
        )
    ).first()
    if logo_pref and logo_pref.value and logo_pref.value.strip():
        url_path = logo_pref.value.strip()
        # 尝试从 url 中提取文件名，在 BRAND_DIR 中查找
        potential_name = url_path.rsplit("/", 1)[-1]
        filepath = os.path.join(BRAND_DIR, potential_name)
        if os.path.isfile(filepath):
            ext = os.path.splitext(potential_name)[1].lower()
            media = "image/png" if ext in (".png",) else "image/jpeg" if ext in (".jpg", ".jpeg") else "image/webp" if ext == ".webp" else "image/svg+xml" if ext == ".svg" else "image/png"
            return FileResponse(filepath, media_type=media)
        # 如果文件名不匹配，尝试查找 BRAND_DIR 中所有 logo_ 文件
        for fname in sorted(os.listdir(BRAND_DIR), reverse=True):
            if fname.startswith("logo_"):
                return FileResponse(os.path.join(BRAND_DIR, fname))
    # 2) 回退：尝试 pwa-192x192.png
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    for candidate in [
        os.path.join(base_dir, "data", "pwa-192x192.png"),
        os.path.join(base_dir, "frontend", "public", "pwa-192x192.png"),
        os.path.join(base_dir, "frontend", "public", "favicon.svg"),
    ]:
        if os.path.isfile(candidate):
            return FileResponse(candidate, media_type="image/png" if candidate.endswith('.png') else "image/svg+xml")
    # 3) 最终回退：返回 1x1 透明 PNG 避免 iOS 生成字母图标
    import base64
    blank_png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    return Response(content=blank_png, media_type="image/png")


@router.get("/branding/manifest")
def serve_manifest(db: Session = Depends(get_session)):
    """动态 Web App Manifest，使用当前品牌名和图标"""
    logo_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "brand_logo_url",
            SystemPreference.user_id == None,
        )
    ).first()
    title_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "brand_site_title",
            SystemPreference.user_id == None,
        )
    ).first()
    site_title = title_pref.value if title_pref else "WorkTrack"
    # 强制使用静态图标，确保PWA兼容性
    icon_192 = "/pwa-192x192.png"
    icon_512 = "/pwa-512x512.png"
    return {
        "name": site_title,
        "short_name": site_title,
        "description": "AI 增强型工作日报与项目管理平台",
        "start_url": "/",
        "display": "standalone",
        "orientation": "portrait-primary",
        "background_color": "#101720",
        "theme_color": "#101720",
        "icons": [
            {"src": icon_192, "sizes": "64x64", "type": "image/png", "purpose": "any maskable"},
            {"src": icon_192, "sizes": "128x128", "type": "image/png", "purpose": "any maskable"},
            {"src": icon_192, "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": icon_192, "sizes": "256x256", "type": "image/png", "purpose": "any maskable"},
            {"src": icon_512, "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }


# ===== MCP 服务配置 =====
import secrets
import string

MCP_KEY_BYTES = 32


def _generate_mcp_key() -> str:
    """生成 32 字节安全的 API Key"""
    return "wt-mcp-" + secrets.token_urlsafe(MCP_KEY_BYTES)


class MCPConfigUpdate(BaseModel):
    enabled: bool = True
    public_url: Optional[str] = None


@router.get("/mcp-config")
def get_mcp_config(db: Session = Depends(get_session),
                   _user: User = Depends(require_permission("settings:read"))):
    """获取 MCP 配置（需登录；完整 Key 仅对已认证用户返回，用于拷贝到外部工具）"""
    key_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "mcp_api_key",
            SystemPreference.user_id == None,
        )
    ).first()
    enabled_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "mcp_enabled",
            SystemPreference.user_id == None,
        )
    ).first()
    url_pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "mcp_public_url",
            SystemPreference.user_id == None,
        )
    ).first()
    raw_key = key_pref.value if key_pref else ""
    return {
        "api_key": raw_key,
        "api_key_masked": (raw_key[:12] + "..." + raw_key[-4:]) if len(raw_key) > 16 else raw_key,
        "enabled": enabled_pref.value == "true" if enabled_pref else False,
        "server_url": "/mcp",
        "public_url": url_pref.value if url_pref else "",
        "has_key": len(raw_key) > 0,
    }


@router.put("/mcp-config")
def update_mcp_config(data: MCPConfigUpdate, db: Session = Depends(get_session),
                      _admin: User = Depends(require_permission("settings:edit"))):
    """启用/禁用 MCP 服务 + 设置公开访问地址"""
    for key, value in [("mcp_enabled", "true" if data.enabled else "false"),
                       ("mcp_public_url", data.public_url)]:
        if key == "mcp_public_url" and value is None:
            continue
        pref = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == key,
                SystemPreference.user_id == None,
            )
        ).first()
        if pref:
            pref.value = value
        else:
            db.add(SystemPreference(key=key, value=value, user_id=None))
    db.commit()
    return {"enabled": data.enabled, "public_url": data.public_url,
            "message": "MCP 服务已" + ("启用" if data.enabled else "停用")}


@router.post("/mcp-config/generate-key")
def generate_mcp_key(db: Session = Depends(get_session),
                     _admin: User = Depends(require_permission("settings:edit"))):
    """生成新的 MCP API Key（旧 Key 立即失效）"""
    new_key = _generate_mcp_key()
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "mcp_api_key",
            SystemPreference.user_id == None,
        )
    ).first()
    if pref:
        pref.value = new_key
    else:
        db.add(SystemPreference(key="mcp_api_key", value=new_key, user_id=None))
    db.commit()
    return {"api_key": new_key, "message": "API Key 已重新生成，请妥善保存"}


# ──────────────────────────── 邮件服务配置 ────────────────────────────

EMAIL_CONFIG_KEYS = ["enabled", "host", "port", "username", "password", "from_name", "use_tls", "use_ssl", "provider"]


class EmailConfigUpdate(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = 587
    username: str = ""
    password: Optional[str] = None  # None 表示不更新密码
    from_name: str = "WorkTrack 系统"
    use_tls: bool = True
    use_ssl: bool = False
    provider: str = "smtp"


class EmailTestRequest(BaseModel):
    to: str


@router.get("/email-config")
def get_email_config(
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """获取邮件配置（密码以 *** 掩码返回）"""
    if not current_user.is_admin:
        raise HTTPException(403, "仅管理员可查看邮件配置")
    rows = db.exec(
        select(SystemPreference).where(
            SystemPreference.user_id == None,
            SystemPreference.key.startswith("email."),
        )
    ).all()
    cfg: dict = {r.key[len("email."):]: r.value for r in rows}
    result = {
        "enabled": cfg.get("enabled") == "true",
        "host": cfg.get("host", ""),
        "port": int(cfg.get("port", 587)),
        "username": cfg.get("username", ""),
        "password_set": bool(cfg.get("password")),
        "from_name": cfg.get("from_name", "WorkTrack 系统"),
        "use_tls": cfg.get("use_tls", "true") == "true",
        "use_ssl": cfg.get("use_ssl", "false") == "true",
        "provider": cfg.get("provider", "smtp"),
    }
    from app.services.email_service import PROVIDER_PRESETS
    result["presets"] = PROVIDER_PRESETS
    return result


@router.put("/email-config")
def update_email_config(
    data: EmailConfigUpdate,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """更新邮件配置（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(403, "仅管理员可修改邮件配置")

    updates: dict = {
        "enabled": "true" if data.enabled else "false",
        "host": data.host,
        "port": str(data.port),
        "username": data.username,
        "from_name": data.from_name,
        "use_tls": "true" if data.use_tls else "false",
        "use_ssl": "true" if data.use_ssl else "false",
        "provider": data.provider,
    }
    if data.password is not None:
        updates["password"] = data.password

    for field, value in updates.items():
        key = f"email.{field}"
        row = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == key, SystemPreference.user_id == None
            )
        ).first()
        if row:
            row.value = value
            db.add(row)
        else:
            db.add(SystemPreference(key=key, value=value, user_id=None))
    db.commit()
    return {"message": "邮件配置已保存"}


@router.post("/email-config/test")
def test_email_config(
    data: EmailTestRequest,
    current_user: User = Depends(get_current_user),
):
    """发送测试邮件（仅管理员）"""
    if not current_user.is_admin:
        raise HTTPException(403, "仅管理员可发送测试邮件")
    if not data.to or "@" not in data.to:
        raise HTTPException(400, "请填写有效的收件邮箱")
    from app.services.email_service import test_send
    result = test_send(data.to)
    if not result["ok"]:
        raise HTTPException(400, result["message"])
    return result
