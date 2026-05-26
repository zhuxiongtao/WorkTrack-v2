"""统一时间处理工具：所有时间操作均使用 UTC 时区"""

from datetime import datetime, timezone


def utc_now() -> datetime:
    """获取当前 UTC 时间（带时区信息）"""
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime | None) -> datetime | None:
    """确保 datetime 对象带有 UTC 时区信息；naive datetime 视为 UTC"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
