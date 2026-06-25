"""企业资产管理：电子设备/办公家具/车辆/房屋/其他。

独立 CRUD 管理，不走审批流程。
查看需 asset:read，增删改需 asset:manage（管理员默认拥有）。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.asset import Asset
from app.models.asset_record import AssetRecord
from app.models.purchase_supplier import PurchaseSupplier
from app.models.user import User
from app.auth import get_current_user, require_permission
from app.schemas.asset import AssetCreate, AssetUpdate, AssetOut, AssetActionIn, AssetRecordOut
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/assets", tags=["企业资产"])

ASSET_CATEGORIES = ["电子设备", "办公家具", "车辆", "房屋", "软件", "其他"]
ASSET_STATUSES = ["在用", "闲置", "维修中", "已报废"]
ASSET_ACTIONS = ["领用", "归还", "调拨", "维修", "报废"]


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


def _to_out(a: Asset, nm: dict, sm: dict) -> AssetOut:
    return AssetOut(
        id=a.id, name=a.name, asset_no=a.asset_no, category=a.category, spec=a.spec,
        purchase_date=a.purchase_date, purchase_price=a.purchase_price,
        amount_unit=a.amount_unit, currency=a.currency,
        status=a.status, location=a.location,
        user_id=a.user_id, user_name=nm.get(a.user_id) if a.user_id else None,
        supplier_id=a.supplier_id, supplier_name=sm.get(a.supplier_id) if a.supplier_id else None,
        remarks=a.remarks,
        created_at=a.created_at, updated_at=a.updated_at,
    )


@router.get("/categories")
def list_categories():
    return {"categories": ASSET_CATEGORIES, "statuses": ASSET_STATUSES, "actions": ASSET_ACTIONS}


@router.get("", response_model=list[AssetOut])
def list_assets(
    keyword: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(Asset).order_by(Asset.created_at.desc())
    if category:
        query = query.where(Asset.category == category)
    if status:
        query = query.where(Asset.status == status)
    if user_id:
        query = query.where(Asset.user_id == user_id)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.name or "").lower()
                or kw in (r.asset_no or "").lower()
                or kw in (r.spec or "").lower()
                or kw in (r.location or "").lower()]
    nm = _name_map(db, [r.user_id for r in rows if r.user_id])
    sm = _supplier_map(db, [r.supplier_id for r in rows if r.supplier_id])
    return [_to_out(r, nm, sm) for r in rows]


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    a = db.get(Asset, asset_id)
    if not a:
        raise HTTPException(404, "资产不存在")
    nm = _name_map(db, [a.user_id] if a.user_id else [])
    sm = _supplier_map(db, [a.supplier_id] if a.supplier_id else [])
    return _to_out(a, nm, sm)


@router.post("", response_model=AssetOut)
def create_asset(
    body: AssetCreate,
    current_user: User = Depends(require_permission("asset:manage")),
    db: Session = Depends(get_session),
):
    if not body.name.strip():
        raise HTTPException(400, "请填写资产名称")
    a = Asset(
        name=body.name.strip(),
        asset_no=body.asset_no,
        category=body.category or "其他",
        spec=body.spec,
        purchase_date=body.purchase_date,
        purchase_price=body.purchase_price or 0,
        amount_unit=body.amount_unit or "元",
        currency=body.currency or "CNY",
        status=body.status or "在用",
        location=body.location,
        user_id=body.user_id,
        supplier_id=body.supplier_id,
        remarks=body.remarks,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    write_log("info", "asset", f"用户 {current_user.username} 新建资产 #{a.id}（{a.name}）", db=db)
    nm = _name_map(db, [a.user_id] if a.user_id else [])
    sm = _supplier_map(db, [a.supplier_id] if a.supplier_id else [])
    return _to_out(a, nm, sm)


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: int,
    body: AssetUpdate,
    current_user: User = Depends(require_permission("asset:manage")),
    db: Session = Depends(get_session),
):
    a = db.get(Asset, asset_id)
    if not a:
        raise HTTPException(404, "资产不存在")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(a, k, v)
    a.updated_at = now()
    db.add(a)
    db.commit()
    db.refresh(a)
    nm = _name_map(db, [a.user_id] if a.user_id else [])
    sm = _supplier_map(db, [a.supplier_id] if a.supplier_id else [])
    return _to_out(a, nm, sm)


@router.delete("/{asset_id}")
def delete_asset(
    asset_id: int,
    current_user: User = Depends(require_permission("asset:manage")),
    db: Session = Depends(get_session),
):
    a = db.get(Asset, asset_id)
    if not a:
        raise HTTPException(404, "资产不存在")
    # 先删履历再删资产（FK 约束）
    for rec in db.exec(select(AssetRecord).where(AssetRecord.asset_id == asset_id)).all():
        db.delete(rec)
    db.flush()
    db.delete(a)
    db.commit()
    write_log("info", "asset", f"资产 #{asset_id}（{a.name}）已删除", db=db)
    return {"ok": True}


@router.post("/{asset_id}/action", response_model=AssetOut)
def asset_action(
    asset_id: int,
    body: AssetActionIn,
    current_user: User = Depends(require_permission("asset:manage")),
    db: Session = Depends(get_session),
):
    """资产流转操作：领用/归还/调拨/维修/报废。
    自动更新资产当前使用人与状态，并写入履历，可追溯历任使用人。"""
    a = db.get(Asset, asset_id)
    if not a:
        raise HTTPException(404, "资产不存在")
    action = (body.action or "").strip()
    if action not in ASSET_ACTIONS:
        raise HTTPException(400, f"不支持的操作：{action}")
    if a.status == "已报废":
        raise HTTPException(400, "资产已报废，不能再操作")

    from_user_id = a.user_id
    from_status = a.status
    to_user_id = None

    if action in ("领用", "调拨"):
        if not body.to_user_id:
            raise HTTPException(400, f"{action}须指定使用人")
        if not db.get(User, body.to_user_id):
            raise HTTPException(404, "指定的使用人不存在")
        to_user_id = body.to_user_id
        a.user_id = to_user_id
        a.status = "在用"
    elif action == "归还":
        if not from_user_id:
            raise HTTPException(400, "该资产当前无使用人，无需归还")
        a.user_id = None
        a.status = "闲置"
    elif action == "维修":
        a.status = "维修中"
    elif action == "报废":
        a.user_id = None
        a.status = "已报废"

    a.updated_at = now()
    db.add(a)
    db.flush()
    db.add(AssetRecord(
        asset_id=asset_id, action=action,
        from_user_id=from_user_id, to_user_id=to_user_id,
        operator_id=current_user.id,
        from_status=from_status, to_status=a.status,
        note=(body.note or None),
    ))
    db.commit()
    db.refresh(a)
    write_log("info", "asset",
              f"用户 {current_user.username} 对资产 #{asset_id}（{a.name}）执行「{action}」", db=db)
    nm = _name_map(db, [a.user_id] if a.user_id else [])
    sm = _supplier_map(db, [a.supplier_id] if a.supplier_id else [])
    return _to_out(a, nm, sm)


@router.get("/{asset_id}/records", response_model=list[AssetRecordOut])
def list_asset_records(
    asset_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """查看资产流转履历（按时间倒序）"""
    if not db.get(Asset, asset_id):
        raise HTTPException(404, "资产不存在")
    rows = db.exec(
        select(AssetRecord).where(AssetRecord.asset_id == asset_id)
        .order_by(AssetRecord.created_at.desc())
    ).all()
    ids = []
    for r in rows:
        ids += [r.from_user_id, r.to_user_id, r.operator_id]
    nm = _name_map(db, [i for i in ids if i])
    return [AssetRecordOut(
        id=r.id, asset_id=r.asset_id, action=r.action,
        from_user_id=r.from_user_id, from_user_name=nm.get(r.from_user_id) if r.from_user_id else None,
        to_user_id=r.to_user_id, to_user_name=nm.get(r.to_user_id) if r.to_user_id else None,
        operator_id=r.operator_id, operator_name=nm.get(r.operator_id) if r.operator_id else None,
        from_status=r.from_status, to_status=r.to_status,
        note=r.note, created_at=r.created_at,
    ) for r in rows]
