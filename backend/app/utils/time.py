"""统一时间处理工具：所有时间操作均使用北京时间（UTC+8），存储为 naive datetime"""

from datetime import datetime, timezone, timedelta

# 北京时间时区（UTC+8）
BEIJING_TZ = timezone(timedelta(hours=8))


def now() -> datetime:
    """获取当前北京时间（naive，不带时区信息，避免前端二次转换）"""
    return datetime.now(BEIJING_TZ).replace(tzinfo=None)


def utc_now() -> datetime:
    """兼容旧接口：获取当前北京时间（naive）"""
    return now()


def ensure_beijing(dt: datetime | None) -> datetime | None:
    """确保 datetime 对象带有北京时区信息；naive datetime 视为北京时间"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=BEIJING_TZ)
    return dt


def ensure_utc(dt: datetime | None) -> datetime | None:
    """兼容旧接口：等同于 ensure_beijing"""
    return ensure_beijing(dt)
