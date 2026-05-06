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
from app.auth import get_current_user
from app.schemas import MeetingNoteCreate, MeetingNoteUpdate, MeetingNoteOut
from app.services.vector_store import index_document, delete_document
from app.services.ai_service import extract_meeting_minutes, transcribe_audio, organize_transcript

router = APIRouter(prefix="/api/v1/meetings", tags=["会议"])


@router.get("", response_model=list[MeetingNoteOut])
def list_meetings(
    customer_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(MeetingNote).where(MeetingNote.user_id == current_user.id).order_by(MeetingNote.meeting_date.desc())
    if customer_id:
        query = query.where(MeetingNote.customer_id == customer_id)
    if project_id:
        query = query.where(MeetingNote.project_id == project_id)
    if start_date:
        query = query.where(MeetingNote.meeting_date >= start_date)
    if end_date:
        query = query.where(MeetingNote.meeting_date <= end_date)
    return db.exec(query).all()


@router.post("", response_model=MeetingNoteOut, status_code=201)
def create_meeting(data: MeetingNoteCreate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
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
def update_meeting(meeting_id: int, data: MeetingNoteUpdate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会议不存在")
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
def delete_meeting(meeting_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    meeting = db.get(MeetingNote, meeting_id)
    if not meeting or meeting.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="会议不存在")
    db.delete(meeting)
    db.commit()
    background_tasks.add_task(delete_document, "meeting_notes", str(meeting_id))


@router.post("/{meeting_id}/ai-extract")
def ai_extract_meeting(meeting_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
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
        meeting.updated_at = datetime.now()
        db.add(meeting)
        db.commit()
    return {"meeting_id": meeting_id, "extracted": extracted, "ai_summary": meeting.ai_summary}


# ===== 音频上传 =====
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "audio")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/{meeting_id}/upload-audio")
async def upload_meeting_audio(meeting_id: int, file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
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
def transcribe_meeting_audio(meeting_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
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
def transcribe_and_organize(meeting_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
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
def serve_audio(filename: str):
    """获取录音文件"""
    from fastapi.responses import FileResponse
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(filepath, media_type="audio/webm")
