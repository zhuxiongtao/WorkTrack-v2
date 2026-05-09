from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, or_
from pydantic import BaseModel
from app.database import get_session
from app.models.model_provider import ModelProvider, TaskModelConfig, ProviderModel
from app.models.field_option import FieldOption
from app.models.system_preference import SystemPreference
from app.models.ai_prompt import AIPrompt
from app.models.user import User
from app.auth import get_current_user, get_current_admin_user
from app.services.ai_service import _extract_message_text, _get_active_provider, _get_client
from app.config import settings as app_settings

import os
import json
import time
from datetime import datetime, timezone

router = APIRouter(prefix="/api/v1/settings", tags=["设置"])


def _get_visible_providers_query(db: Session, user: User | None):
    """返回当前用户可见的供应商查询条件"""
    if user is None:
        return select(ModelProvider).where(ModelProvider.user_id == None)
    if user.is_admin:
        return select(ModelProvider)
    conditions = []
    if user.use_shared_models:
        conditions.append(ModelProvider.user_id == None)
    if user.can_manage_models:
        conditions.append(ModelProvider.user_id == user.id)
    if not conditions:
        return select(ModelProvider).where(ModelProvider.id == -1)
    query = select(ModelProvider).where(or_(*conditions))
    return query


def _check_provider_access(provider: ModelProvider, user: User | None) -> bool:
    """检查用户是否有权限访问某个供应商（读或写）"""
    if user is None or not user.is_admin:
        if user and user.can_manage_models and provider.user_id == user.id:
            return True  # 拥有自己创建的
        if user and user.use_shared_models and provider.user_id is None:
            return True  # 可使用共享的
        return False
    return True  # 管理员全部可访问


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
    return db.exec(query.order_by(ModelProvider.created_at.desc())).all()


@router.post("/providers", status_code=201)
def create_provider(data: ProviderCreate, db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    is_admin = current_user.is_admin
    if not is_admin and not current_user.can_manage_models:
        raise HTTPException(status_code=403, detail="无权限创建模型供应商")
    provider = ModelProvider(**data.model_dump())
    if not is_admin:
        provider.user_id = current_user.id
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


@router.put("/providers/{provider_id}")
def update_provider(provider_id: int, data: ProviderUpdate, db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user):
        raise HTTPException(status_code=403, detail="无权限修改此供应商")
    if not current_user.is_admin and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能修改自己的供应商")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(provider, key, value)
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return provider


@router.delete("/providers/{provider_id}", status_code=204)
def delete_provider(provider_id: int, db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user):
        raise HTTPException(status_code=403, detail="无权限删除此供应商")
    if not current_user.is_admin and provider.user_id != current_user.id:
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

class ModelAdd(BaseModel):
    model_name: str
    model_type: str = "chat"


def _guess_model_type(name: str) -> str:
    """智能推断模型类型"""
    low = name.lower()
    if any(k in low for k in ["asr", "speech", "transcribe", "whisper", "transcriber", "parakeet", "sensevoice"]):
        return "speech_to_text"
    if any(k in low for k in ["embed", "bge-", "bce-"]):
        return "embedding"
    if any(k in low for k in ["vision", "vl-", "image", "ocr", "video", "kolors", "wan-"]):
        return "vision"
    if any(k in low for k in ["search", "tavily", "bing", "google", "serp", "crawl"]):
        return "web_search"
    if any(k in low for k in ["gemini"]):
        return "chat"  # Gemini 默认 chat，部分支持 vision
    return "chat"


@router.get("/providers/{provider_id}/models")
def list_provider_models(provider_id: int, db: Session = Depends(get_session),
                         current_user: User = Depends(get_current_user)):
    """获取供应商下已配置的模型列表"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user):
        raise HTTPException(status_code=403, detail="无权限访问此供应商")
    models = db.exec(
        select(ProviderModel).where(ProviderModel.provider_id == provider_id).order_by(ProviderModel.created_at)
    ).all()
    return [{"id": m.id, "model_name": m.model_name, "model_type": m.model_type, "created_at": m.created_at.isoformat()} for m in models]


@router.post("/providers/{provider_id}/models", status_code=201)
def add_provider_model(provider_id: int, data: ModelAdd, db: Session = Depends(get_session),
                       current_user: User = Depends(get_current_user)):
    """给供应商添加一个模型"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user):
        raise HTTPException(status_code=403, detail="无权限操作此供应商")
    if not current_user.is_admin and provider.user_id != current_user.id:
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
    model = ProviderModel(provider_id=provider_id, model_name=data.model_name, model_type=mtype)
    db.add(model)
    db.commit()
    db.refresh(model)
    return {"id": model.id, "model_name": model.model_name, "model_type": model.model_type}


@router.delete("/providers/{provider_id}/models/{model_id}", status_code=204)
def remove_provider_model(provider_id: int, model_id: int, db: Session = Depends(get_session),
                          current_user: User = Depends(get_current_user)):
    """删除供应商下的一个模型"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user):
        raise HTTPException(status_code=403, detail="无权限操作此供应商")
    if not current_user.is_admin and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能管理自己的供应商模型")
    model = db.get(ProviderModel, model_id)
    if not model or model.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="模型不存在")
    db.delete(model)
    db.commit()


class ModelUpdate(BaseModel):
    model_type: Optional[str] = None
    model_name: Optional[str] = None


@router.put("/providers/{provider_id}/models/{model_id}")
def update_provider_model(provider_id: int, model_id: int, data: ModelUpdate, db: Session = Depends(get_session),
                          current_user: User = Depends(get_current_user)):
    """更新模型的类型或名称"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    if not _check_provider_access(provider, current_user):
        raise HTTPException(status_code=403, detail="无权限操作此供应商")
    if not current_user.is_admin and provider.user_id != current_user.id:
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
    db.add(model)
    db.commit()
    db.refresh(model)
    return {"id": model.id, "model_name": model.model_name, "model_type": model.model_type}


@router.post("/providers/{provider_id}/models/{model_id}/test")
def test_provider_model(provider_id: int, model_id: int, db: Session = Depends(get_session)):
    """测试单个模型连通性（按 model_type 调用相应 API）"""
    model = db.get(ProviderModel, model_id)
    if not model or model.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="模型不存在")
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
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
def test_provider(provider_id: int, db: Session = Depends(get_session)):
    """测试模型供应商连接"""
    provider = db.get(ModelProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="供应商不存在")
    result = {"success": False, "message": "", "models_found": 0}
    try:
        from app.services.ai_service import _get_client, _is_vertex_ai
        client = _get_client(provider.base_url, provider.api_key, provider)
        # 先测试模型列表
        try:
            if _is_vertex_ai(provider):
                # 使用 genai SDK 拉取真实模型列表
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
                model_ids = [m.name for m in models_data if "publishers/google" in m.name]
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
        if not candidates:
            candidates.append("gpt-3.5-turbo")
        priority_kw = ["chat", "instruct", "deepseek", "qwen", "gpt", "claude", "llama", "glm", "yi-", "moonshot"]
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
    if not _check_provider_access(provider, current_user):
        raise HTTPException(status_code=403, detail="无权限拉取模型列表")
    if not current_user.is_admin and provider.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能管理自己的供应商")

    try:
        from app.services.ai_service import _is_vertex_ai, _get_vertex_credentials
        if _is_vertex_ai(provider):
            # 使用 genai SDK 拉取 Vertex AI 真实可用模型列表
            from google import genai
            credentials = _get_vertex_credentials(provider)
            client = genai.Client(
                vertexai=True,
                project=provider.project_id,
                location=provider.location or "global",
                credentials=credentials,
            )
            models_data = list(client.models.list())
            models = []
            for m in models_data:
                name = m.name  # e.g. "publishers/google/models/gemini-2.5-flash"
                if "publishers/" in name:
                    # 提取模型短名，如 "gemini-2.5-flash"
                    short_name = name.split("/")[-1]
                    models.append({"id": short_name, "owned_by": name.split("/")[-3] if len(name.split("/")) >= 3 else "google"})
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
        return {"success": False, "message": str(e)[:200]}


# ===== 任务-模型配置 =====

class TaskModelUpdate(BaseModel):
    task_type: str
    provider_id: Optional[int] = None
    model_name: str = ""


@router.get("/task-models")
def get_task_models(db: Session = Depends(get_session),
                    current_user: User = Depends(get_current_user)):
    """获取任务模型配置：用户私有 +（有权限时）共享"""
    is_admin = current_user.is_admin
    use_shared = is_admin or current_user.use_shared_models
    uid = current_user.id if not is_admin else None

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
    result = {}
    for c in configs:
        provider = db.get(ModelProvider, c.provider_id) if c.provider_id else None
        cfg = {
            "task_type": c.task_type,
            "provider_id": c.provider_id,
            "provider_name": provider.name if provider else None,
            "model_name": c.model_name,
            "user_id": c.user_id,
        }
        if c.user_id is None and c.task_type not in result:
            result[c.task_type] = cfg
        elif c.user_id is not None:
            result[c.task_type] = cfg
    return result


@router.put("/task-models")
def update_task_model(data: TaskModelUpdate, db: Session = Depends(get_session),
                      current_user: User = Depends(get_current_user)):
    """更新任务模型配置：管理员更新共享的，普通用户更新自己的"""
    is_admin = current_user.is_admin
    uid = None if is_admin else current_user.id
    config = db.exec(
        select(TaskModelConfig).where(
            TaskModelConfig.task_type == data.task_type,
            TaskModelConfig.user_id == uid,
        )
    ).first()
    if not config:
        config = TaskModelConfig(task_type=data.task_type, provider_id=data.provider_id, model_name=data.model_name, user_id=uid)
        db.add(config)
    else:
        config.provider_id = data.provider_id
        config.model_name = data.model_name
        db.add(config)
    db.commit()
    db.refresh(config)
    return {"task_type": config.task_type, "provider_id": config.provider_id, "model_name": config.model_name, "user_id": config.user_id}


# ===== 字段选项管理 =====

class FieldOptionCreate(BaseModel):
    category: str
    value: str
    sort_order: int = 0


class FieldOptionBatchUpdate(BaseModel):
    category: str
    values: List[str]


@router.get("/field-options")
def list_field_options(category: Optional[str] = None, db: Session = Depends(get_session)):
    """获取字段选项，可按分类筛选"""
    query = select(FieldOption).order_by(FieldOption.sort_order, FieldOption.id)
    if category:
        query = query.where(FieldOption.category == category)
    return db.exec(query).all()


@router.post("/field-options", status_code=201)
def create_field_option(data: FieldOptionCreate, db: Session = Depends(get_session),
                        _admin: User = Depends(get_current_admin_user)):
    opt = FieldOption(**data.model_dump())
    db.add(opt)
    db.commit()
    db.refresh(opt)
    return opt


@router.put("/field-options/{option_id}")
def update_field_option(option_id: int, data: FieldOptionCreate, db: Session = Depends(get_session),
                        _admin: User = Depends(get_current_admin_user)):
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
                        _admin: User = Depends(get_current_admin_user)):
    opt = db.get(FieldOption, option_id)
    if not opt:
        raise HTTPException(status_code=404, detail="选项不存在")
    db.delete(opt)
    db.commit()


@router.post("/field-options/batch")
def batch_update_field_options(data: FieldOptionBatchUpdate, db: Session = Depends(get_session),
                               _admin: User = Depends(get_current_admin_user)):
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
def list_field_categories(db: Session = Depends(get_session)):
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
    """获取当前用户的 Tavily API Key"""
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "tavily_api_key",
            SystemPreference.user_id == current_user.id,
        )
    ).first()
    return {"api_key": pref.value if pref else ""}


@router.put("/tavily-config")
def update_tavily_config(data: TavilyConfigUpdate, db: Session = Depends(get_session),
                         current_user: User = Depends(get_current_user)):
    """更新当前用户的 Tavily API Key"""
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
        "system_prompt": "你是一个专业的工作助手，请用简洁的中文总结以下日报内容，提取关键工作事项和成果。",
        "user_prompt_template": "请总结以下工作日报：\n{content}",
        "variables": ["{content}"],
    },
    "weekly_summary": {
        "task_type": "weekly_summary",
        "label": "📊 周报总结",
        "desc": "在周报页面生成整周 AI 总结时使用的提示词",
        "system_prompt": "你是一个专业的周报总结助手。请根据本周的日报内容，生成一份简洁的工作周报总结。要求：1. 概括本周主要工作内容 2. 突出重要进展和成果 3. 指出待解决的问题 4. 用 markdown 格式输出，结构清晰。",
        "user_prompt_template": "请总结本周（{week_range}）的工作情况：\n\n{reports_content}",
        "variables": ["{week_range}", "{reports_content}"],
    },
    "meeting_organize": {
        "task_type": "meeting_organize",
        "label": "🎙️ 会议纪要整理",
        "desc": "录音转文字后 AI 整理会议纪要时使用的提示词",
        "system_prompt": "你是一个专业的会议纪要整理助手。请将以下语音转文字内容整理成结构化的会议纪要。\n要求：\n1. 修正转写错误，补充上下文使语句通顺\n2. 按讨论主题分段，每段有小标题\n3. 提取关键决策和待办事项\n4. 用 markdown 格式输出\n请直接输出整理后的会议纪要，不要加\"以下是整理后的...\"之类的引导语。",
        "user_prompt_template": "请整理以下会议录音转写内容：\n{content}",
        "variables": ["{content}"],
    },
    "meeting_extract": {
        "task_type": "meeting_extract",
        "label": "📝 会议结构化提取",
        "desc": "从会议纪要中提取决议、待办等结构化信息时使用的提示词",
        "system_prompt": "你是一个专业的会议纪要分析助手。请从会议内容中提取结构化信息。\n以 JSON 格式返回，包含以下字段：\n- decisions: 会议决议列表\n- todos: 待办事项列表，每项包含 task 和 assignee\n- conclusions: 会议结论摘要\n只返回 JSON，不要有其他内容。",
        "user_prompt_template": "请以 json 格式分析以下会议纪要，返回 decisions、todos、conclusions 三个字段：\n{content}",
        "variables": ["{content}"],
    },
    "project_analysis": {
        "task_type": "project_analysis",
        "label": "📈 项目分析",
        "desc": "AI 分析项目状态时使用的提示词",
        "system_prompt": "你是一个专业的项目管理助手，请分析项目状态并给出建议。",
        "user_prompt_template": "请分析以下项目：\n项目名称: {name}\n状态: {status}\n截止日期: {deadline}\n关联会议: {meetings}\n请给出项目分析，包括：当前状态评估、风险提示、后续建议。",
        "variables": ["{name}", "{status}", "{deadline}", "{meetings}"],
    },
    "insight_week": {
        "task_type": "insight_week",
        "label": "🔍 周度洞察",
        "desc": "数据看板中本周 AI 综合洞察使用的提示词",
        "system_prompt": "你是 WorkTrack 的数据分析助手。请根据本周工作数据，从项目进展、日报提交、会议效率、客户动态等维度进行综合立体分析。\n要求：\n1. 发现本周最值得关注的 3 个点\n2. 每条洞察用「•」开头，不超过 50 字\n3. 侧重趋势发现和行动建议\n4. 直接输出 3 行，不要序号和其他内容",
        "user_prompt_template": "请分析本周（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}\n周报: {weeklies_summary}",
        "variables": ["{range}", "{projects_summary}", "{customers_summary}", "{meetings_summary}", "{reports_summary}", "{weeklies_summary}"],
    },
    "insight_month": {
        "task_type": "insight_month",
        "label": "📊 月度洞察",
        "desc": "数据看板中本月 AI 综合洞察使用的提示词",
        "system_prompt": "你是 WorkTrack 的高级数据分析师。请根据本月工作数据进行综合深度分析，关注月度趋势变化、工作效率、团队协作模式。\n要求：\n1. 发现本月最值得关注的 3 个趋势或问题\n2. 每条洞察用「•」开头，不超过 50 字\n3. 侧重长期趋势和结构性建议\n4. 直接输出 3 行，不要序号和其他内容",
        "user_prompt_template": "请分析本月（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}\n周报: {weeklies_summary}",
        "variables": ["{range}", "{projects_summary}", "{customers_summary}", "{meetings_summary}", "{reports_summary}", "{weeklies_summary}"],
    },
    "insight_quarter": {
        "task_type": "insight_quarter",
        "label": "📋 季度洞察",
        "desc": "数据看板中本季度 AI 综合洞察使用的提示词",
        "system_prompt": "你是 WorkTrack 的资深战略分析师。请根据本季度工作数据进行战略性综合分析，识别大局趋势、瓶颈模式和优化方向。\n要求：\n1. 给出本季度最关键的 3 个洞察\n2. 每条洞察用「•」开头，不超过 50 字\n3. 侧重战略层面和长期改进\n4. 直接输出 3 行，不要序号和其他内容",
        "user_prompt_template": "请分析本季度（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}\n周报: {weeklies_summary}",
        "variables": ["{range}", "{projects_summary}", "{customers_summary}", "{meetings_summary}", "{reports_summary}", "{weeklies_summary}"],
    },
}


@router.get("/ai-prompts")
def get_ai_prompts(db: Session = Depends(get_session),
                   current_user: User = Depends(get_current_user)):
    """获取当前用户的 AI 提示词配置（合并用户自定义和默认值）"""
    saved = {
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
        }
        if key in saved:
            sp = saved[key]
            if sp.system_prompt:
                entry["system_prompt"] = sp.system_prompt
            if sp.user_prompt_template:
                entry["user_prompt_template"] = sp.user_prompt_template
            entry["customized"] = True
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


# ===== 行业标准化分类 =====

DEFAULT_INDUSTRY_CATEGORIES = [
    # ===== AI / 大模型 =====
    "大模型基础研发与训练平台",
    "AI Agent / 智能体开发",
    "向量数据库 / 知识检索 RAG",
    "模型推理优化与部署 MLOps",
    "AI 安全 / 对齐 / 可解释性",
    "多模态 / 视觉生成 AIGC",
    "语音 / NLP / 对话 AI",
    "AI 芯片 / 算力基础设施",
    "开源模型生态与工具链",

    # ===== 云计算 =====
    "云原生 / 容器 / Kubernetes",
    "公有云 IaaS / PaaS",
    "混合云 / 多云管理",
    "边缘计算 / CDN / 分布式云",
    "Serverless / FaaS",
    "云安全 / 零信任 / WAF",
    "FinOps / 云成本优化",
    "DevOps / CI/CD / GitOps",
    "可观测性 / AIOps / 运维平台",

    # ===== 企业服务 / SaaS =====
    "协同办公 / 企业 IM",
    "CRM / 营销自动化",
    "ERP / 财务 / HR SaaS",
    "低代码 / 无代码平台",
    "数据中台 / 数据治理",

    # ===== 其他垂直行业 =====
    "金融科技 / 支付 / 数字银行",
    "新能源汽车 / 智能出行",
    "半导体 / 芯片 / EDA",
    "电商 / 新零售 / 跨境电商",
    "社交媒体 / 内容平台",
    "游戏 / 互动娱乐",
    "在线教育 / 教育科技",
    "医疗健康 / 数字医疗",
    "物流 / 供应链 / 配送",
    "网络安全 / 信息安全",
    "物联网 / 智能硬件",
    "消费电子 / 智能家居",
    "农业科技 / 食品科技",
    "新能源 / 碳中和 / 环保",
    "法律科技 / 合规科技",
    "航空航天 / 卫星 / 低空经济",
    "自动驾驶 / 智能交通",
    "工业互联网 / 智能制造",
    "旅游 / 出行服务",
    "本地生活 / 餐饮 / 即时零售",
    "保险科技",
    "通信 / 5G / 6G",
    "政务 / 智慧城市 / 数字政府",
    "区块链 / Web3 / 数字资产",
    "广告营销 / MarTech",
    "人力资源 / 招聘科技",
]


def _get_industry_categories(db: Session) -> list[str]:
    """从 SystemPreference 读取行业分类，没有则返回默认"""
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "industry_categories",
            SystemPreference.user_id == None,
        )
    ).first()
    if pref and pref.value:
        cats = [c.strip() for c in pref.value.split("\n") if c.strip()]
        if cats:
            return cats
    return list(DEFAULT_INDUSTRY_CATEGORIES)


@router.get("/industry-categories")
def get_industry_categories(current_user: User = Depends(get_current_user),
                           db: Session = Depends(get_session)):
    """获取行业标准化分类列表"""
    return {"categories": _get_industry_categories(db)}


class IndustryCategoriesUpdate(BaseModel):
    categories: str


@router.put("/industry-categories")
def update_industry_categories(data: IndustryCategoriesUpdate, current_user: User = Depends(get_current_user),
                               _admin: User = Depends(get_current_admin_user),
                               db: Session = Depends(get_session)):
    """更新行业分类（管理员），data.categories 为换行分隔字符串"""
    cats = data.categories.strip()
    if not cats:
        raise HTTPException(status_code=400, detail="分类不能为空")
    pref = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == "industry_categories",
            SystemPreference.user_id == None,
        )
    ).first()
    if pref:
        pref.value = cats
    else:
        db.add(SystemPreference(key="industry_categories", value=cats, user_id=None))
    db.commit()
    return {"categories": cats.split("\n"), "saved": True}


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
    total_providers = db.exec(select(ModelProvider)).all()
    configured_count = len(total_providers)
    active_count = len([p for p in total_providers if p.is_active and p.api_key])

    # 用户数
    user_count = db.exec(select(User)).all()
    admin_count = len([u for u in user_count if u.is_admin])
    total_users = len(user_count)

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
    chroma_dir = app_settings.chroma_persist_dir
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

BRAND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "brand")
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
                    _admin: User = Depends(get_current_admin_user)):
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
                             _admin: User = Depends(get_current_admin_user),
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
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    for candidate in [
        os.path.join(base_dir, "data", "pwa-192x192.png"),
        os.path.join(base_dir, "..", "frontend", "public", "pwa-192x192.png"),
    ]:
        if os.path.isfile(candidate):
            return FileResponse(candidate, media_type="image/png")
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
    icon_url = logo_pref.value if (logo_pref and logo_pref.value) else "/api/v1/settings/branding/apple-touch-icon"
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
            {"src": icon_url, "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": icon_url, "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
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
def get_mcp_config(db: Session = Depends(get_session)):
    """获取 MCP 配置（API Key 脱敏展示）"""
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
                      _admin: User = Depends(get_current_admin_user)):
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
                     _admin: User = Depends(get_current_admin_user)):
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
