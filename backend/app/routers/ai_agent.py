import asyncio
import json
import threading
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func
from sqlalchemy import delete as sa_delete
from app.database import get_session, engine
from app.services.ai_agent import run_agent_chat
from app.models.chat import ChatConversation, ChatMessage
from app.models.user import User
from app.auth import get_current_user, has_permission
from app.models.model_provider import TaskModelConfig, ModelProvider
from app.routers.logs import write_log
from datetime import datetime
from app.utils.time import utc_now

router = APIRouter(prefix="/api/v1/ai", tags=["AI Agent"])


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


class ChatResponse(BaseModel):
    reply: str


# ===== 模型信息 =====

@router.get("/active-model")
def get_active_model(db: Session = Depends(get_session),
                     current_user: User = Depends(get_current_user)):
    """获取当前用户可用的对话模型供应商和模型名"""
    uid = current_user.id
    use_shared = has_permission(current_user, "ai:manage_shared", db) or current_user.use_shared_models

    # 1. 用户私有任务配置
    task_cfg = db.exec(
        select(TaskModelConfig).where(
            TaskModelConfig.task_type == "chat",
            TaskModelConfig.user_id == uid,
        )
    ).first()
    if task_cfg and task_cfg.provider_id and task_cfg.model_name:
        provider = db.get(ModelProvider, task_cfg.provider_id)
        if provider and provider.is_active:
            return {"provider_name": provider.name, "model_name": task_cfg.model_name, "source": "user"}

    # 2. 共享任务配置（需权限）
    if use_shared:
        task_cfg = db.exec(
            select(TaskModelConfig).where(
                TaskModelConfig.task_type == "chat",
                TaskModelConfig.user_id == None,
            )
        ).first()
        if task_cfg and task_cfg.provider_id and task_cfg.model_name:
            provider = db.get(ModelProvider, task_cfg.provider_id)
            if provider and provider.is_active:
                return {"provider_name": provider.name, "model_name": task_cfg.model_name, "source": "shared"}

    return {"provider_name": "未配置", "model_name": ""}


# ===== 对话 CRUD =====

class ConversationOut(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取当前用户的对话列表"""
    msg_count_sq = (
        select(
            ChatMessage.conversation_id,
            func.count(ChatMessage.id).label("msg_count")
        ).group_by(ChatMessage.conversation_id)
    ).subquery()
    rows = db.exec(
        select(
            ChatConversation,
            func.coalesce(msg_count_sq.c.msg_count, 0)
        )
        .outerjoin(msg_count_sq, ChatConversation.id == msg_count_sq.c.conversation_id)
        .where(ChatConversation.user_id == current_user.id)
        .order_by(ChatConversation.updated_at.desc())
    ).all()
    result = []
    for conv, count in rows:
        result.append(ConversationOut(
            id=conv.id, title=conv.title or "新对话",
            created_at=conv.created_at, updated_at=conv.updated_at,
            message_count=count,
        ))
    return result


@router.post("/conversations", status_code=201)
def create_conversation(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """创建新对话"""
    conv = ChatConversation(title="新对话", user_id=current_user.id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return {
        "id": conv.id,
        "title": conv.title,
        "created_at": conv.created_at.isoformat(),
        "updated_at": conv.updated_at.isoformat(),
    }


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取对话的所有消息"""
    conv = db.get(ChatConversation, conv_id)
    if not conv or conv.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")
    messages = db.exec(
        select(ChatMessage).where(ChatMessage.conversation_id == conv_id).order_by(ChatMessage.created_at)
    ).all()
    return {
        "id": conv.id,
        "title": conv.title,
        "messages": [{"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()} for m in messages],
    }


@router.delete("/conversations/{conv_id}", status_code=204)
def delete_conversation(conv_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """删除对话及其所有消息"""
    conv = db.get(ChatConversation, conv_id)
    if not conv or conv.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")
    db.execute(sa_delete(ChatMessage).where(ChatMessage.conversation_id == conv_id))
    db.flush()
    db.delete(conv)
    db.commit()


class ConversationChatRequest(BaseModel):
    message: str


@router.post("/conversations/{conv_id}/chat")
def chat_in_conversation(conv_id: int, request: ConversationChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """在已有对话中发送消息并获得 AI 回复"""
    conv = db.get(ChatConversation, conv_id)
    if not conv or conv.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    # 加载历史消息
    history_msgs = db.exec(
        select(ChatMessage).where(ChatMessage.conversation_id == conv_id).order_by(ChatMessage.created_at)
    ).all()
    history = [{"role": m.role, "content": m.content} for m in history_msgs]

    # 保存用户消息
    user_msg = ChatMessage(conversation_id=conv_id, role="user", content=request.message)
    db.add(user_msg)

    # 调用 AI
    try:
        reply = run_agent_chat(request.message, history, db, user_id=current_user.id)
    except Exception as e:
        write_log("error", "ai", f"AI对话失败: {str(e)[:150]}", details=str(e), db=db)
        reply = f"AI 调用失败: {str(e)[:200]}"

    # 保存 AI 回复
    assistant_msg = ChatMessage(conversation_id=conv_id, role="assistant", content=reply)
    db.add(assistant_msg)

    # 自动更新标题（用第一条用户消息作为标题）
    if not history_msgs:
        conv.title = request.message[:40]
    conv.updated_at = utc_now()
    db.add(conv)

    db.commit()
    return {"reply": reply}


# ===== 流式对话（SSE） =====

@router.post("/conversations/{conv_id}/stream")
async def stream_chat_conversation(
    conv_id: int,
    request: ConversationChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """SSE 流式对话：实时推送工具调用事件和最终回复"""
    conv = db.get(ChatConversation, conv_id)
    if not conv or conv.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="对话不存在")

    history_msgs = db.exec(
        select(ChatMessage).where(ChatMessage.conversation_id == conv_id).order_by(ChatMessage.created_at)
    ).all()
    history = [{"role": m.role, "content": m.content} for m in history_msgs]
    is_first = len(history_msgs) == 0
    user_id = current_user.id
    user_message = request.message

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def on_event(event_type: str, data: dict):
        loop.call_soon_threadsafe(queue.put_nowait, {"type": event_type, **data})

    def run_in_thread():
        from sqlmodel import Session as ThreadSession
        with ThreadSession(engine) as tdb:
            try:
                # 在线程里统一写入 user 消息 + AI 回复，避免 HTTP 层写了一半
                tdb.add(ChatMessage(conversation_id=conv_id, role="user", content=user_message))
                tdb.flush()
                reply = run_agent_chat(user_message, history, tdb, user_id=user_id, on_event=on_event)
                tdb.add(ChatMessage(conversation_id=conv_id, role="assistant", content=reply))
                cv = tdb.get(ChatConversation, conv_id)
                if cv:
                    if is_first:
                        cv.title = user_message[:40]
                    cv.updated_at = utc_now()
                    tdb.add(cv)
                tdb.commit()
            except Exception as e:
                loop.call_soon_threadsafe(
                    queue.put_nowait, {"type": "error", "message": str(e)[:300]}
                )
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "done"})

    threading.Thread(target=run_in_thread, daemon=True).start()

    async def event_gen():
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=120.0)
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'error', 'message': '响应超时，请重试'})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                break
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if event.get("type") == "done":
                break

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ===== 存储统计 & 管理员清理 =====

@router.get("/stats")
def get_chat_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """返回当前用户的对话存储统计 + 全局保留策略"""
    from sqlmodel import func
    from app.config import settings as cfg

    conv_count = db.exec(
        select(func.count(ChatConversation.id)).where(ChatConversation.user_id == current_user.id)
    ).one()

    msg_count = db.exec(
        select(func.count(ChatMessage.id))
        .join(ChatConversation, ChatConversation.id == ChatMessage.conversation_id)
        .where(ChatConversation.user_id == current_user.id)
    ).one()

    oldest = db.exec(
        select(ChatConversation)
        .where(ChatConversation.user_id == current_user.id)
        .order_by(ChatConversation.updated_at.asc())
    ).first()

    return {
        "conversation_count": conv_count,
        "message_count": msg_count,
        "oldest_updated_at": oldest.updated_at.isoformat() if oldest else None,
        "retention_days": cfg.ai_chat_retention_days,
        "max_per_user": cfg.ai_chat_max_per_user,
    }


@router.post("/cleanup")
def manual_cleanup(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """管理员手动触发 AI 对话历史清理"""
    if not current_user.is_admin:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="仅管理员可手动触发清理")
    from app.services.scheduler import cleanup_chat_history
    result = cleanup_chat_history()
    return {"success": True, **result}


# ===== 通用 Chat（无会话） =====

@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    try:
        reply = run_agent_chat(request.message, request.history, db, user_id=current_user.id)
    except Exception as e:
        write_log("error", "ai", f"通用AI对话失败: {str(e)[:150]}", details=str(e), db=db)
        reply = f"AI 调用失败: {str(e)[:200]}"
    return ChatResponse(reply=reply)
