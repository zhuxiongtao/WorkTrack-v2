"""认证模块：密码哈希、JWT 令牌、用户依赖注入、安全策略"""

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.models.user import User

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


# ===== 账号锁定 =====
def check_account_locked(user: User) -> Optional[str]:
    """检查账号是否被锁定，返回 None 表示正常，否则返回错误信息"""
    if not user.is_active:
        return "账号已被禁用，请联系管理员"
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        remaining = int((user.locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1
        return f"账号已被锁定，请 {remaining} 分钟后重试"
    return None


def record_login_failure(user: User, db: Session) -> None:
    """记录登录失败，达到上限则锁定账号"""
    max_attempts = settings.login_max_attempts
    lockout = settings.login_lockout_minutes
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= max_attempts:
        user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=lockout)
    user.updated_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()


def record_login_success(user: User, db: Session) -> None:
    """登录成功后重置失败计数，更新最后登录时间"""
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = datetime.now(timezone.utc)
    user.updated_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()


def bump_token_version(user: User, db: Session) -> None:
    """递增 token_version 使所有旧 Token 失效"""
    user.token_version += 1
    user.updated_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()


# ===== JWT =====
SECRET_KEY = settings.jwt_secret_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # 7 天


def create_access_token(user_id: int, username: str, token_version: int = 1) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
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
    return db.get(User, int(user_id))


def get_current_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """管理员权限守卫，非管理员返回 403"""
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user
