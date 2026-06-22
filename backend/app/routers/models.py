"""模型目录相关 API
- GET    /api/v1/models                 业务侧消费：只返回 is_active=true（按 region/provider 过滤）
- GET    /api/v1/models/all             管理后台：返回所有（包含待审校）
- PATCH  /api/v1/models/{id}           审校（编辑/启用/停用）
- DELETE /api/v1/models/{id}           删除
- POST   /api/v1/models/refresh        手动触发刷新
- GET    /api/v1/models/refresh/status 查看上次刷新状态 + 下次定时
"""
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, or_, and_

from app.database import engine, get_session
from app.models.model_catalog import ModelCatalog
from app.models.user import User
from app.schemas.model_catalog import (
    ModelCatalogOut,
    ModelCatalogUpdate,
    ModelCatalogListItem,
    ModelRefreshStatus,
    ModelRefreshTriggerResult,
)
from app.auth import get_current_user
from app.services.model_catalog_fetcher import (
    refresh_and_record,
    get_last_status,
)
from app.services.scheduler import scheduler
from app.config import settings
import os

router = APIRouter(prefix="/api/v1/models", tags=["models"])
logger = logging.getLogger("worktrack.models_api")

# 手动刷新节流：同 IP/用户 1 小时内最多 1 次
_last_manual_trigger: dict = {}
MANUAL_TRIGGER_COOLDOWN = 3600  # 秒


def _is_admin(user: User) -> bool:
    return bool(getattr(user, "is_admin", False) or getattr(user, "is_superuser", False))


@router.get("", response_model=list[ModelCatalogListItem])
def list_active_models(
    region: Optional[str] = Query(None, description="domestic / international"),
    provider: Optional[str] = Query(None),
    _user: User = Depends(get_current_user),
):
    """业务侧消费：只返回已审校（is_active=true）的模型"""
    with Session(engine) as db:
        stmt = select(ModelCatalog).where(ModelCatalog.is_active == True)
        if region:
            stmt = stmt.where(ModelCatalog.region == region)
        if provider:
            stmt = stmt.where(ModelCatalog.provider == provider)
        stmt = stmt.order_by(ModelCatalog.region.asc(), ModelCatalog.provider.asc(), ModelCatalog.name.asc())
        rows = db.exec(stmt).all()
    return [ModelCatalogListItem.model_validate(r) for r in rows]


@router.get("/all", response_model=list[ModelCatalogOut])
def list_all_models(
    include_inactive: bool = True,
    _user: User = Depends(get_current_user),
):
    """管理后台：返回所有（含待审校 is_active=false）"""
    if not _is_admin(_user):
        raise HTTPException(status_code=403, detail="仅管理员可访问")
    with Session(engine) as db:
        stmt = select(ModelCatalog)
        if not include_inactive:
            stmt = stmt.where(ModelCatalog.is_active == True)
        stmt = stmt.order_by(
            ModelCatalog.is_active.desc(),
            ModelCatalog.last_seen_at.desc().nullslast(),
        )
        rows = db.exec(stmt).all()
    return [ModelCatalogOut.model_validate(r) for r in rows]


@router.patch("/{model_id}", response_model=ModelCatalogOut)
def update_model(
    model_id: int,
    payload: ModelCatalogUpdate,
    user: User = Depends(get_current_user),
):
    """管理员审校：编辑字段 / 启用 / 停用"""
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    with Session(engine) as db:
        row = db.get(ModelCatalog, model_id)
        if not row:
            raise HTTPException(status_code=404, detail="模型不存在")
        data = payload.model_dump(exclude_unset=True)
        for k, v in data.items():
            setattr(row, k, v)
        if "is_active" in data and data["is_active"]:
            row.reviewed_at = datetime.now(timezone.utc)
            row.reviewed_by = user.id
        row.updated_at = datetime.now(timezone.utc)
        db.add(row)
        db.commit()
        db.refresh(row)
    return ModelCatalogOut.model_validate(row)


@router.delete("/{model_id}")
def delete_model(
    model_id: int,
    user: User = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    with Session(engine) as db:
        row = db.get(ModelCatalog, model_id)
        if not row:
            raise HTTPException(status_code=404, detail="模型不存在")
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.post("/refresh", response_model=ModelRefreshTriggerResult)
def manual_refresh(
    user: User = Depends(get_current_user),
):
    """管理员手动触发刷新（带 1 小时节流）"""
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    # 节流
    now = time.time()
    last = _last_manual_trigger.get(user.id, 0)
    if now - last < MANUAL_TRIGGER_COOLDOWN:
        remain = int(MANUAL_TRIGGER_COOLDOWN - (now - last))
        raise HTTPException(status_code=429, detail=f"刷新冷却中，请 {remain // 60} 分钟后再试")
    _last_manual_trigger[user.id] = now
    # 调用
    res = refresh_and_record()
    if not res.get("success"):
        raise HTTPException(status_code=500, detail=res.get("error", "刷新失败"))
    return ModelRefreshTriggerResult(
        success=True,
        inserted=res.get("inserted", 0),
        updated=res.get("updated", 0),
        skipped=0,
        translated=res.get("translated", 0),
        duration_ms=res.get("duration_ms", 0),
    )


@router.get("/refresh/status", response_model=ModelRefreshStatus)
def refresh_status(
    _user: User = Depends(get_current_user),
):
    """查看上次刷新状态 + 下次定时"""
    last = get_last_status()
    enabled_env = os.getenv("MODEL_REFRESH_ENABLED", "true").lower() != "false"
    cron = os.getenv("MODEL_REFRESH_CRON", "0 3 * * 1")
    next_run = None
    try:
        job = scheduler.get_job("model_catalog_refresh")
        if job:
            next_run = job.next_run_time
    except Exception:
        pass
    finished_at = last.get("finished_at")
    if finished_at:
        try:
            finished_at_dt = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
        except Exception:
            finished_at_dt = None
    else:
        finished_at_dt = None
    return ModelRefreshStatus(
        last_refresh_at=finished_at_dt,
        last_refresh_status="success" if last.get("success") else ("failed" if last.get("error") else None),
        last_refresh_count=(last.get("inserted", 0) + last.get("updated", 0)),
        last_error=last.get("error"),
        next_run_at=next_run,
        enabled=enabled_env,
        cron=cron,
    )
