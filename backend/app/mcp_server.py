"""
MCP (Model Context Protocol) 服务 - 对外暴露 WorkTrack 工具
供 Claude Desktop、Cursor、Cline 等支持 MCP 的智能体调用
"""
import json
import os
from fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from sqlmodel import Session, select, or_, func
from app.database import get_session, engine
from app.models.user import User
from app.models.customer import Customer
from app.models.project import Project
from app.models.daily_report import DailyReport
from app.models.meeting_note import MeetingNote
from app.models.weekly_summary import WeeklySummary
from app.models.log_entry import LogEntry
from app.models.system_preference import SystemPreference
from app.services.vector_store import search_similar
from datetime import date, timedelta
from typing import Optional

# ---------- MCP API Key 认证 ----------

MCP_CONFIG_KEY = "mcp_api_key"
MCP_ENABLED_KEY = "mcp_enabled"


def get_mcp_api_key() -> Optional[str]:
    """从数据库获取当前 MCP API Key"""
    with Session(engine) as db:
        pref = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == MCP_CONFIG_KEY,
                SystemPreference.user_id == None,
            )
        ).first()
        return pref.value if pref and pref.value else None


def is_mcp_enabled() -> bool:
    """检查 MCP 服务是否已启用"""
    with Session(engine) as db:
        pref = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == MCP_ENABLED_KEY,
                SystemPreference.user_id == None,
            )
        ).first()
        return pref.value == "true" if pref else False


class MCPAuthMiddleware(BaseHTTPMiddleware):
    """MCP API Key 认证中间件"""
    async def dispatch(self, request, call_next):
        # 检查是否启用
        if not is_mcp_enabled():
            return JSONResponse(
                {"error": "MCP 服务未启用，请在系统设置中开启"},
                status_code=503,
            )
        # 验证 API Key
        key = get_mcp_api_key()
        if not key:
            return JSONResponse(
                {"error": "MCP API Key 未配置，请在系统设置中生成"},
                status_code=401,
            )
        auth_header = request.headers.get("Authorization", "")
        expected = f"Bearer {key}"
        if auth_header != expected:
            return JSONResponse(
                {"error": "MCP API Key 无效，请检查 Authorization 头"},
                status_code=401,
            )
        return await call_next(request)


# ---------- FastMCP 实例 ----------

mcp = FastMCP("WorkTrack")


# ============================================================
# 工具：日报 Daily Reports
# ============================================================

@mcp.tool()
def list_daily_reports(days: int = 7, user_id: Optional[int] = None) -> list:
    """查询最近 N 天的日报列表。返回 id、日期、内容摘要和 AI 总结"""
    db = next(get_session())
    try:
        since = date.today() - timedelta(days=days - 1)
        q = select(DailyReport).where(
            DailyReport.report_date >= since,
            DailyReport.report_date <= date.today(),
        ).order_by(DailyReport.report_date.desc())
        if user_id:
            q = q.where(DailyReport.user_id == user_id)
        reports = db.exec(q).all()
        return [
            {
                "id": r.id,
                "date": str(r.report_date),
                "user_id": r.user_id,
                "content_preview": (r.content_md or "")[:300],
                "ai_summary": r.ai_summary,
            }
            for r in reports
        ]
    finally:
        db.close()


@mcp.tool()
def get_daily_report(report_id: int) -> dict:
    """获取单篇日报的完整内容"""
    db = next(get_session())
    try:
        r = db.get(DailyReport, report_id)
        if not r:
            return {"error": "日报不存在"}
        return {
            "id": r.id,
            "date": str(r.report_date),
            "user_id": r.user_id,
            "content_md": r.content_md,
            "ai_summary": r.ai_summary,
        }
    finally:
        db.close()


@mcp.tool()
def create_daily_report(user_id: int, content: str) -> dict:
    """创建一篇新日报"""
    db = next(get_session())
    try:
        report = DailyReport(
            user_id=user_id,
            report_date=date.today(),
            content_md=content,
        )
        db.add(report)
        db.commit()
        db.refresh(report)
        return {"success": True, "report_id": report.id, "date": str(report.report_date)}
    finally:
        db.close()


@mcp.tool()
def update_daily_report(report_id: int, content: Optional[str] = None) -> dict:
    """更新一篇日报的内容"""
    db = next(get_session())
    try:
        r = db.get(DailyReport, report_id)
        if not r:
            return {"error": "日报不存在"}
        if content is not None:
            r.content_md = content
        db.add(r)
        db.commit()
        return {"success": True, "report_id": r.id}
    finally:
        db.close()


@mcp.tool()
def search_daily_reports(query: str, top_k: int = 5) -> list:
    """语义搜索日报内容，返回最相关的 N 条结果"""
    results = search_similar("daily_reports", query, top_k)
    ids_list = results.get("ids", [[]])[0] if results.get("ids") else []
    metas = results.get("metadatas", [[]])[0] if results.get("metadatas") else []
    docs = results.get("documents", [[]])[0] if results.get("documents") else []
    out = []
    for i, id_ in enumerate(ids_list):
        out.append({
            "id": id_,
            "metadata": metas[i] if i < len(metas) else {},
            "content": docs[i] if i < len(docs) else "",
        })
    return out


# ============================================================
# 工具：周报 Weekly Summaries
# ============================================================

@mcp.tool()
def list_weekly_summaries(weeks: int = 4) -> list:
    """查询最近 N 周的周报列表"""
    db = next(get_session())
    try:
        summaries = db.exec(
            select(WeeklySummary).order_by(WeeklySummary.week_start.desc()).limit(weeks)
        ).all()
        return [
            {
                "id": s.id,
                "week_start": str(s.week_start),
                "week_end": str(s.week_end),
                "summary": s.summary_text,
            }
            for s in summaries
        ]
    finally:
        db.close()


@mcp.tool()
def get_weekly_summary(week_start: str) -> dict:
    """获取指定周的周报（week_start 格式 YYYY-MM-DD，如 2026-04-27）"""
    db = next(get_session())
    try:
        s = db.exec(
            select(WeeklySummary).where(WeeklySummary.week_start == date.fromisoformat(week_start))
        ).first()
        if not s:
            return {"error": f"未找到 {week_start} 所在周的周报"}
        return {
            "id": s.id,
            "week_start": str(s.week_start),
            "week_end": str(s.week_end),
            "summary": s.summary_text,
        }
    finally:
        db.close()


# ============================================================
# 工具：项目 Projects
# ============================================================

@mcp.tool()
def list_projects(status: Optional[str] = None, customer_id: Optional[int] = None) -> list:
    """查询项目列表，可按状态或客户筛选"""
    db = next(get_session())
    try:
        q = select(Project).order_by(Project.updated_at.desc())
        if status:
            q = q.where(Project.status == status)
        if customer_id is not None:
            q = q.where(Project.customer_id == customer_id)
        projects = db.exec(q).all()
        return [
            {
                "id": p.id,
                "name": p.name,
                "status": p.status,
                "customer_id": p.customer_id,
                "customer_name": p.customer_name,
                "deadline": str(p.deadline) if p.deadline else None,
                "product": p.product,
                "progress": (p.progress or "")[:200],
            }
            for p in projects
        ]
    finally:
        db.close()


@mcp.tool()
def get_project(project_id: int) -> dict:
    """获取项目详情，包含关联的客户信息"""
    db = next(get_session())
    try:
        p = db.get(Project, project_id)
        if not p:
            return {"error": "项目不存在"}
        customer = db.get(Customer, p.customer_id) if p.customer_id else None
        return {
            "id": p.id,
            "name": p.name,
            "status": p.status,
            "customer_id": p.customer_id,
            "customer_name": p.customer_name,
            "product": p.product,
            "project_scenario": p.project_scenario,
            "sales_person": p.sales_person,
            "progress": p.progress,
            "analysis": p.analysis,
            "cloud_provider": p.cloud_provider,
            "deadline": str(p.deadline) if p.deadline else None,
            "start_date": str(p.start_date) if p.start_date else None,
        }
    finally:
        db.close()


@mcp.tool()
def create_project(name: str, status: str = "active", customer_id: Optional[int] = None,
                   deadline: Optional[str] = None) -> dict:
    """创建新项目。deadline 格式 YYYY-MM-DD"""
    db = next(get_session())
    try:
        proj = Project(
            name=name,
            status=status,
            customer_id=customer_id,
            deadline=date.fromisoformat(deadline) if deadline else None,
        )
        db.add(proj)
        db.commit()
        db.refresh(proj)
        return {"success": True, "project_id": proj.id}
    finally:
        db.close()


@mcp.tool()
def update_project(project_id: int, name: Optional[str] = None, status: Optional[str] = None,
                   progress: Optional[str] = None, deadline: Optional[str] = None) -> dict:
    """更新项目信息"""
    db = next(get_session())
    try:
        p = db.get(Project, project_id)
        if not p:
            return {"error": "项目不存在"}
        if name is not None:
            p.name = name
        if status is not None:
            p.status = status
        if progress is not None:
            p.progress = progress
        if deadline is not None:
            p.deadline = date.fromisoformat(deadline) if deadline else None
        db.add(p)
        db.commit()
        return {"success": True, "project_id": p.id}
    finally:
        db.close()


# ============================================================
# 工具：客户 Customers
# ============================================================

@mcp.tool()
def list_customers(industry: Optional[str] = None, status: Optional[str] = None) -> list:
    """查询客户列表，可按行业或状态筛选"""
    db = next(get_session())
    try:
        q = select(Customer).order_by(Customer.name)
        if industry:
            q = q.where(Customer.industry == industry)
        if status:
            q = q.where(Customer.status == status)
        customers = db.exec(q).all()
        return [
            {
                "id": c.id,
                "name": c.name,
                "industry": c.industry,
                "status": c.status,
                "contact_person": "",
                "contact_email": "",
                "notes": "",
            }
            for c in customers
        ]
    finally:
        db.close()


@mcp.tool()
def get_customer(customer_id: int) -> dict:
    """获取客户详情及关联项目和最近会议"""
    db = next(get_session())
    try:
        c = db.get(Customer, customer_id)
        if not c:
            return {"error": "客户不存在"}
        projects = db.exec(
            select(Project).where(Project.customer_id == customer_id)
        ).all()
        meetings = db.exec(
            select(MeetingNote).where(MeetingNote.customer_id == customer_id)
            .order_by(MeetingNote.meeting_date.desc()).limit(10)
        ).all()
        return {
            "customer": {
                "id": c.id, "name": c.name, "industry": c.industry,
                "status": c.status, "contact_person": "",
                "contact_email": "", "notes": "",
            },
            "projects": [{"id": p.id, "name": p.name, "status": p.status} for p in projects],
            "recent_meetings": [
                {"id": m.id, "title": m.title, "date": str(m.meeting_date)}
                for m in meetings
            ],
        }
    finally:
        db.close()


@mcp.tool()
def create_customer(name: str, industry: str = "", status: str = "潜在") -> dict:
    """创建新客户"""
    db = next(get_session())
    try:
        c = Customer(
            name=name, industry=industry, status=status,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        return {"success": True, "customer_id": c.id}
    finally:
        db.close()


# ============================================================
# 工具：会议 Meeting Notes
# ============================================================

@mcp.tool()
def list_meetings(days: int = 30, customer_id: Optional[int] = None) -> list:
    """查询最近 N 天的会议列表"""
    db = next(get_session())
    try:
        since = date.today() - timedelta(days=days - 1)
        q = select(MeetingNote).where(
            MeetingNote.meeting_date >= since,
            MeetingNote.meeting_date <= date.today(),
        ).order_by(MeetingNote.meeting_date.desc())
        if customer_id is not None:
            q = q.where(MeetingNote.customer_id == customer_id)
        meetings = db.exec(q).all()
        return [
            {
                "id": m.id,
                "title": m.title,
                "date": str(m.meeting_date),
                "customer_id": m.customer_id,
                "duration_minutes": m.duration_minutes,
                "notes_preview": (m.content_md or "")[:300],
                "decisions": "",
                "todos": "",
            }
            for m in meetings
        ]
    finally:
        db.close()


@mcp.tool()
def get_meeting(meeting_id: int) -> dict:
    """获取单次会议的完整纪要"""
    db = next(get_session())
    try:
        m = db.get(MeetingNote, meeting_id)
        if not m:
            return {"error": "会议不存在"}
        return {
            "id": m.id,
            "title": m.title,
            "date": str(m.meeting_date),
            "customer_id": m.customer_id,
            "project_id": m.project_id,
            "duration_minutes": 0,
            "attendees": m.attendees,
            "notes": m.content_md or "",
            "decisions": "",
            "todos": "",
        }
    finally:
        db.close()


@mcp.tool()
def create_meeting(title: str, meeting_date: str, customer_id: Optional[int] = None,
                   project_id: Optional[int] = None, notes: str = "",
                   attendees: str = "", duration_minutes: int = 0) -> dict:
    """创建新会议记录。meeting_date 格式 YYYY-MM-DD"""
    db = next(get_session())
    try:
        m = MeetingNote(
            title=title,
            meeting_date=date.fromisoformat(meeting_date),
            customer_id=customer_id,
            project_id=project_id,
            notes=notes,
            attendees=attendees,
            duration_minutes=duration_minutes,
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return {"success": True, "meeting_id": m.id}
    finally:
        db.close()


# ============================================================
# 工具：全局搜索
# ============================================================

@mcp.tool()
def global_search(query: str, top_k: int = 10) -> list:
    """在日报、项目、客户中全文搜索，返回最相关的结果"""
    db = next(get_session())
    try:
        results = []
        # 搜索项目
        proj_q = select(Project).where(
            or_(Project.name.contains(query), Project.description.contains(query))
        ).limit(top_k)
        projects = db.exec(proj_q).all()
        for p in projects:
            results.append({"type": "project", "id": p.id, "name": p.name, "status": p.status})

        # 搜索客户
        cust_q = select(Customer).where(
            or_(Customer.name.contains(query), Customer.industry.contains(query))
        ).limit(top_k)
        customers = db.exec(cust_q).all()
        for c in customers:
            results.append({"type": "customer", "id": c.id, "name": c.name, "industry": c.industry})

        # 搜索日报
        report_q = select(DailyReport).where(
            DailyReport.content_md.contains(query)
        ).order_by(DailyReport.report_date.desc()).limit(top_k)
        reports = db.exec(report_q).all()
        for r in reports:
            results.append({"type": "daily_report", "id": r.id, "date": str(r.report_date),
                            "preview": (r.content_md or "")[:200]})

        # 搜索会议
        meet_q = select(MeetingNote).where(
            or_(MeetingNote.title.contains(query), MeetingNote.content_md.contains(query))
        ).order_by(MeetingNote.meeting_date.desc()).limit(top_k)
        meetings = db.exec(meet_q).all()
        for m in meetings:
            results.append({"type": "meeting", "id": m.id, "title": m.title,
                            "date": str(m.meeting_date)})

        return results
    finally:
        db.close()


# ============================================================
# 工具：统计概览
# ============================================================

@mcp.tool()
def get_overview() -> dict:
    """获取工作台概览统计：项目数、客户数、本周日报数、本月会议数"""
    db = next(get_session())
    try:
        today = date.today()
        week_start = today - timedelta(days=today.weekday())
        month_start = today.replace(day=1)

        total_projects = len(db.exec(select(Project)).all())
        active_projects = len(db.exec(select(Project).where(Project.status == "active")).all())
        total_customers = len(db.exec(select(Customer)).all())

        week_reports = len(db.exec(
            select(DailyReport).where(DailyReport.report_date >= week_start)
        ).all())

        month_meetings = len(db.exec(
            select(MeetingNote).where(MeetingNote.meeting_date >= month_start)
        ).all())

        return {
            "total_projects": total_projects,
            "active_projects": active_projects,
            "total_customers": total_customers,
            "weekly_reports": week_reports,
            "monthly_meetings": month_meetings,
            "today": str(today),
        }
    finally:
        db.close()
