"""员工入职申请

发起需 hire:manage 权限（HR 专属）；列表默认只看自己的，持 hire:view_all 可看全部。
审批走统一引擎 business_type="hire"，通过后由 approval_engine._on_finished 自动建账号。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.hire_request import HireRequest
from app.models.user import User
from app.models.department import Department
from app.auth import get_current_user, has_permission, require_permission
from app.schemas.hire import HireCreate, HireUpdate, HireOut
from app.services import approval_engine
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/hires", tags=["员工入职申请"])

_LOCKED_STATUSES = {"审批中", "已批准", "已入职"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "hire:view_all", db)


def _user_name_map(db: Session, ids: list[int]) -> dict:
    """批量查用户名"""
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


def _dept_name_map(db: Session, ids: list[int]) -> dict:
    """批量查部门名"""
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    depts = db.exec(select(Department).where(Department.id.in_(ids))).all()
    return {d.id: d.name for d in depts}


def _to_out(hr: HireRequest, user_map: dict, dept_map: dict, leader_map: dict, created_user_map: dict) -> HireOut:
    return HireOut(
        id=hr.id,
        user_id=hr.user_id,
        user_name=user_map.get(hr.user_id),
        candidate_name=hr.candidate_name,
        candidate_username=hr.candidate_username,
        candidate_email=hr.candidate_email,
        candidate_phone=hr.candidate_phone,
        job_title=hr.job_title,
        department_id=hr.department_id,
        department_name=dept_map.get(hr.department_id) if hr.department_id else None,
        leader_id=hr.leader_id,
        leader_name=leader_map.get(hr.leader_id) if hr.leader_id else None,
        first_work_date=hr.first_work_date,
        hire_date=hr.hire_date,
        is_admin=hr.is_admin,
        use_shared_models=hr.use_shared_models,
        salary=hr.salary,
        reason=hr.reason,
        attachments=hr.attachments,
        status=hr.status,
        created_user_id=hr.created_user_id,
        created_user_name=created_user_map.get(hr.created_user_id) if hr.created_user_id else None,
        onboarded_at=hr.onboarded_at,
        created_at=hr.created_at,
        updated_at=hr.updated_at,
    )


def _enrich_list(rows: list[HireRequest], db: Session) -> list[HireOut]:
    """批量填充关联名"""
    user_ids = [r.user_id for r in rows] + [r.leader_id for r in rows if r.leader_id] + [r.created_user_id for r in rows if r.created_user_id]
    dept_ids = [r.department_id for r in rows if r.department_id]
    user_map = _user_name_map(db, user_ids)
    dept_map = _dept_name_map(db, dept_ids)
    # leader 和 created_user 的名字已在 user_map 中
    return [_to_out(r, user_map, dept_map, user_map, user_map) for r in rows]


@router.get("", response_model=list[HireOut])
def list_hires(
    scope: str = Query("mine"),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(HireRequest).order_by(HireRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(HireRequest.user_id == current_user.id)
    if status:
        query = query.where(HireRequest.status == status)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.candidate_name or "").lower()
                or kw in (r.candidate_username or "").lower()
                or kw in (r.reason or "").lower()]
    return _enrich_list(rows, db)


@router.get("/{hire_id}", response_model=HireOut)
def get_hire(hire_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    hr = db.get(HireRequest, hire_id)
    if not hr:
        raise HTTPException(404, "入职申请不存在")
    if hr.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该入职申请")
    return _enrich_list([hr], db)[0]


@router.post("", response_model=HireOut)
def create_hire(
    body: HireCreate,
    current_user: User = Depends(require_permission("hire:manage")),
    db: Session = Depends(get_session),
):
    """创建入职申请（仅 HR 可发起）"""
    # 校验必填
    if not body.candidate_name.strip():
        raise HTTPException(400, "请填写候选人姓名")
    if not body.candidate_username.strip():
        raise HTTPException(400, "请填写登录名")
    if not body.candidate_email.strip():
        raise HTTPException(400, "请填写邮箱")

    # 唯一性预检：用户名
    existing = db.exec(select(User).where(User.username == body.candidate_username.strip())).first()
    if existing:
        raise HTTPException(409, f"登录名 {body.candidate_username} 已存在")
    # 唯一性预检：同候选人用户名是否已有未入职的申请
    dup = db.exec(
        select(HireRequest).where(
            HireRequest.candidate_username == body.candidate_username.strip(),
            HireRequest.status.in_(["草稿", "审批中", "已批准"]),
        )
    ).first()
    if dup:
        raise HTTPException(409, f"登录名 {body.candidate_username} 已有进行中的入职申请 #{dup.id}")

    hr = HireRequest(
        user_id=current_user.id,
        candidate_name=body.candidate_name.strip(),
        candidate_username=body.candidate_username.strip(),
        candidate_email=body.candidate_email.strip(),
        candidate_phone=body.candidate_phone,
        job_title=body.job_title,
        department_id=body.department_id,
        leader_id=body.leader_id,
        first_work_date=body.first_work_date,
        hire_date=body.hire_date,
        is_admin=body.is_admin,
        use_shared_models=body.use_shared_models,
        salary=body.salary,
        reason=body.reason or "",
        attachments=body.attachments,
        status="草稿",
    )
    db.add(hr)
    db.commit()
    db.refresh(hr)
    write_log("info", "hire", f"用户 {current_user.username} 新建入职申请 #{hr.id}（{hr.candidate_name}）", db=db)
    return _enrich_list([hr], db)[0]


@router.put("/{hire_id}", response_model=HireOut)
def update_hire(
    hire_id: int,
    body: HireUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    hr = db.get(HireRequest, hire_id)
    if not hr:
        raise HTTPException(404, "入职申请不存在")
    if hr.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该入职申请")
    if hr.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{hr.status}状态下不可编辑")

    data = body.model_dump(exclude_unset=True)
    # 若修改了登录名，需重新做唯一性预检
    if "candidate_username" in data and data["candidate_username"]:
        new_username = data["candidate_username"].strip()
        if new_username != hr.candidate_username:
            existing = db.exec(select(User).where(User.username == new_username)).first()
            if existing:
                raise HTTPException(409, f"登录名 {new_username} 已存在")
            dup = db.exec(
                select(HireRequest).where(
                    HireRequest.candidate_username == new_username,
                    HireRequest.id != hr.id,
                    HireRequest.status.in_(["草稿", "审批中", "已批准"]),
                )
            ).first()
            if dup:
                raise HTTPException(409, f"登录名 {new_username} 已有进行中的入职申请 #{dup.id}")

    for k, v in data.items():
        setattr(hr, k, v)
    hr.updated_at = now()
    db.add(hr)
    db.commit()
    db.refresh(hr)
    return _enrich_list([hr], db)[0]


@router.delete("/{hire_id}")
def delete_hire(hire_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    hr = db.get(HireRequest, hire_id)
    if not hr:
        raise HTTPException(404, "入职申请不存在")
    if hr.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该入职申请")
    if hr.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{hr.status}状态下不可删除")
    db.delete(hr)
    db.commit()
    write_log("info", "hire", f"入职申请 #{hire_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{hire_id}/submit-approval")
def submit_hire_approval(
    hire_id: int,
    current_user: User = Depends(require_permission("hire:manage")),
    db: Session = Depends(get_session),
):
    """提交入职审批：用人部门负责人 → 人事复核 → 总经理 → HR 执行入职"""
    hr = db.get(HireRequest, hire_id)
    if not hr:
        raise HTTPException(404, "入职申请不存在")
    if hr.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作该入职申请")
    if approval_engine.get_active_instance("hire", hire_id, db):
        raise HTTPException(400, "该入职申请已有进行中的审批")

    try:
        inst = approval_engine.start_approval(
            "hire", hire_id, hr, f"员工入职申请《{hr.candidate_name}》", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if inst is None:
        # 无审批流模板：与 _on_finished approved 分支保持一致，直接执行建账号
        approval_engine._create_user_from_hire(hr, db)
        db.refresh(hr)
        return {"approval_id": None, "status": hr.status, "message": "无需审批，已直接入职并建账号"}

    if inst.status == "pending":
        hr.status = "审批中"
        hr.updated_at = now()
        db.add(hr)
        db.commit()
    db.refresh(hr)
    write_log("info", "hire", f"入职申请 #{hire_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": hr.status, "message": "已提交审批"}


@router.post("/{hire_id}/revoke-approval")
def revoke_hire_approval(
    hire_id: int,
    current_user: User = Depends(require_permission("hire:manage")),
    db: Session = Depends(get_session),
):
    """撤回入职审批"""
    hr = db.get(HireRequest, hire_id)
    if not hr:
        raise HTTPException(404, "入职申请不存在")
    inst = approval_engine.get_active_instance("hire", hire_id, db)
    if not inst:
        raise HTTPException(400, "该入职申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))
    db.refresh(hr)
    write_log("info", "hire", f"入职申请 #{hire_id} 审批已撤回", db=db)
    return {"status": hr.status, "message": "审批已撤回，可重新编辑"}
