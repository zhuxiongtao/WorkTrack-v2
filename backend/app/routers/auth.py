"""认证路由：注册、登录、修改密码、获取当前用户、头像上传"""

import os
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth import (
    hash_password, verify_password, create_access_token, get_current_user, get_optional_user,
    require_permission, has_permission, validate_password_strength,
    check_account_locked, record_login_failure, record_login_success,
    bump_token_version,
)
from app.config import settings
from app.database import get_session
from app.models.user import User
from app.rate_limit import limiter

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _build_user_response(user: User, db: Session) -> dict:
    from app.auth import get_user_permissions
    perms = get_user_permissions(user, db)
    # 补充旧 boolean 字段对应的权限码（与 has_permission 的 _LEGACY_PERM_MAP 保持一致）
    if user.use_shared_models and "ai:use" not in perms:
        perms.append("ai:use")
    if user.can_manage_models and "ai:manage_own" not in perms:
        perms.append("ai:manage_own")
    return {
        "id": user.id, "username": user.username, "name": user.name, "is_admin": user.is_admin,
        "email": user.email, "is_active": user.is_active, "avatar": user.avatar,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "can_manage_models": user.can_manage_models, "use_shared_models": user.use_shared_models,
        "must_change_password": user.must_change_password,
        "permissions": perms,
    }


# 头像存储目录
AVATAR_DIR = settings.effective_avatar_dir
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
    job_title: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# ===== 注册 =====
@router.post("/register")
def register(req: RegisterRequest, db: Session = Depends(get_session),
             current_user: Optional[User] = Depends(get_optional_user)):
    """注册新用户。allow_registration=True 时开放自助注册；否则仅管理员（user:create）可操作。"""
    if not settings.allow_registration:
        if not current_user or not has_permission(current_user, "user:create", db):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="注册功能未开放")
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
        user=_build_user_response(user, db),
    )


# ===== 登录 =====
@router.post("/login")
@limiter.limit("5/minute")
def login(req: LoginRequest, request: Request, db: Session = Depends(get_session)):
    user = db.exec(select(User).where(User.username == req.username)).first()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="您的账号已被管理员停用")

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
        user=_build_user_response(user, db),
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
    current_user.must_change_password = False  # 首登强制改密：改完即解除标志
    db.add(current_user)
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
    if req.job_title is not None:
        current_user.job_title = req.job_title
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return {
        "id": current_user.id,
        "username": current_user.username,
        "name": current_user.name,
        "email": current_user.email,
        "job_title": current_user.job_title,
        "is_admin": current_user.is_admin,
    }


# ===== 获取当前用户 =====
@router.get("/me")
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    from app.auth import get_user_permissions, _get_all_role_ids
    from app.models.rbac import Role
    from app.models.department import Department
    all_role_ids = _get_all_role_ids(current_user.id, db)
    role_codes = list(db.exec(select(Role.code).where(Role.id.in_(all_role_ids))).all()) if all_role_ids else []
    perms = get_user_permissions(current_user, db)
    # 补充旧 boolean 字段对应的权限码（与 has_permission 的 _LEGACY_PERM_MAP 保持一致）
    if current_user.use_shared_models and "ai:use" not in perms:
        perms.append("ai:use")
    if current_user.can_manage_models and "ai:manage_own" not in perms:
        perms.append("ai:manage_own")
    # 部门名称
    dept_name = None
    if current_user.department_id:
        dept = db.get(Department, current_user.department_id)
        if dept:
            dept_name = dept.name
    # 领导名称
    leader_name = None
    if current_user.leader_id:
        leader = db.get(User, current_user.leader_id)
        if leader:
            leader_name = leader.name
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
        "must_change_password": current_user.must_change_password,
        "permissions": perms,
        "roles": role_codes,
        "job_title": current_user.job_title,
        "department_id": current_user.department_id,
        "department_name": dept_name,
        "leader_id": current_user.leader_id,
        "leader_name": leader_name,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
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
    """获取头像文件（公开访问，浏览器 <img> 标签无法携带认证头）"""
    if '..' in filename or '/' in filename or '\\' in filename:
        raise HTTPException(status_code=404, detail="头像文件不存在")
    filepath = os.path.join(AVATAR_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="头像文件不存在")
    return FileResponse(filepath)


# ──────────────────────────── 密码重置 ────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_session)):
    """发起密码重置：根据邮箱查用户，生成 token 发邮件。
    为防止邮箱枚举攻击，无论用户是否存在均返回相同响应。"""
    from app.services import email_service
    # 先检查邮件服务，避免因用户存在与否返回不同状态码（枚举漏洞）
    if not email_service.is_email_configured():
        raise HTTPException(503, "系统邮件服务未配置，请联系管理员")
    user = db.exec(select(User).where(User.email == req.email, User.is_active == True)).first()
    if user:
        token = email_service.create_password_reset_token(user.id)
        frontend_base = email_service._get_frontend_url() or (settings.cors_origins.split(",")[0] or "").strip()
        email_service.send_password_reset_email(req.email, token, frontend_base)
    return {"message": "如果该邮箱已注册，重置邮件将在几分钟内发出"}


@router.post("/reset-password")
@limiter.limit("10/minute")
def reset_password(req: ResetPasswordRequest, request: Request, db: Session = Depends(get_session)):
    """使用 token 重置密码（一次性有效，1 小时过期）"""
    from app.services import email_service
    user_id = email_service.consume_password_reset_token(req.token)
    if not user_id:
        raise HTTPException(400, "重置链接无效或已过期，请重新申请")
    pwd_err = validate_password_strength(req.new_password)
    if pwd_err:
        raise HTTPException(400, pwd_err)
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(400, "用户不存在或已停用")
    user.password_hash = hash_password(req.new_password)
    bump_token_version(user, db)
    return {"message": "密码已重置，请使用新密码登录"}
