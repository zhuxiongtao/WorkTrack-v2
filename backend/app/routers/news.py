"""全频道信息流：AI 资讯 + 系统公告"""
import json
import logging
from datetime import datetime, timezone, timedelta
from app.utils.time import BEIJING_TZ, now
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select, or_, func

from app.database import get_session
from app.models.user import User
from app.models.news_cache import NewsCache
from app.models.system_preference import SystemPreference
from app.auth import get_current_user, require_permission

router = APIRouter(prefix="/api/v1/news", tags=["信息流"])
logger = logging.getLogger("worktrack.news_api")

# 全局公告在 system_preference 表里的 key（user_id=NULL）
ANNOUNCEMENT_KEY = "global_announcement"
# 公告发布时间
ANNOUNCEMENT_PUBLISHED_KEY = "global_announcement_published_at"
# 公告是否启用
ANNOUNCEMENT_ENABLED_KEY = "global_announcement_enabled"


# =================== AI 资讯 ===================

def _serialize_news(n: NewsCache) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "url": n.url,
        "source": n.source or "",
        "description": n.description or "",
        "category": n.category or "other",
        "pub_date": n.pub_date.isoformat() if n.pub_date else None,
        "fetched_at": n.fetched_at.isoformat() if n.fetched_at else None,
    }


@router.get("/feed")
def get_news_feed(
    date: Optional[str] = Query(None, description="日期过滤 YYYY-MM-DD（默认近 7 天）"),
    category: Optional[str] = Query(None, description="分类: official/social/community/media/other"),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """所有登录用户可见：返回缓存的 AI 资讯列表"""
    q = select(NewsCache)
    if category and category != "all":
        q = q.where(NewsCache.category == category)
    if date:
        try:
            day = datetime.fromisoformat(date)
            next_day = day + timedelta(days=1)
            q = q.where(NewsCache.pub_date >= day, NewsCache.pub_date < next_day)
        except ValueError:
            raise HTTPException(status_code=400, detail="date 格式错误，应为 YYYY-MM-DD")
    else:
        # 默认最近 7 天
        cutoff = now() - timedelta(days=7)
        q = q.where(NewsCache.pub_date >= cutoff)

    items = db.exec(
        q.order_by(NewsCache.pub_date.desc().nulls_last()).limit(limit)
    ).all()
    return {
        "items": [_serialize_news(n) for n in items],
        "total": len(items),
    }


@router.post("/fetch-now")
def fetch_now(
    _admin: User = Depends(require_permission("settings:edit")),
):
    """管理员手动触发抓取（不等定时任务）"""
    from app.services.news_fetcher import fetch_ai_news
    return fetch_ai_news()


# =================== 系统公告 ===================

def _load_announcement(db: Session) -> dict:
    """从 SystemPreference 读取公告 3 件套（content / published_at / enabled）"""
    prefs = db.exec(
        select(SystemPreference).where(
            SystemPreference.user_id == None,
            SystemPreference.key.in_([ANNOUNCEMENT_KEY, ANNOUNCEMENT_PUBLISHED_KEY, ANNOUNCEMENT_ENABLED_KEY])
        )
    ).all()
    out = {"content": "", "published_at": None, "enabled": False}
    for p in prefs:
        if p.key == ANNOUNCEMENT_KEY:
            out["content"] = p.value
        elif p.key == ANNOUNCEMENT_PUBLISHED_KEY:
            out["published_at"] = p.value
        elif p.key == ANNOUNCEMENT_ENABLED_KEY:
            out["enabled"] = p.value == "true"
    return out


@router.get("/announcement")
def get_announcement(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """获取当前全局公告（所有登录用户可见，公开内容）"""
    return _load_announcement(db)


class AnnouncementUpdate(BaseModel):
    content: str = ""
    enabled: bool = True


@router.put("/announcement")
def update_announcement(
    data: AnnouncementUpdate,
    _admin: User = Depends(require_permission("settings:edit")),
    db: Session = Depends(get_session),
):
    """管理员编辑/发布/停用全局公告"""
    if len(data.content) > 50000:
        raise HTTPException(status_code=400, detail="公告内容超过 50000 字符上限")

    now_iso = now().isoformat()

    pairs = [
        (ANNOUNCEMENT_KEY, data.content),
        (ANNOUNCEMENT_ENABLED_KEY, "true" if data.enabled else "false"),
    ]
    # 仅在内容非空时更新发布时间
    if data.enabled and data.content.strip():
        pairs.append((ANNOUNCEMENT_PUBLISHED_KEY, now_iso))
    elif not data.enabled:
        # 停用时也清掉发布时间，避免 Banner 还显示"刚刚发布"
        pairs.append((ANNOUNCEMENT_PUBLISHED_KEY, ""))

    for key, val in pairs:
        pref = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == key,
                SystemPreference.user_id == None,
            )
        ).first()
        if pref:
            pref.value = val
        else:
            db.add(SystemPreference(key=key, value=val, user_id=None))
    db.commit()
    return _load_announcement(db)
