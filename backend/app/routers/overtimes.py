"""加班申请：员工加班登记，审批通过后按补偿方式处理（调休授予额度/加班费）。

发起仅需登录；列表默认只看自己的，持 overtime:view_all（HR/管理员）可看全部。
审批走统一引擎 business_type="overtime"。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.overtime_request import OvertimeRequest
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.schemas.overtime import OvertimeCreate, OvertimeUpdate, OvertimeOut
from app.services import approval_engine, leave_balance_service
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/overtimes", tags=["加班申请"])

COMPENSATE_TYPES = ["调休", "加班费"]
_LOCKED_STATUSES = {"审批中", "已批准"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "overtime:view_all", db)


def _to_out(ot: OvertimeRequest, name_map: dict) -> OvertimeOut:
    return OvertimeOut(
        id=ot.id, user_id=ot.user_id, user_name=name_map.get(ot.user_id),
        title=ot.title, start_at=ot.start_at, end_at=ot.end_at, hours=ot.hours,
        reason=ot.reason, compensate_type=ot.compensate_type,
        attachments=ot.attachments, status=ot.status,
        created_at=ot.created_at, updated_at=ot.updated_at,
    )


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


@router.get("/types")
def list_types():
    return {"compensate_types": COMPENSATE_TYPES}


@router.get("", response_model=list[OvertimeOut])
def list_overtimes(
    scope: str = Query("mine"),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(OvertimeRequest).order_by(OvertimeRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(OvertimeRequest.user_id == current_user.id)
    if status:
        query = query.where(OvertimeRequest.status == status)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.title or "").lower() or kw in (r.reason or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows])
    return [_to_out(r, nm) for r in rows]


@router.get("/{overtime_id}", response_model=OvertimeOut)
def get_overtime(overtime_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    ot = db.get(OvertimeRequest, overtime_id)
    if not ot:
        raise HTTPException(404, "加班申请不存在")
    if ot.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该加班申请")
    nm = _name_map(db, [ot.user_id])
    return _to_out(ot, nm)


@router.post("", response_model=OvertimeOut)
def create_overtime(body: OvertimeCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    if not body.title.strip():
        raise HTTPException(400, "请填写加班摘要")
    if body.end_at <= body.start_at:
        raise HTTPException(400, "结束时间必须晚于开始时间")
    ot = OvertimeRequest(
        user_id=current_user.id,
        title=body.title.strip(),
        start_at=body.start_at,
        end_at=body.end_at,
        hours=body.hours or 0,
        reason=body.reason or "",
        compensate_type=body.compensate_type or "调休",
        attachments=body.attachments,
        status="草稿",
    )
    db.add(ot)
    db.commit()
    db.refresh(ot)
    write_log("info", "overtime", f"用户 {current_user.username} 新建加班申请 #{ot.id}（{ot.title}）", db=db)
    nm = _name_map(db, [ot.user_id])
    return _to_out(ot, nm)


@router.put("/{overtime_id}", response_model=OvertimeOut)
def update_overtime(overtime_id: int, body: OvertimeUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    ot = db.get(OvertimeRequest, overtime_id)
    if not ot:
        raise HTTPException(404, "加班申请不存在")
    if ot.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该加班申请")
    if ot.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{ot.status}状态下不可编辑")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(ot, k, v)
    if ot.end_at <= ot.start_at:
        raise HTTPException(400, "结束时间必须晚于开始时间")
    ot.updated_at = now()
    db.add(ot)
    db.commit()
    db.refresh(ot)
    nm = _name_map(db, [ot.user_id])
    return _to_out(ot, nm)


@router.delete("/{overtime_id}")
def delete_overtime(overtime_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    ot = db.get(OvertimeRequest, overtime_id)
    if not ot:
        raise HTTPException(404, "加班申请不存在")
    if ot.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该加班申请")
    if ot.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{ot.status}状态下不可删除")
    db.delete(ot)
    db.commit()
    write_log("info", "overtime", f"加班申请 #{overtime_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{overtime_id}/submit-approval")
def submit_overtime_approval(overtime_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """提交加班审批：部门负责人/分管领导 → 人事复核。"""
    ot = db.get(OvertimeRequest, overtime_id)
    if not ot:
        raise HTTPException(404, "加班申请不存在")
    if ot.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作该加班申请")
    if approval_engine.get_active_instance("overtime", overtime_id, db):
        raise HTTPException(400, "该加班申请已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "overtime", overtime_id, ot, f"加班申请《{ot.title}》", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if inst is None:
        ot.status = "已批准"
        ot.updated_at = now()
        db.add(ot)
        db.commit()
        try:
            leave_balance_service.grant_overtime_compensate(ot, db)
        except Exception as e:
            logger.warning("加班 #%s 无审批流直接通过，授予调休额度失败: %s", ot.id, e)
        return {"approval_id": None, "status": ot.status, "message": "无需审批，已直接通过"}

    if inst.status == "pending":
        ot.status = "审批中"
        ot.updated_at = now()
        db.add(ot)
        db.commit()
    db.refresh(ot)
    write_log("info", "overtime", f"加班申请 #{overtime_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": ot.status, "message": "已提交审批"}


@router.post("/{overtime_id}/revoke-approval")
def revoke_overtime_approval(overtime_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    ot = db.get(OvertimeRequest, overtime_id)
    if not ot:
        raise HTTPException(404, "加班申请不存在")
    inst = approval_engine.get_active_instance("overtime", overtime_id, db)
    if not inst:
        raise HTTPException(400, "该加班申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))
    db.refresh(ot)
    write_log("info", "overtime", f"加班申请 #{overtime_id} 审批已撤回", db=db)
    return {"status": ot.status, "message": "审批已撤回，可重新编辑"}
