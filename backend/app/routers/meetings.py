from typing import Optional
from datetime import datetime
import os
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, UploadFile, File
from sqlmodel import Session, select
from app.database import get_session
from app.models.meeting_note import MeetingNote
from app.models.user import User
from app.auth import get_current_user, require_permission
from app.schemas import MeetingNoteCreate, MeetingNoteUpdate, MeetingNoteOut
from app.services.vector_store import index_document, delete_document
from app.services.ai_service import extract_meeting_minutes, transcribe_audio, organize_transcript
from app.utils.time import utc_now
from app.config import settings

router = APIRouter(prefix="/api/v1/meetings", tags=["会议"])


@router.get("", response_model=list[MeetingNoteOut])
def list_meetings(
    user_id: Optional[int] = Query(None),
    user_ids: Optional[str] = Query(None, description="逗号分隔的用户ID列表"),
    customer_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(require_permission("meeting:read")),
    db: Session = Depends(get_session),
):
    from app.auth import check_data_access, get_visible_user_ids

    # 多用户模式（团队视图）
    if user_ids:
        try:
            requested_ids = [int(x.strip()) for x in user_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="user_ids 格式错误")
        
        visible = get_visible_user_ids(current_user, db, module="meeting")
        if visible is None:
            validated_ids = requested_ids
        else:
            validated_ids = [uid for uid in requested_ids if uid in visible]
        
        if not validated_ids:
            return []
        
        query = select(MeetingNote).where(MeetingNote.user_id.in_(validated_ids)).order_by(MeetingNote.meeting_date.desc())
        if customer_id:
            query = query.where(MeetingNote.customer_id == customer_id)
        if project_id:
            query = query.where(MeetingNote.project_id == project_id)
        if start_date:
            query = query.where(MeetingNote.meeting_date >= start_date)
        if end_date:
            query = query.where(MeetingNote.meeting_date <= end_date)
        return db.exec(query).all()

    # 单用户模式：返回自己的会议 + 被授权的会议
    target_uid = user_id if user_id is not None else current_user.id
    if user_id is not None and not check_data_access(target_uid, current_user, db):
        raise HTTPException(status_code=403, detail="无权查看该用户的会议纪要列表")

    if user_id is not None:
        query = select(MeetingNote).where(MeetingNote.user_id == target_uid)
        shared_meeting_ids = set()
    else:
        shared_meeting_ids = set(db.exec(
            select(MeetingPermission.meeting_id).where(MeetingPermission.user_id == current_user.id)
        ).all())
        query = select(MeetingNote).where(
            (MeetingNote.user_id == current_user.id) | (MeetingNote.id.in_(list(shared_meeting_ids)))
        )
    query = query.order_by(MeetingNote.meeting_date.desc())
    if customer_id:
        query = query.where(MeetingNote.customer_id == customer_id)
    if project_id:
        query = query.where(MeetingNote.project_id == project_id)
    if start_date:
        query = query.where(MeetingNote.meeting_date >= start_date)
    if end_date:
        query = query.where(MeetingNote.meeting_date <= end_date)
    meetings = db.exec(query).all()

    result = []
    for m in meetings:
        data = m.model_dump()
        is_shared = m.id in shared_meeting_ids
        data["is_shared"] = is_shared
        if is_shared:
            perm = db.exec(
                select(MeetingPermission.permission).where(
                    MeetingPermission.meeting_id == m.id,
                    MeetingPermission.user_id == current_user.id,
                )
            ).first()
            data["shared_permission"] = perm
            owner = db.get(User, m.user_id)
            data["owner_name"] = owner.name or owner.username if owner else None
        result.append(data)
    return result


@router.post("", response_model=MeetingNoteOut, status_code=201)
def create_meeting(data: MeetingNoteCreate, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("meeting:create")), db: Session = Depends(get_session)):
    create_data = data.model_dump()
    create_data["user_id"] = current_user.id
    meeting = MeetingNote(**create_data)
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    background_tasks.add_task(
        index_document,
        collection_name="meeting_notes",
        doc_id=str(meeting.id),
        text=f"{meeting.title}\n{meeting.content_md}",
        metadata={"meeting_date": str(meeting.meeting_date), "user_id": meeting.user_id},
    )
    return meeting


@router.put("/{meeting_id}", response_model=MeetingNoteOut)
def update_meeting(meeting_id: int, data: MeetingNoteUpdate, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("meeting:edit")), db: Session = Depends(get_session)):
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    perm = _get_meeting_perm(meeting_id, current_user.id, db)
    if perm not in ("owner", "admin", "editor"):
        raise HTTPException(status_code=403, detail="无权限编辑此会议")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(meeting, key, value)
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    background_tasks.add_task(
        index_document,
        collection_name="meeting_notes",
        doc_id=str(meeting.id),
        text=f"{meeting.title}\n{meeting.content_md}",
        metadata={"meeting_date": str(meeting.meeting_date), "user_id": meeting.user_id},
    )
    return meeting


@router.delete("/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("meeting:delete")), db: Session = Depends(get_session)):
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    perm = _get_meeting_perm(meeting_id, current_user.id, db)
    if perm not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="仅会议创建者或管理员可删除")
    from sqlmodel import text as sql_text
    db.execute(sql_text("DELETE FROM meeting_permission WHERE meeting_id = :mid"), {"mid": meeting_id})
    db.execute(sql_text("DELETE FROM meeting_comment WHERE meeting_id = :mid"), {"mid": meeting_id})
    db.delete(meeting)
    db.commit()
    background_tasks.add_task(delete_document, "meeting_notes", str(meeting_id))


@router.post("/{meeting_id}/ai-extract")
def ai_extract_meeting(meeting_id: int, current_user: User = Depends(require_permission("meeting:edit")), db: Session = Depends(get_session)):
    """手动触发 AI 提取会议结构化信息"""
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会议不存在")
    extracted = extract_meeting_minutes(meeting.content_md, db, current_user.id)
    # 将 AI 返回的原始文本保存为 ai_summary，不依赖特定字段名
    raw_text = extracted.pop("_raw_text", "") if isinstance(extracted, dict) else ""
    fallback = extracted.pop("fallback", "") if isinstance(extracted, dict) else ""
    summary = raw_text or fallback
    # 如果 AI 返回的是 JSON，转换为易读的 Markdown
    if summary and summary != "{}":
        try:
            data = json.loads(summary)
            if isinstance(data, dict):
                lines = []
                for key, value in data.items():
                    lines.append(f"## {key}")
                    if isinstance(value, dict):
                        for k, v in value.items():
                            lines.append(f"- **{k}**: {v}")
                    elif isinstance(value, list):
                        for item in value:
                            if isinstance(item, dict):
                                parts = [f"{k}: {v}" for k, v in item.items()]
                                lines.append(f"- {', '.join(parts)}")
                            else:
                                lines.append(f"- {item}")
                    elif isinstance(value, str):
                        lines.append(value)
                    lines.append("")
                summary = "\n".join(lines)
        except json.JSONDecodeError:
            pass
        meeting.ai_summary = summary.strip()
        meeting.updated_at = utc_now()
        db.add(meeting)
        db.commit()
    return {"meeting_id": meeting_id, "extracted": extracted, "ai_summary": meeting.ai_summary}


# ===== 音频上传 =====
UPLOAD_DIR = settings.effective_audio_dir
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/{meeting_id}/upload-audio")
async def upload_meeting_audio(meeting_id: int, file: UploadFile = File(...), current_user: User = Depends(require_permission("meeting:edit")), db: Session = Depends(get_session)):
    """上传会议录音文件"""
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会议不存在")
    
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "webm"
    filename = f"meeting_{meeting_id}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    
    audio_url = f"/api/v1/meetings/audio/{filename}"
    meeting.audio_url = audio_url
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    
    return {"meeting_id": meeting_id, "audio_url": audio_url, "filename": filename, "size": len(content)}


@router.post("/{meeting_id}/transcribe")
def transcribe_meeting_audio(meeting_id: int, current_user: User = Depends(require_permission("meeting:edit")), db: Session = Depends(get_session)):
    """将会议录音转写为文字，并可选 AI 整理"""
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会议不存在")
    if not meeting.audio_url:
        raise HTTPException(status_code=400, detail="该会议没有上传录音文件")
    # 解析音频文件路径
    filename = meeting.audio_url.rsplit("/", 1)[-1]
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="录音文件不存在，请重新上传")
    try:
        raw_text = transcribe_audio(filepath, db, current_user.id)
        return {"success": True, "raw_text": raw_text, "source": "asr"}
    except Exception as e:
        return {"success": False, "message": f"转写失败: {str(e)[:200]}"}


@router.post("/{meeting_id}/transcribe-and-organize")
def transcribe_and_organize(meeting_id: int, current_user: User = Depends(require_permission("meeting:edit")), db: Session = Depends(get_session)):
    """转写并 AI 整理，自动填入会议纪要"""
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会议不存在")
    if not meeting.audio_url:
        raise HTTPException(status_code=400, detail="该会议没有上传录音文件")
    filename = meeting.audio_url.rsplit("/", 1)[-1]
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="录音文件不存在，请重新上传")
    try:
        raw_text = transcribe_audio(filepath, db, current_user.id)
        organized = organize_transcript(raw_text, db, current_user.id)
        meeting.content_md = organized
        db.add(meeting)
        db.commit()
        db.refresh(meeting)
        return {"success": True, "raw_text": raw_text, "organized": organized, "meeting_id": meeting_id}
    except Exception as e:
        return {"success": False, "message": f"转写或整理失败: {str(e)[:200]}"}


@router.get("/audio/{filename}")
def serve_audio(filename: str, current_user: User = Depends(get_current_user)):
    """获取录音文件"""
    from fastapi.responses import FileResponse
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(filepath, media_type="audio/webm")


# ===== 会议协作 API =====

from app.models.meeting_collab import MeetingPermission, MeetingComment
from pydantic import BaseModel


class MeetingPermCreate(BaseModel):
    user_id: int
    permission: str  # "viewer" / "editor"


class MeetingCommentCreate(BaseModel):
    content: str


def _get_meeting_perm(meeting_id: int, user_id: int, db: Session) -> Optional[str]:
    """获取用户对某会议的权限级别，返回 None 表示无权限"""
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting:
        return None
    if meeting.user_id == user_id:
        return "owner"
    user = db.get(User, user_id)
    if user and user.is_admin:
        return "admin"
    perm = db.exec(
        select(MeetingPermission.permission).where(
            MeetingPermission.meeting_id == meeting_id,
            MeetingPermission.user_id == user_id,
        )
    ).first()
    return perm


@router.get("/{meeting_id}/permissions")
def list_meeting_permissions(meeting_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    perm = _get_meeting_perm(meeting_id, current_user.id, db)
    if not perm:
        raise HTTPException(status_code=403, detail="无权限查看协作者")
    perms = db.exec(
        select(MeetingPermission).where(MeetingPermission.meeting_id == meeting_id)
    ).all()
    result = []
    for p in perms:
        u = db.get(User, p.user_id)
        result.append({
            "id": p.id,
            "user_id": p.user_id,
            "user_name": u.name or u.username if u else "",
            "permission": p.permission,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return result


@router.post("/{meeting_id}/permissions")
def add_meeting_permission(meeting_id: int, data: MeetingPermCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    perm = _get_meeting_perm(meeting_id, current_user.id, db)
    if perm not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="仅会议创建者或管理员可添加协作者")
    if data.permission not in ("viewer", "editor"):
        raise HTTPException(status_code=400, detail="权限类型无效，可选: viewer/editor")
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    if data.user_id == meeting.user_id:
        raise HTTPException(status_code=400, detail="不能给会议创建者添加权限")
    existing = db.exec(
        select(MeetingPermission).where(
            MeetingPermission.meeting_id == meeting_id,
            MeetingPermission.user_id == data.user_id,
        )
    ).first()
    if existing:
        existing.permission = data.permission
        db.add(existing)
    else:
        db.add(MeetingPermission(meeting_id=meeting_id, user_id=data.user_id, permission=data.permission))
    db.commit()
    return {"success": True}


@router.delete("/permissions/{perm_id}")
def remove_meeting_permission(perm_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    p = db.get(MeetingPermission, perm_id)
    if not p:
        raise HTTPException(status_code=404, detail="权限记录不存在")
    perm = _get_meeting_perm(p.meeting_id, current_user.id, db)
    if perm not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="仅会议创建者或管理员可移除协作者")
    db.delete(p)
    db.commit()
    return {"success": True}


@router.get("/{meeting_id}/comments")
def list_meeting_comments(meeting_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    perm = _get_meeting_perm(meeting_id, current_user.id, db)
    if not perm:
        raise HTTPException(status_code=403, detail="无权限查看评论")
    comments = db.exec(
        select(MeetingComment).where(MeetingComment.meeting_id == meeting_id).order_by(MeetingComment.created_at)
    ).all()
    result = []
    for c in comments:
        u = db.get(User, c.user_id)
        result.append({
            "id": c.id,
            "user_id": c.user_id,
            "user_name": u.name or u.username if u else "",
            "user_avatar": u.avatar if u else None,
            "content": c.content,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "can_edit": c.user_id == current_user.id or perm in ("owner", "admin"),
        })
    return result


@router.post("/{meeting_id}/comments")
def add_meeting_comment(meeting_id: int, data: MeetingCommentCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    perm = _get_meeting_perm(meeting_id, current_user.id, db)
    if not perm:
        raise HTTPException(status_code=403, detail="无权限评论")
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    comment = MeetingComment(meeting_id=meeting_id, user_id=current_user.id, content=data.content.strip())
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {"id": comment.id, "content": comment.content, "created_at": comment.created_at.isoformat()}


@router.put("/comments/{comment_id}")
def update_meeting_comment(comment_id: int, data: MeetingCommentCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    comment = db.get(MeetingComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    perm = _get_meeting_perm(comment.meeting_id, current_user.id, db)
    if comment.user_id != current_user.id and perm not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="无权限编辑此评论")
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    comment.content = data.content.strip()
    comment.updated_at = utc_now()
    db.add(comment)
    db.commit()
    return {"success": True}


@router.delete("/comments/{comment_id}")
def delete_meeting_comment(comment_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    comment = db.get(MeetingComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    perm = _get_meeting_perm(comment.meeting_id, current_user.id, db)
    if comment.user_id != current_user.id and perm not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="无权限删除此评论")
    db.delete(comment)
    db.commit()
    return {"success": True}
