import os
import uuid
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlmodel import Session, select

from app.database import get_session
from app.models.contract_template import ContractTemplate
from app.models.user import User
from app.auth import require_permission, get_current_user
from app.services.contract_parser import UPLOAD_DIR

router = APIRouter(prefix="/api/v1/contract-templates", tags=["合同模板"])

SIGNED_DIR = os.path.join(os.path.dirname(UPLOAD_DIR), "signed_contracts")
os.makedirs(SIGNED_DIR, exist_ok=True)


@router.get("", response_model=list[dict])
def list_templates(
    include_inactive: bool = False,
    current_user: User = Depends(require_permission("contract:read")),
    db: Session = Depends(get_session),
):
    q = select(ContractTemplate).order_by(ContractTemplate.category, ContractTemplate.name)
    if not include_inactive:
        q = q.where(ContractTemplate.is_active == True)
    templates = db.exec(q).all()
    return [t.model_dump() for t in templates]


@router.post("", status_code=201)
def create_template(
    name: str = Form(...),
    category: str = Form(""),
    description: Optional[str] = Form(None),
    content: str = Form(""),
    current_user: User = Depends(require_permission("contract:create")),
    db: Session = Depends(get_session),
):
    tpl = ContractTemplate(
        name=name,
        category=category,
        description=description,
        content=content,
        created_by=current_user.id,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl.model_dump()


@router.put("/{template_id}")
def update_template(
    template_id: int,
    name: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    content: Optional[str] = Form(None),
    is_active: Optional[bool] = Form(None),
    current_user: User = Depends(require_permission("contract:edit")),
    db: Session = Depends(get_session),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="仅管理员可修改合同模板")
    tpl = db.get(ContractTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    if name is not None:
        tpl.name = name
    if category is not None:
        tpl.category = category
    if description is not None:
        tpl.description = description
    if content is not None:
        tpl.content = content
    if is_active is not None:
        tpl.is_active = is_active
    tpl.updated_at = now()
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl.model_dump()


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    current_user: User = Depends(require_permission("contract:delete")),
    db: Session = Depends(get_session),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="仅管理员可删除合同模板")
    tpl = db.get(ContractTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在")
    db.delete(tpl)
    db.commit()
