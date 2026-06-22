"""供应商管理 API：MaaS 平台模型供应商 CRUD + 汇总统计 + 关联查询"""
from collections import defaultdict
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func, col
from app.database import get_session
from app.models.supplier import Supplier
from app.models.channel import Channel
from app.models.project_cost import ProjectCost
from app.models.project import Project
from app.schemas.supplier import SupplierCreate, SupplierUpdate, SupplierOut, SupplierSummary
from app.auth import require_permission

router = APIRouter(prefix="/api/v1/suppliers", tags=["供应商管理"])


# ──── 汇总统计（路径固定，必须放在 /{supplier_id} 之前以避免被拦截） ────

@router.get("/summary/all", response_model=list[SupplierSummary])
def get_suppliers_summary(
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:read")),
):
    """获取所有供应商的汇总统计（成本、项目数、模型列表）"""
    suppliers = db.exec(select(Supplier).order_by(col(Supplier.id))).all()
    result = []
    for s in suppliers:
        cost_total = db.exec(
            select(func.coalesce(func.sum(ProjectCost.amount), 0)).where(ProjectCost.supplier_id == s.id)
        ).one()
        project_ids = db.exec(
            select(ProjectCost.project_id).where(ProjectCost.supplier_id == s.id).distinct()
        ).all()
        result.append(SupplierSummary(
            supplier_id=s.id,
            supplier_name=s.name,
            supplier_code=s.code,
            category=s.category,
            status=s.status,
            settlement_currency=s.settlement_currency,
            total_cost=round(cost_total, 2),
            project_count=len(project_ids),
            models=s.models_provided.split(",") if s.models_provided else [],
        ))
    return result


# ──── CRUD ────

@router.get("", response_model=list[SupplierOut])
def list_suppliers(
    status: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:read")),
):
    """获取供应商列表，可按状态/类别筛选"""
    query = select(Supplier).order_by(col(Supplier.id))
    if status:
        query = query.where(Supplier.status == status)
    if category:
        query = query.where(Supplier.category == category)
    return db.exec(query).all()


@router.post("", response_model=SupplierOut)
def create_supplier(
    body: SupplierCreate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    """新增供应商，自动发起新增审批流（无模板则直接生效）"""
    from app.services import approval_engine
    existing = db.exec(select(Supplier).where(Supplier.name == body.name)).first()
    if existing:
        raise HTTPException(400, f"供应商 '{body.name}' 已存在")
    data = body.model_dump()
    data['status'] = '待审批'
    obj = Supplier(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    try:
        inst = approval_engine.start_approval(
            "supplier", obj.id, obj,
            f"供应商《{obj.name}》新增审批", current_user, db,
        )
        if inst is None:
            obj.status = "合作中"
            db.add(obj)
            db.commit()
    except Exception:
        obj.status = "合作中"
        db.add(obj)
        db.commit()
    db.refresh(obj)
    return obj


@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:read")),
):
    supplier = db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(404, "供应商不存在")
    return supplier


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    """更新供应商信息"""
    supplier = db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(404, "供应商不存在")
    data = body.model_dump(exclude_unset=True)
    # 如果改了 name，检查唯一性
    if "name" in data and data["name"] != supplier.name:
        dup = db.exec(select(Supplier).where(Supplier.name == data["name"])).first()
        if dup:
            raise HTTPException(400, f"供应商 '{data['name']}' 已存在")
    for k, v in data.items():
        setattr(supplier, k, v)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    """删除供应商（需先解除关联的成本条目与通道）"""
    supplier = db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(404, "供应商不存在")
    # 检查是否有关联成本条目
    linked_cost = db.exec(
        select(func.count()).where(ProjectCost.supplier_id == supplier_id)
    ).one()
    if linked_cost > 0:
        raise HTTPException(400, f"该供应商下有 {linked_cost} 条成本记录，请先解除关联后再删除")
    # 检查是否有关联通道
    linked_channel = db.exec(
        select(func.count()).where(Channel.supplier_id == supplier_id)
    ).one()
    if linked_channel > 0:
        raise HTTPException(400, f"该供应商下有 {linked_channel} 个通道，请先删除或调整后再删除供应商")
    db.delete(supplier)
    db.commit()
    return {"ok": True}


# ──── 关联查询 ────

@router.get("/{supplier_id}/projects")
def get_supplier_projects(
    supplier_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:read")),
):
    """获取供应商关联的项目列表及成本明细"""
    supplier = db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(404, "供应商不存在")

    # 查找该供应商关联的成本条目
    cost_items = db.exec(
        select(ProjectCost).where(ProjectCost.supplier_id == supplier_id).order_by(ProjectCost.cost_month)
    ).all()

    # 按项目分组
    project_cost_map: dict[int, list] = defaultdict(list)
    for item in cost_items:
        project_cost_map[item.project_id].append(item)

    # 构建项目列表
    projects_data = []
    for pid, items in project_cost_map.items():
        project = db.get(Project, pid)
        if not project:
            continue
        total_cost = sum(i.amount for i in items)
        # 计算该项目毛利率
        deal = project.deal_amount or 0
        gross_profit = (deal - total_cost) if deal else None
        gross_margin = round((1 - total_cost / deal) * 100, 2) if deal > 0 else None
        projects_data.append({
            "project_id": pid,
            "project_name": project.name,
            "customer_name": project.customer_name,
            "currency": project.currency,
            "deal_amount": project.deal_amount,
            "status": project.status,
            "sales_person": project.sales_person,
            "total_cost": round(total_cost, 2),
            "gross_profit": round(gross_profit, 2) if gross_profit is not None else None,
            "gross_margin": gross_margin,
            "cost_count": len(items),
            "cost_items": [
                {
                    "id": i.id,
                    "category": i.category,
                    "description": i.description,
                    "amount": i.amount,
                    "cost_month": i.cost_month,
                    "remarks": i.remarks,
                }
                for i in items
            ],
        })

    # 按毛利率升序（低毛利排前，提醒关注）
    projects_data.sort(key=lambda x: (x["gross_margin"] if x["gross_margin"] is not None else 999, -x["total_cost"]))

    return {
        "supplier": {
            "id": supplier.id,
            "name": supplier.name,
            "code": supplier.code,
            "category": supplier.category,
            "status": supplier.status,
            "settlement_currency": supplier.settlement_currency,
        },
        "projects": projects_data,
        "total_cost": round(sum(i.amount for i in cost_items), 2),
        "total_projects": len(projects_data),
    }


@router.post("/{supplier_id}/sync-stats")
def sync_supplier_stats(
    supplier_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    """手动同步供应商的业务统计数据（累计成本、项目数）"""
    supplier = db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(404, "供应商不存在")

    cost_total = db.exec(
        select(func.coalesce(func.sum(ProjectCost.amount), 0)).where(ProjectCost.supplier_id == supplier_id)
    ).one()
    project_ids = db.exec(
        select(ProjectCost.project_id).where(ProjectCost.supplier_id == supplier_id).distinct()
    ).all()

    supplier.total_cost = round(cost_total, 2)
    supplier.project_count = len(project_ids)
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return {"ok": True, "total_cost": supplier.total_cost, "project_count": supplier.project_count}


@router.post("/{supplier_id}/submit-approval")
def submit_supplier_approval(
    supplier_id: int,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("upstream:edit")),
):
    """为供应商手动发起新增审批"""
    from app.services import approval_engine
    supplier = db.get(Supplier, supplier_id)
    if not supplier:
        raise HTTPException(404, "供应商不存在")
    if approval_engine.get_active_instance("supplier", supplier_id, db):
        raise HTTPException(400, "该供应商已有进行中的审批")
    try:
        inst = approval_engine.start_approval(
            "supplier", supplier_id, supplier,
            f"供应商《{supplier.name}》新增审批", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if inst is None:
        supplier.status = "合作中"
        db.add(supplier)
        db.commit()
        return {"approval_id": None, "status": "合作中", "message": "无需审批，已直接生效"}
    if inst.status == "pending":
        supplier.status = "待审批"
        db.add(supplier)
        db.commit()
    return {"approval_id": inst.id, "status": supplier.status, "message": "已提交审批"}
