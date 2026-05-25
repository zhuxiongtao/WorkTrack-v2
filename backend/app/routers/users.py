"""用户管理路由：管理员 CRUD 用户"""

from typing import Optional, List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from sqlmodel import Session, select, func, or_

from app.auth import (
    get_current_admin_user, get_current_user, hash_password, validate_password_strength,
    bump_token_version,
)
from app.database import get_session
from app.models.user import User
from app.models.rbac import Role, DepartmentRole
from app.models.wiki import UserGroup
from app.models.department import Department

router = APIRouter(prefix="/api/v1/users", tags=["用户管理"])


def get_dept_member_ids(current_user: User, db: Session) -> Optional[List[int]]:
    """获取当前用户所在部门及其子部门的所有成员 ID。
    如果用户没有部门或不是部门领导，返回 None（表示不限制）。
    如果是部门领导，返回本部门+子部门成员 ID 列表用于数据过滤。
    """
    if not current_user.department_id:
        return None
    from app.auth import get_user_permissions
    perms = get_user_permissions(current_user, db)
    if "report:view_all" in perms or current_user.is_admin:
        return None
    dept_ids = [current_user.department_id]
    child_depts = db.exec(select(Department).where(Department.parent_id == current_user.department_id)).all()
    dept_ids.extend(d.id for d in child_depts)
    members = db.exec(select(User).where(User.department_id.in_(dept_ids))).all()
    return [m.id for m in members] if members else [current_user.id]


# ===== 请求/响应模型 =====
class UserCreate(BaseModel):
    username: str
    password: str
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
    }


def _batch_enrich_users_with_groups_and_roles(users: List[User], db: Session) -> List[dict]:
    """批量预加载用户的部门角色信息，避免逐用户 N+1 查询"""
    if not users:
        return []
    
    from app.models.department import Department

    # 收集所有用户的 department_id
    dept_ids = set()
    for u in users:
        if u.department_id is not None:
            dept_ids.add(u.department_id)
    
    # 批量查询部门名称
    dept_name_map: dict[int, str] = {}
    if dept_ids:
        depts = db.exec(select(Department).where(Department.id.in_(list(dept_ids)))).all()
        dept_name_map = {d.id: d.name for d in depts}
    
    # 批量查询各部门的角色
    dept_roles_map: dict[int, list] = {}
    if dept_ids:
        all_dept_roles = db.exec(
            select(DepartmentRole.department_id, Role)
            .join(Role, Role.id == DepartmentRole.role_id)
            .where(DepartmentRole.department_id.in_(list(dept_ids)))
        ).all()
        for dept_id, role in all_dept_roles:
            dept_roles_map.setdefault(dept_id, []).append({"id": role.id, "name": role.name, "code": role.code})
    
    # 组装结果
    result = []
    for u in users:
        data = _user_to_out(u)
        data["groups"] = []
        data["roles"] = dept_roles_map.get(u.department_id, []) if u.department_id else []
        data["department_name"] = dept_name_map.get(u.department_id) if u.department_id else None
        result.append(data)
    
    return result




def _user_to_out_with_roles(user: User, db: Session) -> dict:
    """输出用户信息并附带部门角色列表（单用户版本，用于创建/编辑后返回）"""
    data = _user_to_out(user)
    data["groups"] = []
    # 从用户所属部门计算有效角色
    if user.department_id:
        role_ids = db.exec(
            select(DepartmentRole.role_id).where(DepartmentRole.department_id == user.department_id)
        ).all()
        if role_ids:
            role_rows = db.exec(select(Role).where(Role.id.in_([r for r in role_ids]))).all()
            data["roles"] = [{"id": r.id, "name": r.name, "code": r.code} for r in role_rows]
        else:
            data["roles"] = []
    else:
        data["roles"] = []
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
    _admin: User = Depends(get_current_admin_user),
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
    now = datetime.now(timezone.utc)
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
        stmt = stmt.where(User.locked_until.is_not(None), User.locked_until > now)

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


# ===== 获取简单用户列表（供协同和选择器使用，面向所有登录用户） =====
@router.get("/simple")
def get_users_simple(db: Session = Depends(get_session),
                      _user: User = Depends(get_current_user),
                      department_id: Optional[int] = Query(None)):
    """获取基础用户列表（供在线文档等协作者选择使用，任何登录用户均可访问）"""
    query = select(User).where(User.is_active == True, User.status != "resigned")
    dept_member_ids = get_dept_member_ids(_user, db)
    if department_id:
        query = query.where(User.department_id == department_id)
    elif dept_member_ids is not None:
        query = query.where(User.id.in_(dept_member_ids))
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
                      _admin: User = Depends(get_current_admin_user)):
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
                      _admin: User = Depends(get_current_admin_user)):
    """管理员修改部门基本信息与负责人"""
    from app.models.department import Department
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    if data.name is not None:
        dept.name = data.name
    if data.manager_id is not None:
        dept.manager_id = data.manager_id if data.manager_id != 0 else None
    if data.parent_id is not None:
        dept.parent_id = data.parent_id if data.parent_id != 0 else None
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return {"id": dept.id, "name": dept.name, "manager_id": dept.manager_id, "parent_id": dept.parent_id}


# ===== 删除部门 =====
@router.delete("/departments/{dept_id}", status_code=204)
def delete_department(dept_id: int, db: Session = Depends(get_session),
                      _admin: User = Depends(get_current_admin_user)):
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
    
    # 一次查询所有部门和用户
    depts = db.exec(select(Department)).all()
    users = db.exec(select(User)).all()
    
    # 构建映射：user_id -> user 名字
    user_map: dict[int, str] = {u.id: u.name or u.username for u in users}
    
    # 统计每个部门的直接用户数
    dept_user_count: dict[int, int] = {}
    for u in users:
        if u.department_id is not None:
            dept_user_count[u.department_id] = dept_user_count.get(u.department_id, 0) + 1
    
    # 按 parent_id 分组
    children_map: dict[int, list[dict]] = {}
    all_nodes: dict[int, dict] = {}
    
    for d in depts:
        node = {
            "id": d.id,
            "name": d.name,
            "manager_id": d.manager_id,
            "manager_name": user_map.get(d.manager_id) if d.manager_id else None,
            "parent_id": d.parent_id,
            "user_count": dept_user_count.get(d.id, 0),
            "children": [],
        }
        all_nodes[d.id] = node
        parent = d.parent_id if d.parent_id is not None else 0
        children_map.setdefault(parent, []).append(node)
    
    # 递归组装树并累加子树用户数
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
                        _admin: User = Depends(get_current_admin_user)):
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


# ===== 创建用户 =====
@router.post("", status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_session),
                _admin: User = Depends(get_current_admin_user)):
    """管理员创建新用户"""
    if not data.email or not data.email.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邮箱为必填项")
    # 密码强度校验
    pwd_err = validate_password_strength(data.password)
    if pwd_err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pwd_err)

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
        password_hash=hash_password(data.password),
        name=data.name or data.username,
        email=data.email,
        is_admin=data.is_admin,
        use_shared_models=data.use_shared_models,
        can_manage_models=data.can_manage_models,
        leader_id=resolved_leader_id,
        department_id=data.department_id,
        job_title=data.job_title,
    )
    db.add(user)
    db.flush()
    db.commit()
    db.refresh(user)
    return _user_to_out_with_roles(user, db)


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
        if not data.email.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邮箱为必填项")
        user.email = data.email
    if data.is_admin is not None:
        user.is_admin = data.is_admin
    if data.use_shared_models is not None:
        user.use_shared_models = data.use_shared_models
    if data.can_manage_models is not None:
        user.can_manage_models = data.can_manage_models
    if data.department_id is not None:
        user.department_id = data.department_id if data.department_id != 0 else None
        from app.models.department import Department
        if user.department_id:
            dept = db.get(Department, user.department_id)
            if dept and dept.manager_id:
                user.leader_id = dept.manager_id
            else:
                user.leader_id = None
        else:
            user.leader_id = None
    elif data.leader_id is not None:
        user.leader_id = data.leader_id if data.leader_id != 0 else None
    if data.job_title is not None:
        user.job_title = data.job_title if data.job_title.strip() else None

    db.add(user)
    db.flush()
    db.commit()
    db.refresh(user)
    return _user_to_out_with_roles(user, db)


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
                    _admin: User = Depends(get_current_admin_user)):
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

    db.delete(user)
    db.commit()

