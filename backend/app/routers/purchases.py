"""采购申请：办公用品/设备/服务/其他。

发起仅需登录；列表默认只看自己的，持 purchase:view_all 可看全部。
审批走统一引擎 business_type="purchase"，通过后执行采购和入库。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.purchase_request import PurchaseRequest
from app.models.purchase_supplier import PurchaseSupplier
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.schemas.purchase import PurchaseCreate, PurchaseUpdate, PurchaseOut
from app.services import approval_engine
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/purchases", tags=["采购申请"])

PURCHASE_TYPES = ["办公用品", "设备", "服务", "其他"]
_LOCKED_STATUSES = {"审批中", "已批准", "已采购", "已入库"}


def _can_view_all(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "purchase:view_all", db)


def _can_manage_procurement(user: User, db: Session) -> bool:
    return user.is_admin or has_permission(user, "purchase:manage", db)


def _name_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    users = db.exec(select(User).where(User.id.in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


def _supplier_map(db: Session, ids: list[int]) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    rows = db.exec(select(PurchaseSupplier).where(PurchaseSupplier.id.in_(ids))).all()
    return {r.id: r.name for r in rows}


def _to_out(p: PurchaseRequest, nm: dict, sm: dict) -> PurchaseOut:
    return PurchaseOut(
        id=p.id, user_id=p.user_id, user_name=nm.get(p.user_id),
        title=p.title, purchase_type=p.purchase_type,
        supplier_id=p.supplier_id, supplier_name=sm.get(p.supplier_id) if p.supplier_id else None,
        items=p.items, total_amount=p.total_amount, amount_unit=p.amount_unit,
        currency=p.currency, reason=p.reason, expected_date=p.expected_date,
        attachments=p.attachments, status=p.status,
        purchased_at=p.purchased_at, stored_at=p.stored_at,
        created_at=p.created_at, updated_at=p.updated_at,
    )


@router.get("/types")
def list_types():
    return {"types": PURCHASE_TYPES}


@router.get("", response_model=list[PurchaseOut])
def list_purchases(
    scope: str = Query("mine"),
    status: Optional[str] = Query(None),
    purchase_type: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(PurchaseRequest).order_by(PurchaseRequest.created_at.desc())
    if scope == "all" and _can_view_all(current_user, db):
        pass
    else:
        query = query.where(PurchaseRequest.user_id == current_user.id)
    if status:
        query = query.where(PurchaseRequest.status == status)
    if purchase_type:
        query = query.where(PurchaseRequest.purchase_type == purchase_type)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.title or "").lower() or kw in (r.reason or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows])
    sm = _supplier_map(db, [r.supplier_id for r in rows if r.supplier_id])
    return [_to_out(r, nm, sm) for r in rows]


@router.get("/{purchase_id}", response_model=PurchaseOut)
def get_purchase(purchase_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(PurchaseRequest, purchase_id)
    if not p:
        raise HTTPException(404, "采购申请不存在")
    if p.user_id != current_user.id and not _can_view_all(current_user, db):
        raise HTTPException(403, "无权查看该采购申请")
    nm = _name_map(db, [p.user_id])
    sm = _supplier_map(db, [p.supplier_id] if p.supplier_id else [])
    return _to_out(p, nm, sm)


@router.post("", response_model=PurchaseOut)
def create_purchase(body: PurchaseCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    if not body.title.strip():
        raise HTTPException(400, "请填写采购摘要")
    p = PurchaseRequest(
        user_id=current_user.id,
        title=body.title.strip(),
        purchase_type=body.purchase_type,
        supplier_id=body.supplier_id,
        items=body.items,
        total_amount=body.total_amount or 0,
        amount_unit=body.amount_unit or "元",
        currency=body.currency or "CNY",
        reason=body.reason or "",
        expected_date=body.expected_date,
        attachments=body.attachments,
        status="草稿",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    write_log("info", "purchase", f"用户 {current_user.username} 新建采购申请 #{p.id}（{p.title}）", db=db)
    nm = _name_map(db, [p.user_id])
    sm = _supplier_map(db, [p.supplier_id] if p.supplier_id else [])
    return _to_out(p, nm, sm)


@router.put("/{purchase_id}", response_model=PurchaseOut)
def update_purchase(purchase_id: int, body: PurchaseUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(PurchaseRequest, purchase_id)
    if not p:
        raise HTTPException(404, "采购申请不存在")
    if p.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权编辑该采购申请")
    if p.status in _LOCKED_STATUSES:
        raise HTTPException(400, f"{p.status}状态下不可编辑")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(p, k, v)
    p.updated_at = now()
    db.add(p)
    db.commit()
    db.refresh(p)
    nm = _name_map(db, [p.user_id])
    sm = _supplier_map(db, [p.supplier_id] if p.supplier_id else [])
    return _to_out(p, nm, sm)


@router.delete("/{purchase_id}")
def delete_purchase(purchase_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(PurchaseRequest, purchase_id)
    if not p:
        raise HTTPException(404, "采购申请不存在")
    if p.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权删除该采购申请")
    if p.status in _LOCKED_STATUSES and not current_user.is_admin:
        raise HTTPException(400, f"{p.status}状态下不可删除")
    db.delete(p)
    db.commit()
    write_log("info", "purchase", f"采购申请 #{purchase_id} 已删除", db=db)
    return {"ok": True}


@router.post("/{purchase_id}/submit-approval")
def submit_purchase_approval(purchase_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """提交采购审批：部门负责人 → 财务审核 → 老板批准。"""
    p = db.get(PurchaseRequest, purchase_id)
    if not p:
        raise HTTPException(404, "采购申请不存在")
    if p.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "无权操作该采购申请")
    if approval_engine.get_active_instance("purchase", purchase_id, db):
        raise HTTPException(400, "该采购申请已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "purchase", purchase_id, p, f"采购申请《{p.title}》", current_user, db,
        )
    except ValueError as ex:
        raise HTTPException(400, str(ex))

    if inst is None:
        p.status = "已批准"
        p.updated_at = now()
        db.add(p)
        db.commit()
        return {"approval_id": None, "status": p.status, "message": "无需审批，已直接通过"}

    if inst.status == "pending":
        p.status = "审批中"
        p.updated_at = now()
        db.add(p)
        db.commit()
    db.refresh(p)
    write_log("info", "purchase", f"采购申请 #{purchase_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": p.status, "message": "已提交审批"}


@router.post("/{purchase_id}/revoke-approval")
def revoke_purchase_approval(purchase_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(PurchaseRequest, purchase_id)
    if not p:
        raise HTTPException(404, "采购申请不存在")
    inst = approval_engine.get_active_instance("purchase", purchase_id, db)
    if not inst:
        raise HTTPException(400, "该采购申请没有进行中的审批")
    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as ex:
        raise HTTPException(400, str(ex))
    db.refresh(p)
    write_log("info", "purchase", f"采购申请 #{purchase_id} 审批已撤回", db=db)
    return {"status": p.status, "message": "审批已撤回，可重新编辑"}


@router.post("/{purchase_id}/procure")
def procure_purchase(
    purchase_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """标记采购完成（需 purchase:manage 权限）。仅已批准状态可操作。"""
    if not _can_manage_procurement(current_user, db):
        raise HTTPException(403, "无权执行采购操作")
    p = db.get(PurchaseRequest, purchase_id)
    if not p:
        raise HTTPException(404, "采购申请不存在")
    if p.status != "已批准":
        raise HTTPException(400, "仅已批准的采购可以执行采购")
    p.status = "已采购"
    p.purchased_at = now()
    p.updated_at = now()
    db.add(p)
    db.commit()
    db.refresh(p)
    write_log("info", "purchase", f"采购申请 #{purchase_id} 已由 {current_user.username} 执行采购", db=db)
    nm = _name_map(db, [p.user_id])
    sm = _supplier_map(db, [p.supplier_id] if p.supplier_id else [])
    return _to_out(p, nm, sm)


@router.post("/{purchase_id}/store")
def store_purchase(
    purchase_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """标记入库完成（需 purchase:manage 权限）。仅已采购状态可操作。"""
    if not _can_manage_procurement(current_user, db):
        raise HTTPException(403, "无权执行入库操作")
    p = db.get(PurchaseRequest, purchase_id)
    if not p:
        raise HTTPException(404, "采购申请不存在")
    if p.status != "已采购":
        raise HTTPException(400, "仅已采购的申请可以执行入库")
    p.status = "已入库"
    p.stored_at = now()
    p.updated_at = now()
    db.add(p)
    db.commit()
    db.refresh(p)
    write_log("info", "purchase", f"采购申请 #{purchase_id} 已由 {current_user.username} 执行入库", db=db)
    nm = _name_map(db, [p.user_id])
    sm = _supplier_map(db, [p.supplier_id] if p.supplier_id else [])
    return _to_out(p, nm, sm)
