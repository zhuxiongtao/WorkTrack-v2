from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select
from app.database import get_session
from app.models.daily_report import DailyReport
from app.models.customer import Customer
from app.models.meeting_note import MeetingNote
from app.models.project import Project
from app.models.user import User
from app.auth import get_current_user
from app.services.vector_store import search_similar

router = APIRouter(prefix="/api/v1", tags=["搜索"])


@router.get("/search")
def search(
    q: str = Query(..., min_length=1),
    type: Optional[str] = Query(None, description="daily_report|customer|meeting|project"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """混合搜索：全文 + 语义搜索，覆盖日报/项目/会议（仅搜索当前用户数据）"""
    results: dict = {}

    # ===== 全文搜索 =====
    if not type or type == "daily_report":
        reports = db.exec(
            select(DailyReport).where(
                DailyReport.user_id == current_user.id,
                DailyReport.content_md.contains(q) | DailyReport.ai_summary.contains(q)
            ).limit(10)
        ).all()
        results["reports"] = [
            {"id": r.id, "date": str(r.report_date), "snippet": (r.ai_summary or r.content_md)[:150]}
            for r in reports
        ]

    if not type or type == "customer":
        customers = db.exec(
            select(Customer).where(
                Customer.user_id == current_user.id, Customer.name.contains(q)
            ).limit(10)
        ).all()
        results["customers"] = [
            {"id": c.id, "name": c.name, "status": c.status} for c in customers
        ]

    if not type or type == "meeting":
        meetings = db.exec(
            select(MeetingNote).where(
                MeetingNote.user_id == current_user.id,
                MeetingNote.title.contains(q) | MeetingNote.content_md.contains(q)
            ).limit(10)
        ).all()
        results["meetings"] = [
            {"id": m.id, "title": m.title, "date": str(m.meeting_date), "snippet": m.content_md[:150] if m.content_md else ""}
            for m in meetings
        ]

    if not type or type == "project":
        projects = db.exec(
            select(Project).where(
                Project.user_id == current_user.id,
                Project.name.contains(q) | Project.customer_name.contains(q) | Project.progress.contains(q)
            ).limit(10)
        ).all()
        results["projects"] = [
            {"id": p.id, "name": p.name, "customer": p.customer_name, "status": p.status, "snippet": (p.progress or "")[:150]}
            for p in projects
        ]

    # ===== 语义搜索（跨日报/项目/会议） =====
    semantic = {}
    for col_name, label in [("daily_reports", "reports"), ("projects", "projects"), ("meeting_notes", "meetings")]:
        if type and label.rstrip("s") != type:
            continue
        try:
            s = search_similar(col_name, q, top_k=3, db=db, filter_meta={"user_id": current_user.id})
            if s.get("ids") and s["ids"][0]:
                key = f"semantic_{label}"
                semantic[key] = [
                    {"id": id_, "score": round(1 - (dist or 0), 3), "snippet": (doc or "")[:150]}
                    for id_, dist, doc in zip(s["ids"][0], s.get("distances", [[0]*3])[0], s.get("documents", [[""]*3])[0])
                ]
        except Exception:
            pass
    if semantic:
        results["semantic"] = semantic

    return results
