"""采购供应商管理：用于采购申请的供应商/服务商维护。

与上游管理（MaaS 模型供应商）完全独立。查看需 purchase_supplier:read，
增删改需 purchase_supplier:manage（管理员默认拥有）。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.purchase_supplier import PurchaseSupplier
from app.models.user import User
from app.auth import get_current_user, require_permission
from app.schemas.purchase_supplier import PurchaseSupplierCreate, PurchaseSupplierUpdate, PurchaseSupplierOut
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/purchase-suppliers", tags=["采购供应商"])


def _to_out(s: PurchaseSupplier) -> PurchaseSupplierOut:
    return PurchaseSupplierOut(
        id=s.id, name=s.name, short_name=s.short_name, category=s.category, status=s.status,
        contact_person=s.contact_person, contact_phone=s.contact_phone, contact_email=s.contact_email,
        address=s.address, bank_name=s.bank_name, bank_account=s.bank_account, tax_no=s.tax_no,
        invoice_title=s.invoice_title, remarks=s.remarks,
        created_at=s.created_at, updated_at=s.updated_at,
    )


@router.get("", response_model=list[PurchaseSupplierOut])
def list_suppliers(
    keyword: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(PurchaseSupplier).order_by(PurchaseSupplier.created_at.desc())
    if category:
        query = query.where(PurchaseSupplier.category == category)
    if status:
        query = query.where(PurchaseSupplier.status == status)
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.name or "").lower()
                or kw in (r.short_name or "").lower()
                or kw in (r.contact_person or "").lower()]
    return [_to_out(r) for r in rows]


@router.get("/{supplier_id}", response_model=PurchaseSupplierOut)
def get_supplier(supplier_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    s = db.get(PurchaseSupplier, supplier_id)
    if not s:
        raise HTTPException(404, "采购供应商不存在")
    return _to_out(s)


@router.post("", response_model=PurchaseSupplierOut)
def create_supplier(
    body: PurchaseSupplierCreate,
    current_user: User = Depends(require_permission("purchase_supplier:manage")),
    db: Session = Depends(get_session),
):
    if not body.name.strip():
        raise HTTPException(400, "请填写供应商名称")
    s = PurchaseSupplier(
        name=body.name.strip(),
        short_name=body.short_name,
        category=body.category or "其他",
        status=body.status or "合作中",
        contact_person=body.contact_person,
        contact_phone=body.contact_phone,
        contact_email=body.contact_email,
        address=body.address,
        bank_name=body.bank_name,
        bank_account=body.bank_account,
        tax_no=body.tax_no,
        invoice_title=body.invoice_title or body.name.strip(),
        remarks=body.remarks,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    write_log("info", "purchase_supplier", f"用户 {current_user.username} 新建采购供应商 #{s.id}（{s.name}）", db=db)
    return _to_out(s)


@router.put("/{supplier_id}", response_model=PurchaseSupplierOut)
def update_supplier(
    supplier_id: int,
    body: PurchaseSupplierUpdate,
    current_user: User = Depends(require_permission("purchase_supplier:manage")),
    db: Session = Depends(get_session),
):
    s = db.get(PurchaseSupplier, supplier_id)
    if not s:
        raise HTTPException(404, "采购供应商不存在")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    s.updated_at = now()
    db.add(s)
    db.commit()
    db.refresh(s)
    return _to_out(s)


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    current_user: User = Depends(require_permission("purchase_supplier:manage")),
    db: Session = Depends(get_session),
):
    s = db.get(PurchaseSupplier, supplier_id)
    if not s:
        raise HTTPException(404, "采购供应商不存在")
    db.delete(s)
    db.commit()
    write_log("info", "purchase_supplier", f"采购供应商 #{supplier_id}（{s.name}）已删除", db=db)
    return {"ok": True}
