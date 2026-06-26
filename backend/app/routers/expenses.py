"""报销申请 (V2)

升级点：
- 写 expense_item 明细到独立表
- 关联申请单走通用 expense_relation（多对多）
- 新增"我方名义 + 优先抵消借款 + 实时统计"逻辑
"""
import json
import logging
import math
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.database import get_session
from app.models.expense_request import ExpenseRequest
from app.models.expense_item import ExpenseItem
from app.models.expense_relation import ExpenseRelation
from app.models.legal_entity import LegalEntity
from app.models.user import User
from app.models.department import Department
from app.models.business_trip_request import BusinessTripRequest
from app.auth import get_current_user, require_permission
from app.schemas.expense import (
    ExpenseCreate, ExpenseUpdate, ExpenseOut,
    ExpenseItemOut, ExpenseRelationOut, ExpenseItemIn, ExpenseRelationIn,
)
from app.routers.logs import write_log
from app.utils.time import now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/expenses", tags=["报销申请"])


# ===== 辅助 =====

def _to_item_out(it: ExpenseItem, db: Session) -> ExpenseItemOut:
    dept_name = None
    if it.department_id:
        d = db.get(Department, it.department_id)
        dept_name = d.name if d else None
    return ExpenseItemOut(
        id=it.id, expense_id=it.expense_id,
        name=it.name, expense_type=it.expense_type,
        department_id=it.department_id, department_name=dept_name,
        city=it.city, expense_date=it.expense_date, amount=it.amount,
        note=it.note, remark=it.remark, attachments=it.attachments,
        sort_order=it.sort_order,
        created_at=it.created_at, updated_at=it.updated_at,
    )


def _to_relation_out(rel: ExpenseRelation, db: Session) -> ExpenseRelationOut:
    title = None
    meta: Optional[dict] = None
    if rel.target_type == "business_trip":
        t = db.get(BusinessTripRequest, rel.target_id)
        if t:
            title = f"#{t.id} {t.title}"
            meta = {
                "destination": t.destination,
                "start_date": t.start_date.isoformat() if t.start_date else None,
                "end_date": t.end_date.isoformat() if t.end_date else None,
                "budget": t.budget,
                "status": t.status,
            }
    elif rel.target_type == "leave":
        from app.models.leave_request import LeaveRequest
        lr = db.get(LeaveRequest, rel.target_id)
        if lr:
            title = f"#{lr.id} {lr.title}"
            meta = {
                "leave_type": lr.leave_type,
                "hours": lr.hours,
                "start_at": lr.start_at.isoformat() if lr.start_at else None,
                "end_at": lr.end_at.isoformat() if lr.end_at else None,
            }
    elif rel.target_type == "purchase":
        from app.models.purchase_request import PurchaseRequest
        pr = db.get(PurchaseRequest, rel.target_id)
        if pr:
            title = f"#{pr.id} {pr.title}"
            meta = {
                "purchase_type": pr.purchase_type,
                "total_amount": pr.total_amount,
                "status": pr.status,
            }
    return ExpenseRelationOut(
        id=rel.id, expense_id=rel.expense_id,
        target_type=rel.target_type, target_id=rel.target_id,
        relation_note=rel.relation_note,
        target_title=title, target_meta=meta,
        created_at=rel.created_at,
    )


def _to_out(e: ExpenseRequest, db: Session) -> ExpenseOut:
    user = db.get(User, e.user_id)
    entity = db.get(LegalEntity, e.invoice_entity_id) if e.invoice_entity_id else None
    items = db.exec(select(ExpenseItem).where(ExpenseItem.expense_id == e.id).order_by(ExpenseItem.sort_order, ExpenseItem.id)).all()
    rels = db.exec(select(ExpenseRelation).where(ExpenseRelation.expense_id == e.id)).all()
    return ExpenseOut(
        id=e.id, user_id=e.user_id, user_name=user.name if user else None,
        title=e.title, expense_type=e.expense_type, amount=e.amount,
        amount_unit=e.amount_unit, currency=e.currency, expense_date=e.expense_date,
        reason=e.reason, attachments=e.attachments, status=e.status,
        paid_at=e.paid_at, paid_by=e.paid_by,
        invoice_entity_id=e.invoice_entity_id,
        invoice_entity_name=entity.name if entity else None,
        priority_offset_loan=e.priority_offset_loan,
        offset_loan_amount=e.offset_loan_amount,
        account_balance=e.account_balance,
        company_should_pay=e.company_should_pay,
        actual_pay_amount=e.actual_pay_amount,
        company_owes_personal=e.company_owes_personal,
        items=[_to_item_out(it, db) for it in items],
        relations=[_to_relation_out(r, db) for r in rels],
        created_at=e.created_at, updated_at=e.updated_at,
    )


def _calc_statistics(e: ExpenseRequest, total_amount: float, offset_loan: float, balance: float) -> None:
    """根据明细总额、借款抵消、账户余额计算底部统计行。"""
    e.amount = round(total_amount, 2)
    company_should_pay = round(max(0, total_amount - offset_loan), 2)
    actual_pay = round(min(company_should_pay, balance), 2)
    company_owes = round(company_should_pay - actual_pay, 2)
    e.offset_loan_amount = round(offset_loan, 2)
    e.account_balance = round(balance, 2)
    e.company_should_pay = company_should_pay
    e.actual_pay_amount = actual_pay
    e.company_owes_personal = company_owes


def _validate_relations(relations: List[ExpenseRelationIn], user_id: int, db: Session) -> None:
    """校验通用关联：必须是当前用户的、对应类型下状态匹配的申请单。"""
    for r in relations:
        if r.target_type == "business_trip":
            t = db.get(BusinessTripRequest, r.target_id)
            if not t:
                raise HTTPException(status_code=400, detail=f"关联的出差申请 #{r.target_id} 不存在")
            if t.user_id != user_id:
                raise HTTPException(status_code=400, detail=f"出差申请 #{r.target_id} 不是您提交的")
            if t.status != "已批准":
                raise HTTPException(status_code=400, detail=f"出差申请 #{r.target_id} 状态为「{t.status}」，仅「已批准」可关联")
        elif r.target_type == "leave":
            from app.models.leave_request import LeaveRequest
            lr = db.get(LeaveRequest, r.target_id)
            if not lr:
                raise HTTPException(status_code=400, detail=f"关联的请假申请 #{r.target_id} 不存在")
            if lr.user_id != user_id:
                raise HTTPException(status_code=400, detail=f"请假申请 #{r.target_id} 不是您提交的")
        elif r.target_type == "purchase":
            from app.models.purchase_request import PurchaseRequest
            pr = db.get(PurchaseRequest, r.target_id)
            if not pr:
                raise HTTPException(status_code=400, detail=f"关联的采购申请 #{r.target_id} 不存在")
            if pr.user_id != user_id:
                raise HTTPException(status_code=400, detail=f"采购申请 #{r.target_id} 不是您提交的")
        else:
            raise HTTPException(status_code=400, detail=f"不支持的关联类型: {r.target_type}")


def _replace_items(db: Session, expense_id: int, items_in: List[ExpenseItemIn]) -> List[ExpenseItem]:
    # 删旧
    old = db.exec(select(ExpenseItem).where(ExpenseItem.expense_id == expense_id)).all()
    for o in old:
        db.delete(o)
    db.flush()
    # 写新
    created: List[ExpenseItem] = []
    for idx, it in enumerate(items_in or []):
        ei = ExpenseItem(
            expense_id=expense_id,
            name=(it.name or "")[:100],
            expense_type=(it.expense_type or "其他")[:50],
            department_id=it.department_id,
            city=(it.city or "")[:50],
            expense_date=it.expense_date,
            amount=float(it.amount or 0),
            note=(it.note or "")[:500],
            remark=(it.remark or "")[:500],
            attachments=it.attachments,
            sort_order=it.sort_order or idx,
        )
        db.add(ei)
        created.append(ei)
    db.flush()
    return created


def _replace_relations(db: Session, expense_id: int, relations_in: List[ExpenseRelationIn]) -> List[ExpenseRelation]:
    old = db.exec(select(ExpenseRelation).where(ExpenseRelation.expense_id == expense_id)).all()
    for o in old:
        db.delete(o)
    db.flush()
    created: List[ExpenseRelation] = []
    for r in relations_in or []:
        er = ExpenseRelation(
            expense_id=expense_id,
            target_type=r.target_type,
            target_id=r.target_id,
            relation_note=(r.relation_note or "")[:200],
        )
        db.add(er)
        created.append(er)
    db.flush()
    return created


# ===== API =====

@router.get("", response_model=list[ExpenseOut])
def list_expenses(
    scope: str = Query("mine", description="mine | all"),
    status: Optional[str] = Query(None),
    expense_type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    from app.auth import get_visible_user_ids
    query = select(ExpenseRequest).order_by(ExpenseRequest.created_at.desc())
    if scope == "mine":
        query = query.where(ExpenseRequest.user_id == current_user.id)
    elif scope == "all":
        visible = get_visible_user_ids(current_user, db, module="expense")
        if visible is not None:
            query = query.where(ExpenseRequest.user_id.in_(visible))
    if status:
        query = query.where(ExpenseRequest.status == status)
    if expense_type:
        query = query.where(ExpenseRequest.expense_type == expense_type)
    rows = db.exec(query).all()
    return [_to_out(r, db) for r in rows]


@router.post("", response_model=ExpenseOut)
def create_expense(
    payload: ExpenseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    # 校验：我方名义
    entity = None
    if payload.invoice_entity_id:
        entity = db.get(LegalEntity, payload.invoice_entity_id)
        if not entity:
            raise HTTPException(status_code=400, detail="所选公司主体不存在")
    # 校验：差旅类型 + 旧 trip_id 兼容
    if payload.expense_type == "差旅" and not payload.relations and not payload.trip_id:
        raise HTTPException(status_code=400, detail="差旅类报销必须关联出差申请单")
    # 校验：通用关联
    if payload.relations:
        _validate_relations(payload.relations, current_user.id, db)
    elif payload.trip_id:  # 旧字段自动包装
        _validate_relations([ExpenseRelationIn(target_type="business_trip", target_id=payload.trip_id)], current_user.id, db)
        relations_in = [ExpenseRelationIn(target_type="business_trip", target_id=payload.trip_id)]
    else:
        relations_in = []
    relations_in = payload.relations or relations_in

    e = ExpenseRequest(
        user_id=current_user.id,
        title=payload.title,
        expense_type=payload.expense_type,
        amount=0,
        amount_unit=payload.amount_unit,
        currency=payload.currency,
        expense_date=payload.expense_date,
        reason=payload.reason,
        attachments=payload.attachments,
        status="草稿",
        invoice_entity_id=payload.invoice_entity_id,
        priority_offset_loan=payload.priority_offset_loan,
    )
    db.add(e)
    db.flush()
    # 写明细
    items_in = payload.items or []
    _replace_items(db, e.id, items_in)
    # 写关联
    _replace_relations(db, e.id, relations_in)
    # 计算总额
    total = sum(float(it.amount or 0) for it in items_in)
    # 抵消借款
    offset = 0
    if payload.priority_offset_loan and e.invoice_entity_id:
        from app.routers.employee_loans import apply_offset
        offset = apply_offset(db, current_user.id, e.invoice_entity_id, total)
    _calc_statistics(e, total, offset, entity.balance if entity else 0)
    # 同步 items JSON（向后兼容）
    e.items = json.dumps([{
        "name": it.name, "expense_type": it.expense_type,
        "amount": it.amount, "note": it.note,
        "city": it.city, "expense_date": it.expense_date.isoformat() if it.expense_date else None,
    } for it in items_in], ensure_ascii=False)
    e.updated_at = now()
    db.add(e)
    db.commit()
    db.refresh(e)
    write_log("info", "expense", f"创建报销 #{e.id} 金额 {e.amount}（操作人：{current_user.name}）", db=db)
    return _to_out(e, db)


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(expense_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="报销申请不存在")
    from app.auth import check_data_access
    if not check_data_access(e.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权查看此报销")
    return _to_out(e, db)


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: int,
    payload: ExpenseUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="报销申请不存在")
    if e.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="无权修改他人报销")
    if e.status not in ("草稿", "已驳回"):
        raise HTTPException(status_code=400, detail=f"当前状态「{e.status}」不可修改")
    data = payload.model_dump(exclude_unset=True, exclude={"items", "relations", "trip_id"})
    for k, v in data.items():
        setattr(e, k, v)
    # 校验新主体
    if "invoice_entity_id" in data and data["invoice_entity_id"]:
        if not db.get(LegalEntity, data["invoice_entity_id"]):
            raise HTTPException(status_code=400, detail="所选公司主体不存在")
    # 重写明细
    if payload.items is not None:
        _replace_items(db, e.id, payload.items)
    # 重写关联
    if payload.relations is not None:
        _validate_relations(payload.relations, current_user.id, db)
        _replace_relations(db, e.id, payload.relations)
    elif payload.trip_id:  # 旧字段包装
        rel_in = [ExpenseRelationIn(target_type="business_trip", target_id=payload.trip_id)]
        _validate_relations(rel_in, current_user.id, db)
        _replace_relations(db, e.id, rel_in)
    # 重算
    items = db.exec(select(ExpenseItem).where(ExpenseItem.expense_id == e.id)).all()
    total = sum(float(it.amount or 0) for it in items)
    entity = db.get(LegalEntity, e.invoice_entity_id) if e.invoice_entity_id else None
    # 先撤销之前已抵消的金额，避免重复抵扣
    from app.routers.employee_loans import apply_offset, revert_offset
    if e.offset_loan_amount and e.offset_loan_amount > 0 and e.invoice_entity_id:
        revert_offset(db, e.user_id, e.invoice_entity_id, e.offset_loan_amount)
    offset = 0
    if e.priority_offset_loan and e.invoice_entity_id:
        offset = apply_offset(db, e.user_id, e.invoice_entity_id, total)
    _calc_statistics(e, total, offset, entity.balance if entity else 0)
    e.items = json.dumps([{
        "name": it.name, "expense_type": it.expense_type,
        "amount": it.amount, "note": it.note,
        "city": it.city, "expense_date": it.expense_date.isoformat() if it.expense_date else None,
    } for it in items], ensure_ascii=False)
    e.updated_at = now()
    db.add(e)
    db.commit()
    db.refresh(e)
    return _to_out(e, db)


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="报销申请不存在")
    if e.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="无权删除他人报销")
    if e.status not in ("草稿", "已驳回", "已撤回"):
        raise HTTPException(status_code=400, detail=f"当前状态「{e.status}」不可删除")
    # 撤销已抵消的借款
    if e.offset_loan_amount and e.offset_loan_amount > 0 and e.invoice_entity_id:
        from app.routers.employee_loans import revert_offset
        revert_offset(db, e.user_id, e.invoice_entity_id, e.offset_loan_amount)
    db.delete(e)
    db.commit()
    write_log("warning", "expense", f"删除报销 #{expense_id}（操作人：{current_user.name}）", db=db)
    return {"message": "ok"}


@router.post("/{expense_id}/submit", response_model=ExpenseOut)
def submit_expense(
    expense_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """提交报销：触发统一审批引擎（business_type=expense）"""
    e = db.get(ExpenseRequest, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="报销申请不存在")
    if e.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权提交他人报销")
    if e.status not in ("草稿", "已驳回"):
        raise HTTPException(status_code=400, detail=f"当前状态「{e.status}」不可提交")
    # 提交前校验明细
    items = db.exec(select(ExpenseItem).where(ExpenseItem.expense_id == e.id)).all()
    if not items:
        raise HTTPException(status_code=400, detail="报销明细不能为空")
    if e.expense_type == "差旅":
        rels = db.exec(select(ExpenseRelation).where(ExpenseRelation.expense_id == e.id)).all()
        if not rels:
            raise HTTPException(status_code=400, detail="差旅类报销必须关联出差申请单")
    e.status = "审批中"
    e.updated_at = now()
    db.add(e)
    db.commit()
    # 触发审批流
    try:
        from app.services import approval_engine
        approval_engine.start_approval(
            "expense", e.id, e, f"报销《{e.title}》", current_user, db,
        )
    except ValueError as ex:
        logger.warning("触发审批流失败: %s", ex)
    db.refresh(e)
    return _to_out(e, db)


@router.get("/relations/candidates", response_model=list[dict])
def relation_candidates(
    target_type: str = Query(..., description="business_trip / leave / purchase"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """供报销表单的关联抽屉使用：返回当前用户已批准/可关联的申请单。"""
    if target_type == "business_trip":
        rows = db.exec(
            select(BusinessTripRequest).where(
                BusinessTripRequest.user_id == current_user.id,
                BusinessTripRequest.status.in_(["已批准"]),
            ).order_by(BusinessTripRequest.start_date.desc())
        ).all()
        return [{
            "id": r.id, "title": f"#{r.id} {r.title}",
            "destination": r.destination,
            "start_date": r.start_date.isoformat() if r.start_date else None,
            "end_date": r.end_date.isoformat() if r.end_date else None,
            "budget": r.budget, "status": r.status,
        } for r in rows]
    if target_type == "leave":
        from app.models.leave_request import LeaveRequest
        rows = db.exec(
            select(LeaveRequest).where(
                LeaveRequest.user_id == current_user.id,
                LeaveRequest.status.in_(["已批准"]),
            ).order_by(LeaveRequest.start_at.desc())
        ).all()
        return [{
            "id": r.id, "title": f"#{r.id} {r.title}",
            "leave_type": r.leave_type, "hours": r.hours,
            "start_at": r.start_at.isoformat() if r.start_at else None,
            "end_at": r.end_at.isoformat() if r.end_at else None,
        } for r in rows]
    if target_type == "purchase":
        from app.models.purchase_request import PurchaseRequest
        rows = db.exec(
            select(PurchaseRequest).where(
                PurchaseRequest.user_id == current_user.id,
                PurchaseRequest.status.in_(["已采购", "已入库"]),
            ).order_by(PurchaseRequest.created_at.desc())
        ).all()
        return [{
            "id": r.id, "title": f"#{r.id} {r.title}",
            "purchase_type": r.purchase_type, "total_amount": r.total_amount,
            "status": r.status,
        } for r in rows]
    raise HTTPException(status_code=400, detail="不支持的关联类型")
