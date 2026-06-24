"""请假申请：年假 / 事假 / 病假 / 调休 / 婚假 / 产假 / 陪产假 / 丧假。

发起仅需登录；列表默认只看自己的，持 leave:view_all（HR/管理员）可看全部。
审批走统一引擎 business_type="leave"，通过后扣减假期额度，销假时返还。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.leave_request import LeaveRequest
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.schemas.leave import LeaveCreate, LeaveUpdate, LeaveOut, LeaveCancelBody
from app.services import approval_engine, leave_balance_service
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/leaves", tags=["请假申请"])

LEAVE_TYPES = ["年假", "事假", "病假", "调休", "婚假", "产假", "陪产假", "丧假"]
_LOCKED_STATUSES = {"审批中", "已批准"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "leave:view_all", db)


def _to_out(lv: LeaveRequest, name_map: dict) -> LeaveOut:
    return LeaveOut(
        id=lv.id, user_id=lv.user_id, user_name=name_map.get(lv.user_id),
        leave_type=lv.leave_type, title=lv.title,
        start_at=lv.start_at, end_at=lv.end_at, hours=lv.hours,
        reason=lv.reason, attachments=lv.attachments, status=lv.status,
        actual_end_at=lv.actual_end_at, cancelled_at=lv.cancelled_at,
        created_at=lv.created_at, updated_at=lv.updated_at,
    )


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


@router.get("/types")
def list_types():
    return {"types": LEAVE_TYPES}


@router.get("", response_model=list[LeaveOut])
def list_leaves(
    scope: str = Query("mine"),
    status: Optional[str] = Query(None),
    leave_type: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(LeaveRequest).order_by(LeaveRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(LeaveRequest.user_id == current_user.id)
    if status:
        query = query.where(LeaveRequest.status == status)
    if leave_type:
        query = query.where(LeaveRequest.leave_type == leave_type)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.title or "").lower() or kw in (r.reason or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows])
    return [_to_out(r, nm) for r in rows]


@router.get("/{leave_id}", response_model=LeaveOut)
def get_leave(leave_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    lv = db.get(LeaveRequest, leave_id)
    if not lv:
        raise HTTPException(404, "请假申请不存在")
    if lv.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该请假申请")
    nm = _name_map(db, [lv.user_id])
    return _to_out(lv, nm)


@router.post("", response_model=LeaveOut)
def create_leave(body: LeaveCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    if not body.title.strip():
        raise HTTPException(400, "请填写请假摘要")
    if body.end_at <= body.start_at:
        raise HTTPException(400, "结束时间必须晚于开始时间")
    lv = LeaveRequest(
        user_id=current_user.id,
        leave_type=body.leave_type,
        title=body.title.strip(),
        start_at=body.start_at,
        end_at=body.end_at,
        hours=body.hours or 0,
        reason=body.reason or "",
        attachments=body.attachments,
        status="草稿",
    )
    db.add(lv)
    db.commit()
    db.refresh(lv)
    write_log("info", "leave", f"用户 {current_user.username} 新建请假申请 #{lv.id}（{lv.title}）", db=db)
    nm = _name_map(db, [lv.user_id])
    return _to_out(lv, nm)


@router.put("/{leave_id}", response_model=LeaveOut)
def update_leave(leave_id: int, body: LeaveUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    lv = db.get(LeaveRequest, leave_id)
    if not lv:
        raise HTTPException(404, "请假申请不存在")
    if lv.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该请假申请")
    if lv.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{lv.status}状态下不可编辑")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(lv, k, v)
    if lv.end_at <= lv.start_at:
        raise HTTPException(400, "结束时间必须晚于开始时间")
    lv.updated_at = now()
    db.add(lv)
    db.commit()
    db.refresh(lv)
    nm = _name_map(db, [lv.user_id])
    return _to_out(lv, nm)


@router.delete("/{leave_id}")
def delete_leave(leave_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    lv = db.get(LeaveRequest, leave_id)
    if not lv:
        raise HTTPException(404, "请假申请不存在")
    if lv.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该请假申请")
    if lv.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{lv.status}状态下不可删除")
    db.delete(lv)
    db.commit()
    write_log("info", "leave", f"请假申请 #{leave_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{leave_id}/submit-approval")
def submit_leave_approval(leave_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """提交请假审批：部门负责人/分管领导 → 人事复核。"""
    lv = db.get(LeaveRequest, leave_id)
    if not lv:
        raise HTTPException(404, "请假申请不存在")
    if lv.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作该请假申请")
    if approval_engine.get_active_instance("leave", leave_id, db):
        raise HTTPException(400, "该请假申请已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "leave", leave_id, lv, f"请假申请《{lv.title}》", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if inst is None:
        lv.status = "已批准"
        lv.updated_at = now()
        db.add(lv)
        db.commit()
        try:
            leave_balance_service.apply_leave(lv, db, operator_id=current_user.id)
        except Exception as e:
            logger.warning("请假 #%s 无审批流直接通过，扣减额度失败: %s", lv.id, e)
        return {"approval_id": None, "status": lv.status, "message": "无需审批，已直接通过"}

    if inst.status == "pending":
        lv.status = "审批中"
        lv.updated_at = now()
        db.add(lv)
        db.commit()
    db.refresh(lv)
    write_log("info", "leave", f"请假申请 #{leave_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": lv.status, "message": "已提交审批"}


@router.post("/{leave_id}/revoke-approval")
def revoke_leave_approval(leave_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    lv = db.get(LeaveRequest, leave_id)
    if not lv:
        raise HTTPException(404, "请假申请不存在")
    inst = approval_engine.get_active_instance("leave", leave_id, db)
    if not inst:
        raise HTTPException(400, "该请假申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as e:
        raise HTTPException(400, str(e))
    db.refresh(lv)
    write_log("info", "leave", f"请假申请 #{leave_id} 审批已撤回", db=db)
    return {"status": lv.status, "message": "审批已撤回，可重新编辑"}


@router.post("/{leave_id}/cancel-leave")
def cancel_leave(
    leave_id: int,
    body: LeaveCancelBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """销假：已批准的请假结束后，标记实际销假并返还额度。"""
    lv = db.get(LeaveRequest, leave_id)
    if not lv:
        raise HTTPException(404, "请假申请不存在")
    if lv.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权操作该请假申请")
    if lv.status != "已批准":
        raise HTTPException(400, "仅已批准的请假可以销假")
    lv.status = "已销假"
    lv.actual_end_at = body.actual_end_at or now()
    lv.cancelled_at = now()
    lv.updated_at = now()
    db.add(lv)
    db.commit()
    # 返还额度
    try:
        leave_balance_service.cancel_leave(lv, db, operator_id=current_user.id)
    except Exception as e:
        logger.warning("请假 #%s 销假返还额度失败: %s", lv.id, e)
    write_log("info", "leave", f"请假申请 #{leave_id} 已销假", db=db)
    nm = _name_map(db, [lv.user_id])
    return _to_out(lv, nm)
