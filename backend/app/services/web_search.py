"""Tavily 联网搜索服务"""
import json
import httpx
from sqlmodel import Session, select
from app.models.model_provider import ModelProvider, TaskModelConfig
from app.models.system_preference import SystemPreference
from app.config import settings

TAVILY_SEARCH_URL = "https://api.tavily.com/search"


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


def search_web(query: str, db: Session, search_depth: str = "advanced", max_results: int = 5, user_id: int = 0) -> list[dict]:
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


def search_and_summarize(query: str, db: Session, search_depth: str = "advanced", user_id: int = 0) -> str:
    """执行搜索并将结果拼接为纯文本摘要，供 AI 进一步处理"""
    results = search_web(query, db, search_depth=search_depth, max_results=5, user_id=user_id)
    parts = []
    for r in results:
        if r["type"] == "answer":
            parts.append(f"[AI 摘要]\n{r['content']}")
        else:
            parts.append(f"[{r['title']}]({r['url']})\n{r['content']}")
    return "\n\n---\n\n".join(parts)
