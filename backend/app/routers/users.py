"""用户管理路由：管理员 CRUD 用户"""

import os
import secrets
import string
import logging
from typing import Optional, List
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlmodel import Session, select, func, or_

from app.auth import (
    get_current_admin_user, get_current_user, hash_password, validate_password_strength,
    bump_token_version, require_permission, has_permission, invalidate_rbac_cache,
    generate_initial_password,
)
from app.config import settings
from app.database import get_session
from app.models.user import User
from app.models.rbac import Role, DepartmentRole
from app.models.wiki import UserGroup
from app.models.department import Department

logger = logging.getLogger("worktrack.users")

router = APIRouter(prefix="/api/v1/users", tags=["用户管理"])


def _is_dept_in_descendants(db: Session, ancestor_id: int, descendant_id: int) -> bool:
    """检查 ancestor_id 是否在 descendant_id 的祖先链中（即把 ancestor 设为 descendant 的子部门会形成循环）"""
    current_id = ancestor_id
    visited: set[int] = set()
    while current_id is not None and current_id not in visited:
        if current_id == descendant_id:
            return True
        visited.add(current_id)
        parent = db.get(Department, current_id)
        if not parent:
            break
        current_id = parent.parent_id
    return False


def get_dept_member_ids(current_user: User, db: Session) -> Optional[List[int]]:
    """获取当前用户所在部门及其子部门的所有成员 ID。
    返回 None 表示不限制（管理员/Boss/有 report:view_all 权限的用户）。
    无部门普通用户返回 [current_user.id]（仅看自己）。
    有部门普通用户返回本部门+递归子部门成员 ID 列表用于数据过滤。
    """
    if has_permission(current_user, "report:view_all", db):
        return None
    if not current_user.department_id:
        return [current_user.id]
    dept_ids = _get_department_descendants(current_user.department_id, db)
    members = db.exec(select(User).where(User.department_id.in_(dept_ids))).all()
    return [m.id for m in members] if members else [current_user.id]


# ===== 请求/响应模型 =====
class UserCreate(BaseModel):
    password: Optional[str] = None  # 留空则系统自动生成初始密码并邮件发送
    username: str
    name: str = ""
    email: str
    is_admin: bool = False
    use_shared_models: bool = False
    can_manage_models: bool = False
    leader_id: Optional[int] = None
    department_id: Optional[int] = None
    job_title: Optional[str] = None


class UserUpdate(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    is_admin: Optional[bool] = None
    use_shared_models: Optional[bool] = None
    can_manage_models: Optional[bool] = None
    leader_id: Optional[int] = None
    department_id: Optional[int] = None
    job_title: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    new_password: str

class UserStatusSet(BaseModel):
    status: str  # active | disabled | resigned



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
    leader_id: Optional[int] = None
    department_id: Optional[int] = None
    job_title: Optional[str] = None
    created_at: Optional[str] = None


# ===== 部门树响应模型 =====
class DepartmentTreeNodeModel(BaseModel):
    id: int
    name: str
    manager_id: Optional[int] = None
    manager_name: Optional[str] = None
    parent_id: Optional[int] = None
    user_count: int = 0
    children: list = []




class DepartmentRoleSet(BaseModel):
    role_ids: List[int] = []
def _user_to_out(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "is_admin": user.is_admin,
        "is_active": user.is_active,
        "status": user.status,
        "use_shared_models": user.use_shared_models,
        "can_manage_models": user.can_manage_models,
        "failed_login_attempts": user.failed_login_attempts,
        "locked_until": user.locked_until.isoformat() if user.locked_until else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "leader_id": user.leader_id,
        "department_id": user.department_id,
        "job_title": user.job_title,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "must_change_password": user.must_change_password,
    }


def _batch_enrich_users_with_groups_and_roles(users: List[User], db: Session) -> List[dict]:
    """批量预加载用户的角色信息（直接分配 + 部门角色），避免逐用户 N+1 查询"""
    if not users:
        return []

    from app.models.department import Department
    from app.models.rbac import UserRole

    user_ids = [u.id for u in users]
    dept_ids = {u.department_id for u in users if u.department_id is not None}

    # 批量查询部门名称
    dept_name_map: dict[int, str] = {}
    if dept_ids:
        depts = db.exec(select(Department).where(Department.id.in_(list(dept_ids)))).all()
        dept_name_map = {d.id: d.name for d in depts}

    # 部门 → 角色列表
    dept_roles_map: dict[int, list] = {}
    if dept_ids:
        all_dept_roles = db.exec(
            select(DepartmentRole.department_id, Role)
            .join(Role, Role.id == DepartmentRole.role_id)
            .where(DepartmentRole.department_id.in_(list(dept_ids)))
        ).all()
        for dept_id, role in all_dept_roles:
            dept_roles_map.setdefault(dept_id, []).append({"id": role.id, "name": role.name, "code": role.code})

    # 用户 → 直接分配角色
    user_roles_map: dict[int, list] = {uid: [] for uid in user_ids}
    if user_ids:
        all_user_roles = db.exec(
            select(UserRole.user_id, Role)
            .join(Role, Role.id == UserRole.role_id)
            .where(UserRole.user_id.in_(user_ids))
        ).all()
        for uid, role in all_user_roles:
            user_roles_map.setdefault(uid, []).append({"id": role.id, "name": role.name, "code": role.code})

    # 组装：合并直接分配 + 部门角色，按 id 去重
    result = []
    for u in users:
        merged: list[dict] = []
        seen: set[int] = set()
        for r in user_roles_map.get(u.id, []):
            if r["id"] not in seen:
                seen.add(r["id"])
                merged.append(r)
        for r in dept_roles_map.get(u.department_id, []) if u.department_id else []:
            if r["id"] not in seen:
                seen.add(r["id"])
                merged.append(r)
        data = _user_to_out(u)
        data["groups"] = []
        data["roles"] = merged
        data["department_name"] = dept_name_map.get(u.department_id) if u.department_id else None
        result.append(data)

    return result




def _user_to_out_with_roles(user: User, db: Session) -> dict:
    """输出用户信息并附带有效角色列表（单用户版本，用于创建/编辑后返回）

    有效角色 = 直接分配(UserRole) + 部门角色(DepartmentRole)，按 id 去重。
    """
    from app.models.rbac import UserRole
    data = _user_to_out(user)
    data["groups"] = []
    role_id_set: set[int] = set()
    roles_out: list[dict] = []
    # 1) 直接分配
    direct_ids = [r for r in db.exec(select(UserRole.role_id).where(UserRole.user_id == user.id)).all()]
    if direct_ids:
        rows = db.exec(select(Role).where(Role.id.in_(direct_ids))).all()
        for r in rows:
            if r.id not in role_id_set:
                role_id_set.add(r.id)
                roles_out.append({"id": r.id, "name": r.name, "code": r.code})
    # 2) 部门角色
    if user.department_id:
        dept_role_ids = db.exec(
            select(DepartmentRole.role_id).where(DepartmentRole.department_id == user.department_id)
        ).all()
        if dept_role_ids:
            rows = db.exec(select(Role).where(Role.id.in_([r for r in dept_role_ids]))).all()
            for r in rows:
                if r.id not in role_id_set:
                    role_id_set.add(r.id)
                    roles_out.append({"id": r.id, "name": r.name, "code": r.code})
    data["roles"] = roles_out
    return data


def _get_department_descendants(dept_id: int, db: Session) -> List[int]:
    """递归获取指定部门及其所有子部门 ID 列表"""
    from app.models.department import Department
    result = [dept_id]
    children = db.exec(select(Department.id).where(Department.parent_id == dept_id)).all()
    for child_id in children:
        result.extend(_get_department_descendants(child_id, db))
    return result


# ===== 列出所有用户（支持分页、搜索、多维度筛选） =====
@router.get("")
def list_users(
    db: Session = Depends(get_session),
    _viewer: User = Depends(require_permission("user:read")),
    page: int = Query(default=0, ge=0, description="页码，0=不分页返回全部"),
    page_size: int = Query(default=20, ge=1, le=100, description="每页数量"),
    search: str = Query(default="", description="模糊搜索用户名/姓名/邮箱"),
    department_id: Optional[int] = Query(default=None, description="按部门筛选（含子部门）"),
    role_id: Optional[int] = Query(default=None, description="按角色筛选"),
    status: str = Query(default="all", description="状态筛选: all/active/disabled/resigned/locked"),
):
    """获取用户列表（仅管理员），支持分页、搜索和多维度筛选"""
    # 基础查询
    stmt = select(User)

    # 搜索条件
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            or_(
                User.username.ilike(pattern),
                User.name.ilike(pattern),
                User.email.ilike(pattern),
            )
        )

    # 部门筛选（含子部门）
    if department_id is not None:
        dept_ids = _get_department_descendants(department_id, db)
        stmt = stmt.where(User.department_id.in_(dept_ids))

    # 角色筛选（通过部门角色）
    if role_id is not None:
        dept_ids_with_role = db.exec(
            select(DepartmentRole.department_id).where(DepartmentRole.role_id == role_id)
        ).all()
        if dept_ids_with_role:
            stmt = stmt.where(User.department_id.in_(dept_ids_with_role))
        else:
            if page > 0:
                return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}
            return []

    # 状态筛选
    now_dt = now()
    if status == "active":
        stmt = stmt.where(User.status == "active")
    elif status == "disabled":
        stmt = stmt.where(User.status == "disabled")
    elif status == "resigned":
        stmt = stmt.where(User.status == "resigned")
    elif status == "inactive":
        # 向后兼容：inactive = 旧版 is_active=False 的用户
        stmt = stmt.where(User.is_active == False)
    elif status == "locked":
        stmt = stmt.where(User.locked_until.is_not(None), User.locked_until > now_dt)

    # 排序
    stmt = stmt.order_by(User.id)

    # 分页模式
    if page > 0:
        # 先统计总数
        total = db.exec(select(func.count()).select_from(stmt.subquery())).one()
        # 分页
        offset = (page - 1) * page_size
        users = db.exec(stmt.offset(offset).limit(page_size)).all()
        total_pages = (total + page_size - 1) // page_size if total > 0 else 0
        
        return {
            "items": _batch_enrich_users_with_groups_and_roles(list(users), db),
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    # 不分页模式（向后兼容）
    users = db.exec(stmt).all()
    return _batch_enrich_users_with_groups_and_roles(list(users), db)


# ===== 用户全局统计（用于统计卡） =====
@router.get("/stats")
def get_user_stats(db: Session = Depends(get_session),
                   _admin: User = Depends(require_permission("user:read"))):
    """返回用户全量统计：总成员/活跃/离职/锁定制中/管理员/无部门"""
    from sqlalchemy import func as sql_func
    now_dt = now()
    total = db.exec(select(sql_func.count(User.id))).one()
    active = db.exec(select(sql_func.count(User.id)).where(User.status == "active", User.is_active == True)).one()
    disabled = db.exec(select(sql_func.count(User.id)).where(or_((User.status == "disabled"), (User.is_active == False)))).one()
    resigned = db.exec(select(sql_func.count(User.id)).where(User.status == "resigned")).one()
    locked = db.exec(
        select(sql_func.count(User.id))
        .where(User.locked_until != None, User.locked_until > now_dt)
    ).one()
    admin_count = db.exec(select(sql_func.count(User.id)).where(User.is_admin == True)).one()
    no_dept = db.exec(select(sql_func.count(User.id)).where(or_(User.department_id == None, User.department_id == 0))).one()
    return {
        "total": total,
        "active": active,
        "disabled": disabled,
        "resigned": resigned,
        "locked": locked,
        "admin": admin_count,
        "no_dept": no_dept,
    }


# ===== 用户批量操作 =====
class UserBatchAction(BaseModel):
    user_ids: List[int]
    action: str  # enable / disable / resign / set_department / reset_password
    department_id: Optional[int] = None  # action=set_department 时使用


@router.post("/batch")
def batch_user_action(data: UserBatchAction, current_user: User = Depends(require_permission("user:edit")),
                      db: Session = Depends(get_session)):
    """批量用户操作：启停/改部门/重置密码"""
    if not data.user_ids:
        raise HTTPException(status_code=400, detail="未选择任何用户")
    if len(data.user_ids) > 200:
        raise HTTPException(status_code=400, detail="单次最多操作 200 个用户")
    if data.user_ids and current_user.id in data.user_ids and data.action in ("disable", "resign"):
        raise HTTPException(status_code=400, detail="不能对自己执行禁用/离职操作")

    users = db.exec(select(User).where(User.id.in_(data.user_ids))).all()
    found_ids = {u.id for u in users}
    missing = set(data.user_ids) - found_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"用户不存在: {sorted(missing)}")

    affected = 0
    now_dt = now()
    if data.action == "enable":
        for u in users:
            u.is_active = True
            u.status = "active"
            u.failed_login_attempts = 0
            u.locked_until = None
            affected += 1
    elif data.action == "disable":
        for u in users:
            u.is_active = False
            u.status = "disabled"
            affected += 1
    elif data.action == "resign":
        for u in users:
            u.status = "resigned"
            u.is_active = False
            u.department_id = None
            u.leader_id = None
            u.locked_until = None
            u.failed_login_attempts = 0
            affected += 1
    elif data.action == "set_department":
        new_dept_id = data.department_id if data.department_id not in (None, 0) else None
        if new_dept_id is not None:
            target_dept = db.get(Department, new_dept_id)
            if not target_dept:
                raise HTTPException(status_code=404, detail="目标部门不存在")
        for u in users:
            u.department_id = new_dept_id
            affected += 1
    elif data.action == "reset_password":
        for u in users:
            new_pwd = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(10))
            u.password_hash = hash_password(new_pwd)
            u.token_version = (u.token_version or 0) + 1
            affected += 1
    else:
        raise HTTPException(status_code=400, detail=f"不支持的操作: {data.action}")

    db.commit()
    return {"affected": affected, "action": data.action}


# ===== 获取简单用户列表（供协同和选择器使用，面向所有登录用户） =====
@router.get("/simple")
def get_users_simple(db: Session = Depends(get_session),
                      _user: User = Depends(get_current_user),
                      department_id: Optional[int] = Query(None),
                      search: Optional[str] = Query(None, description="按姓名/用户名搜索"),
                      scope: Optional[str] = Query(None, description="all=返回全部活跃用户，留空=仅返回可见范围用户")):
    """获取基础用户列表（供协作者选择使用）"""
    query = select(User).where(User.is_active == True, User.status != "resigned")
    if department_id:
        query = query.where(User.department_id == department_id)
    elif scope != "all":
        from app.auth import get_visible_user_ids
        visible_ids = get_visible_user_ids(_user, db)
        if visible_ids is not None:
            query = query.where(User.id.in_(visible_ids))
    if search:
        pattern = f"%{search}%"
        query = query.where((User.name.ilike(pattern)) | (User.username.ilike(pattern)))
    users = db.exec(query.order_by(User.name)).all()
    return [{"id": u.id, "username": u.username, "name": u.name, "department_id": u.department_id} for u in users]


class DepartmentCreate(BaseModel):
    name: str
    manager_id: Optional[int] = None
    parent_id: Optional[int] = None


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    manager_id: Optional[int] = None
    parent_id: Optional[int] = None


class DepartmentMove(BaseModel):
    parent_id: Optional[int] = None
    """拖拽改父时使用：new_parent_id 0/None 表示移到根级"""


# ===== 获取部门列表 =====
@router.get("/departments")
def list_departments(db: Session = Depends(get_session),
                     _user: User = Depends(get_current_user)):
    """获取所有部门列表（供用户管理选择使用，面向所有登录用户）"""
    from app.models.department import Department
    depts = db.exec(select(Department)).all()
    return [{"id": d.id, "name": d.name, "manager_id": d.manager_id, "parent_id": d.parent_id} for d in depts]


# ===== 新建部门 =====
@router.post("/departments", status_code=201)
def create_department(data: DepartmentCreate, db: Session = Depends(get_session),
                       _admin: User = Depends(require_permission("user:manage_roles"))):
    """管理员创建新部门（组织架构）"""
    from app.models.department import Department
    existing = db.exec(select(Department).where(Department.name == data.name)).first()
    if existing:
        raise HTTPException(status_code=409, detail="部门名称已存在")
    dept = Department(name=data.name, manager_id=data.manager_id if data.manager_id != 0 else None, parent_id=data.parent_id if data.parent_id != 0 else None)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return {"id": dept.id, "name": dept.name, "manager_id": dept.manager_id, "parent_id": dept.parent_id}


# ===== 更新部门 =====
@router.put("/departments/{dept_id}")
def update_department(dept_id: int, data: DepartmentUpdate, db: Session = Depends(get_session),
                       _admin: User = Depends(require_permission("user:manage_roles"))):
    """管理员修改部门基本信息与负责人"""
    from app.models.department import Department
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    update_fields = data.model_dump(exclude_unset=True)
    if "name" in update_fields:
        dept.name = data.name
    if "manager_id" in update_fields:
        dept.manager_id = data.manager_id if data.manager_id not in (None, 0) else None
    if "parent_id" in update_fields:
        new_parent_id = data.parent_id if data.parent_id not in (None, 0) else None
        if new_parent_id is not None:
            if new_parent_id == dept_id:
                raise HTTPException(status_code=400, detail="部门不能将自身设为上级")
            if _is_dept_in_descendants(db, new_parent_id, dept_id):
                raise HTTPException(status_code=400, detail="不能将部门移动到自身子孙节点下")
        dept.parent_id = new_parent_id
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return {"id": dept.id, "name": dept.name, "manager_id": dept.manager_id, "parent_id": dept.parent_id}


# ===== 拖拽改父 =====
@router.patch("/departments/{dept_id}/move")
def move_department(dept_id: int, data: DepartmentMove, db: Session = Depends(get_session),
                    _admin: User = Depends(require_permission("user:manage_roles"))):
    """拖拽改父：把部门直接挂到新父级下，复用循环引用检测"""
    from app.models.department import Department
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    new_parent_id = data.parent_id if data.parent_id not in (None, 0) else None
    if new_parent_id is not None:
        if new_parent_id == dept_id:
            raise HTTPException(status_code=400, detail="部门不能将自身设为上级")
        if _is_dept_in_descendants(db, new_parent_id, dept_id):
            raise HTTPException(status_code=400, detail="不能将部门移动到自身子孙节点下")
    dept.parent_id = new_parent_id
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return {"id": dept.id, "name": dept.name, "manager_id": dept.manager_id, "parent_id": dept.parent_id}


# ===== 删除部门 =====
@router.delete("/departments/{dept_id}", status_code=204)
def delete_department(dept_id: int, db: Session = Depends(get_session),
                       _admin: User = Depends(require_permission("user:manage_roles"))):
    """管理员删除部门"""
    from app.models.department import Department
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    
    # 深度安全拦截：如果部门下仍有绑定的员工或子级下属部门，决不允许物理注销！
    linked_users = db.exec(select(User).where(User.department_id == dept_id)).all()
    if linked_users:
        raise HTTPException(status_code=400, detail="无法删除：该部门下仍有绑定的在职员工")
        
    linked_sub_depts = db.exec(select(Department).where(Department.parent_id == dept_id)).all()
    if linked_sub_depts:
        raise HTTPException(status_code=400, detail="无法删除：该部门下仍有绑定的子级下属部门")
        
    db.delete(dept)
    db.commit()


# ===== 获取部门树（组织架构） =====
@router.get("/departments/tree")
def get_department_tree(db: Session = Depends(get_session),
                        _user: User = Depends(get_current_user)):
    """获取完整部门树结构，含每个部门的用户数和负责人信息"""
    from app.models.department import Department
    from app.auth import has_permission
    
    can_see_details = has_permission(_user, "user:manage_roles", db)
    
    depts = db.exec(select(Department)).all()
    users = db.exec(select(User)).all()
    
    user_map: dict[int, str] = {u.id: u.name or u.username for u in users}
    
    dept_user_count: dict[int, int] = {}
    for u in users:
        if u.department_id is not None:
            dept_user_count[u.department_id] = dept_user_count.get(u.department_id, 0) + 1
    
    children_map: dict[int, list[dict]] = {}
    all_nodes: dict[int, dict] = {}
    
    for d in depts:
        node = {
            "id": d.id,
            "name": d.name,
            "manager_id": d.manager_id if can_see_details else None,
            "manager_name": user_map.get(d.manager_id) if (can_see_details and d.manager_id) else None,
            "parent_id": d.parent_id,
            "user_count": dept_user_count.get(d.id, 0) if can_see_details else 0,
            "children": [],
        }
        all_nodes[d.id] = node
        parent = d.parent_id if d.parent_id is not None else 0
        children_map.setdefault(parent, []).append(node)
    
    def build_tree(node: dict) -> dict:
        node["children"] = children_map.get(node["id"], [])
        for child in node["children"]:
            build_tree(child)
            node["user_count"] += child["user_count"]
        return node
    
    root_nodes = children_map.get(0, [])
    return [build_tree(n) for n in root_nodes]



# ===== 部门角色管理 =====

@router.get("/departments/{dept_id}/roles")
def get_department_roles(dept_id: int, db: Session = Depends(get_session),
                        _user: User = Depends(get_current_user)):
    """获取部门已分配的角色列表"""
    from app.models.department import Department
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    role_ids = db.exec(
        select(DepartmentRole.role_id).where(DepartmentRole.department_id == dept_id)
    ).all()
    if not role_ids:
        return []
    roles = db.exec(select(Role).where(Role.id.in_([r for r in role_ids]))).all()
    return [{"id": r.id, "name": r.name, "code": r.code, "description": r.description} for r in roles]


@router.put("/departments/{dept_id}/roles")
def set_department_roles(dept_id: int, data: DepartmentRoleSet, db: Session = Depends(get_session),
                        _admin: User = Depends(require_permission("user:manage_roles"))):
    """设置部门角色（覆盖式更新）"""
    from app.models.department import Department
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    # 清除旧关联
    for dr in db.exec(select(DepartmentRole).where(DepartmentRole.department_id == dept_id)).all():
        db.delete(dr)
    # 分配新角色
    for rid in data.role_ids:
        role = db.get(Role, rid)
        if role:
            db.add(DepartmentRole(department_id=dept_id, role_id=rid))
    db.commit()
    return {"message": "部门角色设置成功"}


# ===== 获取用户汇报链 =====
@router.get("/{user_id}/report-chain")
def get_user_report_chain(user_id: int, db: Session = Depends(get_session),
                          _user: User = Depends(get_current_user)):
    """获取指定用户从下到上的完整汇报链"""
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    chain: list = []
    visited: set = set()
    current = target
    
    # 把自己加入链首
    chain.append({
        "id": current.id,
        "name": current.name or current.username,
        "job_title": current.job_title,
    })
    visited.add(current.id)
    
    # 向上追溯 leader
    while current.leader_id is not None and current.leader_id not in visited:
        current = db.get(User, current.leader_id)
        if not current:
            break
        chain.append({
            "id": current.id,
            "name": current.name or current.username,
            "job_title": current.job_title,
        })
        visited.add(current.id)
    
    return {"chain": chain}


# ===== 直接给用户分配角色 =====
class UserRolesUpdate(BaseModel):
    role_ids: List[int]


@router.get("/{user_id}/roles")
def get_user_roles(user_id: int, db: Session = Depends(get_session),
                   _viewer: User = Depends(require_permission("user:read"))):
    """获取某用户**直接分配**的角色 ID 列表（不含部门角色）"""
    from app.models.rbac import UserRole
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    role_ids = [r for r in db.exec(
        select(UserRole.role_id).where(UserRole.user_id == user_id)
    ).all()]
    return {"role_ids": role_ids}


@router.put("/{user_id}/roles")
def set_user_roles(user_id: int, data: UserRolesUpdate, db: Session = Depends(get_session),
                   actor: User = Depends(require_permission("user:manage_roles"))):
    """覆盖式设置某用户**直接分配**的角色（与部门角色并存）"""
    from app.models.rbac import UserRole, Role as RoleModel

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 校验所有 role_id 存在
    if data.role_ids:
        existing = db.exec(select(RoleModel.id).where(RoleModel.id.in_(data.role_ids))).all()
        existing_set = set(existing)
        invalid = [r for r in data.role_ids if r not in existing_set]
        if invalid:
            raise HTTPException(status_code=400, detail=f"以下角色不存在: {invalid}")

    # 提权防护：admin 角色只在现有 admin 之间流转
    # 计算"新直接分配里是否含 admin"
    new_has_admin = False
    if data.role_ids:
        new_codes = db.exec(
            select(RoleModel.code).where(RoleModel.id.in_(data.role_ids))
        ).all()
        new_has_admin = "admin" in {c for c in new_codes}
    # 计算"该用户当前是否通过任何渠道是 admin"（is_admin 字段 + 直接分配 admin 角色）
    has_admin_now = user.is_admin
    if not has_admin_now:
        existing_admin_direct = db.exec(
            select(UserRole.role_id).join(RoleModel, RoleModel.id == UserRole.role_id)
            .where(UserRole.user_id == user_id, RoleModel.code == "admin")
        ).first()
        has_admin_now = bool(existing_admin_direct)
    if (new_has_admin != has_admin_now) and not actor.is_admin:
        raise HTTPException(status_code=403, detail="只有系统管理员才能变更 admin 角色")

    # 清理旧的直接分配
    for ur in db.exec(select(UserRole).where(UserRole.user_id == user_id)).all():
        db.delete(ur)
    db.flush()
    # 写入新分配
    for rid in data.role_ids:
        db.add(UserRole(user_id=user_id, role_id=rid))
    db.commit()
    return _user_to_out_with_roles(user, db)


# ===== 创建用户 =====
@router.post("", status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_session),
                actor: User = Depends(require_permission("user:create"))):
    """管理员创建新用户：默认自动生成初始密码、发送欢迎邮件、要求首登改密"""
    # 提权防护：只有当前已是 admin 的用户才能创建/把账号设为 is_admin=True
    if data.is_admin and not actor.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有系统管理员才能创建管理员账号")
    if not data.email or not data.email.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邮箱为必填项")

    # 初始密码：管理员留空则系统自动生成；填了则校验强度
    if data.password and data.password.strip():
        pwd_err = validate_password_strength(data.password)
        if pwd_err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_err)
        initial_password = data.password
    else:
        initial_password = generate_initial_password()

    # 检查用户名是否已存在
    existing = db.exec(select(User).where(User.username == data.username)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在")

    resolved_leader_id = data.leader_id
    if data.department_id:
        from app.models.department import Department
        dept = db.get(Department, data.department_id)
        if dept and dept.manager_id:
            if data.leader_id is None or data.leader_id != dept.manager_id:
                resolved_leader_id = dept.manager_id

    user = User(
        username=data.username,
        password_hash=hash_password(initial_password),
        name=data.name or data.username,
        email=data.email,
        is_admin=data.is_admin,
        use_shared_models=data.use_shared_models,
        can_manage_models=data.can_manage_models,
        leader_id=resolved_leader_id,
        department_id=data.department_id,
        job_title=data.job_title,
        must_change_password=True,  # 要求首次登录修改密码
    )
    db.add(user)
    db.flush()
    db.commit()
    db.refresh(user)

    # 发送欢迎邮件（含用户名 + 初始密码）。邮件未配置/失败不阻断建号。
    welcome_email_sent = False
    try:
        from app.services.email_service import is_email_configured, send_welcome_email, _get_frontend_url
        if is_email_configured():
            base = _get_frontend_url() or (settings.cors_origins.split(",")[0] or "").strip()
            login_url = f"{base.rstrip('/')}/login" if base else ""
            welcome_email_sent = send_welcome_email(
                to=user.email, username=user.username, password=initial_password,
                name=user.name, login_url=login_url,
            )
    except Exception:
        logger.warning("欢迎邮件发送异常 user=%s", user.username, exc_info=True)

    result = _user_to_out_with_roles(user, db)
    result["welcome_email_sent"] = welcome_email_sent
    # 邮件未发出时，把初始密码返回给管理员，便于线下转交（已发出则不回传，仅存在于邮件中）
    if not welcome_email_sent:
        result["initial_password"] = initial_password
    return result


# ===== 编辑用户 =====
@router.put("/{user_id}")
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_session),
                actor: User = Depends(require_permission("user:edit"))):
    """管理员编辑用户信息"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 提权防护：把某人提为 admin、或从 admin 降级，必须由现有 admin 操作
    target_admin = data.is_admin if data.is_admin is not None else user.is_admin
    if target_admin != user.is_admin and not actor.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有系统管理员才能变更管理员状态")

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
        if not data.email.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邮箱为必填项")
        user.email = data.email
    if data.is_admin is not None:
        user.is_admin = data.is_admin
    if data.use_shared_models is not None:
        user.use_shared_models = data.use_shared_models
    if data.can_manage_models is not None:
        user.can_manage_models = data.can_manage_models
    update_fields = data.model_dump(exclude_unset=True)
    if "department_id" in update_fields:
        raw_dept_id = data.department_id
        user.department_id = raw_dept_id if raw_dept_id is not None and raw_dept_id != 0 else None
        from app.models.department import Department
        if user.department_id:
            dept = db.get(Department, user.department_id)
            if dept and dept.manager_id:
                user.leader_id = dept.manager_id
            else:
                user.leader_id = None
        else:
            user.leader_id = None
    elif "leader_id" in update_fields:
        user.leader_id = data.leader_id if data.leader_id != 0 else None
    if "job_title" in update_fields:
        user.job_title = data.job_title if data.job_title and data.job_title.strip() else None

    db.add(user)
    db.flush()
    db.commit()
    db.refresh(user)
    return _user_to_out_with_roles(user, db)


# ===== 启用/禁用用户 =====
@router.put("/{user_id}/toggle-active")
def toggle_user_active(user_id: int, db: Session = Depends(get_session),
                       actor: User = Depends(require_permission("user:edit"))):
    """管理员启用或禁用用户"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 不能禁用自己
    if user.id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能禁用自己的账号")

    user.is_active = not user.is_active
    # 同步 status 字段
    user.status = "active" if user.is_active else "disabled"
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
        "status": user.status,
        "message": "账号已启用" if user.is_active else "账号已停用",
    }


# ===== 设置用户账号状态 =====
@router.put("/{user_id}/status")
def set_user_status(user_id: int, data: UserStatusSet,
                    db: Session = Depends(get_session),
                    _admin: User = Depends(require_permission("user:edit"))):
    """管理员设置用户账号状态: active / disabled / resigned"""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == _admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能修改自己的账号状态")

    if data.status not in ("active", "disabled", "resigned"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的状态值")

    user.status = data.status
    user.is_active = data.status == "active"

    # 离职时清除部门归属和锁定状态
    if data.status == "resigned":
        user.department_id = None
        user.leader_id = None
        user.failed_login_attempts = 0
        user.locked_until = None

    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "status": user.status,
        "is_active": user.is_active,
        "message": f"账号状态已设置为 {data.status}",
    }


# ===== 重置用户密码 =====
@router.post("/{user_id}/reset-password")
def reset_user_password(user_id: int, data: ResetPasswordRequest,
                        db: Session = Depends(get_session),
                        _admin: User = Depends(require_permission("user:edit"))):
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


# ===== 重发欢迎邮件 =====
@router.post("/{user_id}/resend-welcome")
def resend_welcome_email(user_id: int, db: Session = Depends(get_session),
                         _admin: User = Depends(require_permission("user:edit"))):
    """管理员为指定用户重新生成临时密码并重发欢迎邮件（覆盖原密码）。
    邮件未配置时将临时密码直接返回给管理员，便于线下转交。"""
    from app.services.email_service import is_email_configured, send_welcome_email as _send_welcome, _get_frontend_url
    from app.config import settings as _cfg

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not user.email or not user.email.strip():
        raise HTTPException(status_code=400, detail="该用户未设置邮箱，无法发送欢迎邮件")

    new_password = generate_initial_password()
    user.password_hash = hash_password(new_password)
    user.must_change_password = True
    bump_token_version(user, db)
    db.add(user)
    db.commit()

    sent = False
    try:
        if is_email_configured():
            base = _get_frontend_url() or (_cfg.cors_origins.split(",")[0] or "").strip()
            login_url = f"{base.rstrip('/')}/login" if base else ""
            sent = _send_welcome(to=user.email, username=user.username, password=new_password,
                                 name=user.name or "", login_url=login_url)
    except Exception:
        logger.warning("重发欢迎邮件异常 user=%s", user.username, exc_info=True)

    from app.routers.logs import write_log
    write_log("info", "user", f"管理员重发欢迎邮件 → {user.username}（邮件{'已发出' if sent else '未配置/发送失败，密码已返回'}）", db=db)

    result: dict = {"sent": sent}
    if not sent:
        result["initial_password"] = new_password
    return result


# ===== 删除用户 =====
@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_session),
                _admin: User = Depends(require_permission("user:delete"))):
    """管理员删除用户"""
    from app.models.rbac import UserRole
    from app.models.wiki import UserGroupMember
    from app.models.chat import ChatConversation, ChatMessage
    from app.models.daily_report import DailyReport
    from app.models.meeting_note import MeetingNote
    from app.models.weekly_summary import WeeklySummary
    from app.models.system_preference import SystemPreference
    from app.models.project import Project
    from app.models.customer import Customer
    from app.models.contract import Contract
    from app.models.model_provider import ModelProvider, TaskModelConfig
    from app.models.ai_prompt import AIPrompt
    from app.models.wiki import WikiSpace, WikiPage, WikiPageVersion, WikiPermission, UserGroup, UserGroupMember
    from app.models.data_share import DataShare, DataShareComment

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == _admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能删除自己的账号")

    # 1. 深度清理该用户在在线文档（Wiki）中的所有专属实体与后代页面（攻克底层 500 外键约束报错）
    # 删除该用户建立的所有 Wiki 空间、及其下的所有层级文档
    owned_spaces = db.exec(select(WikiSpace).where(WikiSpace.owner_id == user_id)).all()
    for s in owned_spaces:
        pages = db.exec(select(WikiPage).where(WikiPage.space_id == s.id)).all()
        for p in pages:
            # 删文档版本
            for pv in db.exec(select(WikiPageVersion).where(WikiPageVersion.page_id == p.id)).all():
                db.delete(pv)
            # 删文档级授权
            for pm in db.exec(select(WikiPermission).where(WikiPermission.target_type == "page", WikiPermission.target_id == p.id)).all():
                db.delete(pm)
            db.delete(p)
        # 删空间级授权
        for pm in db.exec(select(WikiPermission).where(WikiPermission.target_type == "space", WikiPermission.target_id == s.id)).all():
            db.delete(pm)
        db.delete(s)

    # 2. 如果该用户创建了某些独立页面（即便不是空间拥有者），也进行级联删除
    created_pages = db.exec(select(WikiPage).where(WikiPage.created_by == user_id)).all()
    for p in created_pages:
        for pv in db.exec(select(WikiPageVersion).where(WikiPageVersion.page_id == p.id)).all():
            db.delete(pv)
        for pm in db.exec(select(WikiPermission).where(WikiPermission.target_type == "page", WikiPermission.target_id == p.id)).all():
            db.delete(pm)
        db.delete(p)

    # 3. 删除由该用户建立的所有在线文档历史快照（防止版本表外链死锁）
    for pv in db.exec(select(WikiPageVersion).where(WikiPageVersion.created_by == user_id)).all():
        db.delete(pv)

    # 4. 删除属于该用户本人的文档协同权限纪录
    for pm in db.exec(select(WikiPermission).where(WikiPermission.subject_type == "user", WikiPermission.subject_id == user_id)).all():
        db.delete(pm)

    # 5. 清理该用户拥有的团队用户组（UserGroup）
    owned_groups = db.exec(select(UserGroup).where(UserGroup.owner_id == user_id)).all()
    for g in owned_groups:
        for member in db.exec(select(UserGroupMember).where(UserGroupMember.group_id == g.id)).all():
            db.delete(member)
        db.delete(g)

    # 6. 原生清理关联数据
    for ur in db.exec(select(UserRole).where(UserRole.user_id == user_id)).all():
        db.delete(ur)
    for gm in db.exec(select(UserGroupMember).where(UserGroupMember.user_id == user_id)).all():
        db.delete(gm)
    # 聊天记录（先删消息再删会话）
    conv_ids = [c.id for c in db.exec(select(ChatConversation).where(ChatConversation.user_id == user_id)).all()]
    for cid in conv_ids:
        for msg in db.exec(select(ChatMessage).where(ChatMessage.conversation_id == cid)).all():
            db.delete(msg)
    for conv in db.exec(select(ChatConversation).where(ChatConversation.user_id == user_id)).all():
        db.delete(conv)
    for dr in db.exec(select(DailyReport).where(DailyReport.user_id == user_id)).all():
        db.delete(dr)
    for mn in db.exec(select(MeetingNote).where(MeetingNote.user_id == user_id)).all():
        db.delete(mn)
    for ws in db.exec(select(WeeklySummary).where(WeeklySummary.user_id == user_id)).all():
        db.delete(ws)
    for sp in db.exec(select(SystemPreference).where(SystemPreference.user_id == user_id)).all():
        db.delete(sp)
    for p in db.exec(select(Project).where(Project.user_id == user_id)).all():
        db.delete(p)
    for c in db.exec(select(Customer).where(Customer.user_id == user_id)).all():
        db.delete(c)
    for ct in db.exec(select(Contract).where(Contract.user_id == user_id)).all():
        db.delete(ct)
    for mp in db.exec(select(ModelProvider).where(ModelProvider.user_id == user_id)).all():
        db.delete(mp)
    for mc in db.exec(select(TaskModelConfig).where(TaskModelConfig.user_id == user_id)).all():
        db.delete(mc)
    for ap in db.exec(select(AIPrompt).where(AIPrompt.user_id == user_id)).all():
        db.delete(ap)
    # 数据分享：删除该用户发出的评论
    for dc in db.exec(select(DataShareComment).where(DataShareComment.user_id == user_id)).all():
        db.delete(dc)
    # 数据分享：删除该用户创建的所有分享记录及其评论
    for ds in db.exec(select(DataShare).where(DataShare.shared_by == user_id)).all():
        for dc in db.exec(select(DataShareComment).where(DataShareComment.share_id == ds.id)).all():
            db.delete(dc)
        db.delete(ds)
    # 数据分享：删除发送给该用户的所有分享记录及其评论
    for ds in db.exec(select(DataShare).where(DataShare.shared_to == user_id)).all():
        for dc in db.exec(select(DataShareComment).where(DataShareComment.share_id == ds.id)).all():
            db.delete(dc)
        db.delete(ds)

    db.delete(user)
    db.commit()

