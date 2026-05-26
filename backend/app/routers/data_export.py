"""数据导出/导入功能：管理员可导出全部业务数据为JSON，支持导入恢复"""

import json
import io
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from app.database import get_session
from app.auth import require_permission
from app.models.user import User
from app.models.customer import Customer
from app.models.customer_contact import CustomerContact
from app.models.project import Project
from app.models.daily_report import DailyReport
from app.models.meeting_note import MeetingNote
from app.models.weekly_summary import WeeklySummary
from app.models.contract import Contract
from app.models.wiki import WikiSpace, WikiPage, WikiPermission, WikiPageVersion, UserGroup, UserGroupMember
from app.models.scheduled_task import ScheduledTask
from app.models.model_provider import ModelProvider, ProviderModel
from app.models.rbac import Permission, Role, RolePermission, UserRole, DepartmentRole, GroupRole
from app.models.department import Department
from app.models.field_option import FieldOption
from app.models.system_preference import SystemPreference
from app.models.ai_prompt import AIPrompt
from app.models.log_entry import LogEntry
from app.models.chat import ChatConversation, ChatMessage
from app.utils.time import utc_now

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/data", tags=["数据管理"])

EXPORT_MODELS = [
    ("users", User),
    ("departments", Department),
    ("customers", Customer),
    ("customer_contacts", CustomerContact),
    ("projects", Project),
    ("daily_reports", DailyReport),
    ("weekly_summaries", WeeklySummary),
    ("meeting_notes", MeetingNote),
    ("contracts", Contract),
    ("wiki_spaces", WikiSpace),
    ("wiki_pages", WikiPage),
    ("wiki_permissions", WikiPermission),
    ("wiki_page_versions", WikiPageVersion),
    ("user_groups", UserGroup),
    ("user_group_members", UserGroupMember),
    ("scheduled_tasks", ScheduledTask),
    ("model_providers", ModelProvider),
    ("provider_models", ProviderModel),
    ("rbac_permissions", Permission),
    ("rbac_roles", Role),
    ("rbac_role_permissions", RolePermission),
    ("rbac_user_roles", UserRole),
    ("rbac_department_roles", DepartmentRole),
    ("rbac_group_roles", GroupRole),
    ("field_options", FieldOption),
    ("system_preferences", SystemPreference),
    ("ai_prompts", AIPrompt),
    ("chat_conversations", ChatConversation),
    ("chat_messages", ChatMessage),
    ("log_entries", LogEntry),
]


def _model_to_dict(obj) -> dict:
    """将 SQLModel 对象转换为可序列化字典"""
    from sqlmodel import SQLModel
    result = {}
    fields = obj.model_fields if hasattr(obj, 'model_fields') else {}
    for col in fields:
        val = getattr(obj, col, None)
        if isinstance(val, datetime):
            val = val.isoformat()
        result[col] = val
    return result


@router.get("/export")
def export_data(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """导出全部业务数据为JSON文件（管理员权限）"""
    data = {
        "version": "2.0",
        "exported_at": utc_now().isoformat(),
        "exported_by": current_user.username,
        "data": {},
    }

    for name, model in EXPORT_MODELS:
        try:
            rows = db.exec(select(model)).all()
            data["data"][name] = [_model_to_dict(r) for r in rows]
        except Exception as e:
            logger.warning("导出 %s 失败: %s", name, e)
            data["data"][name] = []
            data["data"][f"_errors_{name}"] = str(e)

    json_bytes = json.dumps(data, ensure_ascii=False, indent=2, default=str).encode("utf-8")

    filename = f"worktrack_export_{utc_now().strftime('%Y%m%d_%H%M%S')}.json"
    return StreamingResponse(
        io.BytesIO(json_bytes),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/summary")
def export_summary(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """导出摘要：各表记录数，供管理员确认导出范围"""
    from sqlmodel import func
    summary = {}
    for name, model in EXPORT_MODELS:
        try:
            count = db.exec(select(func.count()).select_from(model)).one()
            summary[name] = count
        except Exception:
            summary[name] = -1
    return summary


@router.post("/import")
async def import_data(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("data:import")),
    db: Session = Depends(get_session),
):
    """从JSON文件导入数据（增量合并，已存在则跳过）"""
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="仅支持 .json 格式的导出文件")

    content = await file.read()
    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"JSON解析失败: {e}")

    if data.get("version") != "2.0":
        raise HTTPException(status_code=400, detail="不支持的导出文件版本")

    import_result = {"imported": {}, "skipped": {}, "errors": {}}
    model_map = {name: model for name, model in EXPORT_MODELS}

    for name, rows in data.get("data", {}).items():
        if name.startswith("_errors_"):
            continue
        if name not in model_map:
            continue

        model = model_map[name]
        imported = 0
        skipped = 0
        errors = 0

        for row_data in rows:
            try:
                existing = db.get(model, row_data.get("id"))
                if existing:
                    skipped += 1
                    continue
                obj = model(**{k: v for k, v in row_data.items() if k in model.model_fields})
                db.add(obj)
                imported += 1
            except Exception as e:
                errors += 1
                logger.warning("导入 %s id=%s 失败: %s", name, row_data.get("id"), e)

        if imported > 0:
            db.commit()
        import_result["imported"][name] = imported
        import_result["skipped"][name] = skipped
        if errors > 0:
            import_result["errors"][name] = errors

    return import_result
