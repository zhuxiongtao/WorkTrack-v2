"""认证模块：密码哈希、JWT 令牌、用户依赖注入、安全策略"""

import re
import time
import secrets
from datetime import datetime, timedelta, timezone
from app.utils.time import BEIJING_TZ, now
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.models.user import User

# ===== RBAC 权限缓存 =====
_RBAC_CACHE_MAX = 10000
_rbac_cache: dict[tuple[int, str], tuple[bool, float]] = {}
_rbac_cache_ttl = 60


def invalidate_rbac_cache(user_id: int | None = None) -> None:
    """清理 RBAC 缓存。
    user_id=None 时清空全部（角色/权限/部门角色变更时调用）。
    user_id=int 时仅清该用户（该用户角色/部门调整时调用）。"""
    if user_id is None:
        _rbac_cache.clear()
    else:
        keys_to_delete = [k for k in _rbac_cache if k[0] == user_id]
        for k in keys_to_delete:
            del _rbac_cache[k]

# ===== 密码哈希 =====
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ===== 密码强度校验 =====
def validate_password_strength(password: str) -> Optional[str]:
    """校验密码强度，返回 None 表示通过，否则返回错误信息"""
    min_len = settings.password_min_length
    if len(password) < min_len:
        return f"密码长度至少为 {min_len} 位"
    if not re.search(r'[A-Za-z]', password):
        return "密码必须包含至少一个字母"
    if not re.search(r'\d', password):
        return "密码必须包含至少一个数字"
    return None


def generate_initial_password(length: int = 12) -> str:
    """生成满足强度要求的随机初始密码（去除易混淆字符 0/O/1/l/I，便于从邮件抄录）"""
    letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"
    digits = "23456789"
    alphabet = letters + digits
    length = max(length, settings.password_min_length, 8)
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        # 保证至少含一个字母和一个数字，满足 validate_password_strength
        if any(c.isalpha() for c in pwd) and any(c.isdigit() for c in pwd):
            return pwd


# ===== 账号状态检查 =====
def check_account_locked(user: User) -> Optional[str]:
    """检查账号是否被锁定/停用/离职，返回 None 表示正常，否则返回错误信息"""
    if user.status == "resigned":
        return "该账号已离职，无法登录"
    if user.status == "disabled":
        return "账号已被停用，请联系管理员"
    if not user.is_active:
        return "账号已被禁用，请联系管理员"
    if user.locked_until and user.locked_until > now():
        remaining = int((user.locked_until - now()).total_seconds() / 60) + 1
        return f"账号已被锁定，请 {remaining} 分钟后重试"
    return None


def record_login_failure(user: User, db: Session) -> None:
    """记录登录失败，达到上限则锁定账号"""
    max_attempts = settings.login_max_attempts
    lockout = settings.login_lockout_minutes
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= max_attempts:
        user.locked_until = now() + timedelta(minutes=lockout)
    user.updated_at = now()
    db.add(user)
    db.commit()


def record_login_success(user: User, db: Session) -> None:
    """登录成功后重置失败计数，更新最后登录时间"""
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now()
    user.updated_at = now()
    db.add(user)
    db.commit()


def bump_token_version(user: User, db: Session) -> None:
    """递增 token_version 使所有旧 Token 失效"""
    user.token_version += 1
    user.updated_at = now()
    db.add(user)
    db.commit()


# ===== JWT =====
SECRET_KEY = settings.jwt_secret_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # 7 天


def create_access_token(user_id: int, username: str, token_version: int = 1) -> str:
    expire = now() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "tv": token_version,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ===== 依赖注入 =====
security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_session),
) -> User:
    """从 Authorization Header 解析当前用户；未认证返回 401；校验 token_version"""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    payload = decode_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="令牌无效或已过期")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="令牌无效")
    user = db.get(User, int(user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    # 校验 token_version：如果 Token 中的版本与用户当前的版本不一致，则 Token 已失效
    token_tv = payload.get("tv", 0)
    if token_tv != user.token_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="令牌已失效，请重新登录")
    # 校验账号状态
    lock_msg = check_account_locked(user)
    if lock_msg:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=lock_msg)
    return user


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_session),
) -> Optional[User]:
    """可选的用户解析，未登录返回 None（用于公开接口）"""
    if credentials is None:
        return None
    payload = decode_token(credentials.credentials)
    if payload is None:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = db.get(User, int(user_id))
    if not user:
        return None
    token_tv = payload.get("tv", 0)
    if token_tv != user.token_version:
        return None
    if user.status in ("resigned", "disabled") or not user.is_active:
        return None
    return user


def get_current_admin_user(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> User:
    """管理员权限守卫，非管理员返回 403"""
    if not has_permission(current_user, "user:manage_roles", db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


# ===== RBAC 权限校验 =====

# 旧 boolean 字段 → RBAC 权限映射（向后兼容）
_LEGACY_PERM_MAP = {
    "ai:use": lambda u: u.use_shared_models,
    "ai:manage_own": lambda u: u.can_manage_models,
}


def _get_all_role_ids(user_id: int, db: Session) -> list[int]:
    """统一获取用户所有角色ID，合并三种来源：直接分配、部门角色、用户组角色"""
    from app.models.rbac import UserRole, DepartmentRole, GroupRole
    from app.models.wiki import UserGroupMember

    user_role_ids = list(
        db.exec(select(UserRole.role_id).where(UserRole.user_id == user_id)).all()
    )

    user_dept_id = db.exec(
        select(User.department_id).where(User.id == user_id)
    ).first()
    dept_role_ids = []
    if user_dept_id:
        dept_role_ids = list(
            db.exec(
                select(DepartmentRole.role_id)
                .where(DepartmentRole.department_id == user_dept_id)
            ).all()
        )

    group_role_ids = list(
        db.exec(
            select(GroupRole.role_id)
            .join(UserGroupMember, UserGroupMember.group_id == GroupRole.group_id)
            .where(UserGroupMember.user_id == user_id)
        ).all()
    )

    return list(set(user_role_ids + dept_role_ids + group_role_ids))


def has_permission(user: User, permission_code: str, db: Session) -> bool:
    """
    检查用户是否拥有指定权限。
    三条路径（任一满足即通过）：
    0. is_admin 兜底 → 放行（防止 RBAC 数据异常导致管理员丧失权限）
    1. 旧 boolean 字段向后兼容
    2. RBAC 查询（用户角色 + 部门角色 + 用户组角色）
    结果缓存 60 秒以减少数据库查询。
    """
    if user.is_admin:
        return True

    if permission_code in _LEGACY_PERM_MAP:
        if _LEGACY_PERM_MAP[permission_code](user):
            return True

    cache_key = (user.id, permission_code)
    now = time.time()
    cached = _rbac_cache.get(cache_key)
    if cached and now < cached[1]:
        return cached[0]

    result = _check_rbac(user.id, permission_code, db)
    if len(_rbac_cache) >= _RBAC_CACHE_MAX:
        oldest_keys = sorted(_rbac_cache, key=lambda k: _rbac_cache[k][1])[:len(_rbac_cache) - _RBAC_CACHE_MAX + 1]
        for k in oldest_keys:
            del _rbac_cache[k]
    _rbac_cache[cache_key] = (result, now + _rbac_cache_ttl)
    return result


def _check_rbac(user_id: int, permission_code: str, db: Session) -> bool:
    """通过 RBAC 表检查用户权限（直接角色 + 部门角色 + 用户组角色）"""
    from app.models.rbac import RolePermission, Permission

    all_role_ids = _get_all_role_ids(user_id, db)
    if not all_role_ids:
        return False

    perm = db.exec(
        select(Permission.id).where(Permission.code == permission_code)
    ).first()
    if not perm:
        return False

    count = db.exec(
        select(RolePermission).where(
            RolePermission.role_id.in_(all_role_ids),
            RolePermission.permission_id == perm,
        )
    ).first()

    return count is not None


def get_user_permissions(user: User, db: Session) -> list[str]:
    """获取用户所有有效权限 code 列表（通过直接分配角色、部门角色与用户组角色合并计算）
    is_admin 用户始终返回全部权限"""
    from app.models.rbac import RolePermission, Permission

    if user.is_admin:
        return list(db.exec(select(Permission.code)).all())

    all_role_ids = _get_all_role_ids(user.id, db)
    if not all_role_ids:
        return []

    perm_ids = list(
        db.exec(
            select(RolePermission.permission_id)
            .where(RolePermission.role_id.in_(all_role_ids))
        ).all()
    )
    if not perm_ids:
        return []

    codes = list(
        db.exec(
            select(Permission.code).where(Permission.id.in_(list(set(perm_ids))))
        ).all()
    )
    return codes


def require_permission(permission_code: str):
    """权限校验依赖注入工厂"""
    def checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_session),
    ) -> User:
        if not has_permission(current_user, permission_code, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足：需要 {permission_code}",
            )
        return current_user
    return checker


def check_data_access(owner_id: int, current_user: User, db: Session) -> bool:
    """
    统一数据行级访问权限校验。
    判定优先级：
    1. 本人数据 → 放行
    2. is_admin → 放行
    3. boss 角色 → 全公司放行
    4. 有对应模块的 view_all 权限 → 放行（用于 admin 级跨部门查看）
    5. 部门负责人（manager_id）→ 管辖部门+子部门+汇报链
    6. 直属汇报关系 → leader_id 匹配
    """
    if owner_id == current_user.id:
        return True

    if current_user.is_admin:
        return True

    from app.models.rbac import UserRole, DepartmentRole, Role
    user_roles_ids = list(db.exec(select(UserRole.role_id).where(UserRole.user_id == current_user.id)).all())
    if current_user.department_id:
        dept_role_ids = list(db.exec(
            select(DepartmentRole.role_id).where(DepartmentRole.department_id == current_user.department_id)
        ).all())
    else:
        dept_role_ids = []
    all_role_ids = list(set(user_roles_ids + dept_role_ids))
    role_codes = set(db.exec(select(Role.code).where(Role.id.in_(all_role_ids))).all()) if all_role_ids else set()

    if "boss" in role_codes:
        return True

    owner_user = db.get(User, owner_id)
    if not owner_user:
        return False

    managed = _get_managed_dept_tree(current_user.id, db)
    if owner_user.department_id is not None and owner_user.department_id in managed:
        return True

    if owner_user.leader_id == current_user.id:
        return True

    return False


def get_visible_user_ids(current_user: User, db: Session, module: str = "") -> Optional[list[int]]:
    """
    统一数据可见范围控制。返回 None 表示不限制（全公司可见），否则返回可见用户 ID 列表。
    
    判定优先级：
    1. is_admin / boss 角色 → None（全公司）
    2. 有 {module}:view_all 权限 → None（跨部门可见，如 admin 级管理者）
    3. 部门负责人（Department.manager_id）→ 管辖部门+子部门全部成员
    4. 普通员工 → 仅自己 + 直属下级(leader_id指向自己的)
    5. 无部门用户 → 仅自己
    
    module 参数: 业务模块名（如 "report", "customer", "project"），用于判断 view_all 权限
    """
    if current_user.is_admin:
        return None

    from app.models.rbac import UserRole, DepartmentRole, Role
    user_roles_ids = list(db.exec(select(UserRole.role_id).where(UserRole.user_id == current_user.id)).all())
    if current_user.department_id:
        dept_role_ids = list(db.exec(
            select(DepartmentRole.role_id).where(DepartmentRole.department_id == current_user.department_id)
        ).all())
    else:
        dept_role_ids = []
    all_role_ids = list(set(user_roles_ids + dept_role_ids))
    role_codes = set(db.exec(select(Role.code).where(Role.id.in_(all_role_ids))).all()) if all_role_ids else set()

    if "boss" in role_codes:
        return None

    if module and has_permission(current_user, f"{module}:view_all", db):
        return None

    managed = _get_managed_dept_tree(current_user.id, db)

    visible_dept_ids: set[int] = set()

    if managed:
        visible_dept_ids.update(managed)

    if not visible_dept_ids:
        member_ids = [current_user.id]
    else:
        members = db.exec(select(User).where(User.department_id.in_(visible_dept_ids))).all()
        member_ids = [m.id for m in members]
        if current_user.id not in member_ids:
            member_ids.append(current_user.id)

    leader_subordinate_ids = list(db.exec(
        select(User.id).where(User.leader_id == current_user.id)
    ).all())
    member_ids = list(set(member_ids + leader_subordinate_ids))

    return member_ids


def check_share_access(target_type: str, target_id: int, current_user: User, db: Session) -> bool:
    """
    检查当前用户是否被分享了对应的数据（DataShare fallback）。
    在 check_data_access() 返回 False 后调用，作为额外放行条件。
    """
    from app.models.data_share import DataShare
    from datetime import datetime, timezone
    
    share = db.exec(
        select(DataShare).where(
            DataShare.target_type == target_type,
            DataShare.target_id == target_id,
            DataShare.shared_to == current_user.id,
        )
    ).first()
    
    if not share:
        return False
    
    # 检查是否过期
    if share.expires_at is not None:
        expires = share.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < now():
            return False
    
    return True


def _get_department_descendants(dept_id: int, db: Session) -> list[int]:
    """递归获取指定部门的所有子部门 ID 列表（不含自身）"""
    from app.models.department import Department
    result = []
    children = db.exec(select(Department.id).where(Department.parent_id == dept_id)).all()
    for child_id in children:
        result.append(child_id)
        result.extend(_get_department_descendants(child_id, db))
    return result


def _get_managed_dept_tree(manager_id: int, db: Session) -> set:
    """递归获取用户作为负责人所管理的所有部门 ID（含子部门）"""
    from app.models.department import Department
    managed = set()
    stack = list(db.exec(
        select(Department.id).where(Department.manager_id == manager_id)
    ).all())
    while stack:
        dept_id = stack.pop()
        if dept_id in managed:
            continue
        managed.add(dept_id)
        children = list(db.exec(
            select(Department.id).where(Department.parent_id == dept_id)
        ).all())
        stack.extend(children)
    return managed
