from datetime import datetime, timezone, timedelta
from app.utils.time import BEIJING_TZ, now
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from app.database import get_session
from app.auth import get_current_user
from app.models.user import User
from app.models.model_usage_log import ModelUsageLog
from app.models.model_provider import ModelProvider

router = APIRouter(prefix="/api/v1/admin/model-usage", tags=["model-usage"])


def _require_admin(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="无权访问")
    return current_user


def _since(days: int) -> datetime:
    return now() - timedelta(days=days)


@router.get("/by-model")
def usage_by_model(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_session),
    _: User = Depends(_require_admin),
):
    """按 (provider_id, model_name) 汇总 token 消耗，返回每个模型的调用次数和各类 token 总量"""
    since = _since(days)
    rows = db.exec(
        select(
            ModelUsageLog.provider_id,
            ModelUsageLog.model_name,
            ModelUsageLog.task_type,
            func.count(ModelUsageLog.id).label("calls"),
            func.sum(ModelUsageLog.input_tokens).label("input_tokens"),
            func.sum(ModelUsageLog.output_tokens).label("output_tokens"),
            func.sum(ModelUsageLog.cache_read_tokens).label("cache_read_tokens"),
            func.sum(ModelUsageLog.cache_write_tokens).label("cache_write_tokens"),
            func.sum(ModelUsageLog.total_tokens).label("total_tokens"),
        )
        .where(ModelUsageLog.created_at >= since)
        .group_by(ModelUsageLog.provider_id, ModelUsageLog.model_name, ModelUsageLog.task_type)
        .order_by(func.sum(ModelUsageLog.total_tokens).desc())
    ).all()

    # 补充供应商名称
    provider_names: dict[int, str] = {}
    for row in rows:
        if row.provider_id and row.provider_id not in provider_names:
            p = db.get(ModelProvider, row.provider_id)
            provider_names[row.provider_id] = p.name if p else f"#{row.provider_id}"

    return [
        {
            "provider_id": row.provider_id,
            "provider_name": provider_names.get(row.provider_id, "未知"),
            "model_name": row.model_name,
            "task_type": row.task_type,
            "calls": row.calls,
            "input_tokens": row.input_tokens or 0,
            "output_tokens": row.output_tokens or 0,
            "cache_read_tokens": row.cache_read_tokens or 0,
            "cache_write_tokens": row.cache_write_tokens or 0,
            "total_tokens": row.total_tokens or 0,
        }
        for row in rows
    ]


@router.get("/by-user")
def usage_by_user(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_session),
    _: User = Depends(_require_admin),
):
    """按 (user_id, provider_id, model_name) 分组，返回每个用户在每个模型上的消耗明细"""
    since = _since(days)
    rows = db.exec(
        select(
            ModelUsageLog.user_id,
            ModelUsageLog.provider_id,
            ModelUsageLog.model_name,
            func.count(ModelUsageLog.id).label("calls"),
            func.sum(ModelUsageLog.input_tokens).label("input_tokens"),
            func.sum(ModelUsageLog.output_tokens).label("output_tokens"),
            func.sum(ModelUsageLog.cache_read_tokens).label("cache_read_tokens"),
            func.sum(ModelUsageLog.total_tokens).label("total_tokens"),
        )
        .where(ModelUsageLog.created_at >= since)
        .group_by(ModelUsageLog.user_id, ModelUsageLog.provider_id, ModelUsageLog.model_name)
        .order_by(ModelUsageLog.user_id, func.sum(ModelUsageLog.total_tokens).desc())
    ).all()

    user_names: dict[int, str] = {}
    provider_names: dict[int, str] = {}
    for row in rows:
        if row.user_id and row.user_id not in user_names:
            u = db.get(User, row.user_id)
            user_names[row.user_id] = (u.name or u.username) if u else f"user#{row.user_id}"
        if row.provider_id and row.provider_id not in provider_names:
            p = db.get(ModelProvider, row.provider_id)
            provider_names[row.provider_id] = p.name if p else f"#{row.provider_id}"

    return [
        {
            "user_id": row.user_id,
            "user_name": user_names.get(row.user_id, "系统/未知"),
            "provider_id": row.provider_id,
            "provider_name": provider_names.get(row.provider_id, "未知") if row.provider_id else "未知",
            "model_name": row.model_name,
            "calls": row.calls,
            "input_tokens": row.input_tokens or 0,
            "output_tokens": row.output_tokens or 0,
            "cache_read_tokens": row.cache_read_tokens or 0,
            "total_tokens": row.total_tokens or 0,
        }
        for row in rows
    ]


@router.get("/daily-trend")
def usage_daily_trend(
    days: int = Query(default=30, ge=1, le=90),
    db: Session = Depends(get_session),
    _: User = Depends(_require_admin),
):
    """按天汇总 token 消耗（用于趋势折线图）"""
    since = _since(days)
    rows = db.exec(
        select(
            func.date_trunc('day', ModelUsageLog.created_at).label("day"),
            func.count(ModelUsageLog.id).label("calls"),
            func.sum(ModelUsageLog.input_tokens).label("input_tokens"),
            func.sum(ModelUsageLog.output_tokens).label("output_tokens"),
            func.sum(ModelUsageLog.cache_read_tokens).label("cache_read_tokens"),
            func.sum(ModelUsageLog.total_tokens).label("total_tokens"),
        )
        .where(ModelUsageLog.created_at >= since)
        .group_by(func.date_trunc('day', ModelUsageLog.created_at))
        .order_by(func.date_trunc('day', ModelUsageLog.created_at))
    ).all()

    return [
        {
            "day": row.day.strftime("%Y-%m-%d") if row.day else None,
            "calls": row.calls,
            "input_tokens": row.input_tokens or 0,
            "output_tokens": row.output_tokens or 0,
            "cache_read_tokens": row.cache_read_tokens or 0,
            "total_tokens": row.total_tokens or 0,
        }
        for row in rows
    ]


@router.get("/summary")
def usage_summary(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_session),
    _: User = Depends(_require_admin),
):
    """平台整体汇总：总调用、总 token、活跃用户数"""
    since = _since(days)
    row = db.exec(
        select(
            func.count(ModelUsageLog.id).label("total_calls"),
            func.sum(ModelUsageLog.input_tokens).label("total_input"),
            func.sum(ModelUsageLog.output_tokens).label("total_output"),
            func.sum(ModelUsageLog.cache_read_tokens).label("total_cache_read"),
            func.sum(ModelUsageLog.total_tokens).label("total_tokens"),
            func.count(func.distinct(ModelUsageLog.user_id)).label("active_users"),
        )
        .where(ModelUsageLog.created_at >= since)
    ).one()

    return {
        "days": days,
        "total_calls": row.total_calls or 0,
        "total_input_tokens": row.total_input or 0,
        "total_output_tokens": row.total_output or 0,
        "total_cache_read_tokens": row.total_cache_read or 0,
        "total_tokens": row.total_tokens or 0,
        "active_users": row.active_users or 0,
    }
