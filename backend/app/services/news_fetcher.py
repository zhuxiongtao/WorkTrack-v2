"""AI 资讯抓取服务 —— 定时从 aihot.virxact.com 抓 RSS 落库到 news_cache 表"""
import re
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from xml.etree import ElementTree as ET

import httpx
from sqlmodel import Session, select
from email.utils import parsedate_to_datetime

from app.database import engine
from app.models.news_cache import NewsCache

logger = logging.getLogger("worktrack.news")

RSS_URL = "https://aihot.virxact.com/feed.xml"
HTTP_TIMEOUT = 15.0  # 秒
# 抓取上限：RSS 精编候选池最新 50 条
MAX_ITEMS_PER_FETCH = 50


def _classify(source: str) -> str:
    """根据来源文本做粗略分类（用于 Banner 颜色 tag）"""
    if not source:
        return "other"
    s = source.lower()
    if any(k in s for k in ["x:", "x（", "twitter", "x.com", "@"]):
        return "social"
    if any(k in s for k in ["blog", "官方", "官网"]):
        return "official"
    if any(k in s for k in ["hacker news", "hn ", "reddit", "buzzing", "社区"]):
        return "community"
    if any(k in s for k in ["news", "媒体", "press", "theverge", "techcrunch", "wired", "mit", "arxiv"]):
        return "media"
    return "other"


def _strip_html(text: str) -> str:
    """去掉 RSS description 里的 HTML 标签，保留纯文本（截 500 字）"""
    if not text:
        return ""
    text = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", text, flags=re.DOTALL)
    plain = re.sub(r"<[^>]+>", "", text)
    plain = (plain.replace("&amp;", "&").replace("&lt;", "<")
                 .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'")
                 .replace("&nbsp;", " "))
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain[:500]


def _parse_pub_date(text: Optional[str]) -> Optional[datetime]:
    """解析 RFC 2822 格式（RSS 标准）"""
    if not text:
        return None
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _decode_chunked(data: bytes) -> bytes:
    """解码 HTTP chunked 传输编码"""
    result = b""
    pos = 0
    while pos < len(data):
        # 找到 chunk size 行
        line_end = data.find(b"\r\n", pos)
        if line_end < 0:
            break
        size_str = data[pos:line_end].decode("ascii", errors="replace").strip()
        # chunk size 可能包含分号后的扩展，只取分号前
        size_str = size_str.split(";")[0].strip()
        try:
            chunk_size = int(size_str, 16)
        except ValueError:
            break
        if chunk_size == 0:
            break
        # chunk 数据从 line_end+2 开始，长度为 chunk_size
        chunk_start = line_end + 2
        chunk_end = chunk_start + chunk_size
        result += data[chunk_start:chunk_end]
        # 跳过 chunk 数据后的 \r\n
        pos = chunk_end + 2
    return result


def _fetch_rss_sync() -> list[dict]:
    """同步 HTTP GET RSS，解析为字典列表（scheduler 在子线程里跑，要用同步客户端）

    aihot 的 nginx 会按 ETag 缓存 feed.xml：
    - httpx / urllib 等库会自动缓存 ETag 并在后续请求中发送 If-None-Match → 304
    - 解决方案：用原始 socket 发送 HTTP 请求，不发送任何缓存相关头，强制拿到完整内容
    """
    import time as _t
    import ssl
    import socket as _socket

    url = f"{RSS_URL}?_={int(_t.time())}"
    parsed = _socket.urlparse(url) if hasattr(_socket, 'urlparse') else None
    from urllib.parse import urlparse
    parsed = urlparse(url)
    host = parsed.hostname
    path = parsed.path + ('?' + parsed.query if parsed.query else '')

    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    raw_response = b""
    try:
        with _socket.create_connection((host, 443), timeout=int(HTTP_TIMEOUT)) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ssock:
                request = (
                    f"GET {path} HTTP/1.1\r\n"
                    f"Host: {host}\r\n"
                    f"User-Agent: WorkTrack/1.0 (news-fetcher)\r\n"
                    f"Accept: application/xml,*/*\r\n"
                    f"Connection: close\r\n"
                    f"\r\n"
                )
                ssock.sendall(request.encode())
                while True:
                    chunk = ssock.recv(8192)
                    if not chunk:
                        break
                    raw_response += chunk
    except Exception as e:
        logger.error("RSS socket 请求失败: %s", e)
        return []

    # 解析 HTTP 响应
    header_end = raw_response.find(b"\r\n\r\n")
    if header_end < 0:
        logger.error("RSS 响应格式异常：找不到 header/body 分隔")
        return []
    headers_raw = raw_response[:header_end].decode("utf-8", errors="replace")
    body_raw = raw_response[header_end + 4:]

    status_line = headers_raw.split("\r\n")[0]
    if "200" not in status_line:
        logger.warning("RSS 返回非200: %s", status_line)
        return []

    # 处理 chunked 传输编码
    if "Transfer-Encoding: chunked" in headers_raw:
        xml_bytes = _decode_chunked(body_raw)
    else:
        xml_bytes = body_raw

    if len(xml_bytes) < 100:
        logger.warning("RSS 内容过短: %d bytes", len(xml_bytes))
        return []

    root = ET.fromstring(xml_bytes)
    channel = root.find("channel")
    if channel is None:
        return []

    items: list[dict] = []
    for item_el in channel.findall("item")[:MAX_ITEMS_PER_FETCH]:
        title = (item_el.findtext("title") or "").strip()
        link = (item_el.findtext("link") or "").strip()
        desc = _strip_html(item_el.findtext("description") or "")
        guid = (item_el.findtext("guid") or link or title).strip()
        author = (item_el.findtext("author") or "").strip()
        m = re.search(r"\((.+?)\)\s*$", author)
        source = m.group(1).strip() if m else author or "AI HOT"
        pub_date = _parse_pub_date(item_el.findtext("pubDate"))

        if not title or not link:
            continue
        items.append({
            "guid": guid[:200],
            "title": title[:500],
            "url": link[:1000],
            "source": source[:200],
            "description": desc[:2000] or None,
            "category": _classify(source),
            "pub_date": pub_date,
        })
    return items


NEWS_RETENTION_DAYS = 30  # 超过此天数的旧条目在每次抓取后自动清理


def _insert_new_items(items: list[dict]) -> Tuple[int, int]:
    """只插入 guid 不存在的新条目，已有的直接跳过。返回 (新增, 跳过)"""
    if not items:
        return 0, 0

    guids = [it["guid"] for it in items]
    with Session(engine) as db:
        existing_guids: set[str] = set(
            db.exec(select(NewsCache.guid).where(NewsCache.guid.in_(guids))).all()
        )
        new_items = [it for it in items if it["guid"] not in existing_guids]
        for it in new_items:
            db.add(NewsCache(**it))
        if new_items:
            db.commit()
    return len(new_items), len(existing_guids)


def _cleanup_old_news(retention_days: int = NEWS_RETENTION_DAYS) -> int:
    """删除 fetched_at 早于 retention_days 天的旧条目"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    with Session(engine) as db:
        old_items = db.exec(
            select(NewsCache).where(NewsCache.fetched_at < cutoff)
        ).all()
        for item in old_items:
            db.delete(item)
        if old_items:
            db.commit()
    return len(old_items)


def fetch_ai_news() -> dict:
    """抓取入口（被 scheduler 调用，也被 admin 手动触发接口用）"""
    try:
        items = _fetch_rss_sync()
        inserted, skipped = _insert_new_items(items)
        deleted = _cleanup_old_news()
        msg = f"AI 资讯抓取完成: 新增 {inserted}, 跳过 {skipped}, 清理 {deleted} 条过期"
        logger.info(msg)
        return {
            "success": True,
            "inserted": inserted,
            "skipped": skipped,
            "deleted": deleted,
            "total": len(items),
        }
    except Exception as e:
        logger.error("AI 资讯抓取失败: %s", e, exc_info=True)
        return {"success": False, "error": str(e)[:200]}
