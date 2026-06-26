"""公司主体（Legal Entity）管理。

普通用户可读，管理员可写。供报销单据选择"发票的我方名义"。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.legal_entity import LegalEntity
from app.models.user import User
from app.auth import get_current_user, require_permission
from app.schemas.legal_entity import LegalEntityCreate, LegalEntityUpdate, LegalEntityOut
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/legal-entities", tags=["公司主体"])


def _to_out(e: LegalEntity) -> LegalEntityOut:
    return LegalEntityOut(
        id=e.id, name=e.name, short_name=e.short_name, tax_id=e.tax_id,
        balance=e.balance, is_default=e.is_default, is_active=e.is_active,
        sort_order=e.sort_order, created_at=e.created_at, updated_at=e.updated_at,
    )


@router.get("", response_model=list[LegalEntityOut])
def list_entities(
    keyword: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """所有登录用户可读（含未激活的可通过参数过滤）"""
    query = select(LegalEntity).order_by(LegalEntity.sort_order, LegalEntity.id)
    if not include_inactive:
        query = query.where(LegalEntity.is_active == True)  # noqa: E712
    rows = db.exec(query).all()
    if keyword:
        kw = keyword.strip().lower()
        rows = [r for r in rows if kw in (r.name or "").lower() or kw in (r.short_name or "").lower()]
    return [_to_out(r) for r in rows]


@router.get("/{entity_id}", response_model=LegalEntityOut)
def get_entity(entity_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    e = db.get(LegalEntity, entity_id)
    if not e:
        raise HTTPException(status_code=404, detail="公司主体不存在")
    return _to_out(e)


@router.post("", response_model=LegalEntityOut)
def create_entity(
    payload: LegalEntityCreate,
    current_user: User = Depends(require_permission("expense:view_all")),  # 报销/财务相关权限即可
    db: Session = Depends(get_session),
):
    e = LegalEntity(
        name=payload.name.strip(),
        short_name=payload.short_name.strip(),
        tax_id=(payload.tax_id or "").strip() or None,
        balance=payload.balance,
        is_default=payload.is_default,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    if e.is_default:
        # 取消其他默认
        for ex in db.exec(select(LegalEntity).where(LegalEntity.is_default == True)).all():  # noqa: E712
            ex.is_default = False
            db.add(ex)
    db.add(e)
    db.commit()
    db.refresh(e)
    write_log("info", "expense", f"新增公司主体 {e.name}（操作人：{current_user.name}）", db=db)
    return _to_out(e)


@router.put("/{entity_id}", response_model=LegalEntityOut)
def update_entity(
    entity_id: int,
    payload: LegalEntityUpdate,
    current_user: User = Depends(require_permission("expense:view_all")),
    db: Session = Depends(get_session),
):
    e = db.get(LegalEntity, entity_id)
    if not e:
        raise HTTPException(status_code=404, detail="公司主体不存在")
    for k, v in payload.model_dump(exclude_unset=True).items():
        if k == "name" and v:
            v = v.strip()
        if k == "short_name" and v:
            v = v.strip()
        setattr(e, k, v)
    if e.is_default:
        for ex in db.exec(
            select(LegalEntity).where(LegalEntity.is_default == True, LegalEntity.id != e.id)  # noqa: E712
        ).all():
            ex.is_default = False
            db.add(ex)
    e.updated_at = now()
    db.add(e)
    db.commit()
    db.refresh(e)
    write_log("info", "expense", f"更新公司主体 {e.name}（操作人：{current_user.name}）", db=db)
    return _to_out(e)


@router.delete("/{entity_id}")
def delete_entity(
    entity_id: int,
    current_user: User = Depends(require_permission("expense:view_all")),
    db: Session = Depends(get_session),
):
    e = db.get(LegalEntity, entity_id)
    if not e:
        raise HTTPException(status_code=404, detail="公司主体不存在")
    # 检查是否被引用
    from app.models.expense_request import ExpenseRequest
    from sqlmodel import text as _text
    in_use = db.exec(
        select(ExpenseRequest).where(ExpenseRequest.invoice_entity_id == entity_id)
    ).first()
    if in_use:
        raise HTTPException(status_code=400, detail="该主体已被报销单引用，请改用停用")
    name = e.name
    db.delete(e)
    db.commit()
    write_log("warning", "expense", f"删除公司主体 {name}（操作人：{current_user.name}）", db=db)
    return {"message": "ok"}
