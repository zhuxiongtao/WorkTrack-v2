"""认证路由：注册、登录、修改密码、获取当前用户、头像上传"""

import os
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth import (
    hash_password, verify_password, create_access_token, get_current_user,
    get_current_admin_user, validate_password_strength,
    check_account_locked, record_login_failure, record_login_success,
    bump_token_version,
)
from app.config import settings
from app.database import get_session
from app.models.user import User

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# 头像存储目录
AVATAR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "avatars")
os.makedirs(AVATAR_DIR, exist_ok=True)
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}


# ===== 请求/响应模型 =====
class RegisterRequest(BaseModel):
    username: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# ===== 注册 =====
@router.post("/register")
def register(req: RegisterRequest, db: Session = Depends(get_session),
             _admin: User = Depends(get_current_admin_user)):
    """注册新用户（仅管理员可操作，或根据 allow_registration 配置开放）"""
    pwd_err = validate_password_strength(req.password)
    if pwd_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_err)

    existing = db.exec(select(User).where(User.username == req.username)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        name=req.name or req.username,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.username, user.token_version)
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "username": user.username, "name": user.name, "is_admin": user.is_admin, "can_manage_models": user.can_manage_models, "use_shared_models": user.use_shared_models},
    )


# ===== 登录 =====
@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_session)):
    user = db.exec(select(User).where(User.username == req.username)).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    lock_msg = check_account_locked(user)
    if lock_msg:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=lock_msg)

    if not verify_password(req.password, user.password_hash):
        record_login_failure(user, db)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    record_login_success(user, db)
    token = create_access_token(user.id, user.username, user.token_version)
    return TokenResponse(
        access_token=token,
        user={"id": user.id, "username": user.username, "name": user.name, "is_admin": user.is_admin},
    )


# ===== 修改密码 =====
@router.post("/change-password")
def change_password(req: ChangePasswordRequest, current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_session)):
    """当前用户修改自己的密码"""
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="旧密码错误")

    pwd_err = validate_password_strength(req.new_password)
    if pwd_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_err)

    if req.old_password == req.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不能与旧密码相同")

    current_user.password_hash = hash_password(req.new_password)
    bump_token_version(current_user, db)

    return {"message": "密码修改成功，请重新登录"}


# ===== 更新个人资料 =====
@router.put("/me")
def update_profile(req: UpdateProfileRequest, current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_session)):
    """当前用户更新自己的个人资料"""
    if req.name is not None:
        current_user.name = req.name
    if req.email is not None:
        current_user.email = req.email
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return {
        "id": current_user.id,
        "username": current_user.username,
        "name": current_user.name,
        "email": current_user.email,
        "is_admin": current_user.is_admin,
    }


# ===== 获取当前用户 =====
@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "name": current_user.name,
        "email": current_user.email,
        "is_admin": current_user.is_admin,
        "is_active": current_user.is_active,
        "can_manage_models": current_user.can_manage_models,
        "use_shared_models": current_user.use_shared_models,
        "avatar": current_user.avatar,
        "last_login_at": current_user.last_login_at.isoformat() if current_user.last_login_at else None,
    }


# ===== 头像上传 =====
@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), current_user: User = Depends(get_current_user),
                        db: Session = Depends(get_session)):
    """上传用户头像"""
    ext = os.path.splitext(file.filename or ".png")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式，仅支持: {', '.join(ALLOWED_EXTENSIONS)}")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小不能超过 5MB")

    filename = f"avatar_{current_user.id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)

    # 删除旧头像文件
    if current_user.avatar:
        old_filename = current_user.avatar.rsplit("/", 1)[-1]
        old_filepath = os.path.join(AVATAR_DIR, old_filename)
        if os.path.exists(old_filepath) and old_filepath != filepath:
            try:
                os.remove(old_filepath)
            except OSError:
                pass

    with open(filepath, "wb") as f:
        f.write(content)

    current_user.avatar = f"/api/v1/auth/avatar-file/{filename}"
    db.add(current_user)
    db.commit()

    return {"avatar_url": current_user.avatar, "message": "头像上传成功"}


@router.get("/avatar-file/{filename}")
def serve_avatar(filename: str):
    """获取头像文件"""
    filepath = os.path.join(AVATAR_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="头像文件不存在")
    return FileResponse(filepath)
