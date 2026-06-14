"""通道（Channel）API：供应商下挂载的具体模型通道"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, col, func
from app.database import get_session
from app.models.channel import Channel
from app.models.supplier import Supplier
from app.models.reconcile import ReconcileSupply
from app.schemas.channel import ChannelCreate, ChannelUpdate, ChannelOut, ChannelSummary
from app.auth import require_permission

router = APIRouter(prefix="/api/v1/channels", tags=["通道管理"])


@router.get("", response_model=list[ChannelOut])
def list_channels(
    supplier_id: Optional[int] = None,
    model_type: Optional[str] = None,
    kind: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("project:read")),
):
    """获取通道列表"""
    query = select(Channel).order_by(Channel.supplier_id, col(Channel.id))
    if supplier_id:
        query = query.where(Channel.supplier_id == supplier_id)
    if model_type:
        query = query.where(Channel.model_type == model_type)
    if kind:
        query = query.where(Channel.kind == kind)
    if status:
        query = query.where(Channel.status == status)
    return db.exec(query).all()


@router.get("/summary/all", response_model=list[ChannelSummary])
def get_channels_summary(
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("project:read")),
):
    """通道汇总（含供应商名称）"""
    channels = db.exec(select(Channel).order_by(Channel.supplier_id)).all()
    result = []
    for c in channels:
        sup = db.get(Supplier, c.supplier_id)
        result.append(ChannelSummary(
            channel_id=c.id,
            supplier_id=c.supplier_id,
            supplier_name=sup.name if sup else "未知",
            model_type=c.model_type,
            name=c.name,
            kind=c.kind,
            status=c.status,
            cost_price=c.cost_price,
            price_unit=c.price_unit,
            discount_rate=c.discount_rate,
            inventory_available=c.inventory_available,
            active_projects=c.active_projects,
            monthly_cost=c.monthly_cost,
        ))
    return result


@router.get("/{channel_id}", response_model=ChannelOut)
def get_channel(
    channel_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("project:read")),
):
    channel = db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(404, "通道不存在")
    return channel


@router.post("", response_model=ChannelOut)
def create_channel(
    body: ChannelCreate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("project:edit")),
):
    """新增通道"""
    supplier = db.get(Supplier, body.supplier_id)
    if not supplier:
        raise HTTPException(400, "供应商不存在")
    obj = Channel(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{channel_id}", response_model=ChannelOut)
def update_channel(
    channel_id: int,
    body: ChannelUpdate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("project:edit")),
):
    channel = db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(404, "通道不存在")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(channel, k, v)
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return channel


@router.delete("/{channel_id}")
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("project:edit")),
):
    channel = db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(404, "通道不存在")
    linked_supply = db.exec(
        select(func.count()).where(ReconcileSupply.channel_id == channel_id)
    ).one()
    if linked_supply > 0:
        raise HTTPException(400, f"该通道下有 {linked_supply} 条供应对账记录，请先处理后再删除")
    db.delete(channel)
    db.commit()
    return {"ok": True}
