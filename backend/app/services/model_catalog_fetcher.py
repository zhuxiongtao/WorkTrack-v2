"""模型目录自动采集服务 — 三路并行

1. OpenRouter API   无 key，一次拿 200+ 国际模型 + 定价
2. Provider /v1/models  复用系统已配置的 API Key，model ID 最权威
3. Tavily 搜索  仅国内模型兜底（阿里/字节/智谱/百度/月之暗面等）

三路结果合并去重后 upsert 到 modelcatalog 表（is_active 默认 False，待人工审校）
"""
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlmodel import Session, select

from app.database import engine
from app.models.model_catalog import ModelCatalog
from app.config import settings

logger = logging.getLogger("worktrack.model_catalog")

TAVILY_ENDPOINT = "https://api.tavily.com/search"
TAVILY_TIMEOUT = 30.0
OPENROUTER_TIMEOUT = 20.0
PROVIDER_API_TIMEOUT = 15.0

# ── OpenRouter provider ID → 规范名称 ─────────────────────────────────────────
_OR_PROVIDER_MAP: dict[str, str] = {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "google": "Google",
    "meta-llama": "Meta",
    "mistralai": "Mistral",
    "deepseek": "DeepSeek",
    "qwen": "Alibaba",
    "cohere": "Cohere",
    "x-ai": "xAI",
    "amazon": "Amazon",
    "nvidia": "NVIDIA",
    "microsoft": "Microsoft",
    "perplexity": "Perplexity",
    "01-ai": "零一万物",
    "baidu": "百度",
    "zhipuai": "智谱",
    "moonshot": "月之暗面",
    "minimax": "MiniMax",
    "siliconflow": "SiliconFlow",
    "together": "Together AI",
}

# ── base_url 关键字 → 规范 Provider 名称 ─────────────────────────────────────
_URL_PROVIDER_HINTS: list[tuple[str, str]] = [
    ("openai.com", "OpenAI"),
    ("anthropic.com", "Anthropic"),
    ("generativelanguage.googleapis.com", "Google"),
    ("deepseek.com", "DeepSeek"),
    ("moonshot", "月之暗面"),
    ("zhipuai", "智谱"),
    ("bigmodel.cn", "智谱"),
    ("dashscope", "阿里"),
    ("aliyun", "阿里"),
    ("volcengine", "字节"),
    ("volces.com", "字节"),
    ("siliconflow", "SiliconFlow"),
    ("together", "Together AI"),
    ("mistral", "Mistral"),
    ("cohere", "Cohere"),
    ("01.ai", "零一万物"),
    ("minimax", "MiniMax"),
    ("baidu", "百度"),
    ("qianfan", "百度"),
    ("baichuan", "百川"),
]

# ── 国内模型 Tavily 查询（缩减至 3 条，聚焦国内）────────────────────────────
DOMESTIC_SEARCH_QUERIES = [
    "2025 2026 国内大模型最新版本 API 阿里通义千问 字节豆包 智谱GLM 百度文心 DeepSeek",
    "月之暗面 MiniMax 零一万物 百川 2025 2026 最新 API 模型版本号",
    "国内开源大模型 2025 2026 Qwen3 GLM4 DeepSeek-V3 最新发布 API 调用",
]

EXTRACT_PROMPT = """你是一个 AI 模型目录抽取专家。请从以下搜索结果中，只抽取真实存在、有具体模型名称和版本号的 AI 模型提及（不要凭空编造）。

对每条模型信息，按以下 JSON 数组格式输出（不要输出其他说明文字）：

```json
[
  {
    "name": "通义千问3",
    "version_id": "qwen3-235b-a22b",
    "provider": "阿里",
    "region": "domestic",
    "modality": "text",
    "release_date": "2025-04-28",
    "description": "阿里最新旗舰 MoE 模型，支持 100K 上下文",
    "source_url": "https://...",
    "confidence": 0.92
  }
]
```

字段说明：
- name: 模型显示名（必填）
- version_id: API 调用的版本 ID（如不确定填 null）
- provider: 提供方（中国厂商如 阿里、字节、智谱、百度、月之暗面、MiniMax 等）
- region: 'domestic'（中国厂商）/ 'international'（其他）
- modality: 'text' / 'multimodal' / 'code' / 'embedding' / 'audio'
- release_date: YYYY-MM-DD（不确定填 null）
- description: 一句话描述
- source_url: 引用来源 URL
- confidence: 0~1 之间的置信度

去重规则：同一个 (name, version_id) 只能出现一次；只关注国内（domestic）模型。

以下是搜索结果：

---
{search_content}
---

只输出 JSON 数组，不要其他解释。"""


# ─────────────────────────────────────────────────────────────────────────────
#  辅助函数
# ─────────────────────────────────────────────────────────────────────────────

def _get_tavily_key() -> Optional[str]:
    try:
        with Session(engine) as db:
            from app.models.system_preference import SystemPreference
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == "tavily_api_key",
                    SystemPreference.user_id == None,
                )
            ).first()
            if row and row.value:
                return row.value
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


def _pick_extractor_provider():
    """返回 (provider, model_name, client) 供 LLM 抽取使用"""
    try:
        from app.services.ai_service import _get_active_provider, _get_client
        with Session(engine) as db:
            base_url, api_key, model_name, provider = _get_active_provider(db, "chat")
            client = _get_client(base_url, api_key, provider)
            return provider, model_name, client
    except Exception as e:
        logger.warning("无法获取抽取器: %s", e)
    return None


def _normalize_or_provider(raw: str) -> str:
    return _OR_PROVIDER_MAP.get(raw.lower(), raw.title())


def _infer_provider_from_url(base_url: str, fallback: str) -> str:
    url = (base_url or "").lower()
    for hint, name in _URL_PROVIDER_HINTS:
        if hint in url:
            return name
    return fallback


def _or_modality(m: dict) -> str:
    arch = m.get("architecture") or {}
    mod_in = (arch.get("modality") or arch.get("input_modalities") or "")
    if isinstance(mod_in, list):
        mod_in = " ".join(mod_in)
    mod_in = mod_in.lower()
    mid = (m.get("id") or "").lower()
    if "image" in mod_in or "vision" in mod_in or "vl" in mid:
        return "multimodal"
    if "embed" in mid:
        return "embedding"
    if "whisper" in mid or "tts" in mid or "audio" in mid or "speech" in mid:
        return "audio"
    return "text"


def _infer_modality_from_id(mid: str) -> str:
    m = mid.lower()
    if "embed" in m:
        return "embedding"
    if "whisper" in m or "tts" in m or "audio" in m or "speech" in m:
        return "audio"
    if "vision" in m or "vl" in m:
        return "multimodal"
    return "text"


def _prettify_model_id(mid: str) -> str:
    """gpt-4o-mini  →  GPT-4o Mini"""
    parts = mid.replace("-", " ").replace("_", " ").split()
    out = []
    for p in parts:
        if len(p) <= 3 and p.replace(".", "").isalnum():
            out.append(p.upper())
        else:
            out.append(p.title())
    return " ".join(out)


def _parse_or_price(val) -> Optional[float]:
    """OpenRouter 价格单位：USD/token（字符串），转为 USD/M token"""
    if val is None:
        return None
    try:
        per_token = float(val)
        if per_token <= 0:
            return None
        return round(per_token * 1_000_000, 6)
    except (ValueError, TypeError):
        return None


def _normalize_region(raw: Optional[str]) -> str:
    if not raw:
        return "international"
    r = raw.lower().strip()
    if r in ("domestic", "cn", "china", "国内", "中国"):
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


def _parse_release_date(raw: Optional[str]):
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


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if m:
        return m.group(1)
    m = re.search(r"(\[.*\])", text, re.DOTALL)
    if m:
        return m.group(1)
    return text


# ─────────────────────────────────────────────────────────────────────────────
#  数据源 1：OpenRouter API
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_openrouter() -> list[dict]:
    """GET https://openrouter.ai/api/v1/models — 无需 Key，含价格"""
    try:
        async with httpx.AsyncClient(timeout=OPENROUTER_TIMEOUT) as client:
            r = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"HTTP-Referer": "https://worktrack.app", "X-Title": "WorkTrack"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning("OpenRouter API 失败: %s", e)
        return []

    items = []
    for m in data.get("data", []):
        mid = (m.get("id") or "").strip()
        if not mid:
            continue

        # id 格式 "provider/model-name"
        parts = mid.split("/", 1)
        if len(parts) == 2:
            raw_provider, version_id = parts
        else:
            raw_provider, version_id = "", mid

        provider = _normalize_or_provider(raw_provider)
        name = (m.get("name") or version_id).strip()
        description = (m.get("description") or "").strip()[:500] or None

        pricing = m.get("pricing") or {}
        input_price = _parse_or_price(pricing.get("prompt"))
        output_price = _parse_or_price(pricing.get("completion"))
        cache_read_price = _parse_or_price(pricing.get("input_cache_read")) or _parse_or_price(pricing.get("cache_read"))
        cache_write_price = (_parse_or_price(pricing.get("input_cache_write"))
                             or _parse_or_price(pricing.get("cache_write"))
                             or _parse_or_price(pricing.get("cache_creation")))

        items.append({
            "name": name,
            "version_id": version_id,
            "provider": provider,
            "region": "international",
            "modality": _or_modality(m),
            "description": description,
            "source_url": f"https://openrouter.ai/{mid}",
            "confidence": 0.95,
            "input_price": input_price,
            "output_price": output_price,
            "cache_read_price": cache_read_price,
            "cache_write_price": cache_write_price,
            "_source": "openrouter",
        })

    logger.info("OpenRouter: 获取 %d 条模型", len(items))
    return items


# ─────────────────────────────────────────────────────────────────────────────
#  数据源 2：已配置 Provider 官方 /v1/models
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_provider_models() -> list[dict]:
    """遍历系统已配置的活跃 Provider，调用官方 /v1/models"""
    from app.models.model_provider import ModelProvider
    try:
        with Session(engine) as db:
            providers = db.exec(
                select(ModelProvider).where(ModelProvider.is_active == True)
            ).all()
    except Exception as e:
        logger.warning("读取 Provider 配置失败: %s", e)
        return []

    all_items: list[dict] = []
    async with httpx.AsyncClient(timeout=PROVIDER_API_TIMEOUT) as client:
        tasks = [_fetch_one_provider(client, p) for p in providers]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    for p, result in zip(providers, results):
        if isinstance(result, Exception):
            logger.warning("Provider '%s' 模型列表失败: %s", p.name, result)
            continue
        all_items.extend(result)

    logger.info("Provider APIs: 共获取 %d 条模型（%d 个 Provider）", len(all_items), len(providers))
    return all_items


async def _fetch_one_provider(client: httpx.AsyncClient, provider) -> list[dict]:
    from app.services.ai_service import _is_vertex_ai, _is_gemini, _is_anthropic
    if _is_vertex_ai(provider):
        return []  # Vertex AI 认证复杂，跳过
    if not provider.api_key:
        return []
    try:
        if _is_anthropic(provider):
            return await _fetch_anthropic_models(client, provider)
        elif _is_gemini(provider):
            return await _fetch_gemini_models(client, provider)
        else:
            return await _fetch_openai_compat_models(client, provider)
    except Exception as e:
        logger.debug("Provider '%s' /v1/models 失败: %s", provider.name, e)
        return []


async def _fetch_anthropic_models(client: httpx.AsyncClient, provider) -> list[dict]:
    r = await client.get(
        "https://api.anthropic.com/v1/models",
        headers={
            "x-api-key": provider.api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    r.raise_for_status()
    data = r.json()
    items = []
    for m in data.get("data", []):
        mid = (m.get("id") or "").strip()
        if not mid:
            continue
        items.append({
            "name": (m.get("display_name") or _prettify_model_id(mid)).strip(),
            "version_id": mid,
            "provider": "Anthropic",
            "region": "international",
            "modality": _infer_modality_from_id(mid),
            "description": None,
            "source_url": "https://docs.anthropic.com/en/docs/about-claude/models/all-models",
            "confidence": 0.99,
            "_source": "provider_api",
        })
    return items


async def _fetch_gemini_models(client: httpx.AsyncClient, provider) -> list[dict]:
    r = await client.get(
        f"https://generativelanguage.googleapis.com/v1beta/models?key={provider.api_key}",
    )
    r.raise_for_status()
    data = r.json()
    items = []
    for m in data.get("models", []):
        raw_name = (m.get("name") or "").strip()
        mid = raw_name.removeprefix("models/")
        if not mid:
            continue
        supported = m.get("supportedGenerationMethods") or []
        if "generateContent" not in supported and "embedContent" not in supported:
            continue
        modality = "embedding" if "embedContent" in supported and "generateContent" not in supported else "text"
        items.append({
            "name": (m.get("displayName") or _prettify_model_id(mid)).strip(),
            "version_id": mid,
            "provider": "Google",
            "region": "international",
            "modality": modality,
            "description": (m.get("description") or "")[:500] or None,
            "source_url": "https://ai.google.dev/gemini-api/docs/models",
            "confidence": 0.99,
            "_source": "provider_api",
        })
    return items


async def _fetch_openai_compat_models(client: httpx.AsyncClient, provider) -> list[dict]:
    base_url = (provider.base_url or "").rstrip("/")
    # 去掉末尾的 /v1 再加上 /v1/models，避免 /v1/v1/models
    if base_url.endswith("/v1"):
        url = f"{base_url}/models"
    else:
        url = f"{base_url}/v1/models"
    r = await client.get(url, headers={"Authorization": f"Bearer {provider.api_key}"})
    r.raise_for_status()
    data = r.json()
    pname = _infer_provider_from_url(provider.base_url, provider.name)
    region = "domestic" if pname in (
        "阿里", "字节", "智谱", "百度", "月之暗面", "MiniMax", "零一万物", "百川", "DeepSeek"
    ) else "international"
    items = []
    for m in data.get("data", []):
        mid = (m.get("id") or "").strip()
        if not mid:
            continue
        items.append({
            "name": (m.get("name") or _prettify_model_id(mid)).strip(),
            "version_id": mid,
            "provider": pname,
            "region": region,
            "modality": _infer_modality_from_id(mid),
            "description": None,
            "source_url": url,
            "confidence": 0.99,
            "_source": "provider_api",
        })
    return items


# ─────────────────────────────────────────────────────────────────────────────
#  数据源 3：Tavily 搜索（仅国内模型兜底）
# ─────────────────────────────────────────────────────────────────────────────

async def _tavily_search(client: httpx.AsyncClient, query: str, api_key: str) -> dict:
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


async def _search_domestic_only() -> list[dict]:
    """用 Tavily 搜索国内模型，返回结构化 item 列表（通过 LLM 抽取）"""
    api_key = _get_tavily_key()
    if not api_key:
        logger.info("Tavily Key 未配置，跳过国内模型搜索")
        return []

    extractor = _pick_extractor_provider()
    if not extractor:
        logger.info("LLM 抽取器未配置，跳过 Tavily 国内模型搜索")
        return []
    _, model_name, llm_client = extractor

    async with httpx.AsyncClient() as client:
        tasks = [_tavily_search(client, q, api_key) for q in DOMESTIC_SEARCH_QUERIES]
        results = await asyncio.gather(*tasks)

    blocks = []
    for q, r in zip(DOMESTIC_SEARCH_QUERIES, results):
        answer = r.get("answer", "")
        snippets = []
        for hit in r.get("results", [])[:5]:
            content = (hit.get("content") or "").strip()
            if content:
                snippets.append(f"  - [{hit.get('url','')}] {content[:400]}")
        block = f"【查询】{q}\n【合成答案】{answer[:600]}\n【相关摘要】\n" + "\n".join(snippets)
        blocks.append(block)

    search_content = "\n\n".join(blocks)
    logger.info("Tavily 国内搜索完成，内容 %d 字符", len(search_content))

    try:
        raw_items = _call_extractor(llm_client, model_name, search_content)
    except Exception as e:
        logger.error("Tavily 国内模型 LLM 抽取失败: %s", e)
        return []

    # 只保留 domestic，过滤 LLM 可能幻觉的国际模型
    domestic = [it for it in raw_items if _normalize_region(it.get("region")) == "domestic"]
    logger.info("Tavily 抽取国内模型 %d 条（原始 %d 条）", len(domestic), len(raw_items))
    return domestic


def _call_extractor(client, model_name: str, search_content: str) -> list[dict]:
    from app.services.ai_service import _extract_message_text
    prompt = EXTRACT_PROMPT.replace("{search_content}", search_content[:30000])
    response = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": "你是 AI 模型目录抽取专家，只输出 JSON 数组。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        timeout=120,  # 长文本抽取任务，覆盖客户端 30s 默认值
    )
    content = _extract_message_text(response.choices[0].message)
    return json.loads(_strip_code_fence(content))


# ─────────────────────────────────────────────────────────────────────────────
#  合并 & upsert
# ─────────────────────────────────────────────────────────────────────────────

def _upsert_models(items: list[dict], db: Session) -> tuple[int, int]:
    """把采集到的模型列表 upsert 到 modelcatalog 表

    唯一键: (name, version_id)
    - 命中：更新 provider/region/modality/description/source_url/confidence/last_seen_at
            价格字段只在新值非 None 时覆盖（不用 None 抹掉人工填的价格）
    - 未命中：插入新行，is_active 保持默认 False
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
        modality = _normalize_modality(it.get("modality")) or it.get("modality")
        release_date = _parse_release_date(it.get("release_date"))
        provider = (it.get("provider") or "").strip() or None
        description = (it.get("description") or "").strip() or None
        source_url = (it.get("source_url") or "").strip() or None
        try:
            confidence = float(it.get("confidence") or 0.7)
        except Exception:
            confidence = 0.7
        confidence = max(0.0, min(1.0, confidence))

        input_price: Optional[float] = it.get("input_price")
        output_price: Optional[float] = it.get("output_price")
        cache_read_price: Optional[float] = it.get("cache_read_price")
        cache_write_price: Optional[float] = it.get("cache_write_price")

        existing = db.exec(
            select(ModelCatalog).where(
                ModelCatalog.name == name,
                ModelCatalog.version_id == version_id,
            )
        ).first()

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
            # 价格：只在有值时覆盖，不用 None 抹掉人工填写的价格
            if input_price is not None:
                existing.input_price = input_price
            if output_price is not None:
                existing.output_price = output_price
            if cache_read_price is not None:
                existing.cache_read_price = cache_read_price
            if cache_write_price is not None:
                existing.cache_write_price = cache_write_price
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
                input_price=input_price,
                output_price=output_price,
                cache_read_price=cache_read_price,
                cache_write_price=cache_write_price,
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


# ─────────────────────────────────────────────────────────────────────────────
#  主入口
# ─────────────────────────────────────────────────────────────────────────────

async def _collect_all() -> list[dict]:
    """三路并行采集，合并去重"""
    or_items, prov_items, domestic_items = await asyncio.gather(
        _fetch_openrouter(),
        _fetch_provider_models(),
        _search_domestic_only(),
        return_exceptions=False,
    )

    # 合并顺序：OpenRouter（含价格）→ Provider API（权威 model ID）→ Tavily 国内兜底
    # upsert 内部处理去重，后来的相同 (name, version_id) 会更新前者，但价格不会被 None 抹掉
    all_items: list[dict] = []
    all_items.extend(or_items if isinstance(or_items, list) else [])
    all_items.extend(prov_items if isinstance(prov_items, list) else [])

    # Tavily 国内条目：补全 region 字段
    for it in (domestic_items if isinstance(domestic_items, list) else []):
        it.setdefault("region", "domestic")
        all_items.append(it)

    logger.info(
        "三路采集合计: OpenRouter=%d, ProviderAPI=%d, Tavily国内=%d, 总计=%d",
        len(or_items) if isinstance(or_items, list) else 0,
        len(prov_items) if isinstance(prov_items, list) else 0,
        len(domestic_items) if isinstance(domestic_items, list) else 0,
        len(all_items),
    )
    return all_items


def refresh_model_catalog_sync() -> dict:
    """同步入口：scheduler 调度 / 手动触发都用这个"""
    t0 = time.time()
    try:
        all_items = asyncio.run(_collect_all())
        if not all_items:
            return {
                "success": False,
                "error": "三路数据源均未返回任何模型（请检查 OpenRouter 网络连通性或 Provider 配置）",
                "duration_ms": int((time.time() - t0) * 1000),
            }

        with Session(engine) as db:
            inserted, updated = _upsert_models(all_items, db)
            deactivated = _deactivate_stale(db, days=90)

        duration_ms = int((time.time() - t0) * 1000)
        logger.info(
            "模型目录刷新完成: 新增 %d, 更新 %d, 降级 %d, 耗时 %dms",
            inserted, updated, deactivated, duration_ms,
        )
        return {
            "success": True,
            "inserted": inserted,
            "updated": updated,
            "deactivated": deactivated,
            "duration_ms": duration_ms,
        }
    except Exception as e:
        logger.error("模型目录刷新失败: %s", e, exc_info=True)
        return {"success": False, "error": str(e)[:300], "duration_ms": int((time.time() - t0) * 1000)}


# ─────────────────────────────────────────────────────────────────────────────
#  状态持久化
# ─────────────────────────────────────────────────────────────────────────────

_last_status: dict = {}


def get_last_status() -> dict:
    if _last_status:
        return _last_status
    try:
        with Session(engine) as db:
            from app.models.system_preference import SystemPreference
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == "model_catalog.last_status",
                    SystemPreference.user_id == None,
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
                    SystemPreference.key == "model_catalog.last_status",
                    SystemPreference.user_id == None,
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
    res = refresh_model_catalog_sync()
    res["finished_at"] = datetime.now(timezone.utc).isoformat()
    _persist_status(res)
    return res
