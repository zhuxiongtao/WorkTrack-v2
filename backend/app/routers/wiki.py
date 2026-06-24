"""Wiki 模块路由：空间管理、页面 CRUD、权限管理、版本历史"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session, select
from app.database import get_session
from app.auth import get_current_user, require_permission, verify_password, hash_password, has_permission
from app.models.user import User
from app.models.wiki import WikiSpace, WikiPage, WikiPermission, WikiPageVersion, UserGroup, UserGroupMember
from app.schemas import (
    WikiSpaceCreate, WikiSpaceUpdate, WikiSpaceOut,
    WikiPageCreate, WikiPageUpdate, WikiPageOut, WikiPageTreeNode,
    WikiPermissionCreate, WikiPermissionOut,
    WikiPageVersionOut,
    WikiUserGroupCreate, WikiUserGroupOut, WikiUserGroupMemberAdd,
)
from app.utils.time import BEIJING_TZ, now

router = APIRouter(prefix="/api/v1/wiki", tags=["Wiki"])


# ===================== 工具函数 =====================

def _verify_share_access(space: WikiSpace, password: str | None) -> None:
    """校验公开空间的到期时间和提取密码，不通过则抛出 HTTPException"""
    from datetime import datetime, timezone
    if space.share_expires_at:
        now_dt = now()
        expires = space.share_expires_at
        # 确保两个时间都是时区感知的
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        # 直接比较两个时区感知的时间
        if now_dt > expires:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="该共享链接已到期失效")
    if space.share_password:
        if not password or not verify_password(password.strip(), space.share_password):
            raise HTTPException(status_code=401, detail="提取密码错误")

def _get_user_permission(target_type: str, target_id: int, user_id: int, db: Session) -> str | None:
    """查询用户对空间/页面的最高权限。owner 视为 admin，支持部门级权限继承"""
    if target_type == "space":
        space = db.get(WikiSpace, target_id)
        if space and space.owner_id == user_id:
            return "admin"

    perms = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == target_type,
            WikiPermission.target_id == target_id,
            WikiPermission.subject_type == "user",
            WikiPermission.subject_id == user_id,
        )
    ).all()
    # 查所属用户组的权限
    group_ids = [g.group_id for g in db.exec(
        select(UserGroupMember).where(UserGroupMember.user_id == user_id)
    ).all()]
    if group_ids:
        group_perms = db.exec(
            select(WikiPermission).where(
                WikiPermission.target_type == target_type,
                WikiPermission.target_id == target_id,
                WikiPermission.subject_type == "group",
                WikiPermission.subject_id.in_(group_ids),
            )
        ).all()
        perms.extend(group_perms)

    # 查所属部门的权限（含父部门继承）
    user = db.get(User, user_id)
    if user and user.department_id:
        from app.models.department import Department
        dept_id = user.department_id
        visited = set()
        while dept_id and dept_id not in visited:
            visited.add(dept_id)
            dept_perms = db.exec(
                select(WikiPermission).where(
                    WikiPermission.target_type == target_type,
                    WikiPermission.target_id == target_id,
                    WikiPermission.subject_type == "department",
                    WikiPermission.subject_id == dept_id,
                )
            ).all()
            perms.extend(dept_perms)
            dept = db.get(Department, dept_id)
            dept_id = dept.parent_id if dept else None

    if not perms:
        return None
    levels = {"viewer": 1, "editor": 2, "admin": 3}
    return max(perms, key=lambda p: levels.get(p.permission, 0)).permission


def _check_access(target_type: str, target_id: int, user_id: int, db: Session, required: str = "viewer") -> bool:
    """检查用户是否有指定权限"""
    # 1. 系统超级管理员拥有一切穿透特权，防止管理员管理非自己创建的空间时报 403 无权限错误
    user = db.get(User, user_id)
    if user and has_permission(user, "wiki:manage_space", db):
        return True

    perm = _get_user_permission(target_type, target_id, user_id, db)
    if not perm:
        return False
    levels = {"viewer": 1, "editor": 2, "admin": 3}
    return levels.get(perm, 0) >= levels.get(required, 0)


def _get_page_path(page: WikiPage, db: Session) -> str:
    """获取页面的完整路径（面包屑用）"""
    parts = [page.title]
    current = page
    while current.parent_id:
        parent = db.get(WikiPage, current.parent_id)
        if parent:
            parts.insert(0, parent.title)
            current = parent
        else:
            break
    # 加空间名
    space = db.get(WikiSpace, current.space_id)
    if space:
        parts.insert(0, space.name)
    return " / ".join(parts)


def _build_page_tree(pages: list[WikiPage], parent_id: int | None = None) -> list[WikiPageTreeNode]:
    """将平铺的页面列表构建为嵌套树"""
    nodes = []
    children = sorted(
        [p for p in pages if p.parent_id == parent_id],
        key=lambda x: (x.sort_order, x.created_at),
    )
    for page in children:
        nodes.append(WikiPageTreeNode(
            id=page.id,
            title=page.title,
            parent_id=page.parent_id,
            sort_order=page.sort_order,
            children=_build_page_tree(pages, page.id),
        ))
    return nodes


# ===================== 空间管理 =====================

@router.get("/spaces", response_model=list[WikiSpaceOut])
def list_spaces(current_user: User = Depends(require_permission("wiki:read")), db: Session = Depends(get_session)):
    """列出用户可访问的空间（自己拥有的 + 被授权的整个空间 + 仅被授权子级页面的协作空间）"""
    # 1. 自己拥有的
    owned = db.exec(
        select(WikiSpace).where(WikiSpace.owner_id == current_user.id)
    ).all()

    # 2. 被显式授权整个空间的空间 ID
    authorized_ids = set()
    my_perms = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "space",
            WikiPermission.subject_type == "user",
            WikiPermission.subject_id == current_user.id,
        )
    ).all()
    for p in my_perms:
        authorized_ids.add(p.target_id)

    # 3. 被用户组授权整个空间的空间 ID
    group_ids = [g.group_id for g in db.exec(
        select(UserGroupMember).where(UserGroupMember.user_id == current_user.id)
    ).all()]
    if group_ids:
        group_perms = db.exec(
            select(WikiPermission).where(
                WikiPermission.target_type == "space",
                WikiPermission.subject_type == "group",
                WikiPermission.subject_id.in_(group_ids),
            )
        ).all()
        for p in group_perms:
            authorized_ids.add(p.target_id)

    # 4. 公开空间
    public = db.exec(
        select(WikiSpace).where(WikiSpace.is_public == True)
    ).all()

    # 合并去重并注入协作与拥有权标志属性
    result = []
    seen_ids = set()

    # 先归档我拥有的空间
    for s in owned:
        out = WikiSpaceOut(**s.model_dump())
        out.is_owner = True
        out.is_shared = False
        out.is_page_collaborative = False
        result.append(out)
        seen_ids.add(s.id)

    # 归档被整个空间授权共享给我的空间
    for space_id in authorized_ids:
        if space_id in seen_ids:
            continue
        s = db.get(WikiSpace, space_id)
        if s:
            out = WikiSpaceOut(**s.model_dump())
            out.is_owner = False
            out.is_shared = True
            out.is_page_collaborative = False
            result.append(out)
            seen_ids.add(s.id)

    # 归档其它公开空间
    for s in public:
        if s.id in seen_ids:
            continue
        out = WikiSpaceOut(**s.model_dump())
        out.is_owner = (s.owner_id == current_user.id)
        out.is_shared = not out.is_owner
        out.is_page_collaborative = False
        result.append(out)
        seen_ids.add(s.id)

    # 5. 特殊处理：仅部分特定单篇文档（Page）授权给我的“仅单页协作空间”
    # 获取我被显式授权的 page ID 列表
    my_page_perms = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "page",
            WikiPermission.subject_type == "user",
            WikiPermission.subject_id == current_user.id,
        )
    ).all()
    page_space_ids = set()
    for p in my_page_perms:
        page = db.get(WikiPage, p.target_id)
        if page:
            page_space_ids.add(page.space_id)

    # 包含用户组被授权的 page ID 列表
    if group_ids:
        group_page_perms = db.exec(
            select(WikiPermission).where(
                WikiPermission.target_type == "page",
                WikiPermission.subject_type == "group",
                WikiPermission.subject_id.in_(group_ids),
            )
        ).all()
        for p in group_page_perms:
            page = db.get(WikiPage, p.target_id)
            if page:
                page_space_ids.add(page.space_id)

    # 将这些“仅有部分单页协作者文档”的宿主空间也并入，作为「协作空间」
    for space_id in page_space_ids:
        if space_id in seen_ids:
            continue
        s = db.get(WikiSpace, space_id)
        if s:
            out = WikiSpaceOut(**s.model_dump())
            out.is_owner = False
            out.is_shared = False
            out.is_page_collaborative = True
            result.append(out)
            seen_ids.add(s.id)

    return sorted(result, key=lambda x: x.updated_at, reverse=True)


@router.post("/spaces", response_model=WikiSpaceOut, status_code=201)
def create_space(data: WikiSpaceCreate, current_user: User = Depends(require_permission("wiki:create")), db: Session = Depends(get_session)):
    space = WikiSpace(name=data.name, description=data.description, owner_id=current_user.id, cover_type=data.cover_type, cover_url=data.cover_url)
    db.add(space)
    db.commit()
    db.refresh(space)
    return space


@router.put("/spaces/{space_id}", response_model=WikiSpaceOut)
def update_space(space_id: int, data: WikiSpaceUpdate, current_user: User = Depends(require_permission("wiki:edit")), db: Session = Depends(get_session)):
    space = db.get(WikiSpace, space_id)
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if not _check_access("space", space_id, current_user.id, db, "admin"):
        raise HTTPException(status_code=403, detail="无权限")

    update_data = data.model_dump(exclude_unset=True)
    if "share_password" in update_data and update_data["share_password"]:
        update_data["share_password"] = hash_password(update_data["share_password"])
    for k, v in update_data.items():
        setattr(space, k, v)
    db.add(space)
    db.commit()
    db.refresh(space)
    return space


@router.delete("/spaces/{space_id}", status_code=204)
def delete_space(space_id: int, force: bool = False, current_user: User = Depends(require_permission("wiki:delete")), db: Session = Depends(get_session)):
    space = db.get(WikiSpace, space_id)
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if not _check_access("space", space_id, current_user.id, db, "admin"):
        raise HTTPException(status_code=403, detail="无权限")

    # 检查空间内是否有页面
    pages = db.exec(select(WikiPage).where(WikiPage.space_id == space_id)).all()
    if pages and not force:
        raise HTTPException(
            status_code=409,
            detail=f"空间内还有 {len(pages)} 个页面，请先删除页面后再删除空间，或使用 force=true 强制删除"
        )

    # 级联删除所有子页面：先按深度排序（子页面先删，父页面后删）
    page_ids = {p.id for p in pages}
    def _depth(p: WikiPage) -> int:
        d = 0
        while p.parent_id and p.parent_id in page_ids:
            d += 1
            p = db.get(WikiPage, p.parent_id)
            if not p:
                break
        return d
    pages.sort(key=_depth, reverse=True)

    for page in pages:
        versions = db.exec(select(WikiPageVersion).where(WikiPageVersion.page_id == page.id)).all()
        for v in versions:
            db.delete(v)
        page_perms = db.exec(
            select(WikiPermission).where(
                WikiPermission.target_type == "page", WikiPermission.target_id == page.id
            )
        ).all()
        for pp in page_perms:
            db.delete(pp)
        db.delete(page)
    space_perms = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "space", WikiPermission.target_id == space_id
        )
    ).all()
    for sp in space_perms:
        db.delete(sp)
    db.delete(space)
    db.commit()


# ===================== 页面管理 =====================

@router.get("/spaces/{space_id}/pages")
def list_pages(space_id: int, current_user: User = Depends(require_permission("wiki:read")), db: Session = Depends(get_session)):
    """列出当前用户可访问的空间下的页面树（支持整空间授权访问，和特定单页/子页协同授权访问的过滤集）"""
    # 1. 如果拥有整空间访问权，直接下发完整页面树
    if _check_access("space", space_id, current_user.id, db, "viewer"):
        pages = db.exec(
            select(WikiPage).where(WikiPage.space_id == space_id).order_by(WikiPage.sort_order)
        ).all()
        return _build_page_tree(list(pages))

    # 2. 如果不具备整空间访问权，检查该空间下是否有一些单页（Page）曾被精细化授权给该用户/或其用户组
    my_page_perms = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "page",
            WikiPermission.subject_type == "user",
            WikiPermission.subject_id == current_user.id,
        )
    ).all()

    group_ids = [g.group_id for g in db.exec(
        select(UserGroupMember).where(UserGroupMember.user_id == current_user.id)
    ).all()]

    # 包含用户组被授权的 page 权限
    if group_ids:
        group_page_perms = db.exec(
            select(WikiPermission).where(
                WikiPermission.target_type == "page",
                WikiPermission.subject_type == "group",
                WikiPermission.subject_id.in_(group_ids),
            )
        ).all()
        my_page_perms = list(my_page_perms) + list(group_page_perms)

    authorized_page_ids = {p.target_id for p in my_page_perms}
    if not authorized_page_ids:
        raise HTTPException(status_code=403, detail="无权访问该空间")

    # 获取全空间页面，并进行“单页与上级面包屑链条”的子集过滤
    all_pages = db.exec(
        select(WikiPage).where(WikiPage.space_id == space_id).order_by(WikiPage.sort_order)
    ).all()

    visible_pages = []
    seen_page_ids = set()

    for page in all_pages:
        if page.id in authorized_page_ids:
            if page.id not in seen_page_ids:
                visible_pages.append(page)
                seen_page_ids.add(page.id)

            # 递归追溯其所有的上级父页面，保障在前端树状大纲能正确连线/挂载
            current = page
            while current.parent_id:
                parent_page = next((p for p in all_pages if p.id == current.parent_id), None)
                if parent_page:
                    if parent_page.id not in seen_page_ids:
                        visible_pages.append(parent_page)
                        seen_page_ids.add(parent_page.id)
                    current = parent_page
                else:
                    break

    if not visible_pages:
        raise HTTPException(status_code=403, detail="无权访问该空间下的任何页面")

    # 按原有的 sort_order 排序
    visible_pages.sort(key=lambda x: x.sort_order)
    return _build_page_tree(visible_pages)


def _prepare_page_out(page: WikiPage, db: Session, current_user: Optional[User] = None) -> WikiPageOut:
    """包装 WikiPageOut 响应：包含作者、所有协同编辑者的姓名集，以及当前访问用户的具体原子权限角色"""
    from app.models.user import User
    
    # 查找主创作者姓名
    creator = db.get(User, page.created_by)
    creator_name = (creator.name or creator.username) if creator else "系统分配"

    # 查询多版本记录，找出所有参与过编辑的协同编辑人 ID
    version_author_ids = db.exec(
        select(WikiPageVersion.created_by).where(WikiPageVersion.page_id == page.id)
    ).all()

    # 合并主创作者、最后更新者以及历史版本参与人
    all_author_ids = list(set([page.created_by, page.updated_by] + list(version_author_ids)))

    # 批量查出所有参与人昵称/用户名
    authors = db.exec(
        select(User).where(User.id.in_(all_author_ids))
    ).all()
    editor_names = [u.name or u.username for u in authors]

    out = WikiPageOut(**page.model_dump())
    out.creator_name = creator_name
    out.editor_names = editor_names
    # 强制加上 UTC 时区，确保 FastAPI 序列化时带有 Z / +00:00 标志，从而在前端浏览器中被 Local 渲染为本地时间（北京时间）
    if out.created_at.tzinfo is None:
        out.created_at = out.created_at.replace(tzinfo=timezone.utc)
    if out.updated_at.tzinfo is None:
        out.updated_at = out.updated_at.replace(tzinfo=timezone.utc)

    # 3. 动态核算当前请求访问者对本篇文档的最高权限角色级别（Viewer/Editor/Admin），供前端精准拦截渲染
    if current_user:
        if current_user.is_admin or has_permission(current_user, "wiki:manage_space", db):
            out.my_permission = "admin"
        else:
            space = db.get(WikiSpace, page.space_id)
            if space and space.owner_id == current_user.id:
                out.my_permission = "admin"
            else:
                # 获取空间级和页面级最高授权
                space_perm = _get_user_permission("space", page.space_id, current_user.id, db)
                page_perm = _get_user_permission("page", page.id, current_user.id, db)
                
                levels = {None: 0, "viewer": 1, "editor": 2, "admin": 3}
                max_code = None
                max_val = 0
                for p_code in [space_perm, page_perm]:
                    val = levels.get(p_code, 0)
                    if val > max_val:
                        max_val = val
                        max_code = p_code
                out.my_permission = max_code if max_code else "viewer"
                
                # 如果是页面创作者，天然也是 admin（拥有最全管理权限）
                if page.created_by == current_user.id and levels.get(out.my_permission, 0) < 3:
                    out.my_permission = "admin"
    else:
        out.my_permission = "viewer" # 外部外链访问默认为只读查看

    return out


@router.get("/pages/{page_id}", response_model=WikiPageOut)
def get_page(page_id: int, current_user: User = Depends(require_permission("wiki:read")), db: Session = Depends(get_session)):
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    
    # 只要拥有整空间的只读权，或者本页面的只读权即可访问！
    has_space_access = _check_access("space", page.space_id, current_user.id, db, "viewer")
    has_page_access = _check_access("page", page.id, current_user.id, db, "viewer")
    if not has_space_access and not has_page_access:
        raise HTTPException(status_code=403, detail="无权限访问该在线文档")

    return _prepare_page_out(page, db, current_user)


@router.post("/pages", response_model=WikiPageOut, status_code=201)
def create_page(data: WikiPageCreate, current_user: User = Depends(require_permission("wiki:create")), db: Session = Depends(get_session)):
    if not _check_access("space", data.space_id, current_user.id, db, "editor"):
        raise HTTPException(status_code=403, detail="无权限")

    # 计算排序值
    max_order = db.exec(
        select(WikiPage.sort_order)
        .where(WikiPage.space_id == data.space_id, WikiPage.parent_id == data.parent_id)
        .order_by(WikiPage.sort_order.desc())
    ).first()
    sort_order = (max_order or 0) + 1

    page = WikiPage(
        space_id=data.space_id,
        parent_id=data.parent_id,
        title=data.title,
        content=data.content,
        sort_order=sort_order,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(page)
    db.commit()
    db.refresh(page)
    return _prepare_page_out(page, db, current_user)


@router.put("/pages/{page_id}", response_model=WikiPageOut)
def update_page(page_id: int, data: WikiPageUpdate, current_user: User = Depends(require_permission("wiki:edit")), db: Session = Depends(get_session)):
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    
    # 只要拥有整空间的编辑权，或者本页面的编辑权即可更新！
    has_space_access = _check_access("space", page.space_id, current_user.id, db, "editor")
    has_page_access = _check_access("page", page.id, current_user.id, db, "editor")
    if not has_space_access and not has_page_access:
        raise HTTPException(status_code=403, detail="无权限编辑该在线文档")

    update_data = data.model_dump(exclude_unset=True)

    # 内容变更时保存版本
    if "content" in update_data and update_data["content"] != page.content:
        max_ver = db.exec(
            select(WikiPageVersion.version)
            .where(WikiPageVersion.page_id == page_id)
            .order_by(WikiPageVersion.version.desc())
        ).first()
        ver = (max_ver or 0) + 1
        snapshot = WikiPageVersion(
            page_id=page_id,
            content=update_data["content"],
            version=ver,
            created_by=current_user.id,
        )
        db.add(snapshot)

    for k, v in update_data.items():
        setattr(page, k, v)
    page.updated_by = current_user.id
    page.updated_at = now()
    db.add(page)
    db.commit()
    db.refresh(page)
    return _prepare_page_out(page, db, current_user)


@router.delete("/pages/{page_id}", status_code=204)
def delete_page(page_id: int, current_user: User = Depends(require_permission("wiki:delete")), db: Session = Depends(get_session)):
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    
    # 只要拥有整空间的管理/编辑权，或者本页面的管理权，或者是创作者即可删除！
    has_space_admin = _check_access("space", page.space_id, current_user.id, db, "admin")
    has_page_admin = _check_access("page", page.id, current_user.id, db, "admin")
    is_creator = page.created_by == current_user.id
    if not has_space_admin and not has_page_admin and not is_creator:
        raise HTTPException(status_code=403, detail="无权限删除该在线文档")

    # 递归删除子页面
    def _recursive_delete(pid: int):
        children = db.exec(select(WikiPage).where(WikiPage.parent_id == pid)).all()
        for child in children:
            _recursive_delete(child.id)
        # 删除版本记录
        versions = db.exec(select(WikiPageVersion).where(WikiPageVersion.page_id == pid)).all()
        for v in versions:
            db.delete(v)
        # 删除页面级权限
        perms = db.exec(
            select(WikiPermission).where(
                WikiPermission.target_type == "page", WikiPermission.target_id == pid
            )
        ).all()
        for p in perms:
            db.delete(p)
        # 删除页面本身
        target = db.get(WikiPage, pid)
        if target:
            db.delete(target)

    _recursive_delete(page_id)
    db.commit()


@router.put("/pages/{page_id}/move")
def move_page(page_id: int, new_parent_id: int | None = None, new_index: int = 0,
               current_user: User = Depends(require_permission("wiki:edit")), db: Session = Depends(get_session)):
    """移动页面到新的父节点或调整排序"""
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    if not _check_access("space", page.space_id, current_user.id, db, "editor"):
        raise HTTPException(status_code=403, detail="无权限")

    if new_parent_id is not None:
        # 防止把自己移到自己的子节点下
        if new_parent_id == page_id:
            raise HTTPException(status_code=400, detail="不能移动到自身下")
        if page.parent_id != new_parent_id:
            page.parent_id = new_parent_id

    page.sort_order = new_index
    db.add(page)
    db.commit()
    return {"ok": True}


# ===================== 权限管理 =====================

def _build_permission_out(perm: WikiPermission, db: Session) -> WikiPermissionOut:
    subject_name = ""
    subject_username = ""
    if perm.subject_type == "user":
        user = db.get(User, perm.subject_id)
        if user:
            subject_name = user.name or user.username or ""
            subject_username = user.username or ""
    elif perm.subject_type == "group":
        group = db.get(UserGroup, perm.subject_id)
        if group:
            subject_name = group.name
            subject_username = f"@group_{group.id}"
    elif perm.subject_type == "department":
        from app.models.department import Department
        dept = db.get(Department, perm.subject_id)
        if dept:
            subject_name = dept.name
            subject_username = f"@dept_{dept.id}"
    return WikiPermissionOut(
        id=perm.id,
        target_type=perm.target_type,
        target_id=perm.target_id,
        subject_type=perm.subject_type,
        subject_id=perm.subject_id,
        permission=perm.permission,
        subject_name=subject_name,
        subject_username=subject_username,
    )


def _fill_permissions_list(permissions: list, db: Session) -> list:
    result = []
    for perm in permissions:
        result.append(_build_permission_out(perm, db))
    return result


@router.get("/spaces/{space_id}/permissions")
def list_space_permissions(space_id: int, current_user: User = Depends(require_permission("wiki:manage_space")), db: Session = Depends(get_session)):
    if not _check_access("space", space_id, current_user.id, db, "admin"):
        raise HTTPException(status_code=403, detail="无权限")
    permissions = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "space",
            WikiPermission.target_id == space_id,
        )
    ).all()
    return _fill_permissions_list(permissions, db)


@router.post("/spaces/{space_id}/permissions", status_code=201)
def add_space_permission(space_id: int, data: WikiPermissionCreate,
                          current_user: User = Depends(require_permission("wiki:manage_space")), db: Session = Depends(get_session)):
    if not _check_access("space", space_id, current_user.id, db, "admin"):
        raise HTTPException(status_code=403, detail="无权限")

    existing = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "space",
            WikiPermission.target_id == space_id,
            WikiPermission.subject_type == data.subject_type,
            WikiPermission.subject_id == data.subject_id,
        )
    ).first()
    if existing:
        existing.permission = data.permission
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return _build_permission_out(existing, db)

    perm = WikiPermission(
        target_type="space", target_id=space_id,
        subject_type=data.subject_type, subject_id=data.subject_id,
        permission=data.permission,
    )
    db.add(perm)
    db.commit()
    db.refresh(perm)
    return _build_permission_out(perm, db)


@router.delete("/permissions/{perm_id}", status_code=204)
def remove_permission(perm_id: int, current_user: User = Depends(require_permission("wiki:manage_space")), db: Session = Depends(get_session)):
    perm = db.get(WikiPermission, perm_id)
    if not perm:
        raise HTTPException(status_code=404, detail="权限不存在")
    if perm.target_type == "space":
        if not _check_access("space", perm.target_id, current_user.id, db, "admin"):
            raise HTTPException(status_code=403, detail="无权限")
    db.delete(perm)
    db.commit()


# ===================== 版本历史 =====================

@router.get("/pages/{page_id}/versions", response_model=list[WikiPageVersionOut])
def list_versions(page_id: int, current_user: User = Depends(require_permission("wiki:read")), db: Session = Depends(get_session)):
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    if not _check_access("space", page.space_id, current_user.id, db, "viewer"):
        raise HTTPException(status_code=403, detail="无权限")
    return db.exec(
        select(WikiPageVersion).where(WikiPageVersion.page_id == page_id).order_by(
            WikiPageVersion.version.desc()
        )
    ).all()


@router.post("/pages/{page_id}/restore/{version_id}")
def restore_version(page_id: int, version_id: int, current_user: User = Depends(require_permission("wiki:edit")), db: Session = Depends(get_session)):
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    if not _check_access("space", page.space_id, current_user.id, db, "editor"):
        raise HTTPException(status_code=403, detail="无权限")

    ver = db.get(WikiPageVersion, version_id)
    if not ver or ver.page_id != page_id:
        raise HTTPException(status_code=404, detail="版本不存在")

    page.content = ver.content
    page.updated_by = current_user.id
    db.add(page)
    db.commit()
    return {"ok": True}


# ===================== 用户组 =====================

@router.get("/groups", response_model=list[WikiUserGroupOut])
def list_groups(current_user: User = Depends(require_permission("wiki:read")), db: Session = Depends(get_session)):
    """列出我拥有的 + 我加入的用户组"""
    owned = db.exec(select(UserGroup).where(UserGroup.owner_id == current_user.id)).all()
    member_group_ids = [g.group_id for g in db.exec(
        select(UserGroupMember).where(UserGroupMember.user_id == current_user.id)
    ).all()]
    joined = db.exec(select(UserGroup).where(UserGroup.id.in_(member_group_ids))).all() if member_group_ids else []

    seen = {g.id: g for g in owned}
    for g in joined:
        seen[g.id] = g

    result = []
    for g in seen.values():
        count = db.exec(
            select(UserGroupMember).where(UserGroupMember.group_id == g.id)
        ).all()
        result.append(WikiUserGroupOut(
            id=g.id, name=g.name, owner_id=g.owner_id, created_at=g.created_at,
            member_count=len(count),
        ))
    return sorted(result, key=lambda x: x.created_at, reverse=True)


@router.post("/groups", response_model=WikiUserGroupOut, status_code=201)
def create_group(data: WikiUserGroupCreate, current_user: User = Depends(require_permission("wiki:create")), db: Session = Depends(get_session)):
    group = UserGroup(name=data.name, owner_id=current_user.id)
    db.add(group)
    db.commit()
    db.refresh(group)
    return WikiUserGroupOut(id=group.id, name=group.name, owner_id=group.owner_id,
                            created_at=group.created_at, member_count=0)


@router.post("/groups/{group_id}/members")
def add_group_member(group_id: int, data: WikiUserGroupMemberAdd,
                      current_user: User = Depends(require_permission("wiki:manage_space")), db: Session = Depends(get_session)):
    group = db.get(UserGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="用户组不存在")
    if group.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有组长可以管理成员")

    existing = db.exec(
        select(UserGroupMember).where(
            UserGroupMember.group_id == group_id,
            UserGroupMember.user_id == data.user_id,
        )
    ).first()
    if existing:
        return {"ok": True}

    db.add(UserGroupMember(group_id=group_id, user_id=data.user_id))
    db.commit()
    return {"ok": True}


@router.delete("/groups/{group_id}/members/{user_id}", status_code=204)
def remove_group_member(group_id: int, user_id: int,
                        current_user: User = Depends(require_permission("wiki:manage_space")), db: Session = Depends(get_session)):
    group = db.get(UserGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="用户组不存在")
    if group.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有组长可以管理成员")

    member = db.exec(
        select(UserGroupMember).where(
            UserGroupMember.group_id == group_id,
            UserGroupMember.user_id == user_id,
        )
    ).first()
    if member:
        db.delete(member)
        db.commit()


# ===================== 公开外链共享访问 =====================

from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timezone

class SharePasswordVerify(BaseModel):
    password: str

@router.post("/public/spaces/{space_id}/verify-password")
def verify_public_space_password(space_id: int, data: SharePasswordVerify, db: Session = Depends(get_session)):
    """校验公开空间的提取密码并判断是否失效"""
    space = db.get(WikiSpace, space_id)
    if not space or not space.is_public:
        raise HTTPException(status_code=403, detail="该空间未被公开共享")
    _verify_share_access(space, data.password)
    return {"ok": True}


@router.get("/public/pages/{page_id}", response_model=WikiPageOut)
def get_public_page(page_id: int, password: Optional[str] = None, shared_page_id: Optional[int] = Query(None), scope: str = Query("space"), db: Session = Depends(get_session)):
    """公开外链页面获取（无需 Auth Token，支持基于共享范围的安全校验与到期、提取码验证）"""
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")

    # 1. 安全校验：防止越权访问共享范围外的文档
    if shared_page_id is not None and scope in ["single", "descendants"]:
        if scope == "single" and page_id != shared_page_id:
            raise HTTPException(status_code=403, detail="该页面不在公开共享范围内")
        elif scope == "descendants" and page_id != shared_page_id:
            # 校验 page_id 必须是 shared_page_id 的子孙
            is_descendant = False
            current = page
            while current.parent_id:
                if current.parent_id == shared_page_id:
                    is_descendant = True
                    break
                current = db.get(WikiPage, current.parent_id)
                if not current:
                    break
            if not is_descendant:
                raise HTTPException(status_code=403, detail="该页面不在公开共享范围内")

    space = db.get(WikiSpace, page.space_id)
    if not space or not space.is_public:
        raise HTTPException(status_code=403, detail="该文档未被公开共享")

    _verify_share_access(space, password)

    return _prepare_page_out(page, db)


@router.get("/public/spaces/{space_id}/pages")
def list_public_pages(space_id: int, password: Optional[str] = None, page_id: Optional[int] = Query(None), scope: str = Query("space"), db: Session = Depends(get_session)):
    """公开外链空间下的整棵页面树结构获取（无需 Auth Token，支持范围与失效时间校验）"""
    space = db.get(WikiSpace, space_id)
    if not space or not space.is_public:
        raise HTTPException(status_code=403, detail="该空间未被公开共享")

    _verify_share_access(space, password)

    pages = db.exec(
        select(WikiPage).where(WikiPage.space_id == space_id).order_by(WikiPage.sort_order)
    ).all()

    # 3. 根据共享范围控制树的节点数
    if page_id is not None and scope in ["single", "descendants"]:
        shared_page = next((p for p in pages if p.id == page_id), None)
        if not shared_page:
            return []

        if scope == "single":
            # 仅共享当前页本身
            return _build_page_tree([shared_page], shared_page.parent_id)
        elif scope == "descendants":
            # 收集当前页面及其所有的后代
            descendants = []
            def _collect(pid: int):
                p_item = next((p for p in pages if p.id == pid), None)
                if p_item:
                    descendants.append(p_item)
                children = [p for p in pages if p.parent_id == pid]
                for c in children:
                    _collect(c.id)
            _collect(page_id)
            return _build_page_tree(descendants, shared_page.parent_id)

    return _build_page_tree(pages)


# ===================== 页面级权限管理 =====================

@router.get("/pages/{page_id}/permissions")
def list_page_permissions(page_id: int, current_user: User = Depends(require_permission("wiki:manage_space")), db: Session = Depends(get_session)):
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    if not _check_access("space", page.space_id, current_user.id, db, "admin") and page.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="无权限查看页面权限")
    permissions = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "page",
            WikiPermission.target_id == page_id,
        )
    ).all()
    result = _fill_permissions_list(permissions, db)
    return result


@router.post("/pages/{page_id}/permissions", status_code=201)
def add_page_permission(page_id: int, data: WikiPermissionCreate,
                          current_user: User = Depends(require_permission("wiki:manage_space")), db: Session = Depends(get_session)):
    """为具体页面添加或修改协作者权限"""
    page = db.get(WikiPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="页面不存在")
    if not _check_access("space", page.space_id, current_user.id, db, "admin") and page.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="无权限管理该页面的协作者")

    existing = db.exec(
        select(WikiPermission).where(
            WikiPermission.target_type == "page",
            WikiPermission.target_id == page_id,
            WikiPermission.subject_type == data.subject_type,
            WikiPermission.subject_id == data.subject_id,
        )
    ).first()
    if existing:
        existing.permission = data.permission
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return _build_permission_out(existing, db)

    perm = WikiPermission(
        target_type="page", target_id=page_id,
        subject_type=data.subject_type, subject_id=data.subject_id,
        permission=data.permission,
    )
    db.add(perm)
    db.commit()
    db.refresh(perm)
    return _build_permission_out(perm, db)

