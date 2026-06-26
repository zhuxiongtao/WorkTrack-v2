"""出差申请：员工出差登记，走审批流程。

发起仅需登录；列表默认只看自己的，持 trip:view_all 可看全部。
审批走统一引擎 business_type="business_trip"。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.business_trip_request import BusinessTripRequest
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.schemas.business_trip import BusinessTripCreate, BusinessTripUpdate, BusinessTripOut
from app.services import approval_engine
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/business-trips", tags=["出差申请"])

TRANSPORT_TYPES = ["飞机", "高铁", "火车", "汽车", "其他"]
_LOCKED_STATUSES = {"审批中", "已批准"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "trip:view_all", db)


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


def _to_out(t: BusinessTripRequest, nm: dict) -> BusinessTripOut:
    return BusinessTripOut(
        id=t.id, user_id=t.user_id, user_name=nm.get(t.user_id),
        title=t.title, destination=t.destination,
        start_date=t.start_date, end_date=t.end_date, days=t.days,
        purpose=t.purpose, budget=t.budget, budget_unit=t.budget_unit,
        currency=t.currency, transport=t.transport, attachments=t.attachments,
        status=t.status, completed_at=t.completed_at,
        created_at=t.created_at, updated_at=t.updated_at,
    )


@router.get("/types")
def list_types():
    return {"transport_types": TRANSPORT_TYPES}


@router.get("/approved")
def list_approved_trips(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取当前用户已批准的出差申请（供报销关联选择）"""
    rows = db.exec(
        select(BusinessTripRequest)
        .where(BusinessTripRequest.user_id == current_user.id)
        .where(BusinessTripRequest.status == "已批准")
        .order_by(BusinessTripRequest.created_at.desc())
    ).all()
    return [
        {"id": t.id, "title": t.title, "destination": t.destination,
         "start_date": t.start_date.isoformat() if t.start_date else None,
         "end_date": t.end_date.isoformat() if t.end_date else None}
        for t in rows
    ]


@router.get("", response_model=list[BusinessTripOut])
def list_trips(
    scope: str = Query("mine"),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(BusinessTripRequest).order_by(BusinessTripRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(BusinessTripRequest.user_id == current_user.id)
    if status:
        query = query.where(BusinessTripRequest.status == status)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.title or "").lower()
                or kw in (r.destination or "").lower()
                or kw in (r.purpose or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows])
    return [_to_out(r, nm) for r in rows]


@router.get("/{trip_id}", response_model=BusinessTripOut)
def get_trip(trip_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    t = db.get(BusinessTripRequest, trip_id)
    if not t:
        raise HTTPException(404, "出差申请不存在")
    if t.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该出差申请")
    nm = _name_map(db, [t.user_id])
    return _to_out(t, nm)


@router.post("", response_model=BusinessTripOut)
def create_trip(body: BusinessTripCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    if not body.title.strip():
        raise HTTPException(400, "请填写出差摘要")
    if body.end_date <= body.start_date:
        raise HTTPException(400, "结束日期必须晚于开始日期")
    t = BusinessTripRequest(
        user_id=current_user.id,
        title=body.title.strip(),
        destination=body.destination.strip(),
        start_date=body.start_date,
        end_date=body.end_date,
        days=body.days or 0,
        purpose=body.purpose or "",
        budget=body.budget or 0,
        budget_unit=body.budget_unit or "元",
        currency=body.currency or "CNY",
        transport=body.transport or "其他",
        attachments=body.attachments,
        status="草稿",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    write_log("info", "business_trip", f"用户 {current_user.username} 新建出差申请 #{t.id}（{t.title}）", db=db)
    nm = _name_map(db, [t.user_id])
    return _to_out(t, nm)


@router.put("/{trip_id}", response_model=BusinessTripOut)
def update_trip(trip_id: int, body: BusinessTripUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    t = db.get(BusinessTripRequest, trip_id)
    if not t:
        raise HTTPException(404, "出差申请不存在")
    if t.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该出差申请")
    if t.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{t.status}状态下不可编辑")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(t, k, v)
    if t.end_date <= t.start_date:
        raise HTTPException(400, "结束日期必须晚于开始日期")
    t.updated_at = now()
    db.add(t)
    db.commit()
    db.refresh(t)
    nm = _name_map(db, [t.user_id])
    return _to_out(t, nm)


@router.delete("/{trip_id}")
def delete_trip(trip_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    t = db.get(BusinessTripRequest, trip_id)
    if not t:
        raise HTTPException(404, "出差申请不存在")
    if t.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该出差申请")
    if t.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{t.status}状态下不可删除")
    db.delete(t)
    db.commit()
    write_log("info", "business_trip", f"出差申请 #{trip_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{trip_id}/submit-approval")
def submit_trip_approval(trip_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """提交出差审批：部门负责人 → 老板批准。"""
    t = db.get(BusinessTripRequest, trip_id)
    if not t:
        raise HTTPException(404, "出差申请不存在")
    if t.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作该出差申请")
    if approval_engine.get_active_instance("business_trip", trip_id, db):
        raise HTTPException(400, "该出差申请已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "business_trip", trip_id, t, f"出差申请《{t.title}》", current_user, db,
        )
    except ValueError as ex:
        raise HTTPException(400, str(ex))

    if inst is None:
        t.status = "已批准"
        t.updated_at = now()
        db.add(t)
        db.commit()
        return {"approval_id": None, "status": t.status, "message": "无需审批，已直接通过"}

    if inst.status == "pending":
        t.status = "审批中"
        t.updated_at = now()
        db.add(t)
        db.commit()
    db.refresh(t)
    write_log("info", "business_trip", f"出差申请 #{trip_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": t.status, "message": "已提交审批"}


@router.post("/{trip_id}/revoke-approval")
def revoke_trip_approval(trip_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    t = db.get(BusinessTripRequest, trip_id)
    if not t:
        raise HTTPException(404, "出差申请不存在")
    inst = approval_engine.get_active_instance("business_trip", trip_id, db)
    if not inst:
        raise HTTPException(400, "该出差申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as ex:
        raise HTTPException(400, str(ex))
    db.refresh(t)
    write_log("info", "business_trip", f"出差申请 #{trip_id} 审批已撤回", db=db)
    return {"status": t.status, "message": "审批已撤回，可重新编辑"}


@router.post("/{trip_id}/complete")
def complete_trip(
    trip_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """标记出差完成。仅已批准状态可完成。"""
    t = db.get(BusinessTripRequest, trip_id)
    if not t:
        raise HTTPException(404, "出差申请不存在")
    if t.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权操作该出差申请")
    if t.status != "已批准":
        raise HTTPException(400, "仅已批准的出差可以标记完成")
    t.status = "已完成"
    t.completed_at = now()
    t.updated_at = now()
    db.add(t)
    db.commit()
    db.refresh(t)
    write_log("info", "business_trip", f"出差申请 #{trip_id} 已标记完成", db=db)
    nm = _name_map(db, [t.user_id])
    return _to_out(t, nm)
