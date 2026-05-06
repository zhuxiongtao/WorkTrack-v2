"""用户管理路由：管理员 CRUD 用户"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth import (
    get_current_admin_user, hash_password, validate_password_strength,
    bump_token_version,
)
from app.database import get_session
from app.models.user import User

router = APIRouter(prefix="/api/v1/users", tags=["用户管理"])


# ===== 请求/响应模型 =====
class UserCreate(BaseModel):
    username: str
    password: str
    name: str = ""
    email: Optional[str] = None
    is_admin: bool = False
    use_shared_models: bool = False
    can_manage_models: bool = False


class UserUpdate(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    is_admin: Optional[bool] = None
    use_shared_models: Optional[bool] = None
    can_manage_models: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    new_password: str


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    email: Optional[str] = None
    is_admin: bool
    is_active: bool
    use_shared_models: bool = False
    can_manage_models: bool = False
    failed_login_attempts: int
    locked_until: Optional[str] = None
    last_login_at: Optional[str] = None
    created_at: Optional[str] = None


def _user_to_out(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "is_admin": user.is_admin,
        "is_active": user.is_active,
        "use_shared_models": user.use_shared_models,
        "can_manage_models": user.can_manage_models,
        "failed_login_attempts": user.failed_login_attempts,
        "locked_until": user.locked_until.isoformat() if user.locked_until else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


# ===== 列出所有用户 =====
@router.get("")
def list_users(db: Session = Depends(get_session),
               _admin: User = Depends(get_current_admin_user)):
    """获取所有用户列表（仅管理员）"""
    users = db.exec(select(User).order_by(User.id)).all()
    return [_user_to_out(u) for u in users]


# ===== 创建用户 =====
@router.post("", status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_session),
                _admin: User = Depends(get_current_admin_user)):
    """管理员创建新用户"""
    # 密码强度校验
    pwd_err = validate_password_strength(data.password)
    if pwd_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_err)

    # 检查用户名是否已存在
    existing = db.exec(select(User).where(User.username == data.username)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        name=data.name or data.username,
        email=data.email,
        is_admin=data.is_admin,
        use_shared_models=data.use_shared_models,
        can_manage_models=data.can_manage_models,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_to_out(user)


# ===== 编辑用户 =====
@router.put("/{user_id}")
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_session),
                _admin: User = Depends(get_current_admin_user)):
    """管理员编辑用户信息"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if data.username is not None:
        # 检查新用户名是否与其他用户冲突
        existing = db.exec(
            select(User).where(User.username == data.username, User.id != user_id)
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已被占用")
        user.username = data.username
    if data.name is not None:
        user.name = data.name
    if data.email is not None:
        user.email = data.email
    if data.is_admin is not None:
        user.is_admin = data.is_admin
    if data.use_shared_models is not None:
        user.use_shared_models = data.use_shared_models
    if data.can_manage_models is not None:
        user.can_manage_models = data.can_manage_models

    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_to_out(user)


# ===== 启用/禁用用户 =====
@router.put("/{user_id}/toggle-active")
def toggle_user_active(user_id: int, db: Session = Depends(get_session),
                       _admin: User = Depends(get_current_admin_user)):
    """管理员启用或禁用用户"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 不能禁用自己
    if user.id == _admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能禁用自己的账号")

    user.is_active = not user.is_active
    # 恢复启用时同时清除锁定状态
    if user.is_active:
        user.failed_login_attempts = 0
        user.locked_until = None

    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "is_active": user.is_active,
        "message": "账号已启用" if user.is_active else "账号已禁用",
    }


# ===== 重置用户密码 =====
@router.post("/{user_id}/reset-password")
def reset_user_password(user_id: int, data: ResetPasswordRequest,
                        db: Session = Depends(get_session),
                        _admin: User = Depends(get_current_admin_user)):
    """管理员重置用户密码"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 密码强度校验
    pwd_err = validate_password_strength(data.new_password)
    if pwd_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_err)

    user.password_hash = hash_password(data.new_password)
    # 递增 token_version 使该用户所有设备上的 Token 失效
    bump_token_version(user, db)

    return {"message": "密码已重置，用户需要重新登录"}


# ===== 删除用户 =====
@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_session),
                _admin: User = Depends(get_current_admin_user)):
    """管理员删除用户"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 不能删除自己
    if user.id == _admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除自己的账号")

    db.delete(user)
    db.commit()
