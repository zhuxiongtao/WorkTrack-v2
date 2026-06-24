"""意见反馈 API：提交端零门槛（登录即可），管理端聚合（feedback:manage）"""
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func, col

from app.database import get_session
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate, FeedbackAdminUpdate, FeedbackOut
from app.auth import get_current_user, require_permission
from app.routers.logs import write_log

router = APIRouter(prefix="/api/v1/feedback", tags=["意见反馈"])

# 可提交的标准功能模块（与系统菜单保持一致，前端「自定义」时不受此限制）
FEEDBACK_MODULES = [
    "数据看板", "日报周报", "团队管理", "会议纪要", "项目管理", "成本利润",
    "上游管理", "财务对账", "客户管理", "合同管理", "在线文档", "AI 助手",
    "登录与权限", "性能与稳定性", "整体体验", "其他",
]

VALID_CATEGORY = {"bug", "feature", "improve", "other"}
VALID_PRIORITY = {"low", "medium", "high"}
VALID_STATUS = {"pending", "reviewing", "processing", "done", "closed", "wontfix"}


def _to_out(fb: Feedback, name_map: dict[int, str]) -> FeedbackOut:
    return FeedbackOut(
        id=fb.id,
        user_id=fb.user_id,
        user_name=name_map.get(fb.user_id),
        category=fb.category,
        module=fb.module,
        is_custom_module=fb.is_custom_module,
        title=fb.title,
        content=fb.content,
        images=fb.images,
        contact=fb.contact,
        user_priority=fb.user_priority,
        status=fb.status,
        admin_priority=fb.admin_priority,
        handler_id=fb.handler_id,
        handler_name=name_map.get(fb.handler_id) if fb.handler_id else None,
        admin_reply=fb.admin_reply,
        created_at=fb.created_at,
        updated_at=fb.updated_at,
        resolved_at=fb.resolved_at,
    )


def _name_map(db: Session, fbs: list[Feedback]) -> dict[int, str]:
    """批量取出涉及的用户 id → 姓名，避免 N+1"""
    ids = {f.user_id for f in fbs} | {f.handler_id for f in fbs if f.handler_id}
    if not ids:
        return {}
    users = db.exec(select(User).where(col(User.id).in_(ids))).all()
    return {u.id: (u.name or u.username) for u in users}


# ──── 提交端（登录即可，无需特殊权限） ────

@router.get("/modules")
def list_modules(current_user: User = Depends(get_current_user)):
    """返回可选标准功能模块列表，前端下拉用"""
    return {"modules": FEEDBACK_MODULES}


@router.post("", response_model=FeedbackOut)
def create_feedback(
    body: FeedbackCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """提交反馈：任何登录用户可用"""
    if body.category not in VALID_CATEGORY:
        raise HTTPException(status_code=400, detail="无效的反馈类型")
    if body.user_priority not in VALID_PRIORITY:
        raise HTTPException(status_code=400, detail="无效的紧急度")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="标题不能为空")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="详细描述不能为空")
    if not body.module.strip():
        raise HTTPException(status_code=400, detail="请选择或填写功能模块")

    fb = Feedback(
        user_id=current_user.id,
        category=body.category,
        module=body.module.strip(),
        is_custom_module=body.is_custom_module,
        title=body.title.strip(),
        content=body.content.strip(),
        images=body.images,
        contact=(body.contact or "").strip() or None,
        user_priority=body.user_priority,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    write_log(level="INFO", category="意见反馈",
              message=f"用户 {current_user.username} 提交反馈《{fb.title}》[{fb.category}/{fb.module}]", db=db)
    return _to_out(fb, {current_user.id: current_user.name or current_user.username})


@router.get("/mine", response_model=list[FeedbackOut])
def my_feedback(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """我提交的反馈（带状态跟踪）"""
    fbs = db.exec(
        select(Feedback).where(Feedback.user_id == current_user.id).order_by(col(Feedback.id).desc())
    ).all()
    return [_to_out(f, _name_map(db, fbs)) for f in fbs]


# ──── 管理端（feedback:manage） ────

@router.get("/stats")
def feedback_stats(
    current_user: User = Depends(require_permission("feedback:manage")),
    db: Session = Depends(get_session),
):
    """后台统计卡：总数 / 待处理 / 本周新增 / 已解决率 / 类型与模块分布"""
    all_fb = db.exec(select(Feedback)).all()
    total = len(all_fb)
    pending = sum(1 for f in all_fb if f.status == "pending")
    resolved = sum(1 for f in all_fb if f.status in ("done", "closed"))

    now_dt = now()
    week_ago = now_dt.timestamp() - 7 * 86400
    week_new = sum(1 for f in all_fb if f.created_at and f.created_at.timestamp() >= week_ago)

    by_category: dict[str, int] = {}
    by_module: dict[str, int] = {}
    for f in all_fb:
        by_category[f.category] = by_category.get(f.category, 0) + 1
        by_module[f.module] = by_module.get(f.module, 0) + 1

    return {
        "total": total,
        "pending": pending,
        "resolved": resolved,
        "week_new": week_new,
        "resolved_rate": round(resolved / total * 100, 1) if total else 0,
        "by_category": by_category,
        "by_module": sorted(
            [{"module": k, "count": v} for k, v in by_module.items()],
            key=lambda x: x["count"], reverse=True,
        ),
    }


@router.get("", response_model=list[FeedbackOut])
def list_feedback(
    category: Optional[str] = None,
    module: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = Query(default=200, le=500),
    offset: int = 0,
    current_user: User = Depends(require_permission("feedback:manage")),
    db: Session = Depends(get_session),
):
    """后台反馈列表，支持多维筛选"""
    query = select(Feedback)
    if category:
        query = query.where(Feedback.category == category)
    if module:
        query = query.where(Feedback.module == module)
    if status:
        query = query.where(Feedback.status == status)
    if priority:
        query = query.where(Feedback.user_priority == priority)
    if keyword:
        kw = f"%{keyword}%"
        query = query.where(col(Feedback.title).ilike(kw) | col(Feedback.content).ilike(kw))
    query = query.order_by(col(Feedback.id).desc()).offset(offset).limit(limit)
    fbs = db.exec(query).all()
    return [_to_out(f, _name_map(db, fbs)) for f in fbs]


@router.patch("/{feedback_id}", response_model=FeedbackOut)
def update_feedback(
    feedback_id: int,
    body: FeedbackAdminUpdate,
    current_user: User = Depends(require_permission("feedback:manage")),
    db: Session = Depends(get_session),
):
    """后台处理：改状态 / 定优先级 / 指派处理人 / 回复"""
    fb = db.get(Feedback, feedback_id)
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")

    if body.status is not None:
        if body.status not in VALID_STATUS:
            raise HTTPException(status_code=400, detail="无效的状态")
        # 进入终态时打 resolved_at；回到非终态时清除
        if body.status in ("done", "closed") and fb.status not in ("done", "closed"):
            fb.resolved_at = now()
        elif body.status not in ("done", "closed"):
            fb.resolved_at = None
        fb.status = body.status
    if body.admin_priority is not None:
        if body.admin_priority and body.admin_priority not in VALID_PRIORITY:
            raise HTTPException(status_code=400, detail="无效的优先级")
        fb.admin_priority = body.admin_priority or None
    if body.handler_id is not None:
        fb.handler_id = body.handler_id or None
    if body.admin_reply is not None:
        fb.admin_reply = body.admin_reply.strip() or None

    fb.updated_at = now()
    db.add(fb)
    db.commit()
    db.refresh(fb)
    write_log(level="INFO", category="意见反馈",
              message=f"{current_user.username} 处理反馈 #{fb.id} → 状态={fb.status}", db=db)
    return _to_out(fb, _name_map(db, [fb]))


@router.delete("/{feedback_id}")
def delete_feedback(
    feedback_id: int,
    current_user: User = Depends(require_permission("feedback:manage")),
    db: Session = Depends(get_session),
):
    """删除反馈"""
    fb = db.get(Feedback, feedback_id)
    if not fb:
        raise HTTPException(status_code=404, detail="反馈不存在")
    db.delete(fb)
    db.commit()
    write_log(level="INFO", category="意见反馈",
              message=f"{current_user.username} 删除反馈 #{feedback_id}", db=db)
    return {"ok": True}
