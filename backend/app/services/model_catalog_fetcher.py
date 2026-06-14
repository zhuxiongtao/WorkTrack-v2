"""模型目录自动采集服务
- 通过 Tavily 联网搜索最新模型
- 调用用户已配置的某个 modelprovider 做结构化抽取
- upsert 到 modelcatalog 表（默认 is_active=False，待人工审校）
"""
import json
import logging
import os
import re
import time
import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlmodel import Session, select

from app.database import engine
from app.models.model_catalog import ModelCatalog
from app.models.model_provider import ModelProvider
from app.config import settings

logger = logging.getLogger("worktrack.model_catalog")

TAVILY_ENDPOINT = "https://api.tavily.com/search"
TAVILY_TIMEOUT = 30.0
EXTRACT_TIMEOUT = 90.0
MAX_CONCURRENT = 4  # Tavily 搜索并发

# ====== 6 条并行查询模板 ======
SEARCH_QUERIES = [
    "latest frontier LLM models 2026 release OpenAI Anthropic Google DeepMind Meta",
    "2026 国内大模型最新发布 阿里通义千问 字节豆包 智谱清言 百度文心",
    "多模态大模型 2026 文生图 文生视频 语音 视觉理解",
    "open source LLM release 2026 Llama Qwen DeepSeek Mistral GLM",
    "embedding model 2026 text-embedding-3 voyage cohere BGE",
    "中国开源大模型 2026 DeepSeek Qwen GLM 智谱 月之暗面",
]

EXTRACT_PROMPT = """你是一个 AI 模型目录抽取专家。请从以下搜索结果中，**只抽取**真实存在、有具体模型名称和版本号的 AI 模型提及（不要凭空编造）。

对每条模型信息，按以下 JSON 数组格式输出（不要输出其他说明文字）：

```json
[
  {
    "name": "GPT-5",
    "version_id": "gpt-5-2025-08-07",
    "provider": "OpenAI",
    "region": "international",
    "modality": "text",
    "release_date": "2025-08-07",
    "description": "OpenAI 最新旗舰模型，擅长推理、代码、长上下文",
    "source_url": "https://openai.com/...",
    "confidence": 0.95
  }
]
```

字段说明：
- name: 模型显示名（必填）
- version_id: API 调用的版本 ID（如不确定填 null）
- provider: 提供方（如 OpenAI、Anthropic、阿里、字节）
- region: 'domestic'（中国厂商）/ 'international'（其他）
- modality: 'text' / 'multimodal' / 'code' / 'embedding' / 'audio'
- release_date: YYYY-MM-DD（不确定填 null）
- description: 一句话描述
- source_url: 引用来源 URL
- confidence: 0~1 之间的置信度（无把握的标 0.5 以下）

去重规则：同一个 (name, version_id) 只能出现一次；如有多次提及，confidence 取最高。

以下是搜索结果：

---
{search_content}
---

只输出 JSON 数组，不要其他解释。"""


def _get_tavily_key() -> Optional[str]:
    """优先从 SystemPreference 读（先全局，再任一用户兜底），再回退到 .env"""
    try:
        with Session(engine) as db:
            from app.models.system_preference import SystemPreference
            # 1) 全局（user_id is None）
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == "tavily_api_key",
                    SystemPreference.user_id == None,  # 全局
                )
            ).first()
            if row and row.value:
                return row.value
            # 2) 兜底：任意用户的 tavily_api_key（兼容历史「个人偏好」存储）
            row = db.exec(
                select(SystemPreference)
                .where(SystemPreference.key == "tavily_api_key")
                .order_by(SystemPreference.id.asc())
            ).first()
            if row and row.value:
                return row.value
    except Exception:
        pass
    return settings.tavily_api_key or os.getenv("TAVILY_API_KEY")


def _pick_extractor_provider_id() -> Optional[int]:
    """从 modelprovider 表挑一个开启的、用于做结构化抽取"""
    try:
        with Session(engine) as db:
            row = db.exec(
                select(ModelProvider)
                .where(ModelProvider.is_active == True)
                .where(ModelProvider.provider_type == "chat")
                .order_by(ModelProvider.id.asc())
            ).first()
            if row and row.api_key and row.base_url:
                return row.id
    except Exception:
        pass
    return None


async def _tavily_search(client: httpx.AsyncClient, query: str, api_key: str) -> dict:
    """单条 Tavily 搜索"""
    try:
        r = await client.post(
            TAVILY_ENDPOINT,
            json={
                "api_key": api_key,
                "query": query,
                "max_results": 8,
                "search_depth": "advanced",
                "include_answer": True,
                "include_raw_content": False,
                "topic": "general",
            },
            timeout=TAVILY_TIMEOUT,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("Tavily 搜索失败: %s | query=%s", e, query[:60])
        return {"answer": "", "results": [], "error": str(e)[:200]}


async def _search_all() -> list[dict]:
    """并发 6 条查询，返回拼接后的搜索内容"""
    api_key = _get_tavily_key()
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY 未配置（请在 .env 或 系统偏好 中设置）")
    async with httpx.AsyncClient() as client:
        tasks = [_tavily_search(client, q, api_key) for q in SEARCH_QUERIES]
        results = await asyncio.gather(*tasks)
    blocks = []
    for q, r in zip(SEARCH_QUERIES, results):
        answer = r.get("answer", "")
        snippets = []
        for hit in r.get("results", [])[:5]:
            content = (hit.get("content") or "").strip()
            if content:
                snippets.append(f"  - [{hit.get('url','')}] {content[:400]}")
        block = f"【查询】{q}\n【合成答案】{answer[:600]}\n【相关摘要】\n" + "\n".join(snippets)
        blocks.append(block)
    return blocks


def _strip_code_fence(text: str) -> str:
    """去掉 LLM 输出里常见的 ```json ... ``` 包裹"""
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if m:
        return m.group(1)
    m = re.search(r"(\[.*\])", text, re.DOTALL)
    if m:
        return m.group(1)
    return text


def _call_extractor(provider: ModelProvider, search_content: str) -> list[dict]:
    """调用用户配置的 LLM 做结构化抽取"""
    # 避免 search_content 中的 { / } 被 str.format 当成占位符解析（用占位符占位 + replace 的方式）
    prompt = EXTRACT_PROMPT.replace("{search_content}", search_content[:30000])  # 防止爆 token
    base_url = (provider.base_url or "").rstrip("/")
    # OpenAI 兼容协议
    url = f"{base_url}/chat/completions" if not base_url.endswith("/chat/completions") else base_url
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": provider.default_model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "你是 AI 模型目录抽取专家，只输出 JSON 数组。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
    }
    try:
        with httpx.Client(timeout=EXTRACT_TIMEOUT) as client:
            r = client.post(url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
            content = data["choices"][0]["message"]["content"]
        return json.loads(_strip_code_fence(content))
    except Exception as e:
        logger.error("LLM 抽取失败: %s", e, exc_info=True)
        raise


def _normalize_region(raw: Optional[str]) -> str:
    if not raw:
        return "international"
    r = raw.lower().strip()
    if r in ("domestic", "cn", "china", "china", "国内", "中国"):
        return "domestic"
    return "international"


def _normalize_modality(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    r = raw.lower().strip()
    if "embed" in r:
        return "embedding"
    if "code" in r or "代码" in r:
        return "code"
    if "audio" in r or "speech" in r or "语音" in r:
        return "audio"
    if "vision" in r or "image" in r or "video" in r or "多模态" in r or "multimodal" in r:
        return "multimodal"
    return "text"


def _parse_release_date(raw: Optional[str]) -> Optional["date"]:
    if not raw:
        return None
    from datetime import date as _d
    raw = raw.strip()
    m = re.match(r"(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})", raw)
    if m:
        try:
            return _d(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except Exception:
            return None
    m = re.match(r"(\d{4})[-/年](\d{1,2})", raw)
    if m:
        try:
            return _d(int(m.group(1)), int(m.group(2)), 1)
        except Exception:
            return None
    m = re.match(r"(\d{4})", raw)
    if m:
        try:
            return _d(int(m.group(1)), 1, 1)
        except Exception:
            return None
    return None


def _upsert_models(items: list[dict], db: Session) -> tuple[int, int]:
    """把抽取的模型列表 upsert 到 modelcatalog 表
    - 唯一键: (name, version_id)
    - 命中：更新 provider/region/modality/description/source_url/confidence/last_seen_at
    - 未命中：插入新行，is_active 保持默认 false
    返回 (inserted, updated)
    """
    now = datetime.now(timezone.utc)
    inserted = updated = 0
    for it in items:
        name = (it.get("name") or "").strip()
        if not name:
            continue
        version_id = (it.get("version_id") or "").strip() or None
        region = _normalize_region(it.get("region"))
        modality = _normalize_modality(it.get("modality"))
        release_date = _parse_release_date(it.get("release_date"))
        provider = (it.get("provider") or "").strip() or None
        description = (it.get("description") or "").strip() or None
        source_url = (it.get("source_url") or "").strip() or None
        try:
            confidence = float(it.get("confidence") or 0.7)
        except Exception:
            confidence = 0.7
        confidence = max(0.0, min(1.0, confidence))

        stmt = select(ModelCatalog).where(
            ModelCatalog.name == name,
            ModelCatalog.version_id == version_id,
        )
        existing = db.exec(stmt).first()
        if existing:
            existing.provider = provider or existing.provider
            existing.region = region
            existing.modality = modality or existing.modality
            existing.release_date = release_date or existing.release_date
            existing.description = description or existing.description
            existing.source_url = source_url or existing.source_url
            existing.confidence = confidence
            existing.last_seen_at = now
            existing.updated_at = now
            db.add(existing)
            updated += 1
        else:
            row = ModelCatalog(
                name=name[:255],
                version_id=version_id[:255] if version_id else None,
                provider=provider[:120] if provider else None,
                region=region,
                modality=modality,
                release_date=release_date,
                description=description,
                source_url=source_url[:1000] if source_url else None,
                confidence=confidence,
                is_active=False,
                last_seen_at=now,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            inserted += 1
    db.commit()
    return inserted, updated


def _deactivate_stale(db: Session, days: int = 90) -> int:
    """超过 N 天未在搜索结果中出现的 active 模型，自动置为不活跃"""
    from datetime import timedelta
    threshold = datetime.now(timezone.utc) - timedelta(days=days)
    rows = db.exec(
        select(ModelCatalog).where(
            ModelCatalog.is_active == True,
            ModelCatalog.last_seen_at != None,
            ModelCatalog.last_seen_at < threshold,
        )
    ).all()
    for r in rows:
        r.is_active = False
        r.updated_at = datetime.now(timezone.utc)
        db.add(r)
    if rows:
        db.commit()
    return len(rows)


def refresh_model_catalog_sync() -> dict:
    """同步入口：scheduler 调度 / 手动触发都用这个
    返回 dict: {success, inserted, updated, deactivated, duration_ms, error}
    """
    t0 = time.time()
    provider_id = _pick_extractor_provider_id()
    if not provider_id:
        return {"success": False, "error": "未找到可用的 LLM 抽取器（请先在「设置 → 模型供应商」中配置并启用至少一个 chat provider）", "duration_ms": int((time.time()-t0)*1000)}
    with Session(engine) as db:
        provider = db.get(ModelProvider, provider_id)
        if not provider:
            return {"success": False, "error": "抽取器 provider 不存在", "duration_ms": int((time.time()-t0)*1000)}

    try:
        # 1) Tavily 搜索（异步 -> 同步包装）
        blocks = asyncio.run(_search_all())
        search_content = "\n\n".join(blocks)
        logger.info("Tavily 搜索完成，拼接内容 %d 字符", len(search_content))

        # 2) LLM 抽取
        items = _call_extractor(provider, search_content)
        if not isinstance(items, list):
            return {"success": False, "error": "LLM 抽取返回非数组", "duration_ms": int((time.time()-t0)*1000)}
        logger.info("LLM 抽取到 %d 条候选模型", len(items))

        # 3) upsert
        with Session(engine) as db:
            inserted, updated = _upsert_models(items, db)
            # 4) 90 天未见的 active 模型降级
            deactivated = _deactivate_stale(db, days=90)

        duration_ms = int((time.time() - t0) * 1000)
        logger.info("模型目录刷新完成: 新增 %d, 更新 %d, 降级 %d, 耗时 %dms", inserted, updated, deactivated, duration_ms)
        return {
            "success": True,
            "inserted": inserted,
            "updated": updated,
            "deactivated": deactivated,
            "duration_ms": duration_ms,
        }
    except Exception as e:
        logger.error("模型目录刷新失败: %s", e, exc_info=True)
        return {"success": False, "error": str(e)[:300], "duration_ms": int((time.time()-t0)*1000)}


# 内存里的最近一次状态（用 system_preference 持久化会更稳，这里先用内存 + DB 双写）
_last_status: dict = {}


def get_last_status() -> dict:
    """返回最近一次刷新状态"""
    if _last_status:
        return _last_status
    # 从 DB 系统偏好里读
    try:
        with Session(engine) as db:
            from app.models.system_preference import SystemPreference
            for k in ("model_catalog.last_status",):
                row = db.exec(
                    select(SystemPreference).where(
                        SystemPreference.key == k, SystemPreference.user_id == None
                    )
                ).first()
                if row and row.value:
                    try:
                        return json.loads(row.value)
                    except Exception:
                        return {}
    except Exception:
        pass
    return {}


def _persist_status(status: dict) -> None:
    global _last_status
    _last_status = status
    try:
        with Session(engine) as db:
            from app.models.system_preference import SystemPreference
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == "model_catalog.last_status", SystemPreference.user_id == None
                )
            ).first()
            payload = json.dumps(status, default=str, ensure_ascii=False)
            if row:
                row.value = payload
                db.add(row)
            else:
                db.add(SystemPreference(key="model_catalog.last_status", value=payload, user_id=None))
            db.commit()
    except Exception as e:
        logger.warning("持久化 last_status 失败: %s", e)


def refresh_and_record() -> dict:
    """带状态记录的刷新（写入 _last_status / system_preference）"""
    res = refresh_model_catalog_sync()
    res["finished_at"] = datetime.now(timezone.utc).isoformat()
    _persist_status(res)
    return res
