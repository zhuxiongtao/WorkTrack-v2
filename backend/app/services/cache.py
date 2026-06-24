"""轻量内存 TTL 缓存

特点：
- 进程内单例（dict + threading.Lock）
- 支持按 key 设独立 TTL
- 命中时返回 (value, True)，未命中计算后存 (value, False)
- 简单 LRU 淘汰：超过 MAX_ENTRIES 时清掉最早的 25%
"""
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Tuple

MAX_ENTRIES = 512  # 全局最大缓存条目数

_cache: "OrderedDict[str, Tuple[float, float, Any]]" = OrderedDict()
_lock = threading.Lock()


def _evict_if_needed() -> None:
    if len(_cache) <= MAX_ENTRIES:
        return
    # 清掉最早插入的 25%
    drop = max(1, MAX_ENTRIES // 4)
    for _ in range(drop):
        _cache.popitem(last=False)


def cached_call(key: str, ttl: int, factory: Callable[[], Any], skip_none: bool = False) -> Tuple[Any, bool]:
    """按 key 在 ttl 秒内缓存 factory() 的结果

    返回 (value, hit)。命中时 hit=True；未命中计算并存入 hit=False。
    异常不会被缓存（向上抛）。
    skip_none=True 时，factory 返回 None 不写入缓存，下次继续重试。
    """
    now = time.monotonic()
    with _lock:
        item = _cache.get(key)
        if item is not None:
            exp, _, value = item
            if exp > now:
                # 命中 → 提升为最近使用
                _cache.move_to_end(key)
                return value, True
            # 已过期 → 删除
            del _cache[key]
    # 未命中：在锁外计算（避免长时间持锁）
    value = factory()
    if value is None and skip_none:
        return value, False
    with _lock:
        _cache[key] = (now + ttl, now, value)
        _cache.move_to_end(key)
        _evict_if_needed()
    return value, False


def invalidate(prefix: str = "") -> int:
    """清掉所有 key 以 prefix 开头的缓存；prefix 为空则清空全部。返回清理条数"""
    with _lock:
        if not prefix:
            n = len(_cache)
            _cache.clear()
            return n
        keys = [k for k in _cache if k.startswith(prefix)]
        for k in keys:
            del _cache[k]
        return len(keys)
