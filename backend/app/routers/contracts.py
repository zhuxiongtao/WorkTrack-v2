import os
import uuid
import threading
from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlmodel import Session, select

from app.database import get_session
from app.models.contract import Contract
from app.models.customer import Customer
from app.models.project import Project
from app.models.user import User
from app.auth import get_current_user
from app.schemas import ContractCreate, ContractUpdate, ContractOut
from app.services.contract_parser import extract_text, extract_text_with_vision_fallback, parse_contract, UPLOAD_DIR
from app.services.vector_store import index_document
from app.routers.logs import write_log

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(Contract).where(Contract.user_id == current_user.id).order_by(Contract.created_at.desc())
    if customer_id:
        query = query.where(Contract.customer_id == customer_id)
    if project_id:
        query = query.where(Contract.project_id == project_id)
    if status:
        query = query.where(Contract.status == status)
    if keyword:
        query = query.where(
            (Contract.title.contains(keyword)) |
            (Contract.contract_no.contains(keyword)) |
            (Contract.summary.contains(keyword)) |
            (Contract.raw_text.contains(keyword))
        )
    return db.exec(query).all()


@router.post("", response_model=ContractOut, status_code=201)
async def create_contract(
    title: str = Form(...),
    customer_id: int = Form(...),
    project_id: Optional[int] = Form(None),
    contract_no: str = Form(""),
    sign_date: Optional[date] = Form(None),
    start_date: Optional[date] = Form(None),
    end_date: Optional[date] = Form(None),
    party_a: str = Form(""),
    party_b: str = Form(""),
    contract_amount: Optional[float] = Form(None),
    currency: str = Form("CNY"),
    payment_terms: Optional[str] = Form(None),
    remarks: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")

    file_path = ""
    file_name = ""
    file_type = ""
    file_size = 0

    if file:
        _validate_file_extension(file.filename)
        ext = _get_file_type(file.filename)
        unique_name = f"{uuid.uuid4().hex}{ext}"
        save_path = os.path.join(UPLOAD_DIR, unique_name)
        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
        file_path = save_path
        file_name = file.filename or ""
        file_type = ext
        file_size = len(content)

    contract = Contract(
        user_id=current_user.id,
        title=title,
        contract_no=contract_no,
        customer_id=customer_id,
        project_id=project_id,
        sign_date=sign_date,
        start_date=start_date,
        end_date=end_date,
        party_a=party_a,
        party_b=party_b,
        contract_amount=contract_amount,
        currency=currency,
        payment_terms=payment_terms,
        remarks=remarks,
        file_path=file_path,
        file_name=file_name,
        file_type=file_type,
        file_size=file_size,
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)

    if file_path and file_type:
        threading.Thread(target=_auto_parse_contract, args=(contract.id, current_user.id), daemon=True).start()

    return contract


def _auto_parse_contract(contract_id: int, user_id: int):
    from app.database import engine
    from sqlmodel import Session as SqlSession
    db = SqlSession(engine)
    try:
        write_log("info", "contract", f"开始后台解析合同 #{contract_id}", db=db)
        contract = db.get(Contract, contract_id)
        if not contract or not contract.file_path or not os.path.exists(contract.file_path):
            return
        raw_text = extract_text_with_vision_fallback(contract.file_path, contract.file_type, db, user_id)
        if not raw_text:
            write_log("warning", "contract", f"合同 #{contract_id} 无法提取文字内容", db=db)
            return
        contract.raw_text = raw_text
        result = parse_contract(raw_text, db, user_id)
        if "error" not in result:
            if result.get("sign_date"):
                contract.sign_date = result["sign_date"]
            if result.get("start_date"):
                contract.start_date = result["start_date"]
            if result.get("end_date"):
                contract.end_date = result["end_date"]
            contract.party_a = result.get("party_a", contract.party_a)
            contract.party_b = result.get("party_b", contract.party_b)
            contract.contract_amount = result.get("contract_amount")
            contract.currency = result.get("currency", contract.currency)
            contract.payment_terms = result.get("payment_terms")
            contract.key_clauses = result.get("key_clauses")
            contract.summary = result.get("summary")
            try:
                index_document("contracts", str(contract.id),
                    f"{contract.title} {contract.contract_no} {contract.party_b} {contract.summary or ''}",
                    {"user_id": user_id, "customer_id": contract.customer_id, "type": "contract"},
                    db)
            except Exception:
                pass
        db.add(contract)
        db.commit()
        write_log("info", "contract", f"后台解析合同 #{contract_id} 完成", db=db)
    except Exception as e:
        try:
            write_log("warning", "contract", f"后台解析合同失败: {str(e)[:200]}", db=db)
        except Exception:
            pass
    finally:
        db.close()


@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(contract_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    return contract


@router.put("/{contract_id}", response_model=ContractOut)
def update_contract(contract_id: int, data: ContractUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(contract, key, value)
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


@router.delete("/{contract_id}", status_code=204)
def delete_contract(contract_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    if contract.file_path and os.path.exists(contract.file_path):
        try:
            os.remove(contract.file_path)
        except Exception:
            pass
    db.delete(contract)
    db.commit()


@router.get("/{contract_id}/file")
def download_contract_file(contract_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    from fastapi.responses import FileResponse
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    if not contract.file_path or not os.path.exists(contract.file_path):
        raise HTTPException(status_code=404, detail="合同文件不存在")
    return FileResponse(contract.file_path, filename=contract.file_name)


@router.post("/{contract_id}/parse", response_model=ContractOut)
def parse_contract_content(contract_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="合同不存在")
    if not contract.file_path or not os.path.exists(contract.file_path):
        raise HTTPException(status_code=400, detail="合同没有上传文件")

    try:
        raw_text = extract_text_with_vision_fallback(contract.file_path, contract.file_type, db, current_user.id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="合同文件解析失败，请确认文件格式正确")

    try:
        if not raw_text:
            raise HTTPException(status_code=400, detail="合同文件无法提取文字内容")
        contract.raw_text = raw_text
        result = parse_contract(raw_text, db, current_user.id)
        if "error" not in result:
            if result.get("sign_date"):
                contract.sign_date = result["sign_date"]
            if result.get("start_date"):
                contract.start_date = result["start_date"]
            if result.get("end_date"):
                contract.end_date = result["end_date"]
            contract.party_a = result.get("party_a", contract.party_a)
            contract.party_b = result.get("party_b", contract.party_b)
            contract.contract_amount = result.get("contract_amount")
            contract.currency = result.get("currency", contract.currency)
            contract.payment_terms = result.get("payment_terms")
            contract.key_clauses = result.get("key_clauses")
            contract.summary = result.get("summary")

            try:
                index_document("contracts", str(contract.id),
                    f"{contract.title} {contract.contract_no} {contract.party_b} {contract.summary or ''}",
                    {"user_id": current_user.id, "customer_id": contract.customer_id, "type": "contract"},
                    db)
            except Exception:
                pass
        else:
            write_log("warning", "contract", f"合同AI解析失败: {result['error']}", db=db)
    except HTTPException:
        raise
    except Exception as e:
        write_log("warning", "contract", f"合同解析异常: {str(e)[:200]}", db=db)

    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


def _validate_file_extension(filename: str):
    ALLOWED = {".pdf", ".doc", ".docx"}
    ext = _get_file_type(filename)
    if ext not in ALLOWED:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}，仅支持 PDF/DOC/DOCX")
