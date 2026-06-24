"""联网搜索服务

统一入口 `search_web` 会按配置在「Gemini 接地搜索」与「Tavily」之间分派：
  - search_provider = auto（默认）：有 Vertex/Gemini 供应商时优先接地搜索，失败回退 Tavily
  - search_provider = gemini_grounding：优先接地搜索，失败回退 Tavily（兜底）
  - search_provider = tavily：仅用 Tavily（旧行为）
所有返回结构保持一致（list[dict]，含 answer + result），调用方无需改动。
"""
import json
import logging
import httpx
from sqlmodel import Session, select
from app.models.model_provider import ModelProvider, TaskModelConfig
from app.models.system_preference import SystemPreference
from app.config import settings

logger = logging.getLogger("worktrack")

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

_VALID_SEARCH_PROVIDERS = {"auto", "gemini_grounding", "tavily"}


def _resolve_search_provider(db: Session, user_id: int = 0) -> str:
    """解析当前生效的搜索通道，优先级：用户偏好 > 共享偏好 > 'auto'"""
    try:
        if user_id:
            pref = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == "search_provider",
                    SystemPreference.user_id == user_id,
                )
            ).first()
            if pref and pref.value in _VALID_SEARCH_PROVIDERS:
                return pref.value
        shared = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == "search_provider",
                SystemPreference.user_id == None,
            )
        ).first()
        if shared and shared.value in _VALID_SEARCH_PROVIDERS:
            return shared.value
    except Exception:
        pass
    return "auto"


def _get_tavily_api_key(db: Session, user_id: int = 0) -> str:
    """获取 Tavily API Key，优先级：用户系统偏好 > 用户任务配置 > 管理员共享任务配置 > .env"""
    # 1. 用户自己的系统偏好
    if user_id:
        pref = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == "tavily_api_key",
                SystemPreference.user_id == user_id,
            )
        ).first()
        if pref and pref.value:
            return pref.value

    # 2. 用户自己的 web_search 任务配置
    if user_id:
        task_cfg = db.exec(
            select(TaskModelConfig).where(
                TaskModelConfig.task_type == "web_search",
                TaskModelConfig.user_id == user_id,
            )
        ).first()
        if task_cfg and task_cfg.provider_id:
            provider = db.get(ModelProvider, task_cfg.provider_id)
            if provider and provider.api_key:
                return provider.api_key

    # 3. 管理员共享的 web_search 任务配置
    task_cfg = db.exec(
        select(TaskModelConfig).where(
            TaskModelConfig.task_type == "web_search",
            TaskModelConfig.user_id == None,
        )
    ).first()
    if task_cfg and task_cfg.provider_id:
        provider = db.get(ModelProvider, task_cfg.provider_id)
        if provider and provider.api_key:
            return provider.api_key

    # 4. 兜底：任意用户的 SystemPreference（兼容旧数据）
    pref = db.exec(
        select(SystemPreference).where(SystemPreference.key == "tavily_api_key")
    ).first()
    if pref and pref.value:
        return pref.value

    # 5. .env 兜底
    env_key = getattr(settings, "tavily_api_key", "")
    if env_key:
        return env_key

    return ""


def search_web(query: str, db: Session, search_depth: str = "advanced", max_results: int = 5, user_id: int = 0, force_tavily: bool = False) -> list[dict]:
    """联网搜索统一入口：按 search_provider 配置在接地搜索 / Tavily 间分派。

    force_tavily=True 时跳过接地搜索直接走 Tavily（供上层已自行处理过接地搜索、
    仅需 Tavily 兜底的场景，避免重复触发慢调用）。
    """
    mode = "tavily" if force_tavily else _resolve_search_provider(db, user_id)
    if mode in ("auto", "gemini_grounding"):
        try:
            from app.services.grounding_search import grounding_search, has_grounding_provider
            if mode == "gemini_grounding" or has_grounding_provider(db, user_id):
                results = grounding_search(query, db, user_id=user_id, max_results=max_results)
                if results:
                    return results
                logger.info("接地搜索无结果，回退 Tavily | query=%s", query[:60])
        except Exception as e:
            logger.warning("Gemini 接地搜索失败，回退 Tavily: %s | query=%s", e, query[:60])
    return _tavily_search_web(query, db, search_depth=search_depth, max_results=max_results, user_id=user_id)


def _tavily_search_web(query: str, db: Session, search_depth: str = "advanced", max_results: int = 5, user_id: int = 0) -> list[dict]:
    """调用 Tavily Search API 执行联网搜索，返回结构化结果列表"""
    api_key = _get_tavily_api_key(db, user_id)
    if not api_key:
        raise RuntimeError("未配置 Tavily API Key，请在设置中配置搜索服务")

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                TAVILY_SEARCH_URL,
                json={
                    "api_key": api_key,
                    "query": query,
                    "search_depth": search_depth,
                    "max_results": max_results,
                    "include_answer": True,
                    "include_raw_content": False,
                    "include_images": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            answer = data.get("answer", "")
            output = []
            if answer:
                output.append({"type": "answer", "content": answer})
            for r in results:
                output.append({
                    "type": "result",
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "content": r.get("content", ""),
                    "score": r.get("score", 0),
                })
            return output
    except httpx.HTTPError as e:
        raise RuntimeError(f"Tavily 搜索请求失败: {str(e)}")
    except Exception as e:
        raise RuntimeError(f"Tavily 搜索异常: {str(e)}")


def search_images(query: str, db: Session, max_results: int = 5, user_id: int = 0) -> list[str]:
    """使用 Tavily 图片搜索获取图片 URL 列表"""
    api_key = _get_tavily_api_key(db, user_id)
    if not api_key:
        return []

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                TAVILY_SEARCH_URL,
                json={
                    "api_key": api_key,
                    "query": query,
                    "search_depth": "advanced",
                    "max_results": max_results,
                    "include_answer": False,
                    "include_raw_content": False,
                    "include_images": True,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            images = []
            for img in data.get("images", []):
                url = img.get("url", "") if isinstance(img, dict) else str(img)
                if url and any(url.lower().endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico')):
                    images.append(url)
            return images
    except Exception:
        return []


def search_and_summarize(query: str, db: Session, search_depth: str = "advanced", user_id: int = 0, force_tavily: bool = False) -> str:
    """执行搜索并将结果拼接为纯文本摘要，供 AI 进一步处理"""
    text, _ = search_web_with_sources(query, db, search_depth=search_depth, user_id=user_id, force_tavily=force_tavily)
    return text


def search_web_with_sources(
    query: str,
    db: Session,
    search_depth: str = "advanced",
    max_results: int = 5,
    user_id: int = 0,
    force_tavily: bool = False,
) -> tuple[str, list[dict]]:
    """执行搜索，返回 (摘要文本, 来源列表)。

    来源列表每条格式: {"url": ..., "title": ..., "domain": ...}
    供调用方在显示结果时附上可点击的引用来源。
    """
    from urllib.parse import urlparse

    results = search_web(query, db, search_depth=search_depth, max_results=max_results, user_id=user_id, force_tavily=force_tavily)
    parts: list[str] = []
    sources: list[dict] = []
    for r in results:
        if r["type"] == "answer":
            parts.append(f"[AI 摘要]\n{r['content']}")
        else:
            parts.append(f"[{r['title']}]({r['url']})\n{r['content']}")
            url = r.get("url", "")
            if url:
                try:
                    domain = urlparse(url).netloc.replace("www.", "")
                except Exception:
                    domain = ""
                sources.append({"url": url, "title": r.get("title", "")[:120], "domain": domain})
    return "\n\n---\n\n".join(parts), sources
