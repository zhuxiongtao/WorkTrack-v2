"""RBAC 管理路由：角色、权限、用户角色分配"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select, or_

from app.auth import get_current_user, has_permission, get_user_permissions, invalidate_rbac_cache
from app.database import get_session
from app.models.rbac import Permission, Role, RolePermission, UserRole, GroupRole
from app.models.user import User

router = APIRouter(prefix="/api/v1", tags=["RBAC管理"])


# ===== 请求/响应模型 =====

class RoleCreate(BaseModel):
    name: str
    code: str
    description: str = ""
    permission_codes: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    permission_codes: Optional[List[str]] = None


# ===== 权限列表 =====

@router.get("/permissions")
def list_permissions(db: Session = Depends(get_session),
                     current_user: User = Depends(get_current_user)):
    """获取所有权限列表（任何登录用户可查看）"""
    return db.exec(select(Permission).order_by(Permission.module, Permission.action)).all()


# ===== 角色 CRUD =====

@router.get("/roles")
def list_roles(db: Session = Depends(get_session),
               current_user: User = Depends(get_current_user)):
    """获取所有角色"""
    if not has_permission(current_user, "user:manage_roles", db):
        raise HTTPException(status_code=403, detail="无权限查看角色")
    roles = db.exec(select(Role).order_by(Role.created_at)).all()
    role_ids = [r.id for r in roles]
    perm_by_role: dict[int, list[str]] = {rid: [] for rid in role_ids}
    if role_ids:
        rows = db.exec(
            select(RolePermission.role_id, Permission.code)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(RolePermission.role_id.in_(role_ids))
        ).all()
        for role_id, code in rows:
            perm_by_role.setdefault(role_id, []).append(code)
    return [
        {
            "id": r.id,
            "name": r.name,
            "code": r.code,
            "description": r.description,
            "is_system": r.is_system,
            "user_id": r.user_id,
            "permission_codes": perm_by_role.get(r.id, []),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in roles
    ]


@router.post("/roles", status_code=201)
def create_role(data: RoleCreate, db: Session = Depends(get_session),
                current_user: User = Depends(get_current_user)):
    """创建角色"""
    if not has_permission(current_user, "user:manage_roles", db):
        raise HTTPException(status_code=403, detail="无权限创建角色")
    existing = db.exec(select(Role).where(Role.code == data.code)).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"角色编码 {data.code} 已存在")
    role = Role(
        name=data.name,
        code=data.code,
        description=data.description,
        user_id=current_user.id,
    )
    db.add(role)
    db.flush()
    # 分配权限
    for code in data.permission_codes:
        perm = db.exec(select(Permission).where(Permission.code == code)).first()
        if perm:
            db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    db.commit()
    db.refresh(role)
    invalidate_rbac_cache()
    return {"id": role.id, "name": role.name, "code": role.code}


@router.put("/roles/{role_id}")
def update_role(role_id: int, data: RoleUpdate, db: Session = Depends(get_session),
                current_user: User = Depends(get_current_user)):
    """编辑角色（名称/描述/权限）"""
    if not has_permission(current_user, "user:manage_roles", db):
        raise HTTPException(status_code=403, detail="无权限编辑角色")
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.is_system and data.code is not None and data.code != role.code:
        raise HTTPException(status_code=400, detail="系统内置角色不能修改编码")
    if data.name is not None:
        role.name = data.name
    if data.code is not None:
        existing = db.exec(select(Role).where(Role.code == data.code, Role.id != role_id)).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"角色编码 {data.code} 已被占用")
        role.code = data.code
    if data.description is not None:
        role.description = data.description
    if data.permission_codes is not None:
        for rp in db.exec(select(RolePermission).where(RolePermission.role_id == role.id)).all():
            db.delete(rp)
        for code in data.permission_codes:
            perm = db.exec(select(Permission).where(Permission.code == code)).first()
            if perm:
                db.add(RolePermission(role_id=role.id, permission_id=perm.id))
    db.add(role)
    db.commit()
    db.refresh(role)
    invalidate_rbac_cache()
    perm_codes = [
        r for r in
        db.exec(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role.id)
        ).all()
    ]
    return {
        "id": role.id, "name": role.name, "code": role.code,
        "description": role.description, "is_system": role.is_system,
        "permission_codes": perm_codes,
    }


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: int, db: Session = Depends(get_session),
                current_user: User = Depends(get_current_user)):
    """删除角色（自动清理所有关联：用户、部门、用户组、权限）"""
    if not has_permission(current_user, "user:manage_roles", db):
        raise HTTPException(status_code=403, detail="无权限删除角色")
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    if role.is_system:
        raise HTTPException(status_code=400, detail="系统内置角色不可删除")
    from app.models.rbac import DepartmentRole
    from app.models.wiki import UserGroupMember
    # 清除所有关联
    for rp in db.exec(select(RolePermission).where(RolePermission.role_id == role.id)).all():
        db.delete(rp)
    for ur in db.exec(select(UserRole).where(UserRole.role_id == role.id)).all():
        db.delete(ur)
    for gr in db.exec(select(GroupRole).where(GroupRole.role_id == role.id)).all():
        db.delete(gr)
    for dr in db.exec(select(DepartmentRole).where(DepartmentRole.role_id == role.id)).all():
        db.delete(dr)
    db.delete(role)
    db.commit()
    invalidate_rbac_cache()


# ===== 查询用户有效权限 =====

@router.get("/users/{user_id}/permissions")
def get_user_permission_list(user_id: int, db: Session = Depends(get_session),
                             current_user: User = Depends(get_current_user)):
    """查询用户的有效权限列表"""
    if not has_permission(current_user, "user:read", db) and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="无权限查看他人权限")
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    perms = get_user_permissions(target, db)
    # 补充旧字段权限
    if target.use_shared_models and "ai:use" not in perms:
        perms.append("ai:use")
    if target.can_manage_models and "ai:manage_own" not in perms:
        perms.append("ai:manage_own")
    return {"user_id": user_id, "permissions": perms}
