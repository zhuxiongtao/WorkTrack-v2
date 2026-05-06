from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select
from sqlalchemy import delete as sa_delete
from app.database import get_session
from app.services.ai_agent import run_agent_chat
from app.models.chat import ChatConversation, ChatMessage
from app.models.user import User
from app.auth import get_current_user
from app.models.model_provider import TaskModelConfig, ModelProvider
from app.routers.logs import write_log
from datetime import datetime

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
    is_admin = current_user.is_admin
    use_shared = is_admin or current_user.use_shared_models

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
    convs = db.exec(
        select(ChatConversation).where(ChatConversation.user_id == current_user.id).order_by(ChatConversation.updated_at.desc())
    ).all()
    result = []
    for c in convs:
        count = db.exec(
            select(ChatMessage).where(ChatMessage.conversation_id == c.id)
        ).all()
        result.append(ConversationOut(
            id=c.id, title=c.title or "新对话",
            created_at=c.created_at, updated_at=c.updated_at,
            message_count=len(count),
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
    conv.updated_at = datetime.now()
    db.add(conv)

    db.commit()
    return {"reply": reply}


# ===== 通用 Chat（无会话） =====

@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    try:
        reply = run_agent_chat(request.message, request.history, db, user_id=current_user.id)
    except Exception as e:
        write_log("error", "ai", f"通用AI对话失败: {str(e)[:150]}", details=str(e), db=db)
        reply = f"AI 调用失败: {str(e)[:200]}"
    return ChatResponse(reply=reply)
