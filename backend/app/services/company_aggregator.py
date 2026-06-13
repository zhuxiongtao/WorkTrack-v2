"""多源公司信息聚合器

数据源（按调用顺序）：
  1. Tavily Search（主搜索，由 ai_service.fetch_company_info 内部调用）
  2. 公司官网深度抓取（拿到域名后）
  3. 维基百科 API（中英文）
  4. 百度百科 HTML
  5. DuckDuckGo HTML 兜底
"""
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger("worktrack.aggregator")

# 防止抓取时被反爬
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 官网常见 about/products/news 路径
ABOUT_PATHS = [
    "/about", "/about-us", "/aboutus", "/company", "/company-info",
    "/intro", "/introduction", "/overview",
]
PRODUCT_PATHS = [
    "/products", "/product", "/solutions", "/services",
    "/business", "/capabilities", "/platform",
]
NEWS_PATHS = [
    "/news", "/newsroom", "/press", "/blog", "/announcements",
    "/dynamic", "/xinwen",
]

# DuckDuckGo HTML 抓取
DDG_URL = "https://html.duckduckgo.com/html/"
# 维基百科 REST summary
WIKI_API = "https://zh.wikipedia.org/api/rest_v1/page/summary/"
WIKI_EN_API = "https://en.wikipedia.org/api/rest_v1/page/summary/"
# 百度百科搜索
BAIDU_BAIKE_SEARCH = "https://baike.baidu.com/item/{name}"


# ============================================================
# 官网抓取
# ============================================================
def _clean_html_text(html: str) -> str:
    """简易 HTML 标签剥离 + 实体还原（不引入 bs4）"""
    if not html:
        return ""
    s = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<noscript[\s\S]*?</noscript>", " ", s, flags=re.I)
    s = re.sub(r"<!--[\s\S]*?-->", " ", s)
    # 段落/换行标签 → 换行
    s = re.sub(r"<(p|div|li|tr|h[1-6]|br)[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = unescape(s)
    s = re.sub(r"[ \t\u00A0]+", " ", s)
    s = re.sub(r"\n[ \t]*", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, flags=re.I)
    if not m:
        return ""
    return unescape(m.group(1)).strip()


def _extract_meta_description(html: str) -> str:
    m = re.search(
        r'<meta\s+[^>]*name=["\']description["\'][^>]*content=["\']([\s\S]*?)["\']',
        html, flags=re.I,
    )
    if not m:
        return ""
    return unescape(m.group(1)).strip()


def _extract_meta_keywords(html: str) -> str:
    m = re.search(
        r'<meta\s+[^>]*name=["\']keywords["\'][^>]*content=["\']([\s\S]*?)["\']',
        html, flags=re.I,
    )
    return unescape(m.group(1)).strip() if m else ""


def _fetch_url(url: str, timeout: float = 8.0) -> str:
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True, headers=DEFAULT_HEADERS, trust_env=False) as c:
            r = c.get(url)
            if r.status_code >= 400:
                return ""
            # 限制最大响应（避免下载巨型 PDF/视频）
            content = r.text[:200_000] if r.text else ""
            return content
    except Exception as e:
        logger.debug("抓取 %s 失败: %s", url, e)
        return ""


def fetch_company_pages(domain: str) -> dict:
    """抓取官网首页 + about/products/news 路径，提取业务描述/产品/动态

    返回：
      {
        "domain": str,
        "title": str,
        "description": str,
        "keywords": str,
        "home_text": str,    # 首页纯文本摘要
        "about_text": str,
        "product_text": str,
        "news_text": str,
        "sources": [{"title": str, "url": str, "section": str}],
      }
    """
    if not domain:
        return {"domain": "", "sources": []}
    domain = domain.replace("http://", "").replace("https://", "").split("/")[0]
    # 优先 https 尝试，失败回退 http，再加 www. 前缀
    base_candidates = [f"https://{domain}", f"http://{domain}"]
    if not domain.startswith("www."):
        base_candidates += [f"https://www.{domain}", f"http://www.{domain}"]
    chosen_base = None
    for cand in base_candidates:
        try:
            with httpx.Client(timeout=6.0, follow_redirects=True, headers=DEFAULT_HEADERS, trust_env=False) as c:
                r = c.get(cand + "/")
                if r.status_code < 400 and r.text and len(r.text) > 200:
                    # 排除 404 占位
                    title_lc = (r.text[:3000] or "").lower()
                    if "404" not in title_lc and "not found" not in title_lc and "page not found" not in title_lc:
                        chosen_base = cand
                        break
        except Exception:
            continue
    if not chosen_base:
        return {"domain": domain, "sources": []}
    base = chosen_base

    paths_to_try: list[tuple[str, str]] = []  # (path, section)
    paths_to_try.append(("/", "home"))
    for p in ABOUT_PATHS:
        paths_to_try.append((p, "about"))
    for p in PRODUCT_PATHS:
        paths_to_try.append((p, "products"))
    for p in NEWS_PATHS:
        paths_to_try.append((p, "news"))

    result: dict = {
        "domain": domain,
        "title": "",
        "description": "",
        "keywords": "",
        "home_text": "",
        "about_text": "",
        "product_text": "",
        "news_text": "",
        "sources": [],
    }

    def _task(path: str, section: str) -> tuple[str, str, str, dict | None]:
        url = urljoin(base, path)
        html = _fetch_url(url, timeout=6.0)
        if not html:
            return section, "", "", None
        text = _clean_html_text(html)
        title = _extract_title(html)
        meta_desc = _extract_meta_description(html)
        meta_kw = _extract_meta_keywords(html)
        src = {
            "title": title or section,
            "url": url,
            "section": section,
        }
        return section, text, (title, meta_desc, meta_kw), src

    # 并发抓取（最多 8 个并发）
    section_texts: dict[str, str] = {}
    home_meta: tuple[str, str, str] = ("", "", "")  # home 的 title/desc/kw
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(_task, p, sec) for p, sec in paths_to_try]
        for fut in as_completed(futures):
            try:
                section, text, meta, src = fut.result(timeout=12)
            except Exception as e:
                logger.debug("抓取任务失败: %s", e)
                continue
            if text:
                # 排除 404 占位内容
                head = text[:200]
                if "404-error" in head.lower() or "page not found" in head.lower():
                    continue
                # 每个 section 只保留第一个非空结果
                if section not in section_texts:
                    section_texts[section] = text[:5000]  # 每个 section 截 5KB
            # 优先用 home 的 title/desc/kw，避免被 404 路径覆盖
            if section == "home" and meta:
                home_meta = meta
            if src and src["url"] and not any(s["url"] == src["url"] for s in result["sources"]):
                result["sources"].append(src)
    if home_meta and home_meta[0]:
        result["title"] = home_meta[0]
    if home_meta and home_meta[1]:
        result["description"] = home_meta[1]
    if home_meta and home_meta[2]:
        result["keywords"] = home_meta[2]

    result["home_text"] = section_texts.get("home", "")
    result["about_text"] = section_texts.get("about", "")
    result["product_text"] = section_texts.get("products", "")
    result["news_text"] = section_texts.get("news", "")

    # 没有抓到任何东西 → 返回空
    if not any([result["home_text"], result["about_text"], result["product_text"], result["news_text"]]):
        return {"domain": domain, "sources": []}

    logger.info("官网抓取 %s 完成: about=%dB products=%dB news=%dB", domain,
                len(result["about_text"]), len(result["product_text"]), len(result["news_text"]))
    return result


# ============================================================
# 维基百科（中英文）
# ============================================================
def _wiki_summary(name: str, lang: str = "zh") -> dict | None:
    api = WIKI_API if lang == "zh" else WIKI_EN_API
    try:
        with httpx.Client(timeout=6.0, follow_redirects=True, headers=DEFAULT_HEADERS, trust_env=False) as c:
            r = c.get(api + name, headers={"Accept": "application/json"})
            if r.status_code != 200:
                return None
            data = r.json()
            extract = data.get("extract") or ""
            desc = data.get("description") or ""
            url = (data.get("content_urls") or {}).get("desktop", {}).get("page", "")
            if not extract and not desc:
                return None
            return {
                "title": data.get("title", name),
                "extract": extract,
                "description": desc,
                "url": url,
                "lang": lang,
            }
    except Exception as e:
        logger.debug("wiki %s %s 失败: %s", lang, name, e)
        return None


def wikipedia_search(name: str) -> list[dict]:
    """中英文维基百科都查"""
    out: list[dict] = []
    for lang in ("zh", "en"):
        item = _wiki_summary(name, lang)
        if item:
            out.append(item)
    return out


# ============================================================
# 百度百科
# ============================================================
def baidu_baike_search(name: str) -> dict | None:
    """百度百科 HTML 抓取（无需 API key，但需注意反爬）"""
    if not name:
        return None
    try:
        url = BAIDU_BAIKE_SEARCH.format(name=name)
        with httpx.Client(timeout=8.0, follow_redirects=True, headers={**DEFAULT_HEADERS, "Referer": "https://www.baidu.com/"}, trust_env=False) as c:
            r = c.get(url)
            if r.status_code != 200:
                return None
            html = r.text
        # 提取基本信息
        title = _extract_title(html).split("_")[0]
        desc = _extract_meta_description(html)
        # 提取正文摘要（lemma-summary class 包含公司介绍）
        summary_match = re.search(
            r'<div[^>]*class=["\'][^"\']*lemma-summary[^"\']*["\'][^>]*>([\s\S]*?)</div>\s*<',
            html,
        )
        summary = _clean_html_text(summary_match.group(1))[:2000] if summary_match else ""
        if not desc and not summary:
            return None
        return {
            "title": title or name,
            "description": desc,
            "summary": summary,
            "url": url,
        }
    except Exception as e:
        logger.debug("百度百科 %s 失败: %s", name, e)
        return None


# ============================================================
# DuckDuckGo HTML 兜底
# ============================================================
def duckduckgo_search(query: str, max_results: int = 5) -> list[dict]:
    """DuckDuckGo HTML 抓取（无需 API key），返回 [{title, url, snippet}]"""
    if not query:
        return []
    try:
        with httpx.Client(
            timeout=10.0, follow_redirects=True, trust_env=False,
            headers={**DEFAULT_HEADERS, "Referer": "https://duckduckgo.com/"},
        ) as c:
            r = c.post(
                DDG_URL,
                data={"q": query, "kl": ""},
            )
            if r.status_code != 200:
                return []
            html = r.text
        # 提取 result__a 链接 + result__snippet 摘要
        # 新版 DDG HTML 结构：<a class="result__a" href="...">title</a> + <a class="result__snippet">snippet</a>
        out: list[dict] = []
        link_re = re.compile(
            r'<a[^>]+class=["\']result__a["\'][^>]+href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>',
            re.I,
        )
        snippet_re = re.compile(
            r'<a[^>]+class=["\']result__snippet["\'][^>]*>([\s\S]*?)</a>',
            re.I,
        )
        links = link_re.findall(html)
        snippets = snippet_re.findall(html)
        for i, (url, title_html) in enumerate(links[:max_results]):
            title = _clean_html_text(title_html)[:120]
            # 真实 URL 在 redirect 中（uddg=），尝试解析
            real_url = url
            m = re.search(r"uddg=([^&]+)", url)
            if m:
                from urllib.parse import unquote
                real_url = unquote(m.group(1))
            snippet = _clean_html_text(snippets[i]) if i < len(snippets) else ""
            out.append({
                "title": title,
                "url": real_url,
                "snippet": snippet[:300],
            })
        return out
    except Exception as e:
        logger.debug("DuckDuckGo 搜索失败: %s", e)
        return []


# ============================================================
# 综合聚合（统一给 fetch_company_info 用）
# ============================================================
def aggregate_company_sources(company_name: str, website_domain: str | None = None) -> dict:
    """并发跑：维基百科 + 百度百科 + 官网抓取（如果有域名）"""
    tasks: dict = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        f_wiki = ex.submit(wikipedia_search, company_name)
        f_baidu = ex.submit(baidu_baike_search, company_name)
        f_site = ex.submit(fetch_company_pages, website_domain) if website_domain else None
        try:
            tasks["wikipedia"] = f_wiki.result(timeout=10)
        except Exception as e:
            tasks["wikipedia"] = []
            logger.debug("wiki 失败: %s", e)
        try:
            tasks["baidu_baike"] = f_baidu.result(timeout=10)
        except Exception as e:
            tasks["baidu_baike"] = None
            logger.debug("baidu 失败: %s", e)
        if f_site:
            try:
                tasks["site"] = f_site.result(timeout=20)
            except Exception as e:
                tasks["site"] = {"domain": website_domain, "sources": []}
                logger.debug("site 失败: %s", e)
        else:
            tasks["site"] = {"domain": "", "sources": []}
    return tasks
