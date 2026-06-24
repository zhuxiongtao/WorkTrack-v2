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
from app.models.purchase_supplier import PurchaseSupplier
from app.models.user import User
from app.auth import get_current_user, require_permission
from app.schemas.asset import AssetCreate, AssetUpdate, AssetOut
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/assets", tags=["企业资产"])

ASSET_CATEGORIES = ["电子设备", "办公家具", "车辆", "房屋", "软件", "其他"]
ASSET_STATUSES = ["在用", "闲置", "维修中", "已报废"]


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
    return {"categories": ASSET_CATEGORIES, "statuses": ASSET_STATUSES}


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
    db.delete(a)
    db.commit()
    write_log("info", "asset", f"资产 #{asset_id}（{a.name}）已删除", db=db)
    return {"ok": True}
