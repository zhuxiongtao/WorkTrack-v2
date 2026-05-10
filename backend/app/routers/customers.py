from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select
from app.database import get_session
from app.models.customer import Customer
from app.models.customer_contact import CustomerContact
from app.models.project import Project
from app.models.meeting_note import MeetingNote
from app.models.user import User
from app.auth import get_current_user
from app.schemas import CustomerCreate, CustomerUpdate, CustomerOut, CompanySearchRequest, CompanyInfoRequest
from app.schemas import CustomerContactCreate, CustomerContactUpdate, CustomerContactOut
from app.services.vector_store import index_document, delete_document
from app.services.ai_service import search_company_names, fetch_company_info, refresh_company_news
from app.routers.logs import write_log

router = APIRouter(prefix="/api/v1/customers", tags=["客户"])


@router.get("", response_model=list[CustomerOut])
def list_customers(
    status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(Customer).where(Customer.user_id == current_user.id).order_by(Customer.created_at.desc())
    if status:
        query = query.where(Customer.status == status)
    return db.exec(query).all()


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(data: CustomerCreate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    create_data = data.model_dump()
    create_data["user_id"] = current_user.id
    customer = Customer(**create_data)
    db.add(customer)
    db.commit()
    db.refresh(customer)
    background_tasks.add_task(
        index_document,
        collection_name="customers",
        doc_id=str(customer.id),
        text=f"{customer.name} {customer.industry or ''}",
        metadata={"status": customer.status, "user_id": customer.user_id},
    )
    return customer


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, data: CustomerUpdate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(customer, key, value)
    db.add(customer)
    db.commit()
    db.refresh(customer)
    background_tasks.add_task(
        index_document,
        collection_name="customers",
        doc_id=str(customer.id),
        text=f"{customer.name} {customer.industry or ''}",
        metadata={"status": customer.status, "user_id": customer.user_id},
    )
    return customer


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    db.delete(customer)
    db.commit()
    background_tasks.add_task(delete_document, "customers", str(customer_id))


@router.get("/{customer_id}/overview")
def get_customer_overview(customer_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    projects = db.exec(
        select(Project).where(Project.customer_id == customer_id, Project.user_id == current_user.id)
    ).all()
    meetings = db.exec(
        select(MeetingNote).where(MeetingNote.customer_id == customer_id, MeetingNote.user_id == current_user.id).order_by(
            MeetingNote.meeting_date.desc()
        ).limit(10)
    ).all()
    return {
        "customer": customer,
        "projects": projects,
        "recent_meetings": meetings,
    }


@router.post("/search-company")
def search_company(request: CompanySearchRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """根据关键词搜索公司全称（AI 联网检索）"""
    try:
        results = search_company_names(request.keyword, db, current_user.id)
        return {"results": results}
    except Exception as e:
        write_log("error", "ai", f"公司搜索失败: {str(e)[:150]}", details=str(e), db=db)
        raise HTTPException(status_code=502, detail=f"公司搜索失败: {str(e)[:200]}")


@router.post("/fetch-company-info")
def fetch_company_info_endpoint(request: CompanyInfoRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """根据公司全称获取详细信息（AI 联网检索）"""
    try:
        info = fetch_company_info(request.company_name, db, current_user.id)
        return info
    except Exception as e:
        write_log("error", "ai", f"公司信息获取失败: {str(e)[:150]}", details=str(e), db=db)
        raise HTTPException(status_code=502, detail=f"公司信息获取失败: {str(e)[:200]}")


@router.post("/{customer_id}/refresh-news")
def refresh_customer_news(customer_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """单独刷新客户最新动态（聚焦半年内新闻）"""
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    try:
        news = refresh_company_news(customer.name, db, current_user.id)
        customer.recent_news = news
        db.add(customer)
        db.commit()
        return {"recent_news": news}
    except Exception as e:
        write_log("error", "ai", f"刷新客户动态失败: {str(e)[:150]}", details=str(e), db=db)
        raise HTTPException(status_code=502, detail=f"刷新客户动态失败: {str(e)[:200]}")


@router.get("/{customer_id}/contacts", response_model=list[CustomerContactOut])
def list_contacts(customer_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    return db.exec(select(CustomerContact).where(CustomerContact.customer_id == customer_id).order_by(CustomerContact.created_at.asc())).all()


@router.post("/{customer_id}/contacts", response_model=CustomerContactOut, status_code=201)
def create_contact(customer_id: int, data: CustomerContactCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    if data.is_primary:
        existing_primaries = db.exec(
            select(CustomerContact).where(CustomerContact.customer_id == customer_id, CustomerContact.is_primary == True)
        ).all()
        for c in existing_primaries:
            c.is_primary = False
            db.add(c)
    contact = CustomerContact(customer_id=customer_id, name=data.name, phone=data.phone, email=data.email, position=data.position, is_primary=data.is_primary)
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.put("/{customer_id}/contacts/{contact_id}", response_model=CustomerContactOut)
def update_contact(customer_id: int, contact_id: int, data: CustomerContactUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    contact = db.get(CustomerContact, contact_id)
    if not contact or contact.customer_id != customer_id:
        raise HTTPException(status_code=404, detail="联系人不存在")
    if data.name is not None:
        contact.name = data.name
    if data.phone is not None:
        contact.phone = data.phone
    if data.email is not None:
        contact.email = data.email
    if data.position is not None:
        contact.position = data.position
    if data.is_primary is not None and data.is_primary:
        existing_primaries = db.exec(
            select(CustomerContact).where(CustomerContact.customer_id == customer_id, CustomerContact.is_primary == True, CustomerContact.id != contact_id)
        ).all()
        for c in existing_primaries:
            c.is_primary = False
            db.add(c)
    if data.is_primary is not None:
        contact.is_primary = data.is_primary
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{customer_id}/contacts/{contact_id}", status_code=204)
def delete_contact(customer_id: int, contact_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="客户不存在")
    contact = db.get(CustomerContact, contact_id)
    if not contact or contact.customer_id != customer_id:
        raise HTTPException(status_code=404, detail="联系人不存在")
    db.delete(contact)
    db.commit()
