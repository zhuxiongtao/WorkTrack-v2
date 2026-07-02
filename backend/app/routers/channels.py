"""通道（Channel）API：供应商下挂载的具体模型通道"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, col, func
from app.database import get_session
from app.models.channel import Channel, compute_channel_status
from app.models.supplier import Supplier
from app.models.reconcile import ReconcileSupply
from app.schemas.channel import ChannelCreate, ChannelUpdate, ChannelOut, ChannelSummary
from app.auth import require_permission

router = APIRouter(prefix="/api/v1/channels", tags=["通道管理"])


def _supplier_map(db: Session, supplier_ids: list[int]) -> dict[int, Supplier]:
    if not supplier_ids:
        return {}
    rows = db.exec(select(Supplier).where(col(Supplier.id).in_(supplier_ids))).all()
    return {s.id: s for s in rows}


def _to_out(c: Channel, sup: Optional[Supplier]) -> ChannelOut:
    cs = compute_channel_status(
        c.status,
        sup.contract_start if sup else None,
        sup.contract_end if sup else None,
    )
    return ChannelOut(
        id=c.id, supplier_id=c.supplier_id, name=c.name, code=c.code,
        api_protocol=c.api_protocol, status=c.status, computed_status=cs,
        cost_discount=c.cost_discount, markup=c.markup, cost_source=c.cost_source,
        scope_type=c.scope_type, model_family=c.model_family, model_id=c.model_id,
        sla_json=c.sla_json,
        access_url=c.access_url, usage_url=c.usage_url,
        inventory_total=c.inventory_total, inventory_available=c.inventory_available,
        active_projects=c.active_projects, monthly_cost=c.monthly_cost,
        remarks=c.remarks, created_at=c.created_at, updated_at=c.updated_at,
    )


@router.get("", response_model=list[ChannelOut])
def list_channels(
    supplier_id: Optional[int] = None,
    scope_type: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:read")),
):
    query = select(Channel).order_by(Channel.supplier_id, col(Channel.id))
    if supplier_id:
        query = query.where(Channel.supplier_id == supplier_id)
    if scope_type:
        query = query.where(Channel.scope_type == scope_type)
    if status:
        query = query.where(Channel.status == status)
    channels = db.exec(query).all()
    smap = _supplier_map(db, list({c.supplier_id for c in channels}))
    return [_to_out(c, smap.get(c.supplier_id)) for c in channels]


@router.get("/summary/all", response_model=list[ChannelSummary])
def get_channels_summary(
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:read")),
):
    channels = db.exec(select(Channel).order_by(Channel.supplier_id)).all()
    smap = _supplier_map(db, list({c.supplier_id for c in channels}))
    result = []
    for c in channels:
        sup = smap.get(c.supplier_id)
        cs = compute_channel_status(
            c.status,
            sup.contract_start if sup else None,
            sup.contract_end if sup else None,
        )
        result.append(ChannelSummary(
            channel_id=c.id, supplier_id=c.supplier_id,
            supplier_name=sup.name if sup else "未知",
            name=c.name, api_protocol=c.api_protocol,
            status=c.status, computed_status=cs,
            cost_discount=c.cost_discount, markup=c.markup, scope_type=c.scope_type,
            model_family=c.model_family,
            inventory_available=c.inventory_available,
            active_projects=c.active_projects, monthly_cost=c.monthly_cost,
        ))
    return result


@router.get("/{channel_id}", response_model=ChannelOut)
def get_channel(
    channel_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:read")),
):
    c = db.get(Channel, channel_id)
    if not c:
        raise HTTPException(404, "通道不存在")
    sup = db.get(Supplier, c.supplier_id)
    return _to_out(c, sup)


@router.post("", response_model=ChannelOut)
def create_channel(
    body: ChannelCreate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    sup = db.get(Supplier, body.supplier_id)
    if not sup:
        raise HTTPException(400, "供应商不存在")
    obj = Channel(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _to_out(obj, sup)


@router.put("/{channel_id}", response_model=ChannelOut)
def update_channel(
    channel_id: int,
    body: ChannelUpdate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    c = db.get(Channel, channel_id)
    if not c:
        raise HTTPException(404, "通道不存在")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.add(c)
    db.commit()
    db.refresh(c)
    sup = db.get(Supplier, c.supplier_id)
    return _to_out(c, sup)



@router.delete("/{channel_id}")
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    c = db.get(Channel, channel_id)
    if not c:
        raise HTTPException(404, "通道不存在")
    linked = db.exec(
        select(func.count()).where(ReconcileSupply.channel_id == channel_id)
    ).one()
    if linked > 0:
        raise HTTPException(400, f"该通道下有 {linked} 条供应对账记录，请先处理后再删除")
    db.delete(c)
    db.commit()
    return {"ok": True}
