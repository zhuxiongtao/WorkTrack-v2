"""盖章（用印）申请：公章 / 财务章 / 法人章。

发起仅需登录；列表默认只看自己的，持 seal:view_all（法务/印章管理员/老板/管理员）可看全部。
审批走统一引擎 business_type="seal"，末节点「盖章」为执行节点。
"""
import logging
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.seal import SealRequest
from app.models.contract import Contract
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.schemas.seal import SealCreate, SealUpdate, SealOut
from app.services import approval_engine
from app.routers.logs import write_log

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/seals", tags=["盖章申请"])

SEAL_TYPES = ["公章", "财务章", "法人章"]
_LOCKED_STATUSES = {"审批中", "已盖章"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "seal:view_all", db)


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


def _contract_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    cs = db.exec(select(Contract).where(Contract.id.in_(ids))).all()
    return {c.id: c.title for c in cs}


def _to_out(s: SealRequest, name_map: dict, contract_map: dict) -> SealOut:
    return SealOut(
        id=s.id, user_id=s.user_id, user_name=name_map.get(s.user_id),
        seal_type=s.seal_type, title=s.title, reason=s.reason, copies=s.copies,
        is_contract_related=s.is_contract_related, contract_id=s.contract_id,
        contract_title=contract_map.get(s.contract_id),
        attachments=s.attachments, status=s.status,
        created_at=s.created_at, updated_at=s.updated_at,
    )


@router.get("/types")
def list_types():
    return {"types": SEAL_TYPES}


@router.get("", response_model=list[SealOut])
def list_seals(
    scope: str = Query("mine", description="mine=我发起的；all=全部（需 view_all）"),
    status: Optional[str] = Query(None),
    seal_type: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(SealRequest).order_by(SealRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(SealRequest.user_id == current_user.id)
    if status:
        query = query.where(SealRequest.status == status)
    if seal_type:
        query = query.where(SealRequest.seal_type == seal_type)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.title or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows])
    cm = _contract_map(db, [r.contract_id for r in rows if r.contract_id])
    return [_to_out(r, nm, cm) for r in rows]


@router.get("/{seal_id}", response_model=SealOut)
def get_seal(seal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    s = db.get(SealRequest, seal_id)
    if not s:
        raise HTTPException(404, "盖章申请不存在")
    if s.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该盖章申请")
    nm = _name_map(db, [s.user_id])
    cm = _contract_map(db, [s.contract_id] if s.contract_id else [])
    return _to_out(s, nm, cm)


@router.post("", response_model=SealOut)
def create_seal(body: SealCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    if not body.title.strip():
        raise HTTPException(400, "请填写用印文件 / 摘要")
    s = SealRequest(
        user_id=current_user.id,
        seal_type=body.seal_type or "公章",
        title=body.title.strip(),
        reason=body.reason or "",
        copies=body.copies or 1,
        is_contract_related=body.is_contract_related or False,
        contract_id=body.contract_id,
        attachments=body.attachments,
        status="草稿",
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    write_log("info", "seal", f"用户 {current_user.username} 新建盖章申请 #{s.id}（{s.title}）", db=db)
    nm = _name_map(db, [s.user_id])
    cm = _contract_map(db, [s.contract_id] if s.contract_id else [])
    return _to_out(s, nm, cm)


@router.put("/{seal_id}", response_model=SealOut)
def update_seal(seal_id: int, body: SealUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    s = db.get(SealRequest, seal_id)
    if not s:
        raise HTTPException(404, "盖章申请不存在")
    if s.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该盖章申请")
    if s.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{s.status}状态下不可编辑")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    s.updated_at = now()
    db.add(s)
    db.commit()
    db.refresh(s)
    nm = _name_map(db, [s.user_id])
    cm = _contract_map(db, [s.contract_id] if s.contract_id else [])
    return _to_out(s, nm, cm)


@router.delete("/{seal_id}")
def delete_seal(seal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    s = db.get(SealRequest, seal_id)
    if not s:
        raise HTTPException(404, "盖章申请不存在")
    if s.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该盖章申请")
    if s.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{s.status}状态下不可删除")
    db.delete(s)
    db.commit()
    write_log("info", "seal", f"盖章申请 #{seal_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{seal_id}/submit-approval")
def submit_seal_approval(seal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """提交用印审批：部门负责人/分管领导 → 法务初审 → 财务初审 → 总经理 → 盖章。"""
    s = db.get(SealRequest, seal_id)
    if not s:
        raise HTTPException(404, "盖章申请不存在")
    if s.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作该盖章申请")
    if approval_engine.get_active_instance("seal", seal_id, db):
        raise HTTPException(400, "该盖章申请已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "seal", seal_id, s, f"用印申请《{s.title}》", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if inst is None:
        s.status = "已盖章"
        s.updated_at = now()
        db.add(s)
        db.commit()
        return {"approval_id": None, "status": s.status, "message": "无需审批，已直接通过"}

    if inst.status == "pending":
        s.status = "审批中"
        s.updated_at = now()
        db.add(s)
        db.commit()
    db.refresh(s)
    write_log("info", "seal", f"盖章申请 #{seal_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": s.status, "message": "已提交审批"}


@router.post("/{seal_id}/revoke-approval")
def revoke_seal_approval(seal_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    s = db.get(SealRequest, seal_id)
    if not s:
        raise HTTPException(404, "盖章申请不存在")
    inst = approval_engine.get_active_instance("seal", seal_id, db)
    if not inst:
        raise HTTPException(400, "该盖章申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))
    db.refresh(s)
    write_log("info", "seal", f"盖章申请 #{seal_id} 审批已撤回", db=db)
    return {"status": s.status, "message": "审批已撤回，可重新编辑"}
