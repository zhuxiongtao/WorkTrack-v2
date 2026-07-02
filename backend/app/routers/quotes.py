"""报价单支持接口：每用户公司/平台信息 + 报价单 CRUD + 过期清理"""
import json
import uuid
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Body, HTTPException
from sqlmodel import Session, select, col
from app.database import get_session
from app.models.system_preference import SystemPreference
from app.models.channel import Channel, compute_channel_status
from app.models.supplier import Supplier
from app.models.model_catalog import ModelCatalog
from app.models.quote_record import QuoteRecord
from app.auth import require_permission, get_current_user
from app.models.user import User
from app.utils.time import now

router = APIRouter(prefix="/api/v1/quotes", tags=["报价单"])

QUOTE_PREF_KEYS = [
    "quote_company_name", "quote_company_phone", "quote_company_email",
    "quote_company_website", "quote_company_address",
    "quote_platform_name", "quote_platform_intro",
    "quote_value_added_services", "quote_sla_terms",
    "quote_disclaimer", "quote_payment_terms",
]

QUOTE_STORAGE_DAYS = 90  # 报价单默认保存 90 天后自动清理


# ---------- 每用户公司 / 平台信息 ----------

def _get(db: Session, key: str, user_id: int, default: str = "") -> str:
    row = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == key,
            SystemPreference.user_id == user_id,
        )
    ).first()
    return row.value if row else default


def _set(db: Session, key: str, value: str, user_id: int) -> None:
    row = db.exec(
        select(SystemPreference).where(
            SystemPreference.key == key,
            SystemPreference.user_id == user_id,
        )
    ).first()
    if row:
        row.value = value
        db.add(row)
    else:
        db.add(SystemPreference(key=key, value=value, user_id=user_id))
    db.commit()


@router.get("/company-info")
def get_quote_company_info(
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return {k.removeprefix("quote_"): _get(db, k, current_user.id) for k in QUOTE_PREF_KEYS}


@router.put("/company-info")
def update_quote_company_info(
    body: dict = Body(...),
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("quote:view")),
):
    mapping = {k.removeprefix("quote_"): k for k in QUOTE_PREF_KEYS}
    for short_key, pref_key in mapping.items():
        if short_key in body:
            _set(db, pref_key, str(body[short_key] or ""), current_user.id)
    return {"ok": True}


# ---------- 报价选项数据 ----------

@router.get("/options")
def get_quote_options(
    db: Session = Depends(get_session),
    _=Depends(require_permission("quote:view")),
):
    channels_raw = db.exec(select(Channel).order_by(Channel.supplier_id, col(Channel.id))).all()
    supplier_ids = list({c.supplier_id for c in channels_raw})
    smap: dict[int, Supplier] = {}
    if supplier_ids:
        for s in db.exec(select(Supplier).where(col(Supplier.id).in_(supplier_ids))).all():
            smap[s.id] = s

    channels_out = []
    for c in channels_raw:
        sup = smap.get(c.supplier_id)
        cs = compute_channel_status(
            c.status,
            sup.contract_start if sup else None,
            sup.contract_end if sup else None,
        )
        sla = {}
        if c.sla_json:
            try:
                sla = json.loads(c.sla_json)
            except Exception:
                pass
        channels_out.append({
            "id": c.id, "name": c.name, "code": c.code,
            "supplier_id": c.supplier_id,
            "supplier_name": sup.name if sup else "未知",
            "api_protocol": c.api_protocol,
            "status": c.status, "computed_status": cs,
            "cost_discount": c.cost_discount, "markup": c.markup,
            "scope_type": c.scope_type,
            "model_family": c.model_family, "model_id": c.model_id,
            "sla": sla,
        })

    models_raw = db.exec(
        select(ModelCatalog)
        .where(ModelCatalog.is_active == True)  # noqa: E712
        .order_by(ModelCatalog.provider, ModelCatalog.name)
    ).all()
    models_out = [
        {
            "id": m.id, "name": m.name, "version_id": m.version_id,
            "provider": m.provider, "modality": m.modality,
            "input_price": m.input_price, "output_price": m.output_price,
            "cache_read_price": m.cache_read_price, "cache_write_price": m.cache_write_price,
            "price_currency": m.price_currency,
        }
        for m in models_raw
    ]
    return {"channels": channels_out, "models": models_out}


# ---------- 报价单 CRUD ----------

def _cleanup_expired(db: Session) -> None:
    """惰性清理：删除已过期的报价单"""
    expired = db.exec(
        select(QuoteRecord).where(QuoteRecord.expires_at < now())
    ).all()
    for q in expired:
        db.delete(q)
    if expired:
        db.commit()


@router.get("/")
def list_my_quotes(
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("quote:view")),
):
    _cleanup_expired(db)
    records = db.exec(
        select(QuoteRecord)
        .where(QuoteRecord.user_id == current_user.id)
        .order_by(QuoteRecord.created_at.desc())  # type: ignore[arg-type]
    ).all()
    return [_record_out(r) for r in records]


def _record_out(r) -> dict:
    return {
        "id": r.id,
        "title": r.title,
        "customer_name": r.customer_name,
        "valid_days": r.valid_days,
        "notes": r.notes,
        "items_json": r.items_json,
        "share_token": r.share_token,
        "quote_number": r.quote_number,
        "contact_name": r.contact_name,
        "app_scenario": r.app_scenario,
        "special_requirements": r.special_requirements,
        "settlement_method": r.settlement_method,
        "expires_at": r.expires_at.isoformat(),
        "created_at": r.created_at.isoformat(),
        "updated_at": r.updated_at.isoformat(),
    }


@router.post("/")
def save_quote(
    body: dict = Body(...),
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("quote:create")),
):
    _cleanup_expired(db)
    now_dt = now()
    record = QuoteRecord(
        user_id=current_user.id,
        title=body.get("title") or None,
        customer_name=body.get("customer_name") or None,
        valid_days=int(body.get("valid_days") or 30),
        notes=body.get("notes") or None,
        items_json=json.dumps(body.get("items", []), ensure_ascii=False),
        share_token=str(uuid.uuid4()),
        quote_number=body.get("quote_number") or None,
        contact_name=body.get("contact_name") or None,
        app_scenario=body.get("app_scenario") or None,
        special_requirements=body.get("special_requirements") or None,
        settlement_method=body.get("settlement_method") or None,
        expires_at=now_dt + timedelta(days=QUOTE_STORAGE_DAYS),
        created_at=now_dt,
        updated_at=now_dt,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    # 如未手动指定编号，按全局 ID 自动生成
    if not record.quote_number:
        record.quote_number = f"TJ-MaaS-{record.id:05d}"
        db.add(record)
        db.commit()
    return {"id": record.id, "share_token": record.share_token, "quote_number": record.quote_number, "ok": True}


@router.put("/{quote_id}")
def update_quote(
    quote_id: int,
    body: dict = Body(...),
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("quote:create")),
):
    record = db.get(QuoteRecord, quote_id)
    if not record or record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="报价单不存在")
    record.title = body.get("title") or record.title
    record.customer_name = body.get("customer_name") or record.customer_name
    record.valid_days = int(body.get("valid_days") or record.valid_days)
    record.notes = body.get("notes") if "notes" in body else record.notes
    if "items" in body:
        record.items_json = json.dumps(body["items"], ensure_ascii=False)
    if "quote_number" in body:
        record.quote_number = body.get("quote_number") or record.quote_number
    if "contact_name" in body:
        record.contact_name = body.get("contact_name") or None
    if "app_scenario" in body:
        record.app_scenario = body.get("app_scenario") or None
    if "special_requirements" in body:
        record.special_requirements = body.get("special_requirements") or None
    if "settlement_method" in body:
        record.settlement_method = body.get("settlement_method") or None
    if not record.share_token:
        record.share_token = str(uuid.uuid4())
    record.updated_at = now()
    db.add(record)
    db.commit()
    return {"ok": True, "share_token": record.share_token}


@router.get("/public/{token}")
def get_public_quote(token: str, db: Session = Depends(get_session)):
    """无需登录的公开报价单查看接口"""
    record = db.exec(
        select(QuoteRecord).where(QuoteRecord.share_token == token)
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="报价单不存在或链接已失效")
    if record.expires_at < now():
        raise HTTPException(status_code=410, detail="报价单已过期")
    out = _record_out(record)
    for k in QUOTE_PREF_KEYS:
        out[k.removeprefix("quote_")] = _get(db, k, record.user_id)
    return out


@router.delete("/{quote_id}")
def delete_quote(
    quote_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(require_permission("quote:view")),
):
    record = db.get(QuoteRecord, quote_id)
    if not record or record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="报价单不存在")
    db.delete(record)
    db.commit()
    return {"ok": True}
