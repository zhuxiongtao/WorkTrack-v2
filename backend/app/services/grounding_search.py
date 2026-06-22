"""Gemini 接地搜索（Grounding with Google Search）

通过 Vertex AI / Gemini API 的 google_search 工具，让 Gemini 模型直接联网检索
实时信息，并返回带引用来源（grounding metadata）的答案。作为 Tavily 之外的
主力搜索通道。

返回结构与 web_search.search_web 完全一致（list[dict]，含 answer + result），
因此可被所有现有搜索调用方无缝复用。
"""
import logging
from sqlmodel import Session, select

from app.models.model_provider import ModelProvider, TaskModelConfig

logger = logging.getLogger("worktrack")


def _strip_vertex_prefix(model_name: str) -> str:
    """Vertex 原生模型名不带 google/ 前缀"""
    if model_name and model_name.startswith("google/"):
        return model_name[len("google/"):]
    return model_name


def _pick_grounding_provider(db: Session, user_id: int = 0):
    """挑选可用于接地搜索的 (provider, model_name)。

    优先级：web_search 任务配置 > chat 任务配置 > 任意 active 的 Vertex/Gemini 供应商。
    仅接受 Vertex AI（带 project_id）或 Gemini API（generativelanguage）供应商。
    挑不到返回 (None, None)。
    """
    from app.services.ai_service import _is_vertex_ai, _is_gemini

    def _accept(p):
        return bool(p and p.is_active and (_is_vertex_ai(p) or _is_gemini(p)))

    uids = [user_id, None] if user_id else [None]
    for task_type in ("web_search", "chat"):
        for uid in uids:
            tc = db.exec(
                select(TaskModelConfig).where(
                    TaskModelConfig.task_type == task_type,
                    TaskModelConfig.user_id == uid,
                )
            ).first()
            if tc and tc.provider_id and tc.model_name:
                p = db.get(ModelProvider, tc.provider_id)
                if _accept(p):
                    return p, _strip_vertex_prefix(tc.model_name)

    # 兜底：任意 active 的 Vertex/Gemini 供应商，挑一个 gemini 模型
    provs = db.exec(select(ModelProvider).where(ModelProvider.is_active == True)).all()
    for p in provs:
        if not (_is_vertex_ai(p) or _is_gemini(p)):
            continue
        m = next((mm for mm in p.models_rel if "gemini" in (mm.model_name or "").lower()), None)
        if m:
            return p, _strip_vertex_prefix(m.model_name)
        if _is_vertex_ai(p):
            return p, "gemini-2.5-flash"
    return None, None


def has_grounding_provider(db: Session, user_id: int = 0) -> bool:
    """是否存在可用于接地搜索的供应商（供 auto 模式判定）"""
    try:
        p, m = _pick_grounding_provider(db, user_id)
        return bool(p and m)
    except Exception:
        return False


def _build_genai_client(provider: ModelProvider, timeout_s: float = 40.0):
    """根据供应商类型构建 google-genai 客户端（Vertex 走服务账号，Gemini API 走 api_key）。

    带硬超时（默认 40s），避免接地搜索在网络异常时无限挂起拖垮整个请求。
    """
    from google import genai

    http_opts = None
    try:
        from google.genai import types
        http_opts = types.HttpOptions(timeout=int(timeout_s * 1000))  # 毫秒
    except Exception:
        http_opts = None

    from app.services.ai_service import _is_vertex_ai, _get_vertex_credentials

    if _is_vertex_ai(provider):
        creds = _get_vertex_credentials(provider)
        kwargs = dict(
            vertexai=True,
            project=provider.project_id,
            location=provider.location or "global",
            credentials=creds,
        )
    else:
        # Gemini API (AI Studio)
        kwargs = dict(api_key=provider.api_key)
    if http_opts is not None:
        kwargs["http_options"] = http_opts
    return genai.Client(**kwargs)


def _record_usage(db, resp, user_id, provider_id, model_name):
    """把 genai 的 usage_metadata 转成统一用量并记录（异常静默）"""
    try:
        from app.services.ai_service import _FakeUsage, _FakeResponse, _record_usage_silent
        um = getattr(resp, "usage_metadata", None)
        if not um:
            return
        usage = _FakeUsage(
            prompt_tokens=getattr(um, "prompt_token_count", 0) or 0,
            completion_tokens=getattr(um, "candidates_token_count", 0) or 0,
            total_tokens=getattr(um, "total_token_count", 0) or 0,
        )
        _record_usage_silent(
            db, _FakeResponse(choices=[], usage=usage),
            user_id or 0, provider_id, model_name, "web_search",
        )
    except Exception:
        pass


def _parse_response(resp) -> list[dict]:
    """解析 genai 响应为 [{type:answer},{type:result,...}]，与 Tavily 结构一致"""
    out: list[dict] = []
    answer = (getattr(resp, "text", "") or "").strip()
    if answer:
        out.append({"type": "answer", "content": answer})
    try:
        cand = (resp.candidates or [None])[0]
        gm = getattr(cand, "grounding_metadata", None)
        chunks = getattr(gm, "grounding_chunks", None) or []
        seen = set()
        for ch in chunks:
            web = getattr(ch, "web", None)
            if not web:
                continue
            uri = getattr(web, "uri", "") or ""
            title = getattr(web, "title", "") or ""
            key = uri or title
            if not key or key in seen:
                continue
            seen.add(key)
            out.append({
                "type": "result",
                "title": title,
                "url": uri,
                "content": title,
                "score": 0,
            })
    except Exception as e:
        logger.debug("解析接地来源失败: %s", e)
    return out


def grounding_search(query: str, db: Session, user_id: int = 0, max_results: int = 5,
                     timeout_s: float = 40.0) -> list[dict]:
    """用 Gemini 接地搜索执行联网查询，返回与 search_web 一致的结构。

    无可用供应商或调用失败时抛 RuntimeError，交由上层决定是否回退 Tavily。
    """
    provider, model_name = _pick_grounding_provider(db, user_id)
    if not provider or not model_name:
        raise RuntimeError("未配置可用于接地搜索的 Vertex/Gemini 供应商")

    from google.genai import types

    client = _build_genai_client(provider, timeout_s=timeout_s)
    resp = client.models.generate_content(
        model=model_name,
        contents=query,
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
            temperature=1.0,  # 官方建议接地搜索用 1.0
        ),
    )
    _record_usage(db, resp, user_id, provider.id, model_name)

    results = _parse_response(resp)
    answer_items = [r for r in results if r["type"] == "answer"]
    result_items = [r for r in results if r["type"] == "result"][:max_results]
    return answer_items + result_items
