from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, Response
from sqlmodel import Session, select
from app.database import get_session
from app.models.customer import Customer
from app.models.customer_contact import CustomerContact
from app.models.project import Project
from app.models.meeting_note import MeetingNote
from app.models.contract import Contract
from app.models.user import User
from app.auth import get_current_user, require_permission, has_permission, get_visible_user_ids
from app.schemas import CustomerCreate, CustomerUpdate, CustomerOut, CompanySearchRequest, CompanyInfoRequest
from app.schemas import CustomerContactCreate, CustomerContactUpdate, CustomerContactOut
from app.services.vector_store import index_document, delete_document
from app.services.ai_service import search_company_names, fetch_company_info, refresh_company_news
from app.services.industry_service import get_industry_aggregation_from_db
from app.routers.logs import write_log
import httpx
import re as _re_logo
from app.services.cache import cached_call

router = APIRouter(prefix="/api/v1/customers", tags=["客户"])


def _can_access_customer(customer: Customer, current_user: User, db: Session) -> bool:
    if customer.user_id == current_user.id:
        return True
    if current_user.is_admin or has_permission(current_user, "customer:view_all", db):
        return True
    from app.auth import check_data_access
    return check_data_access(customer.user_id, current_user, db)


@router.get("", response_model=list[CustomerOut])
def list_customers(
    user_id: Optional[int] = Query(None),
    user_ids: Optional[str] = Query(None, description="逗号分隔的用户ID列表，用于团队视图筛选"),
    status: Optional[str] = Query(None),
    current_user: User = Depends(require_permission("customer:read")),
    db: Session = Depends(get_session),
):
    from app.auth import get_visible_user_ids
    visible_ids = get_visible_user_ids(current_user, db, module="customer")
    if user_ids:
        uid_list = [int(x) for x in user_ids.split(",") if x.strip().isdigit()]
        if visible_ids is not None:
            uid_list = [uid for uid in uid_list if uid in visible_ids]
        if uid_list:
            query = select(Customer).where(Customer.user_id.in_(uid_list)).order_by(Customer.created_at.desc())
        else:
            query = select(Customer).where(False).order_by(Customer.created_at.desc())
    elif user_id:
        if visible_ids is not None and user_id not in visible_ids:
            query = select(Customer).where(False).order_by(Customer.created_at.desc())
        else:
            query = select(Customer).where(Customer.user_id == user_id).order_by(Customer.created_at.desc())
    else:
        if visible_ids is None:
            query = select(Customer).order_by(Customer.created_at.desc())
        else:
            query = select(Customer).where(Customer.user_id.in_(visible_ids)).order_by(Customer.created_at.desc())
    if status:
        query = query.where(Customer.status == status)
    return db.exec(query).all()


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(data: CustomerCreate, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("customer:create")), db: Session = Depends(get_session)):
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
def update_customer(customer_id: int, data: CustomerUpdate, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("customer:edit")), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
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
def delete_customer(customer_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(require_permission("customer:delete")), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
        raise HTTPException(status_code=404, detail="客户不存在")

    # 级联清理关联数据：联系人、合同、会议、项目
    contacts = db.exec(select(CustomerContact).where(CustomerContact.customer_id == customer_id)).all()
    for ct in contacts:
        db.delete(ct)

    contracts = db.exec(select(Contract).where(Contract.customer_id == customer_id)).all()
    for c in contracts:
        db.delete(c)

    meetings = db.exec(select(MeetingNote).where(MeetingNote.customer_id == customer_id)).all()
    for m in meetings:
        m.customer_id = None  # 会议保留但解除关联

    projects = db.exec(select(Project).where(Project.customer_id == customer_id)).all()
    for p in projects:
        p.customer_id = None  # 项目保留但解除关联

    db.flush()
    db.delete(customer)
    db.commit()
    background_tasks.add_task(delete_document, "customers", str(customer_id))


@router.get("/{customer_id}/delete-preview")
def delete_preview(customer_id: int, current_user: User = Depends(require_permission("customer:delete")), db: Session = Depends(get_session)):
    """删除前预览：返回关联数据详情"""
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
        raise HTTPException(status_code=404, detail="客户不存在")

    contacts = db.exec(select(CustomerContact).where(CustomerContact.customer_id == customer_id)).all()
    contracts = db.exec(select(Contract).where(Contract.customer_id == customer_id)).all()
    meetings = db.exec(select(MeetingNote).where(MeetingNote.customer_id == customer_id)).all()
    projects = db.exec(select(Project).where(Project.customer_id == customer_id)).all()

    return {
        "customer_name": customer.name,
        "contacts": [{"name": ct.name, "position": ct.position} for ct in contacts],
        "contracts": [{"title": c.title, "contract_no": c.contract_no} for c in contracts],
        "meetings_count": len(meetings),
        "projects_count": len(projects),
    }


@router.get("/{customer_id}/overview")
def get_customer_overview(customer_id: int, current_user: User = Depends(require_permission("customer:read")), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="客户不存在")
    
    # 统一角色权限核验
    from app.auth import check_share_access
    if not _can_access_customer(customer, current_user, db):
        # DataShare fallback
        if not check_share_access("customer", customer_id, current_user, db):
            raise HTTPException(status_code=403, detail="无权查看该客户")
    
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
def search_company(request: CompanySearchRequest, current_user: User = Depends(require_permission("customer:read")), db: Session = Depends(get_session)):
    """根据关键词搜索公司全称

    加速策略：
    1. 先查本地 customer.name 模糊匹配（0.05s 内出，命中 >= 1 直接返回）
    2. 否则调 search_company_names：内部先 LLM（1-3s），LLM 不够时 Tavily 兜底
    3. 同一关键词 10 分钟内重复搜索走进程内缓存
    """
    from app.auth import get_visible_user_ids
    from app.services.cache import cached_call

    kw = (request.keyword or "").strip()
    if not kw:
        return {"results": []}

    # 阶段1：本地 customer.name 模糊匹配（带可见性过滤）
    visible_ids = get_visible_user_ids(current_user, db, module="customer")
    stmt = select(Customer).where(Customer.name.ilike(f"%{kw}%"))
    if visible_ids is not None:
        stmt = stmt.where(Customer.user_id.in_(visible_ids))
    local_hits = db.exec(stmt.limit(8)).all()
    if local_hits:
        results = [
            {"name": c.name, "full_name": c.name, "source": "local"}
            for c in local_hits
            if c.name
        ]
        if results:
            return {"results": results, "source": "local"}

    # 阶段2：调 service（内部 LRU 缓存 10 分钟 + LLM/Tavily）
    cache_key = f"search_company_api:u{current_user.id}:{kw.lower()}"

    def _compute():
        try:
            return search_company_names(kw, db, current_user.id)
        except Exception as e:
            write_log("error", "ai", f"公司搜索失败: {str(e)[:150]}", details=str(e), db=db)
            return [{"_error": f"公司搜索失败: {str(e)[:200]}"}]

    results, _hit = cached_call(cache_key, ttl=600, factory=_compute)
    return {"results": results, "source": "ai"}


@router.post("/fetch-company-info")
def fetch_company_info_endpoint(request: CompanyInfoRequest, current_user: User = Depends(require_permission("customer:read")), db: Session = Depends(get_session)):
    """根据公司全称获取详细信息（多源 AI 联网检索），如有 customer_id 则同步落库"""
    from app.services.ai_service import fetch_company_info
    try:
        info = fetch_company_info(request.company_name, db, current_user.id)
        # 如果传入了 customer_id，把 AI 采集结果回填到客户档案
        if request.customer_id and info:
            customer = db.get(Customer, request.customer_id)
            if customer and _can_access_customer(customer, current_user, db):
                for field in ("name", "industry", "core_products", "business_scope",
                              "scale", "profile", "recent_news", "logo_url",
                              "website", "ai_initiatives", "ai_evidence"):
                    val = info.get(field)
                    # 防御：list/dict 等非标类型转 str（避免后续 .strip() 报错）
                    if isinstance(val, (list, dict)):
                        import json as _json
                        val = _json.dumps(val, ensure_ascii=False)
                    if val:  # 仅在 AI 返回了非空值时覆盖
                        setattr(customer, field, val)
                db.add(customer)
                db.commit()
                db.refresh(customer)
                info["customer_id"] = customer.id
        return info
    except Exception as e:
        write_log("error", "ai", f"公司信息获取失败: {str(e)[:150]}", details=str(e), db=db)
        raise HTTPException(status_code=502, detail=f"公司信息获取失败: {str(e)[:200]}")


@router.post("/{customer_id}/refresh-news")
def refresh_customer_news(customer_id: int, current_user: User = Depends(require_permission("customer:edit")), db: Session = Depends(get_session)):
    """单独刷新客户最新动态（聚焦半年内新闻）"""
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
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
def list_contacts(customer_id: int, current_user: User = Depends(require_permission("customer:read")), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
        raise HTTPException(status_code=404, detail="客户不存在")
    return db.exec(select(CustomerContact).where(CustomerContact.customer_id == customer_id).order_by(CustomerContact.created_at.asc())).all()


@router.post("/{customer_id}/contacts", response_model=CustomerContactOut, status_code=201)
def create_contact(customer_id: int, data: CustomerContactCreate, current_user: User = Depends(require_permission("customer:create")), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
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
def update_contact(customer_id: int, contact_id: int, data: CustomerContactUpdate, current_user: User = Depends(require_permission("customer:edit")), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
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
def delete_contact(customer_id: int, contact_id: int, current_user: User = Depends(require_permission("customer:delete")), db: Session = Depends(get_session)):
    customer = db.get(Customer, customer_id)
    if not customer or not _can_access_customer(customer, current_user, db):
        raise HTTPException(status_code=404, detail="客户不存在")
    contact = db.get(CustomerContact, contact_id)
    if not contact or contact.customer_id != customer_id:
        raise HTTPException(status_code=404, detail="联系人不存在")
    db.delete(contact)
    db.commit()


@router.get("/industry-aggregation")
def get_industry_aggregation(current_user: User = Depends(require_permission("customer:read")), db: Session = Depends(get_session)):
    visible_ids = get_visible_user_ids(current_user, db, module="customer")
    return get_industry_aggregation_from_db(db, visible_ids)


@router.get("/logo")
def get_company_logo(
    domain: str = Query(..., description="公司官网域名,例如 anta.com"),
    # 公开端点:<img> 标签不会自动带 Authorization header,强制认证会让所有 logo 都 401
):
    """公司 logo 代理:多源抓取 + 进程内 TTL 缓存 24h。

    - 抓取顺序:原站 /favicon.ico -> DuckDuckGo -> Google S2 -> Clearbit
    - 任一源返回 >=50B 视为成功,首次成功后缓存 24h
    - 4 源并发,任一成功立即取消其余,单源 4s 超时
    - trust_env=False 避免被环境代理影响
    """
    if not domain or not _re_logo.match(r"^[a-z0-9.\-]+$", domain.lower()):
        raise HTTPException(status_code=400, detail="invalid domain")
    domain = domain.lower()

    def _fetch():
        import time as _time
        from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
        sources = [
            (f"https://{domain}/favicon.ico", "image/x-icon"),
            (f"https://icons.duckduckgo.com/ip3/{domain}.ico", "image/x-icon"),
            (f"https://www.google.com/s2/favicons?domain={domain}&sz=64", "image/png"),
            (f"https://logo.clearbit.com/{domain}?size=80", "image/png"),
        ]

        def _try_one(args):
            url, default_ct = args
            try:
                with httpx.Client(timeout=4.0, trust_env=False, follow_redirects=True) as c:
                    r = c.get(url)
                    if r.status_code == 200 and len(r.content) >= 50:
                        ct = (r.headers.get("content-type") or default_ct).split(";")[0].strip()
                        return r.content, ct
            except Exception:
                return None
            return None

        try:
            with ThreadPoolExecutor(max_workers=4) as ex:
                futures = {ex.submit(_try_one, s): s for s in sources}
                try:
                    # 轮询:每 0.2s 检查一次,任一源成功就返回 + 取消其余
                    deadline = _time.monotonic() + 5.0
                    pending = set(futures.keys())
                    while pending and _time.monotonic() < deadline:
                        done, pending = wait(pending, timeout=0.2, return_when=FIRST_COMPLETED)
                        for f in done:
                            try:
                                r = f.result()
                                if r and isinstance(r, tuple):
                                    return r
                            except Exception:
                                pass
                finally:
                    for f in futures:
                        f.cancel()
        except Exception:
            pass
        return None

    cache_key = f"company_logo:{domain}"
    result, _hit = cached_call(cache_key, ttl=86400, factory=_fetch)
    if not result:
        raise HTTPException(status_code=404, detail="logo not found")
    content, content_type = result
    return Response(
        content=content,
        media_type=content_type or "image/x-icon",
        headers={"Cache-Control": "public, max-age=86400"},
    )
