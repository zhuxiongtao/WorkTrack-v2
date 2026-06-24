import os
import uuid
import logging
from typing import Optional
from datetime import date
from app.utils.time import BEIJING_TZ, now

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, BackgroundTasks
from sqlmodel import Session, select

from app.database import get_session
from app.models.contract import Contract
from app.models.customer import Customer
from app.models.project import Project
from app.models.user import User
from app.models.seal import SealRequest
from app.models.payment import PaymentRequest
from app.models.approval import ApprovalInstance, ApprovalRecord
from app.auth import get_current_user, require_permission, has_permission, get_visible_user_ids, check_data_access
from app.schemas import ContractCreate, ContractUpdate, ContractOut
from app.services.contract_parser import extract_text, extract_text_with_vision_fallback, parse_contract, apply_parse_result, UPLOAD_DIR, extract_text_from_docx, extract_text_from_legacy_doc
from app.services.vector_store import index_document
from app.routers.logs import write_log

logger = logging.getLogger("worktrack")

router = APIRouter(prefix="/api/v1/contracts", tags=["合同"])

os.makedirs(UPLOAD_DIR, exist_ok=True)


def _get_file_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    return ext


@router.get("", response_model=list[ContractOut])
def list_contracts(
    customer_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    user_ids: Optional[str] = Query(None, description="逗号分隔的用户ID列表，用于团队视图筛选"),
    current_user: User = Depends(require_permission("contract:read")),
    db: Session = Depends(get_session),
):
    query = select(Contract).order_by(Contract.created_at.desc())
    visible_ids = get_visible_user_ids(current_user, db, module="contract")
    if user_ids:
        uid_list = [int(x) for x in user_ids.split(",") if x.strip().isdigit()]
        if visible_ids is not None:
            uid_list = [uid for uid in uid_list if uid in visible_ids]
        if uid_list:
            query = query.where(Contract.user_id.in_(uid_list))
    else:
        if visible_ids is not None:
            query = query.where(Contract.user_id.in_(visible_ids))
    if customer_id:
        query = query.where(Contract.customer_id == customer_id)
    if project_id:
        query = query.where(Contract.project_id == project_id)
    if status:
        query = query.where(Contract.status == status)
    if keyword:
        escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.where(
            (Contract.title.ilike(pattern)) |
            (Contract.contract_no.ilike(pattern)) |
            (Contract.summary.ilike(pattern)) |
            (Contract.raw_text.ilike(pattern))
        )
    return db.exec(query).all()


@router.post("", response_model=ContractOut, status_code=201)
async def create_contract(
    title: str = Form(...),
    contract_type: str = Form(""),
    customer_id: Optional[int] = Form(None),
    project_id: Optional[int] = Form(None),
    contract_no: str = Form(""),
    sign_date: Optional[date] = Form(None),
    start_date: Optional[date] = Form(None),
    end_date: Optional[date] = Form(None),
    party_a: str = Form(""),
    party_b: str = Form(""),
    contract_amount: Optional[float] = Form(None),
    amount_unit: str = Form("万元"),
    currency: str = Form("CNY"),
    payment_terms: Optional[str] = Form(None),
    remarks: Optional[str] = Form(None),
    seal_types_requested: str = Form(""),
    source: str = Form("external"),
    template_id: Optional[int] = Form(None),
    content_html: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_permission("contract:create")),
    db: Session = Depends(get_session),
    background_tasks: BackgroundTasks = None,
):
    if customer_id:
        customer = db.get(Customer, customer_id)
        if not customer:
            raise HTTPException(status_code=404, detail="客户不存在")
        can_access = (
            customer.user_id == current_user.id
            or current_user.is_admin
            or has_permission(current_user, "customer:view_all", db)
            or check_data_access(customer.user_id, current_user, db)
        )
        if not can_access:
            raise HTTPException(status_code=404, detail="客户不存在")

    file_path = ""
    file_name = ""
    file_type = ""
    file_size = 0

    if file and file.filename:
        _validate_file_extension(file.filename)
        ext = _get_file_type(file.filename)
        unique_name = f"{uuid.uuid4().hex}{ext}"
        save_path = os.path.join(UPLOAD_DIR, unique_name)
        raw_content = await file.read()
        with open(save_path, "wb") as fh:
            fh.write(raw_content)
        file_path = save_path
        file_name = file.filename or ""
        file_type = ext
        file_size = len(raw_content)

    contract = Contract(
        user_id=current_user.id,
        title=title,
        contract_type=contract_type,
        contract_no=contract_no,
        customer_id=customer_id,
        project_id=project_id,
        sign_date=sign_date,
        start_date=start_date,
        end_date=end_date,
        party_a=party_a,
        party_b=party_b,
        contract_amount=contract_amount,
        amount_unit=amount_unit,
        currency=currency,
        payment_terms=payment_terms,
        remarks=remarks,
        seal_types_requested=seal_types_requested,
        file_path=file_path,
        file_name=file_name,
        file_type=file_type,
        file_size=file_size,
        source=source,
        template_id=template_id,
        content_html=content_html,
        parse_status="parsing" if file_path else "pending",
        parse_error="",
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)

    if file_path and file_type:
        background_tasks.add_task(_auto_parse_contract_safe, contract.id, current_user.id)

    return contract


@router.post("/archive", response_model=ContractOut, status_code=201)
async def archive_historical_contract(
    title: str = Form(...),
    customer_id: Optional[int] = Form(None),
    contract_no: str = Form(""),
    contract_type: str = Form(""),
    sign_date: Optional[date] = Form(None),
    start_date: Optional[date] = Form(None),
    end_date: Optional[date] = Form(None),
    party_a: str = Form(""),
    party_b: str = Form(""),
    contract_amount: Optional[float] = Form(None),
    amount_unit: str = Form("万元"),
    currency: str = Form("CNY"),
    remarks: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("contract:archive")),
    db: Session = Depends(get_session),
    background_tasks: BackgroundTasks = None,
):
    if customer_id:
        customer = db.get(Customer, customer_id)
        if not customer:
            raise HTTPException(status_code=404, detail="客户不存在")
        can_access = (
            customer.user_id == current_user.id
            or current_user.is_admin
            or has_permission(current_user, "customer:view_all", db)
            or check_data_access(customer.user_id, current_user, db)
        )
        if not can_access:
            raise HTTPException(status_code=404, detail="客户不存在")

    if not file.filename:
        raise HTTPException(status_code=400, detail="历史归档必须上传合同文件")
    _validate_file_extension(file.filename)
    ext = _get_file_type(file.filename)
    unique_name = f"{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(UPLOAD_DIR, unique_name)
    raw_content = await file.read()
    with open(save_path, "wb") as fh:
        fh.write(raw_content)

    contract = Contract(
        user_id=current_user.id,
        title=title,
        contract_no=contract_no,
        contract_type=contract_type,
        customer_id=customer_id,
        sign_date=sign_date,
        start_date=start_date,
        end_date=end_date,
        party_a=party_a,
        party_b=party_b,
        contract_amount=contract_amount,
        amount_unit=amount_unit,
        currency=currency,
        remarks=remarks,
        file_path=save_path,
        file_name=file.filename,
        file_type=ext,
        file_size=len(raw_content),
        source="external",
        # 历史归档：直接生效，上传件即为签章留底
        status="生效中",
        is_historical=True,
        signed_file_path=save_path,
        signed_file_name=file.filename,
        parse_status="parsing",
        parse_error="",
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)

    background_tasks.add_task(_auto_parse_contract_safe, contract.id, current_user.id)
    return contract


def _auto_parse_contract_safe(contract_id: int, user_id: int):
    from app.database import engine
    from sqlmodel import Session as SqlSession
    db = SqlSession(engine)
    try:
        _auto_parse_contract(contract_id, user_id, db)
    except Exception as e:
        logging.getLogger(__name__).exception("后台解析合同 #%d 失败: %s", contract_id, e)
        # 异常兜底：把 status 写为 failed，让前端能感知
        try:
            from app.services.contract_parser import apply_parse_result
            c2 = db.get(Contract, contract_id)
            if c2 and c2.parse_status == "parsing":
                c2.parse_status = "failed"
                c2.parse_error = f"后台任务异常: {str(e)[:300]}"
                from datetime import datetime
                c2.parsed_at = now()
                db.add(c2)
                db.commit()
        except Exception as e2:
            logging.getLogger(__name__).exception("写入失败状态失败: %s", e2)
    finally:
        db.close()


def _auto_parse_contract(contract_id: int, user_id: int, db: Session):
    try:
        write_log("info", "contract", f"开始后台解析合同 #{contract_id}", db=db)
        contract = db.get(Contract, contract_id)
        if not contract or not contract.file_path or not os.path.exists(contract.file_path):
            if contract:
                contract.parse_status = "failed"
                contract.parse_error = "文件不存在或路径为空"
                from datetime import datetime
                contract.parsed_at = now()
                db.add(contract)
                db.commit()
            return
        try:
            raw_text = extract_text_with_vision_fallback(contract.file_path, contract.file_type, db, user_id)
        except Exception as e:
            from datetime import datetime
            contract.parse_status = "failed"
            contract.parse_error = f"文本提取失败: {str(e)[:300]}"
            contract.parsed_at = now()
            db.add(contract)
            db.commit()
            write_log("warning", "contract", f"合同 #{contract_id} 文本提取失败: {str(e)[:200]}", db=db)
            return
        if not raw_text:
            from datetime import datetime
            contract.parse_status = "failed"
            contract.parse_error = "无法提取文件文本内容（可能是扫描件且未配置视觉模型）"
            contract.parsed_at = now()
            db.add(contract)
            db.commit()
            write_log("warning", "contract", f"合同 #{contract_id} 无法提取文字内容", db=db)
            return
        contract.raw_text = raw_text
        result = parse_contract(raw_text, db, user_id)
        # 阶段 1+2：使用新的 apply_parse_result 一站式回填（含 confidence/source_text）
        apply_parse_result(contract, result)
        db.add(contract)
        db.commit()
        # 写入向量索引
        if contract.parse_status == "success":
            try:
                index_document("contracts", str(contract.id),
                    f"{contract.title} {contract.contract_no} {contract.party_b} {contract.summary or ''} {contract.key_clauses or ''}",
                    {"user_id": user_id, "customer_id": contract.customer_id, "type": "contract"},
                    db)
            except Exception as e:
                logger.error("后台索引合同向量失败: %s", e)
        write_log("info", "contract", f"后台解析合同 #{contract_id} {contract.parse_status}", db=db)
    except Exception as e:
        try:
            from datetime import datetime
            contract = db.get(Contract, contract_id)
            if contract:
                contract.parse_status = "failed"
                contract.parse_error = f"解析异常: {str(e)[:300]}"
                contract.parsed_at = now()
                db.add(contract)
                db.commit()
            write_log("warning", "contract", f"后台解析合同失败: {str(e)[:200]}", db=db)
        except Exception as e2:
            logger.error("写入日志失败: %s", e2)


@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(contract_id: int, current_user: User = Depends(require_permission("contract:read")), db: Session = Depends(get_session)):
    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")
    
    # 统一角色权限核验
    from app.auth import check_data_access, check_share_access
    if not check_data_access(contract.user_id, current_user, db):
        # DataShare fallback
        if not check_share_access("contract", contract_id, current_user, db):
            raise HTTPException(status_code=403, detail="无权查看该合同")
    
    return contract


@router.put("/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: int, data: ContractUpdate, current_user: User = Depends(require_permission("contract:edit")), db: Session = Depends(get_session)):
    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")
    if contract.user_id is not None and not check_data_access(contract.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权编辑该合同")
    # 审批进行中禁止编辑（管理员除外），保证审批所依据的内容不被中途篡改
    from app.services import approval_engine
    if not current_user.is_admin and approval_engine.get_active_instance("contract", contract_id, db):
        raise HTTPException(status_code=400, detail="合同正在审批中，暂不可编辑")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(contract, key, value)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


@router.delete("/{contract_id}", status_code=204)
def delete_contract(contract_id: int, current_user: User = Depends(require_permission("contract:delete")), db: Session = Depends(get_session)):
    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")
    if contract.file_path and os.path.exists(contract.file_path):
        try:
            os.remove(contract.file_path)
        except Exception as e:
            logger.error("删除合同文件失败: %s", e)
    # 级联删除关联记录（避免 FK 约束报错）
    instances = db.exec(select(ApprovalInstance).where(ApprovalInstance.target_type == "contract", ApprovalInstance.target_id == contract_id)).all()
    for inst in instances:
        for rec in db.exec(select(ApprovalRecord).where(ApprovalRecord.instance_id == inst.id)).all():
            db.delete(rec)
    db.flush()  # ApprovalRecord 必须先于 ApprovalInstance 落库（FK 约束）
    for inst in instances:
        db.delete(inst)
    for row in db.exec(select(SealRequest).where(SealRequest.contract_id == contract_id)).all():
        db.delete(row)
    for row in db.exec(select(PaymentRequest).where(PaymentRequest.contract_id == contract_id)).all():
        db.delete(row)
    db.delete(contract)
    db.commit()


@router.get("/{contract_id}/approval-preview")
def get_contract_approval_preview(
    contract_id: int,
    current_user: User = Depends(require_permission("contract:edit")),
    db: Session = Depends(get_session),
):
    """预览合同提交审批后的节点和审批人（解析为真实姓名）"""
    import json
    from app.services import approval_engine
    from sqlmodel import select as sq_select
    from app.models.user import User as UserModel

    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")

    flow = approval_engine.match_flow("contract", contract, db)
    if not flow:
        return {"nodes": [], "no_flow": True}

    nodes = json.loads(flow.nodes or "[]")
    nodes.sort(key=lambda n: n.get("order", 0))

    result = []
    for n in nodes:
        approver_ids = approval_engine.resolve_approvers(
            n.get("approver_type", ""), str(n.get("approver_value", "")), current_user, db
        )
        names = []
        if approver_ids:
            users = db.exec(sq_select(UserModel).where(UserModel.id.in_(approver_ids))).all()
            names = [u.name or u.username for u in users]
        result.append({
            "name": n.get("name", ""),
            "order": n.get("order", 0),
            "approver_type": n.get("approver_type", ""),
            "approver_names": names,
            "node_kind": n.get("node_kind", "approval"),
        })
    return {"nodes": result, "no_flow": False}


@router.post("/{contract_id}/submit-approval")
def submit_contract_approval(
    contract_id: int,
    current_user: User = Depends(require_permission("contract:edit")),
    db: Session = Depends(get_session),
):
    """提交合同审批：按合同审批模板发起多级审批流。
    无匹配模板（如未达金额阈值）则直接生效。"""
    from datetime import datetime
    from app.services import approval_engine

    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")
    if contract.user_id is not None and not check_data_access(contract.user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权操作该合同")
    if approval_engine.get_active_instance("contract", contract_id, db):
        raise HTTPException(status_code=400, detail="该合同已有进行中的审批")

    try:
        inst = approval_engine.start_approval(
            "contract", contract_id, contract,
            f"合同《{contract.title}》审批", current_user, db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if inst is None:
        contract.status = "生效中"
        contract.updated_at = now()
        db.add(contract)
        db.commit()
        write_log("info", "contract", f"合同 #{contract_id} 无需审批，直接生效", db=db)
        return {"approval_id": None, "status": contract.status, "message": "该合同无需审批，已直接生效"}

    # 实例仍在审批中才置「审批中」；若节点被自动跳过而即时通过，引擎已回写状态
    if inst.status == "pending":
        contract.status = "审批中"
        contract.updated_at = now()
        db.add(contract)
        db.commit()
    db.refresh(contract)
    write_log("info", "contract", f"合同 #{contract_id} 提交审批（实例 #{inst.id}）", db=db)
    return {"approval_id": inst.id, "status": contract.status, "message": "已提交审批"}


@router.post("/{contract_id}/revoke-approval")
def revoke_contract_approval(
    contract_id: int,
    current_user: User = Depends(require_permission("contract:edit")),
    db: Session = Depends(get_session),
):
    """撤回进行中的合同审批，合同状态恢复为草稿可重新编辑。"""
    from app.services import approval_engine

    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")

    inst = approval_engine.get_active_instance("contract", contract_id, db)
    if not inst:
        raise HTTPException(status_code=400, detail="该合同没有进行中的审批")

    try:
        approval_engine.cancel(inst, current_user, db)
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.refresh(contract)
    write_log("info", "contract", f"合同 #{contract_id} 审批已撤回", db=db)
    return {"status": contract.status, "message": "审批已撤回，合同可重新编辑"}


@router.get("/{contract_id}/file")
def download_contract_file(contract_id: int, preview: bool = Query(False), convert: Optional[str] = Query(None, description="convert=pdf 把 DOC/DOCX 转 PDF"), current_user: User = Depends(require_permission("contract:read")), db: Session = Depends(get_session)):
    from fastapi.responses import FileResponse
    from urllib.parse import quote
    contract = db.get(Contract, contract_id)
    if not contract or not check_data_access(contract.user_id, current_user, db):
        raise HTTPException(status_code=404, detail="合同不存在")
    if not contract.file_path or not os.path.exists(contract.file_path):
        raise HTTPException(status_code=404, detail="合同文件不存在")

    ext = (contract.file_type or '').lower()
    media_type_map = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
    }
    media_type = media_type_map.get(ext)

    def _content_disposition(disp: str, filename: str) -> str:
        """构建 Content-Disposition，兼容中文文件名（RFC 5987 percent-encoding）"""
        # 把 filename 全部用 UTF-8 percent-encoding + filename* 形式，老浏览器忽略
        encoded = quote(filename, safe='')
        return f"{disp}; filename=\"contract\"; filename*=UTF-8''{encoded}"

    # DOC/DOCX + convert=pdf：实时调 LibreOffice 转 PDF（缓存到 preview_cache/）
    if convert == "pdf" and ext in (".doc", ".docx"):
        from app.services.preview_converter import ensure_pdf_preview
        pdf_path, err = ensure_pdf_preview(
            contract_id=contract.id,
            src_path=contract.file_path,
            file_type=ext,
            contracts_dir=UPLOAD_DIR,
        )
        if not pdf_path:
            raise HTTPException(status_code=503, detail=err or "DOC/DOCX 转 PDF 失败")
        download_name = (contract.file_name or "contract") + ".pdf"
        return FileResponse(
            pdf_path,
            filename=download_name,
            media_type="application/pdf",
            headers={"Content-Disposition": _content_disposition("inline", download_name)}
        )

    if preview:
        return FileResponse(
            contract.file_path,
            filename=contract.file_name,
            media_type=media_type,
            headers={"Content-Disposition": _content_disposition("inline", contract.file_name)}
        )
    return FileResponse(contract.file_path, filename=contract.file_name)


@router.get("/{contract_id}/parse-status")
def get_parse_status(contract_id: int, current_user: User = Depends(require_permission("contract:read")), db: Session = Depends(get_session)):
    """轻量轮询接口：返回当前合同的解析状态（用于前端 2s 轮询）"""
    from app.auth import check_data_access, check_share_access
    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")
    if not check_data_access(contract.user_id, current_user, db):
        if not check_share_access("contract", contract_id, current_user, db):
            raise HTTPException(status_code=403, detail="无权查看该合同")
    return {
        "id": contract.id,
        "parse_status": contract.parse_status or "pending",
        "parse_error": contract.parse_error or "",
        "parsed_at": contract.parsed_at.isoformat() if contract.parsed_at else None,
    }


@router.post("/{contract_id}/reparse", response_model=ContractOut)
def reparse_contract(contract_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("contract:parse")), db: Session = Depends(get_session)):
    """手动重解析：清空旧结果，重新走后台流程"""
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    if not contract.file_path or not os.path.exists(contract.file_path):
        raise HTTPException(status_code=400, detail="合同没有上传文件，无法重新解析")
    # 重置状态
    contract.parse_status = "parsing"
    contract.parse_error = ""
    contract.parsed_at = None
    db.add(contract)
    db.commit()
    db.refresh(contract)
    background_tasks.add_task(_auto_parse_contract_safe, contract.id, current_user.id)
    return contract


@router.post("/{contract_id}/parse", response_model=ContractOut)
def parse_contract_content(contract_id: int, current_user: User = Depends(require_permission("contract:parse")), db: Session = Depends(get_session)):
    """同步解析（保留以兼容老接口），实际已迁移到上传时自动后台解析"""
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    if not contract.file_path or not os.path.exists(contract.file_path):
        raise HTTPException(status_code=400, detail="合同没有上传文件")

    try:
        raw_text = extract_text_with_vision_fallback(contract.file_path, contract.file_type, db, current_user.id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"合同文件解析失败: {str(e)[:200]}")

    try:
        if not raw_text:
            raise HTTPException(status_code=400, detail="合同文件无法提取文字内容")
        contract.raw_text = raw_text
        result = parse_contract(raw_text, db, current_user.id)
        # 阶段 1+2：统一用 apply_parse_result 回填（含 confidence/source_text）
        apply_parse_result(contract, result)
        if contract.parse_status == "failed":
            write_log("warning", "contract", f"合同AI解析失败: {contract.parse_error}", db=db)
        elif contract.parse_status == "success":
            try:
                index_document("contracts", str(contract.id),
                    f"{contract.title} {contract.contract_no} {contract.party_b} {contract.summary or ''} {contract.key_clauses or ''}",
                    {"user_id": current_user.id, "customer_id": contract.customer_id, "type": "contract"},
                    db)
            except Exception as e:
                logger.error("索引合同向量失败: %s", e)
    except HTTPException:
        raise
    except Exception as e:
        write_log("warning", "contract", f"合同解析异常: {str(e)[:200]}", db=db)

    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


@router.get("/{contract_id}/preview-text")
def preview_contract_text(contract_id: int, current_user: User = Depends(require_permission("contract:read")), db: Session = Depends(get_session)):
    """提取合同原文用于在线预览（支持 PDF / DOCX / DOC）"""
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    if not contract.file_path or not os.path.exists(contract.file_path):
        raise HTTPException(status_code=404, detail="合同文件不存在")

    ext = (contract.file_type or '').lower()

    if ext == '.pdf':
        from app.services.contract_parser import extract_text_from_pdf
        text = extract_text_from_pdf(contract.file_path)
    elif ext == '.docx':
        text = extract_text_from_docx(contract.file_path)
    elif ext == '.doc':
        text = extract_text_from_legacy_doc(contract.file_path)
    else:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

    if not text:
        # 降级：尝试用通用提取方法
        text = extract_text(contract.file_path)

    if not text:
        raise HTTPException(status_code=400, detail="无法提取文件文本内容")

    return {"text": text, "file_name": contract.file_name, "file_type": contract.file_type}


def _validate_file_extension(filename: str):
    ALLOWED = {".pdf", ".doc", ".docx"}
    ext = _get_file_type(filename)
    if ext not in ALLOWED:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}，仅支持 PDF/DOC/DOCX")


SIGNED_DIR = os.path.join(os.path.dirname(UPLOAD_DIR), "signed_contracts")
os.makedirs(SIGNED_DIR, exist_ok=True)


@router.post("/{contract_id}/upload-signed", response_model=ContractOut)
async def upload_signed_contract(
    contract_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission("contract:edit")),
    db: Session = Depends(get_session),
):
    """上传签章后的扫描版合同作为留底"""
    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="合同不存在")

    ALLOWED_SIGNED = {".pdf", ".jpg", ".jpeg", ".png"}
    ext = _get_file_type(file.filename or "")
    if ext not in ALLOWED_SIGNED:
        raise HTTPException(status_code=400, detail="签章版仅支持 PDF/JPG/PNG 格式")

    # 删除旧签章文件
    if contract.signed_file_path and os.path.exists(contract.signed_file_path):
        try:
            os.remove(contract.signed_file_path)
        except Exception:
            pass

    unique_name = f"signed_{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(SIGNED_DIR, unique_name)
    raw_content = await file.read()
    with open(save_path, "wb") as fh:
        fh.write(raw_content)

    from app.utils.time import now, utc_now
    contract.signed_file_path = save_path
    contract.signed_file_name = file.filename or unique_name
    contract.updated_at = utc_now()
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


@router.get("/{contract_id}/signed-file")
def download_signed_file(
    contract_id: int,
    current_user: User = Depends(require_permission("contract:read")),
    db: Session = Depends(get_session),
):
    """下载签章归档文件"""
    from fastapi.responses import FileResponse
    from urllib.parse import quote
    contract = db.get(Contract, contract_id)
    if not contract or not check_data_access(contract.user_id, current_user, db):
        raise HTTPException(status_code=404, detail="合同不存在")
    if not contract.signed_file_path or not os.path.exists(contract.signed_file_path):
        raise HTTPException(status_code=404, detail="签章文件不存在")

    ext = _get_file_type(contract.signed_file_name or "")
    media_map = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
    media_type = media_map.get(ext, "application/octet-stream")
    encoded = quote(contract.signed_file_name or "signed", safe="")
    return FileResponse(
        contract.signed_file_path,
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename=\"signed\"; filename*=UTF-8''{encoded}"},
    )
