"""数据管理模块：Excel 模块导出 + JSON/SQL 全量备份 + 数据恢复

功能架构：
- Excel 模块导出：按业务模块下载表格（支持时间范围筛选）
- JSON 全量备份：补齐 55+ 模型，按拓扑排序导出
- SQL dump 备份：pg_dump 整库快照，可完整恢复
- 备份历史：记录每次备份元信息，支持重新下载
- 数据恢复：上传 JSON，支持 dry-run 预检查 + skip/insert_only 策略
"""
import json
import os
import io
import subprocess
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.config import settings
from app.database import get_session, engine
from app.auth import require_permission
from app.models.user import User
from app.models.department import Department
from app.models.customer import Customer
from app.models.customer_contact import CustomerContact
from app.models.project import Project
from app.models.project_cost import ProjectCost
from app.models.project_follow_up import ProjectFollowUp
from app.models.contract import Contract
from app.models.contract_template import ContractTemplate
from app.models.meeting_note import MeetingNote
from app.models.meeting_collab import MeetingPermission, MeetingComment
from app.models.daily_report import DailyReport
from app.models.weekly_summary import WeeklySummary
from app.models.wiki import (
    WikiSpace, WikiPage, WikiPermission, WikiPageVersion,
    UserGroup, UserGroupMember,
)
from app.models.rbac import Permission, Role, RolePermission, UserRole, DepartmentRole, GroupRole
from app.models.scheduled_task import ScheduledTask
from app.models.model_provider import ModelProvider, ProviderModel, TaskModelConfig, ModelParamPreset
from app.models.field_option import FieldOption
from app.models.system_preference import SystemPreference
from app.models.ai_prompt import AIPrompt
from app.models.log_entry import LogEntry
from app.models.chat import ChatConversation, ChatMessage
from app.models.data_share import DataShare, DataShareComment
from app.models.news_cache import NewsCache
from app.models.model_catalog import ModelCatalog
from app.models.model_change import ModelChangeEvent, ModelChangeStage, ModelChangeCustomerTask
from app.models.model_usage_log import ModelUsageLog
from app.models.feedback import Feedback
from app.models.payment import PaymentRequest
from app.models.seal import SealRequest
from app.models.supplier import Supplier
from app.models.channel import Channel
from app.models.reconcile import ReconcileSales, ReconcileSupply, ReconcileSummary, ReconcileDiff
from app.models.approval import ApprovalFlow, ApprovalInstance, ApprovalRecord
from app.models.legal_entity import LegalEntity
from app.models.employee_loan import EmployeeLoan
from app.models.expense_request import ExpenseRequest
from app.models.expense_item import ExpenseItem
from app.models.expense_relation import ExpenseRelation
from app.models.business_trip_request import BusinessTripRequest
from app.models.leave_request import LeaveRequest
from app.models.leave_balance import LeaveBalance, LeaveBalanceLog
from app.models.overtime_request import OvertimeRequest
from app.models.purchase_request import PurchaseRequest
from app.models.purchase_supplier import PurchaseSupplier
from app.models.asset import Asset
from app.models.asset_record import AssetRecord
from app.models.backup_record import BackupRecord
from app.utils.time import utc_now
from app.services.excel_export_service import (
    EXCEL_MODULES, DOMAIN_LABELS, get_modules_summary, export_excel,
)

logger = logging.getLogger("worktrack")
router = APIRouter(prefix="/api/v1/data", tags=["数据管理"])

# ──────────────────────────────────────────────────────────────
# 备份目录（持久化到 /app/data/backups/）
# ──────────────────────────────────────────────────────────────
BACKUP_DIR = Path(settings.effective_data_root) / "backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)


# ──────────────────────────────────────────────────────────────
# JSON 全量备份模型清单（按拓扑排序，55+ 模型）
# 导入时按此顺序执行，避免外键约束冲突
# ──────────────────────────────────────────────────────────────
EXPORT_MODELS_V2 = [
    # ── 第 0 层：系统基础（无外键依赖）──
    ("users", User),
    ("departments", Department),
    ("permissions", Permission),
    ("roles", Role),
    ("legal_entities", LegalEntity),
    ("field_options", FieldOption),
    ("system_preferences", SystemPreference),
    ("ai_prompts", AIPrompt),
    ("news_cache", NewsCache),
    ("feedback", Feedback),
    ("contract_templates", ContractTemplate),
    ("purchase_suppliers", PurchaseSupplier),
    ("suppliers", Supplier),
    # ── 第 1 层：依赖第 0 层 ──
    ("customers", Customer),
    ("customer_contacts", CustomerContact),
    ("channels", Channel),
    ("role_permissions", RolePermission),
    ("user_roles", UserRole),
    ("department_roles", DepartmentRole),
    ("group_roles", GroupRole),
    ("user_groups", UserGroup),
    ("scheduled_tasks", ScheduledTask),
    ("model_providers", ModelProvider),
    ("approval_flows", ApprovalFlow),
    ("employee_loans", EmployeeLoan),
    # ── 第 2 层：依赖第 1 层 ──
    ("projects", Project),
    ("contracts", Contract),
    ("wiki_spaces", WikiSpace),
    ("user_group_members", UserGroupMember),
    ("provider_models", ProviderModel),
    ("task_model_configs", TaskModelConfig),
    ("model_param_presets", ModelParamPreset),
    ("model_catalogs", ModelCatalog),
    # ── 第 3 层：业务主体 ──
    ("daily_reports", DailyReport),
    ("weekly_summaries", WeeklySummary),
    ("meeting_notes", MeetingNote),
    ("meeting_permissions", MeetingPermission),
    ("meeting_comments", MeetingComment),
    ("project_costs", ProjectCost),
    ("project_follow_ups", ProjectFollowUp),
    ("payment_requests", PaymentRequest),
    ("seal_requests", SealRequest),
    ("expense_requests", ExpenseRequest),
    ("business_trips", BusinessTripRequest),
    ("leave_requests", LeaveRequest),
    ("overtime_requests", OvertimeRequest),
    ("purchase_requests", PurchaseRequest),
    ("assets", Asset),
    ("leave_balances", LeaveBalance),
    ("data_shares", DataShare),
    ("model_change_events", ModelChangeEvent),
    ("chat_conversations", ChatConversation),
    # ── 第 4 层：业务明细 / 子表 ──
    ("expense_items", ExpenseItem),
    ("expense_relations", ExpenseRelation),
    ("asset_records", AssetRecord),
    ("leave_balance_logs", LeaveBalanceLog),
    ("approval_instances", ApprovalInstance),
    ("approval_records", ApprovalRecord),
    ("wiki_pages", WikiPage),
    ("wiki_permissions", WikiPermission),
    ("wiki_page_versions", WikiPageVersion),
    ("data_share_comments", DataShareComment),
    ("model_change_stages", ModelChangeStage),
    ("model_change_customer_tasks", ModelChangeCustomerTask),
    ("model_usage_logs", ModelUsageLog),
    ("reconcile_sales", ReconcileSales),
    ("reconcile_supply", ReconcileSupply),
    ("reconcile_summaries", ReconcileSummary),
    ("reconcile_diffs", ReconcileDiff),
    ("chat_messages", ChatMessage),
    ("log_entries", LogEntry),
]


def _model_to_dict(obj) -> dict:
    """将 SQLModel 对象转换为可序列化字典"""
    result = {}
    fields = obj.model_fields if hasattr(obj, 'model_fields') else {}
    for col in fields:
        val = getattr(obj, col, None)
        if isinstance(val, datetime):
            val = val.isoformat()
        result[col] = val
    return result


def _get_backup_dir() -> Path:
    """确保备份目录存在并返回路径"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return BACKUP_DIR


def _format_size(size_bytes: int) -> str:
    """格式化文件大小"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


# ══════════════════════════════════════════════════════════════
# Excel 模块导出
# ══════════════════════════════════════════════════════════════

@router.get("/excel/modules")
def list_excel_modules(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """列出可导出的业务模块及各模块记录数"""
    modules = get_modules_summary(db)
    return {
        "modules": modules,
        "domains": DOMAIN_LABELS,
    }


class ExcelExportRequest(BaseModel):
    modules: list[str]
    date_from: Optional[str] = None
    date_to: Optional[str] = None


@router.post("/excel/export")
def export_excel_modules(
    req: ExcelExportRequest,
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """导出选中模块为 Excel 文件"""
    if not req.modules:
        raise HTTPException(status_code=400, detail="请至少选择一个模块")

    valid_keys = {m["key"] for m in EXCEL_MODULES}
    invalid = [k for k in req.modules if k not in valid_keys]
    if invalid:
        raise HTTPException(status_code=400, detail=f"未知的模块: {', '.join(invalid)}")

    try:
        buf = export_excel(db, req.modules, req.date_from, req.date_to)
    except Exception as e:
        logger.error("Excel 导出失败: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"导出失败: {e}")

    # 记录备份历史
    content = buf.getvalue()
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"excel_export_{timestamp}.xlsx"
    file_path = _get_backup_dir() / filename
    with open(file_path, "wb") as f:
        f.write(content)

    record = BackupRecord(
        backup_type="excel",
        filename=filename,
        file_path=str(file_path.relative_to(_get_backup_dir())),
        size_bytes=len(content),
        model_count=len(req.modules),
        record_count=0,
        modules=",".join(req.modules),
        operator_id=current_user.id,
        operator_name=current_user.name or current_user.username,
        note=f"Excel 模块导出：{', '.join(req.modules)}",
    )
    db.add(record)
    db.commit()

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ══════════════════════════════════════════════════════════════
# JSON 全量备份
# ══════════════════════════════════════════════════════════════

@router.get("/backup/json")
def backup_json(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """JSON 全量备份（55+ 模型，按拓扑排序）"""
    data = {
        "version": "3.0",
        "exported_at": utc_now().isoformat(),
        "exported_by": current_user.name or current_user.username,
        "model_count": len(EXPORT_MODELS_V2),
        "data": {},
    }

    total_records = 0
    for name, model in EXPORT_MODELS_V2:
        try:
            rows = db.exec(select(model)).all()
            data["data"][name] = [_model_to_dict(r) for r in rows]
            total_records += len(rows)
        except Exception as e:
            logger.warning("备份 %s 失败: %s", name, e)
            data["data"][name] = []
            data["data"][f"_errors_{name}"] = str(e)

    data["record_count"] = total_records
    json_bytes = json.dumps(data, ensure_ascii=False, indent=2, default=str).encode("utf-8")

    # 持久化到备份目录
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_json_{timestamp}.json"
    file_path = _get_backup_dir() / filename
    with open(file_path, "wb") as f:
        f.write(json_bytes)

    # 记录备份历史
    record = BackupRecord(
        backup_type="json",
        filename=filename,
        file_path=str(file_path.relative_to(_get_backup_dir())),
        size_bytes=len(json_bytes),
        model_count=len(EXPORT_MODELS_V2),
        record_count=total_records,
        operator_id=current_user.id,
        operator_name=current_user.name or current_user.username,
        note=f"JSON 全量备份（{len(EXPORT_MODELS_V2)} 模型 / {total_records} 条记录）",
    )
    db.add(record)
    db.commit()

    return StreamingResponse(
        io.BytesIO(json_bytes),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ══════════════════════════════════════════════════════════════
# SQL dump 备份
# ══════════════════════════════════════════════════════════════

@router.get("/backup/sql")
def backup_sql(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """SQL dump 全量备份（pg_dump，可完整恢复整库）"""
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_sql_{timestamp}.dump"
    file_path = _get_backup_dir() / filename

    # 从 database_url 解析连接参数
    db_url = settings.database_url
    # pg_dump 直接使用 DATABASE_URL
    try:
        result = subprocess.run(
            ["pg_dump", "--no-owner", "--no-privileges", "--format=custom",
             f"--file={file_path}", db_url],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            logger.error("pg_dump 失败: %s", result.stderr)
            raise HTTPException(status_code=500, detail=f"SQL 备份失败: {result.stderr}")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="服务器未安装 pg_dump 工具")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="SQL 备份超时（5分钟）")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("SQL 备份异常: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"SQL 备份异常: {e}")

    size = file_path.stat().st_size if file_path.exists() else 0

    # 统计记录数
    record_count = 0
    for name, model in EXPORT_MODELS_V2:
        try:
            count = db.exec(select(func.count()).select_from(model)).one()
            record_count += count
        except Exception:
            pass

    # 记录备份历史
    record = BackupRecord(
        backup_type="sql",
        filename=filename,
        file_path=str(file_path.relative_to(_get_backup_dir())),
        size_bytes=size,
        model_count=len(EXPORT_MODELS_V2),
        record_count=record_count,
        operator_id=current_user.id,
        operator_name=current_user.name or current_user.username,
        note=f"SQL dump 全量备份（{_format_size(size)}）",
    )
    db.add(record)
    db.commit()

    return {
        "success": True,
        "filename": filename,
        "size": size,
        "size_label": _format_size(size),
        "record_count": record_count,
        "message": f"SQL 备份成功，文件大小 {_format_size(size)}",
    }


# ══════════════════════════════════════════════════════════════
# 备份历史
# ══════════════════════════════════════════════════════════════

@router.get("/backup/history")
def backup_history(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
    backup_type: Optional[str] = Query(None),
):
    """获取备份历史列表"""
    stmt = select(BackupRecord).order_by(BackupRecord.created_at.desc()).limit(100)
    if backup_type:
        stmt = stmt.where(BackupRecord.backup_type == backup_type)

    records = db.exec(stmt).all()
    # 检查文件是否仍存在
    result = []
    for r in records:
        file_path = _get_backup_dir() / r.file_path
        exists = file_path.exists()
        if r.file_exists != exists:
            r.file_exists = exists
            db.add(r)
        result.append({
            "id": r.id,
            "backup_type": r.backup_type,
            "filename": r.filename,
            "size": r.size_bytes,
            "size_label": _format_size(r.size_bytes),
            "model_count": r.model_count,
            "record_count": r.record_count,
            "modules": r.modules,
            "operator_name": r.operator_name,
            "note": r.note,
            "file_exists": exists,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    db.commit()
    return {"records": result}


@router.get("/backup/{record_id}/download")
def download_backup(
    record_id: int,
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """下载历史备份文件"""
    record = db.get(BackupRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="备份记录不存在")

    file_path = _get_backup_dir() / record.file_path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="备份文件已被清理")

    media_type = {
        "json": "application/json",
        "sql": "application/octet-stream",
        "excel": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }.get(record.backup_type, "application/octet-stream")

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=record.filename,
    )


# ══════════════════════════════════════════════════════════════
# 数据恢复
# ══════════════════════════════════════════════════════════════

@router.post("/restore")
async def restore_data(
    file: UploadFile = File(...),
    strategy: str = Query("skip", pattern="^(skip|insert_only)$"),
    dry_run: bool = Query(False),
    current_user: User = Depends(require_permission("data:import")),
    db: Session = Depends(get_session),
):
    """从 JSON 文件恢复数据

    策略：
    - skip: 已存在 ID 跳过，仅导入新数据（最安全，默认）
    - insert_only: 仅导入新 ID，已存在跳过（与 skip 等价，语义更明确）

    dry_run=True 时仅预检查，不实际写入，返回将新增/跳过的统计
    """
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="仅支持 .json 格式的备份文件")

    content = await file.read()
    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"JSON 解析失败: {e}")

    if data.get("version") not in ("2.0", "3.0"):
        raise HTTPException(status_code=400, detail="不支持的备份文件版本")

    model_map = {name: model for name, model in EXPORT_MODELS_V2}
    result = {
        "dry_run": dry_run,
        "strategy": strategy,
        "would_import": {},
        "would_skip": {},
        "imported": {},
        "skipped": {},
        "errors": {},
        "total_would_import": 0,
        "total_would_skip": 0,
        "total_imported": 0,
        "total_skipped": 0,
    }

    for name, rows in data.get("data", {}).items():
        if name.startswith("_errors_"):
            continue
        if name not in model_map:
            continue

        model = model_map[name]
        would_import = 0
        would_skip = 0
        imported = 0
        skipped = 0
        errors = 0

        for row_data in rows:
            try:
                existing = db.get(model, row_data.get("id"))
                if existing:
                    would_skip += 1
                    skipped += 1
                    continue
                would_import += 1
                if not dry_run:
                    obj = model(**{k: v for k, v in row_data.items() if k in model.model_fields})
                    db.add(obj)
                    imported += 1
            except Exception as e:
                errors += 1
                logger.warning("恢复 %s id=%s 失败: %s", name, row_data.get("id"), e)

        if not dry_run and imported > 0:
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                logger.error("提交 %s 失败，已回滚: %s", name, e)
                result["errors"][name] = str(e)
                imported = 0
                skipped = len(rows) - errors

        result["would_import"][name] = would_import
        result["would_skip"][name] = would_skip
        result["imported"][name] = imported
        result["skipped"][name] = skipped
        if errors > 0:
            result["errors"][name] = errors
        result["total_would_import"] += would_import
        result["total_would_skip"] += would_skip
        result["total_imported"] += imported
        result["total_skipped"] += skipped

    return result


# ══════════════════════════════════════════════════════════════
# 导出摘要（兼容旧接口）
# ══════════════════════════════════════════════════════════════

@router.get("/export/summary")
def export_summary(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """导出摘要：各表记录数（使用 V2 模型清单）"""
    summary = {}
    for name, model in EXPORT_MODELS_V2:
        try:
            count = db.exec(select(func.count()).select_from(model)).one()
            summary[name] = count
        except Exception:
            summary[name] = -1
    return summary


# ──────────────────────────────────────────────────────────────
# 兼容旧接口（/export, /import）—— 转发到新接口
# ──────────────────────────────────────────────────────────────

@router.get("/export")
def export_data_legacy(
    current_user: User = Depends(require_permission("data:export")),
    db: Session = Depends(get_session),
):
    """[兼容] 导出全部业务数据为 JSON（转发到 V2 备份）"""
    return backup_json(current_user=current_user, db=db)


@router.post("/import")
async def import_data_legacy(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("data:import")),
    db: Session = Depends(get_session),
):
    """[兼容] 从 JSON 文件导入数据（转发到 V2 恢复，skip 策略）"""
    return await restore_data(file=file, strategy="skip", dry_run=False,
                              current_user=current_user, db=db)
