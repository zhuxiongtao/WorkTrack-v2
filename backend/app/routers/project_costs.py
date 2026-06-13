"""项目成本利润管理 API"""
from collections import defaultdict
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from app.database import get_session
from app.models.project import Project
from app.models.project_cost import ProjectCost
from app.schemas.project_cost import (
    CostItemCreate, CostItemUpdate, CostItemOut,
    ProjectProfitSummary, OverallProfitSummary,
    CategoryCostItem, MonthlyCostItem, SalesProfitItem,
)
from app.auth import require_permission, check_data_access, get_visible_user_ids

router = APIRouter(prefix="/api/v1/project-costs", tags=["项目成本利润"])


# ──── 成本明细 CRUD ────

@router.post("", response_model=CostItemOut)
def create_cost_item(body: CostItemCreate, db: Session = Depends(get_session), current_user=Depends(require_permission("project:edit"))):
    """新增一条成本明细"""
    project = db.get(Project, body.project_id)
    if not project:
        raise HTTPException(404, "项目不存在")
    if not check_data_access(project.user_id, current_user, db):
        raise HTTPException(403, "无权操作该项目")
    item = ProjectCost(
        project_id=body.project_id,
        user_id=current_user.id,
        category=body.category,
        supplier_id=body.supplier_id,
        description=body.description,
        amount=body.amount,
        cost_month=body.cost_month,
        remarks=body.remarks,
    )
    db.add(item)
    _sync_project_cost(db, body.project_id)
    db.commit()
    db.refresh(item)
    return item


@router.get("/project/{project_id}", response_model=ProjectProfitSummary)
def get_project_profit(project_id: int, db: Session = Depends(get_session), current_user=Depends(require_permission("project:read"))):
    """获取单个项目的成本利润汇总"""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "项目不存在")
    if not check_data_access(project.user_id, current_user, db):
        raise HTTPException(403, "无权查看该项目")
    return _build_project_summary(db, project)


@router.get("/items/{item_id}", response_model=CostItemOut)
def get_cost_item(item_id: int, db: Session = Depends(get_session), current_user=Depends(require_permission("project:read"))):
    item = db.get(ProjectCost, item_id)
    if not item:
        raise HTTPException(404, "成本条目不存在")
    return item


@router.put("/items/{item_id}", response_model=CostItemOut)
def update_cost_item(item_id: int, body: CostItemUpdate, db: Session = Depends(get_session), current_user=Depends(require_permission("project:edit"))):
    item = db.get(ProjectCost, item_id)
    if not item:
        raise HTTPException(404, "成本条目不存在")
    project = db.get(Project, item.project_id)
    if project and not check_data_access(project.user_id, current_user, db):
        raise HTTPException(403, "无权操作")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.add(item)
    _sync_project_cost(db, item.project_id)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}")
def delete_cost_item(item_id: int, db: Session = Depends(get_session), current_user=Depends(require_permission("project:edit"))):
    item = db.get(ProjectCost, item_id)
    if not item:
        raise HTTPException(404, "成本条目不存在")
    project = db.get(Project, item.project_id)
    if project and not check_data_access(project.user_id, current_user, db):
        raise HTTPException(403, "无权操作")
    pid = item.project_id
    db.delete(item)
    _sync_project_cost(db, pid)
    db.commit()
    return {"ok": True}


# ──── 整体统计 ────

@router.get("/overview", response_model=OverallProfitSummary)
def get_overall_profit(
    user_id: Optional[int] = None,
    db: Session = Depends(get_session),
    current_user=Depends(require_permission("project:read")),
):
    """获取整体成本利润汇总"""
    query = select(Project)
    if user_id:
        if not check_data_access(user_id, current_user, db):
            raise HTTPException(403, "无权查看")
        query = query.where(Project.user_id == user_id)
    else:
        uids = get_visible_user_ids(current_user, db)
        query = query.where(Project.user_id.in_(uids))

    projects = db.exec(query).all()
    summaries = [_build_project_summary(db, p) for p in projects if p.deal_amount]

    # ── 基础汇总 ──
    by_currency: dict[str, dict] = {}
    total_deal = 0.0
    total_cost = 0.0
    for s in summaries:
        c = s.currency
        if c not in by_currency:
            by_currency[c] = {"deal": 0.0, "cost": 0.0, "profit": 0.0}
        by_currency[c]["deal"] += s.deal_amount or 0
        by_currency[c]["cost"] += s.total_cost
        by_currency[c]["profit"] += s.gross_profit or 0
        if c == "CNY":
            total_deal += s.deal_amount or 0
            total_cost += s.total_cost

    for c in by_currency:
        d = by_currency[c]
        d["margin"] = round((1 - d["cost"] / d["deal"]) * 100, 1) if d["deal"] > 0 else None

    total_profit = total_deal - total_cost
    overall_margin = round((1 - total_cost / total_deal) * 100, 1) if total_deal > 0 else None

    # ── 按类别汇总 ──
    all_items = db.exec(
        select(ProjectCost).where(ProjectCost.project_id.in_([p.id for p in projects]))
    ).all()
    cat_map: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    for item in all_items:
        cat_map[item.category]["amount"] += item.amount
        cat_map[item.category]["count"] += 1
    by_category = [CategoryCostItem(category=k, amount=round(v["amount"], 2), count=v["count"]) for k, v in sorted(cat_map.items(), key=lambda x: x[1]["amount"], reverse=True)]

    # ── 按月份汇总 ──
    month_map: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0})
    for item in all_items:
        m = item.cost_month or "未指定"
        month_map[m]["amount"] += item.amount
        month_map[m]["count"] += 1
    by_month = [MonthlyCostItem(month=k, amount=round(v["amount"], 2), count=v["count"]) for k, v in sorted(month_map.items())]

    # ── 按销售汇总 ──
    sales_map: dict[str, dict] = defaultdict(lambda: {"project_count": 0, "total_deal": 0.0, "total_cost": 0.0})
    for s in summaries:
        sp = s.sales_person or "未指定"
        sales_map[sp]["project_count"] += 1
        sales_map[sp]["total_deal"] += s.deal_amount or 0
        sales_map[sp]["total_cost"] += s.total_cost
    by_sales = []
    for sp, v in sorted(sales_map.items(), key=lambda x: x[1]["total_deal"], reverse=True):
        profit = v["total_deal"] - v["total_cost"]
        margin = round((1 - v["total_cost"] / v["total_deal"]) * 100, 1) if v["total_deal"] > 0 else None
        by_sales.append(SalesProfitItem(sales_person=sp, project_count=v["project_count"], total_deal=round(v["total_deal"], 2), total_cost=round(v["total_cost"], 2), gross_profit=round(profit, 2), gross_margin=margin))

    # ── 排行 ──
    sorted_s = sorted(summaries, key=lambda x: x.gross_margin if x.gross_margin is not None else -999, reverse=True)

    return OverallProfitSummary(
        total_projects=len(summaries),
        total_deal=round(total_deal, 2),
        total_cost=round(total_cost, 2),
        total_gross_profit=round(total_profit, 2),
        overall_margin=overall_margin,
        by_currency=by_currency,
        by_category=by_category,
        by_month=by_month,
        by_sales=by_sales,
        top_margin_projects=sorted_s[:5],
        low_margin_projects=sorted_s[-5:] if len(sorted_s) > 5 else [],
    )


# ──── 辅助函数 ────

def _build_project_summary(db: Session, project: Project) -> ProjectProfitSummary:
    """构建单个项目的成本利润汇总"""
    items = db.exec(
        select(ProjectCost).where(ProjectCost.project_id == project.id).order_by(ProjectCost.cost_month, ProjectCost.id)
    ).all()
    total_cost = sum(i.amount for i in items)
    deal = project.deal_amount or 0
    gross_profit = deal - total_cost if deal else None
    gross_margin = round((1 - total_cost / deal) * 100, 2) if deal > 0 else None
    return ProjectProfitSummary(
        project_id=project.id,
        project_name=project.name,
        customer_name=project.customer_name,
        currency=project.currency,
        opportunity_amount=project.opportunity_amount,
        deal_amount=project.deal_amount,
        total_cost=round(total_cost, 2),
        gross_profit=round(gross_profit, 2) if gross_profit is not None else None,
        gross_margin=gross_margin,
        sales_person=project.sales_person,
        status=project.status,
        cost_items=[CostItemOut.model_validate(i) for i in items],
    )


def _sync_project_cost(db: Session, project_id: int):
    """同步回写 project.cost_amount = 汇总成本"""
    total = db.exec(
        select(func.sum(ProjectCost.amount)).where(ProjectCost.project_id == project_id)
    ).one() or 0
    project = db.get(Project, project_id)
    if project:
        project.cost_amount = round(total, 2)
        if project.deal_amount and project.deal_amount > 0:
            project.gross_margin = round((1 - total / project.deal_amount) * 100, 2)
        else:
            project.gross_margin = None
        db.add(project)
