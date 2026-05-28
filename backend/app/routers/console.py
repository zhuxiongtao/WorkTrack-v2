"""管理总览路由 - 部门负责人查看团队数据"""

from typing import Optional
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlmodel import Session, select, func
from app.database import get_session
from app.models.project import Project
from app.models.customer import Customer
from app.models.daily_report import DailyReport
from app.models.meeting_note import MeetingNote
from app.models.user import User
from app.models.department import Department
from app.auth import get_current_user, require_permission, check_data_access, get_visible_user_ids, _get_department_descendants
from app.utils.time import utc_now

router = APIRouter(prefix="/api/v1/console", tags=["管理总览"])


def _week_range(ref: Optional[date] = None) -> tuple:
    """返回本周的起止日期（周一 ~ 周日）"""
    today = ref or date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


@router.get("/overview")
def console_overview(
    current_user: User = Depends(require_permission("management:console")),
    db: Session = Depends(get_session),
):
    """获取管辖范围概览统计"""
    # 获取可见用户列表
    visible_user_ids = get_visible_user_ids(current_user, db, module="project")
    
    if visible_user_ids is None:
        # 全公司可见（admin/boss）
        user_filter = None
    elif len(visible_user_ids) == 0:
        # 无可见用户
        return {
            "stats": {"reports_this_week": 0, "active_projects": 0, "recent_meetings": 0, "total_customers": 0},
            "members": [],
            "scope": "none",
        }
    else:
        user_filter = visible_user_ids
    
    # 本周日期范围
    monday, sunday = _week_range()
    today = date.today()
    
    # 构建查询过滤条件
    def apply_filter(query, model):
        if user_filter is not None:
            return query.where(model.user_id.in_(user_filter))
        return query
    
    # 1. 本周日报提交数
    report_query = select(func.count(DailyReport.id)).where(
        DailyReport.report_date >= monday,
        DailyReport.report_date <= sunday,
        DailyReport.status == "submitted",
    )
    report_query = apply_filter(report_query, DailyReport)
    reports_this_week = db.exec(report_query).one()
    
    # 2. 活跃项目数（非已完成）
    project_query = select(func.count(Project.id)).where(
        Project.status != "已完成",
    )
    project_query = apply_filter(project_query, Project)
    active_projects = db.exec(project_query).one()
    
    # 3. 近 7 天会议数
    seven_days_ago = today - timedelta(days=7)
    meeting_query = select(func.count(MeetingNote.id)).where(
        MeetingNote.meeting_date >= datetime.combine(seven_days_ago, datetime.min.time()),
    )
    meeting_query = apply_filter(meeting_query, MeetingNote)
    recent_meetings = db.exec(meeting_query).one()
    
    # 4. 客户总数
    customer_query = select(func.count(Customer.id))
    customer_query = apply_filter(customer_query, Customer)
    total_customers = db.exec(customer_query).one()
    
    # 5. 获取成员列表及其基本统计
    if user_filter is not None:
        members = db.exec(select(User).where(User.id.in_(user_filter), User.is_active == True)).all()
    else:
        members = db.exec(select(User).where(User.is_active == True)).all()
    
    member_stats = []
    for m in members:
        # 每人本周日报数
        m_reports = db.exec(
            select(func.count(DailyReport.id)).where(
                DailyReport.user_id == m.id,
                DailyReport.report_date >= monday,
                DailyReport.report_date <= sunday,
                DailyReport.status == "submitted",
            )
        ).one()
        # 每人活跃项目数
        m_projects = db.exec(
            select(func.count(Project.id)).where(
                Project.user_id == m.id,
                Project.status != "已完成",
            )
        ).one()
        # 每人近 7 天会议数
        m_meetings = db.exec(
            select(func.count(MeetingNote.id)).where(
                MeetingNote.user_id == m.id,
                MeetingNote.meeting_date >= datetime.combine(seven_days_ago, datetime.min.time()),
            )
        ).one()
        
        member_stats.append({
            "id": m.id,
            "name": m.name or m.username,
            "username": m.username,
            "avatar": m.avatar,
            "department_id": m.department_id,
            "reports_this_week": m_reports,
            "active_projects": m_projects,
            "recent_meetings": m_meetings,
        })
    
    # 按本周日报数降序排列
    member_stats.sort(key=lambda x: x["reports_this_week"], reverse=True)
    
    # 获取部门名称映射
    departments = {d.id: d.name for d in db.exec(select(Department)).all()}
    for ms in member_stats:
        ms["department_name"] = departments.get(ms["department_id"], "未分配")
    
    return {
        "stats": {
            "reports_this_week": reports_this_week,
            "active_projects": active_projects,
            "recent_meetings": recent_meetings,
            "total_customers": total_customers,
            "member_count": len(members),
        },
        "members": member_stats,
        "scope": "all" if user_filter is None else "filtered",
        "period": {
            "week_start": monday.isoformat(),
            "week_end": sunday.isoformat(),
        },
    }


@router.get("/member/{user_id}/summary")
def member_summary(
    user_id: int,
    current_user: User = Depends(require_permission("management:console")),
    db: Session = Depends(get_session),
):
    """获取单个成员的数据汇总"""
    # 权限检查
    if not check_data_access(user_id, current_user, db):
        raise HTTPException(status_code=403, detail="无权查看该用户数据")
    
    target_user = db.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    today = date.today()
    monday, sunday = _week_range()
    seven_days_ago = today - timedelta(days=7)
    thirty_days_ago = today - timedelta(days=30)
    
    # 本周日报
    weekly_reports = db.exec(
        select(DailyReport).where(
            DailyReport.user_id == user_id,
            DailyReport.report_date >= monday,
            DailyReport.report_date <= sunday,
            DailyReport.status == "submitted",
        ).order_by(DailyReport.report_date.desc()).limit(5)
    ).all()
    
    # 活跃项目
    active_projects = db.exec(
        select(Project).where(
            Project.user_id == user_id,
            Project.status != "已完成",
        ).limit(5)
    ).all()
    
    # 近期会议
    recent_meetings = db.exec(
        select(MeetingNote).where(
            MeetingNote.user_id == user_id,
            MeetingNote.meeting_date >= datetime.combine(seven_days_ago, datetime.min.time()),
        ).order_by(MeetingNote.meeting_date.desc()).limit(5)
    ).all()
    
    # 客户数
    customer_count = db.exec(
        select(func.count(Customer.id)).where(Customer.user_id == user_id)
    ).one()
    
    return {
        "user": {
            "id": target_user.id,
            "name": target_user.name or target_user.username,
            "username": target_user.username,
            "avatar": target_user.avatar,
        },
        "weekly_reports": [
            {"id": r.id, "date": r.report_date.isoformat(), "summary": (r.ai_summary or r.content_md[:100])[:100]}
            for r in weekly_reports
        ],
        "active_projects": [
            {"id": p.id, "name": p.name, "status": p.status, "customer_name": p.customer_name}
            for p in active_projects
        ],
        "recent_meetings": [
            {"id": m.id, "title": m.title, "date": m.meeting_date.date().isoformat() if isinstance(m.meeting_date, datetime) else m.meeting_date.isoformat()}
            for m in recent_meetings
        ],
        "customer_count": customer_count,
    }


@router.get("/dept/{dept_id}/members")
def dept_members_summary(
    dept_id: int,
    current_user: User = Depends(require_permission("management:console")),
    db: Session = Depends(get_session),
):
    """获取部门成员及其近期数据摘要"""
    dept = db.get(Department, dept_id)
    if not dept:
        raise HTTPException(status_code=404, detail="部门不存在")
    
    # 获取部门及所有子部门 ID
    all_dept_ids = [dept_id] + _get_department_descendants(dept_id, db)
    
    # 获取这些部门的成员
    members = db.exec(
        select(User).where(User.department_id.in_(all_dept_ids), User.is_active == True)
    ).all()
    
    # 权限过滤
    visible_members = [m for m in members if check_data_access(m.id, current_user, db)]
    
    today = date.today()
    monday, sunday = _week_range()
    seven_days_ago = today - timedelta(days=7)
    
    result = []
    for m in visible_members:
        # 快速统计
        reports_count = db.exec(
            select(func.count(DailyReport.id)).where(
                DailyReport.user_id == m.id,
                DailyReport.report_date >= monday,
                DailyReport.report_date <= sunday,
                DailyReport.status == "submitted",
            )
        ).one()
        projects_count = db.exec(
            select(func.count(Project.id)).where(
                Project.user_id == m.id,
                Project.status != "已完成",
            )
        ).one()
        meetings_count = db.exec(
            select(func.count(MeetingNote.id)).where(
                MeetingNote.user_id == m.id,
                MeetingNote.meeting_date >= datetime.combine(seven_days_ago, datetime.min.time()),
            )
        ).one()
        
        result.append({
            "id": m.id,
            "name": m.name or m.username,
            "username": m.username,
            "avatar": m.avatar,
            "job_title": m.job_title,
            "reports_this_week": reports_count,
            "active_projects": projects_count,
            "recent_meetings": meetings_count,
        })
    
    # 按日报数降序
    result.sort(key=lambda x: x["reports_this_week"], reverse=True)
    
    return {
        "department": {"id": dept.id, "name": dept.name, "manager_id": dept.manager_id},
        "member_count": len(result),
        "members": result,
    }
