"""数据分享与评论路由"""

from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from app.database import get_session
from app.models.data_share import DataShare, DataShareComment
from app.models.user import User
from app.models.daily_report import DailyReport
from app.models.project import Project
from app.models.meeting_note import MeetingNote
from app.models.customer import Customer
from app.models.contract import Contract
from app.auth import get_current_user, require_permission, check_data_access, has_permission
from app.schemas.data_share import DataShareCreate, DataShareOut, DataShareCommentCreate, DataShareCommentOut
from app.utils.time import utc_now

router = APIRouter(prefix="/api/v1/shares", tags=["数据分享"])

# target_type -> (Model, module_name)
_TARGET_MODEL_MAP = {
    "report": (DailyReport, "report"),
    "project": (Project, "project"),
    "meeting": (MeetingNote, "meeting"),
    "customer": (Customer, "customer"),
    "contract": (Contract, "contract"),
}


def _get_target_title(target_type: str, target_id: int, db: Session) -> str:
    """获取目标数据的标题/名称摘要"""
    model_cls = _TARGET_MODEL_MAP.get(target_type, (None,))[0]
    if not model_cls:
        return ""
    obj = db.get(model_cls, target_id)
    if not obj:
        return ""
    if hasattr(obj, "name"):
        return obj.name
    if hasattr(obj, "title"):
        return obj.title
    if hasattr(obj, "contract_no"):
        return f"合同 #{obj.contract_no}"
    return f"#{target_id}"


def _check_target_ownership(target_type: str, target_id: int, current_user: User, db: Session) -> bool:
    """检查当前用户是否拥有目标数据的所有权或管理权限"""
    model_cls, module = _TARGET_MODEL_MAP.get(target_type, (None, None))
    if not model_cls:
        return False
    obj = db.get(model_cls, target_id)
    if not obj:
        return False
    # 本人数据
    if hasattr(obj, "user_id") and obj.user_id == current_user.id:
        return True
    # 管理权限
    if current_user.is_admin:
        return True
    if has_permission(current_user, f"{module}:edit", db):
        return True
    return False


@router.post("", response_model=DataShareOut, status_code=201)
def create_share(
    data: DataShareCreate,
    current_user: User = Depends(require_permission("share:create")),
    db: Session = Depends(get_session),
):
    """创建数据分享"""
    if data.target_type not in _TARGET_MODEL_MAP:
        raise HTTPException(status_code=400, detail=f"不支持的 target_type: {data.target_type}")
    if data.permission not in ("viewer", "commenter"):
        raise HTTPException(status_code=400, detail="permission 必须为 viewer 或 commenter")
    if data.shared_to == current_user.id:
        raise HTTPException(status_code=400, detail="不能分享给自己")
    
    # 验证目标数据存在且有权限分享
    if not _check_target_ownership(data.target_type, data.target_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权分享此数据")
    
    # 验证被分享用户存在
    target_user = db.get(User, data.shared_to)
    if not target_user:
        raise HTTPException(status_code=404, detail="被分享用户不存在")
    
    # 检查唯一约束
    existing = db.exec(
        select(DataShare).where(
            DataShare.target_type == data.target_type,
            DataShare.target_id == data.target_id,
            DataShare.shared_to == data.shared_to,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="已分享过此数据给该用户")
    
    share = DataShare(
        target_type=data.target_type,
        target_id=data.target_id,
        shared_by=current_user.id,
        shared_to=data.shared_to,
        permission=data.permission,
        expires_at=data.expires_at,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    
    return DataShareOut(
        id=share.id,
        target_type=share.target_type,
        target_id=share.target_id,
        shared_by=share.shared_by,
        shared_to=share.shared_to,
        shared_by_name=current_user.name or current_user.username,
        shared_to_name=target_user.name or target_user.username,
        permission=share.permission,
        expires_at=share.expires_at,
        created_at=share.created_at,
        target_title=_get_target_title(share.target_type, share.target_id, db),
    )


@router.get("/target/{target_type}/{target_id}", response_model=list[DataShareOut])
def list_shares_for_target(
    target_type: str,
    target_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """查看某条数据的分享列表（仅数据所有者或管理员可调用）"""
    if not _check_target_ownership(target_type, target_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权查看此数据的分享记录")
    
    shares = db.exec(
        select(DataShare).where(
            DataShare.target_type == target_type,
            DataShare.target_id == target_id,
        ).order_by(DataShare.created_at.desc())
    ).all()
    
    result = []
    sharer_user = db.get(User, current_user.id)
    for s in shares:
        recipient = db.get(User, s.shared_to)
        result.append(DataShareOut(
            id=s.id,
            target_type=s.target_type,
            target_id=s.target_id,
            shared_by=s.shared_by,
            shared_to=s.shared_to,
            shared_by_name=(sharer_user.name or sharer_user.username) if sharer_user else "",
            shared_to_name=(recipient.name or recipient.username) if recipient else "",
            permission=s.permission,
            expires_at=s.expires_at,
            created_at=s.created_at,
            target_title=_get_target_title(s.target_type, s.target_id, db),
        ))
    return result


@router.delete("/{share_id}")
def delete_share(
    share_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """取消分享"""
    share = db.get(DataShare, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="分享记录不存在")
    if share.shared_by != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="无权取消此分享")
    # 级联删除评论
    comments = db.exec(select(DataShareComment).where(DataShareComment.share_id == share_id)).all()
    for c in comments:
        db.delete(c)
    db.delete(share)
    db.commit()
    return {"detail": "已取消分享"}


@router.get("/received", response_model=list[DataShareOut])
def list_received_shares(
    target_type: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("share:read")),
    db: Session = Depends(get_session),
):
    """我收到的分享列表（排除已过期的）"""
    now = utc_now()
    query = select(DataShare).where(DataShare.shared_to == current_user.id)
    if target_type:
        query = query.where(DataShare.target_type == target_type)
    
    shares = db.exec(query.order_by(DataShare.created_at.desc())).all()
    
    result = []
    for s in shares:
        # 过滤已过期的
        if s.expires_at is not None:
            exp = s.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < now:
                continue
        sharer = db.get(User, s.shared_by)
        result.append(DataShareOut(
            id=s.id,
            target_type=s.target_type,
            target_id=s.target_id,
            shared_by=s.shared_by,
            shared_to=s.shared_to,
            shared_by_name=(sharer.name or sharer.username) if sharer else "",
            shared_to_name=(current_user.name or current_user.username),
            permission=s.permission,
            expires_at=s.expires_at,
            created_at=s.created_at,
            target_title=_get_target_title(s.target_type, s.target_id, db),
        ))
    return result


@router.get("/sent", response_model=list[DataShareOut])
def list_sent_shares(
    target_type: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("share:create")),
    db: Session = Depends(get_session),
):
    """我发出的分享列表"""
    query = select(DataShare).where(DataShare.shared_by == current_user.id)
    if target_type:
        query = query.where(DataShare.target_type == target_type)
    shares = db.exec(query.order_by(DataShare.created_at.desc())).all()
    result = []
    for s in shares:
        recipient = db.get(User, s.shared_to)
        result.append(DataShareOut(
            id=s.id,
            target_type=s.target_type,
            target_id=s.target_id,
            shared_by=s.shared_by,
            shared_to=s.shared_to,
            shared_by_name=current_user.name or current_user.username,
            shared_to_name=(recipient.name or recipient.username) if recipient else "",
            permission=s.permission,
            expires_at=s.expires_at,
            created_at=s.created_at,
            target_title=_get_target_title(s.target_type, s.target_id, db),
        ))
    return result


@router.post("/{share_id}/comments", response_model=DataShareCommentOut, status_code=201)
def add_comment(
    share_id: int,
    data: DataShareCommentCreate,
    current_user: User = Depends(require_permission("share:comment")),
    db: Session = Depends(get_session),
):
    """添加评论（需要 commenter 权限且为分享接收者）"""
    share = db.get(DataShare, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="分享记录不存在")
    if share.shared_to != current_user.id:
        raise HTTPException(status_code=403, detail="只有被分享者可以评论")
    if share.permission != "commenter":
        raise HTTPException(status_code=403, detail="当前分享权限为只读，无法评论")
    
    # 检查是否过期
    if share.expires_at is not None:
        exp = share.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < utc_now():
            raise HTTPException(status_code=410, detail="分享已过期")
    
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    
    comment = DataShareComment(
        share_id=share_id,
        user_id=current_user.id,
        content=data.content.strip(),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    
    return DataShareCommentOut(
        id=comment.id,
        share_id=comment.share_id,
        user_id=comment.user_id,
        user_name=current_user.name or current_user.username,
        user_avatar=current_user.avatar,
        content=comment.content,
        created_at=comment.created_at,
    )


@router.get("/{share_id}/comments", response_model=list[DataShareCommentOut])
def list_comments(
    share_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """查看评论（分享相关方均可）"""
    share = db.get(DataShare, share_id)
    if not share:
        raise HTTPException(status_code=404, detail="分享记录不存在")
    if share.shared_to != current_user.id and share.shared_by != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="无权查看此分享的评论")
    
    comments = db.exec(
        select(DataShareComment).where(DataShareComment.share_id == share_id).order_by(DataShareComment.created_at)
    ).all()
    
    result = []
    for c in comments:
        user = db.get(User, c.user_id)
        result.append(DataShareCommentOut(
            id=c.id,
            share_id=c.share_id,
            user_id=c.user_id,
            user_name=(user.name or user.username) if user else "",
            user_avatar=user.avatar if user else None,
            content=c.content,
            created_at=c.created_at,
        ))
    return result
