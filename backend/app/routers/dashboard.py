from typing import Optional
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlmodel import Session, select, func
from app.database import get_session
from app.models.project import Project
from app.models.customer import Customer
from app.models.daily_report import DailyReport
from app.models.meeting_note import MeetingNote
from app.models.weekly_summary import WeeklySummary
from app.models.ai_prompt import AIPrompt
from app.models.user import User
from app.auth import get_current_user
from app.routers.settings import DEFAULT_PROMPTS
from app.services.ai_service import _get_active_provider, _get_client, _extract_message_text

router = APIRouter(prefix="/api/v1/dashboard", tags=["数据看板"])


def _to_date(d) -> date:
    """安全转换为 date 对象，兼容数据库可能存储 datetime 的情况"""
    return d.date() if isinstance(d, datetime) else d


def _week_range(ref: Optional[date] = None) -> tuple:
    """返回本周的起止日期（周一 ~ 周日）"""
    today = ref or date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday


def _month_range(ref: Optional[date] = None) -> tuple:
    """返回本月的起止日期"""
    today = ref or date.today()
    first = today.replace(day=1)
    if today.month == 12:
        last = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        last = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
    return first, last


def _quarter_range(ref: Optional[date] = None) -> tuple:
    """返回本季度的起止日期"""
    today = ref or date.today()
    quarter_month = ((today.month - 1) // 3) * 3 + 1
    first = today.replace(month=quarter_month, day=1)
    if quarter_month == 10:
        last = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        last = today.replace(month=quarter_month + 3, day=1) - timedelta(days=1)
    return first, last


def _parse_date_range(start_date: Optional[str], end_date: Optional[str], preset: Optional[str]) -> tuple:
    """解析时间范围，返回 (start_date, end_date) 的 date 对象"""
    if preset == 'week':
        return _week_range()
    elif preset == 'month':
        return _month_range()
    elif preset == 'quarter':
        return _quarter_range()
    elif start_date and end_date:
        try:
            s = date.fromisoformat(start_date)
            e = date.fromisoformat(end_date)
            return s, e
        except ValueError:
            pass
    # 默认本月
    return _month_range()


@router.get("/stats")
def get_stats(
    start_date: Optional[str] = Query(None, description="开始日期 ISO 格式"),
    end_date: Optional[str] = Query(None, description="结束日期 ISO 格式"),
    preset: Optional[str] = Query(None, description="预设范围: week/month/quarter"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    range_start, range_end = _parse_date_range(start_date, end_date, preset)

    # === 项目统计 ===
    all_projects = db.exec(
        select(Project).where(Project.user_id == current_user.id)
    ).all()
    projects_in_range = [p for p in all_projects if p.created_at.date() <= range_end]

    total_projects = len(projects_in_range)
    status_dist: dict[str, int] = {}
    for p in projects_in_range:
        if p.status:
            status_dist[p.status] = status_dist.get(p.status, 0) + 1

    # 新建项目（本周期）
    new_projects = sum(1 for p in all_projects if p.created_at.date() >= range_start and p.created_at.date() <= range_end)

    # 项目金额统计（按币种）
    total_opp_cny = sum(p.opportunity_amount or 0 for p in projects_in_range if p.opportunity_amount and (p.currency or 'CNY') == 'CNY')
    total_opp_usd = sum(p.opportunity_amount or 0 for p in projects_in_range if p.opportunity_amount and (p.currency or 'CNY') == 'USD')
    total_deal_cny = sum(p.deal_amount or 0 for p in projects_in_range if p.deal_amount and (p.currency or 'CNY') == 'CNY')
    total_deal_usd = sum(p.deal_amount or 0 for p in projects_in_range if p.deal_amount and (p.currency or 'CNY') == 'USD')
    opp_this_period_cny = sum(p.opportunity_amount or 0 for p in all_projects if p.opportunity_amount and (p.currency or 'CNY') == 'CNY' and p.created_at.date() >= range_start and p.created_at.date() <= range_end)
    opp_this_period_usd = sum(p.opportunity_amount or 0 for p in all_projects if p.opportunity_amount and (p.currency or 'CNY') == 'USD' and p.created_at.date() >= range_start and p.created_at.date() <= range_end)
    deal_this_period_cny = sum(p.deal_amount or 0 for p in all_projects if p.deal_amount and (p.currency or 'CNY') == 'CNY' and p.created_at.date() >= range_start and p.created_at.date() <= range_end)
    deal_this_period_usd = sum(p.deal_amount or 0 for p in all_projects if p.deal_amount and (p.currency or 'CNY') == 'USD' and p.created_at.date() >= range_start and p.created_at.date() <= range_end)

    # === 客户统计 ===
    all_customers = db.exec(
        select(Customer).where(Customer.user_id == current_user.id)
    ).all()
    customers_in_range = [c for c in all_customers if c.created_at.date() <= range_end]
    total_customers = len(customers_in_range)
    new_customers = sum(1 for c in all_customers if c.created_at.date() >= range_start and c.created_at.date() <= range_end)

    # 行业分布
    industry_dist: dict[str, int] = {}
    for c in customers_in_range:
        if c.industry:
            industry_dist[c.industry] = industry_dist.get(c.industry, 0) + 1

    # === 会议统计 ===
    all_meetings = db.exec(
        select(MeetingNote).where(MeetingNote.user_id == current_user.id)
    ).all()
    meetings_in_range = [
        m for m in all_meetings
        if hasattr(m, 'meeting_date') and m.meeting_date
        and _to_date(m.meeting_date) >= range_start
        and _to_date(m.meeting_date) <= range_end
    ]
    try:
        total_meetings = db.exec(
            select(func.count(MeetingNote.id)).where(MeetingNote.user_id == current_user.id)
        ).one() or 0
    except Exception:
        total_meetings = len(all_meetings)

    # === 日报统计 ===
    reports_in_range = db.exec(
        select(DailyReport).where(
            DailyReport.user_id == current_user.id,
            DailyReport.report_date >= range_start,
            DailyReport.report_date <= range_end
        )
    ).all()
    total_reports = db.exec(
        select(func.count(DailyReport.id)).where(DailyReport.user_id == current_user.id)
    ).one() or 0

    # 连续天数（排除周末和法定节假日）
    streak_days = 0
    today = date.today()
    # 2025-2026 年中国法定节假日（调休上班日也需要写日报）
    # 格式: "YYYY-MM-DD"
    HOLIDAYS_2025_2026 = {
        # 2025 年法定节假日
        "2025-01-01",  # 元旦
        "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31", "2025-02-01", "2025-02-02", "2025-02-03",  # 春节
        "2025-04-04", "2025-04-05", "2025-04-06",  # 清明
        "2025-05-01", "2025-05-02", "2025-05-03", "2025-05-04", "2025-05-05",  # 劳动节
        "2025-05-31", "2025-06-01", "2025-06-02",  # 端午
        "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04", "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08",  # 国庆+中秋
        # 2026 年法定节假日
        "2026-01-01", "2026-01-02", "2026-01-03",  # 元旦
        "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21",  # 春节
        "2026-04-04", "2026-04-05", "2026-04-06",  # 清明
        "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",  # 劳动节
        "2026-06-19", "2026-06-20", "2026-06-21",  # 端午
        "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",  # 国庆+中秋
    }
    
    # 调休上班日（周末但需要上班）
    WORK_WEEKENDS_2025_2026 = {
        # 2025 年调休上班日
        "2025-01-26",  # 春节前调休（周日上班）
        "2025-02-08",  # 春节后调休（周六上班）
        "2025-04-27",  # 劳动节前调休（周日上班）
        "2025-09-28",  # 国庆前调休（周日上班）
        "2025-10-11",  # 国庆后调休（周六上班）
        # 2026 年调休上班日（预估）
        "2026-02-14",  # 春节前调休（周六上班）
        "2026-02-28",  # 春节后调休（周六上班）
        "2026-04-26",  # 劳动节前调休（周日上班）
        "2026-10-10",  # 国庆前调休（周六上班）
        "2026-10-17",  # 国庆后调休（周六上班）
    }
    
    def is_workday(d: date) -> bool:
        """判断是否为工作日（需要写日报的日子）"""
        weekday = d.weekday()  # 0=周一, 6=周日
        date_str = d.isoformat()
        
        # 调休上班日（周末但需要上班）
        if date_str in WORK_WEEKENDS_2025_2026:
            return True
        
        # 法定节假日
        if date_str in HOLIDAYS_2025_2026:
            return False
        
        # 普通周末（周六、周日）
        if weekday >= 5:
            return False
        
        return True
    
    for delta in range(90):
        d = today - timedelta(days=delta)
        
        # 如果是休息日，跳过（不要求写日报）
        if not is_workday(d):
            continue
        
        # 工作日必须检查是否有日报
        has = db.exec(
            select(DailyReport).where(
                DailyReport.user_id == current_user.id,
                DailyReport.report_date == d
            )
        ).first()
        if has:
            streak_days += 1
        else:
            break

    # === 周报统计 ===
    total_weeklies = db.exec(
        select(func.count(WeeklySummary.id)).where(WeeklySummary.user_id == current_user.id)
    ).one() or 0
    weeklies_in_range = db.exec(
        select(WeeklySummary).where(
            WeeklySummary.user_id == current_user.id,
            WeeklySummary.week_start <= range_end,
            WeeklySummary.week_end >= range_start
        )
    ).all()

    return {
        "range": {"start": range_start.isoformat(), "end": range_end.isoformat()},
        "projects": {
            "total": total_projects,
            "new_this_period": new_projects,
            "status_distribution": [{"name": k, "count": v} for k, v in status_dist.items()],
            "total_opp_cny": round(total_opp_cny, 2),
            "total_opp_usd": round(total_opp_usd, 2),
            "total_deal_cny": round(total_deal_cny, 2),
            "total_deal_usd": round(total_deal_usd, 2),
            "opp_this_period_cny": round(opp_this_period_cny, 2),
            "opp_this_period_usd": round(opp_this_period_usd, 2),
            "deal_this_period_cny": round(deal_this_period_cny, 2),
            "deal_this_period_usd": round(deal_this_period_usd, 2),
        },
        "customers": {
            "total": total_customers,
            "new_this_period": new_customers,
            "industry_distribution": [{"name": k, "count": v} for k, v in industry_dist.items()],
        },
        "meetings": {
            "total": total_meetings,
            "this_period": len(meetings_in_range),
        },
        "reports": {
            "total": total_reports,
            "this_period": len(reports_in_range),
            "streak_days": streak_days,
        },
        "weekly_summaries": {
            "total": total_weeklies,
            "this_period": len(weeklies_in_range),
        },
    }


@router.get("/timeline")
def get_timeline(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """合并最近动态，按时间倒序"""
    events = []

    # 项目最近更新
    projects = db.exec(
        select(Project).where(Project.user_id == current_user.id).order_by(Project.updated_at.desc()).limit(limit)
    ).all()
    for p in projects:
        events.append({
            "type": "project",
            "title": f"更新了项目「{p.name}」",
            "description": f"状态: {p.status or '未设置'}",
            "time": p.updated_at.isoformat(),
            "link_id": p.id,
        })

    # 会议最近创建
    meetings = db.exec(
        select(MeetingNote).where(MeetingNote.user_id == current_user.id).order_by(MeetingNote.created_at.desc()).limit(limit)
    ).all()
    for m in meetings:
        events.append({
            "type": "meeting",
            "title": f"创建了会议「{m.title}」",
            "description": f"日期: {m.meeting_date.isoformat() if hasattr(m, 'meeting_date') and m.meeting_date else '未知'}",
            "time": m.created_at.isoformat(),
            "link_id": m.id,
        })

    # 客户最近新增
    customers = db.exec(
        select(Customer).where(Customer.user_id == current_user.id).order_by(Customer.created_at.desc()).limit(limit)
    ).all()
    for c in customers:
        events.append({
            "type": "customer",
            "title": f"新建客户「{c.name}」",
            "description": f"行业: {c.industry or '未设置'}",
            "time": c.created_at.isoformat(),
            "link_id": c.id,
        })

    # 日报最近提交
    reports = db.exec(
        select(DailyReport).where(DailyReport.user_id == current_user.id).order_by(DailyReport.created_at.desc()).limit(limit)
    ).all()
    for r in reports:
        events.append({
            "type": "report",
            "title": f"提交了日报「{r.report_date.isoformat()}」",
            "description": f"{len(r.content_md)} 字",
            "time": r.created_at.isoformat(),
            "link_id": r.id,
        })

    # 按时间倒序
    events.sort(key=lambda e: e["time"], reverse=True)
    return events[:limit]


def _resolve_prompt(db: Session, period: str) -> tuple:
    """从数据库或默认配置获取洞察提示词，返回 (system_prompt, user_prompt_template)"""
    task_type = f"insight_{period}"
    # 优先使用用户自定义
    saved = db.exec(select(AIPrompt).where(AIPrompt.task_type == task_type)).first()
    if saved:
        return saved.system_prompt, saved.user_prompt_template
    # 回退到默认
    default = DEFAULT_PROMPTS.get(task_type, {})
    return default.get("system_prompt", ""), default.get("user_prompt_template", "")


@router.post("/ai-insights")
def get_ai_insights(
    period: Optional[str] = Query('month', description="洞察周期: week/month/quarter"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """基于当前数据生成 AI 洞察，支持 周度/月度/季度 三个维度"""

    # 确定时间范围
    if period == 'week':
        range_start, range_end = _week_range()
        label = '本周'
    elif period == 'quarter':
        range_start, range_end = _quarter_range()
        label = '本季度'
    else:  # month
        range_start, range_end = _month_range()
        label = '本月'

    range_str = f"{range_start.isoformat()} ~ {range_end.isoformat()}"

    # 项目统计
    all_projects = db.exec(
        select(Project).where(Project.user_id == current_user.id)
    ).all()
    projects_in_range = [p for p in all_projects if p.created_at.date() <= range_end]
    status_parts = []
    status_summary = {}
    for p in projects_in_range:
        if p.status:
            status_summary[p.status] = status_summary.get(p.status, 0) + 1
    for st, cnt in status_summary.items():
        status_parts.append(f"{st}: {cnt}")
    projects_text = f"{len(projects_in_range)}个{'（' + '、'.join(status_parts) + '）' if status_parts else ''}"

    # 客户
    all_customers = db.exec(
        select(Customer).where(Customer.user_id == current_user.id)
    ).all()
    customers_in_range = sum(1 for c in all_customers if c.created_at.date() >= range_start and c.created_at.date() <= range_end)
    customers_text = f"累计{len(all_customers)}个，{label}新增{customers_in_range}个"

    # 会议
    meetings_in_range = db.exec(
        select(func.count(MeetingNote.id)).where(
            MeetingNote.user_id == current_user.id,
            MeetingNote.meeting_date >= range_start,
            MeetingNote.meeting_date <= range_end,
        )
    ).one() or 0
    meetings_total = db.exec(
        select(func.count(MeetingNote.id)).where(MeetingNote.user_id == current_user.id)
    ).one() or 0
    meetings_text = f"{label}{meetings_in_range}次（累计{meetings_total}次）"

    # 日报
    reports_in_range = db.exec(
        select(func.count(DailyReport.id)).where(
            DailyReport.user_id == current_user.id,
            DailyReport.report_date >= range_start,
            DailyReport.report_date <= range_end,
        )
    ).one() or 0
    reports_text = f"{label}{reports_in_range}篇"

    # 周报
    weeklies_in_range = db.exec(
        select(func.count(WeeklySummary.id)).where(
            WeeklySummary.user_id == current_user.id,
            WeeklySummary.week_start <= range_end,
            WeeklySummary.week_end >= range_start,
        )
    ).one() or 0
    weeklies_text = f"{label}{weeklies_in_range}篇"

    # 构建数据来源
    sources = {
        "projects": projects_text,
        "customers": customers_text,
        "meetings": meetings_text,
        "reports": reports_text,
        "weeklies": weeklies_text,
        "range": range_str,
    }

    # 获取提示词（从数据库或默认配置）
    system_prompt, user_prompt_template = _resolve_prompt(db, period)

    # 尝试调用 AI
    try:
        provider_info = _get_active_provider(db, "chat", current_user.id)
    except HTTPException:
        provider_info = (None, None, None)
    except Exception:
        provider_info = (None, None, None)

    if not provider_info[0] or not provider_info[1]:
        return {"insights": [], "period": period, "sources": sources, "updated_at": None}

    try:
        client = _get_client(provider_info[0], provider_info[1])
        model = provider_info[2] or "gpt-3.5-turbo"

        # 构建用户消息：用真实数据替换模板变量
        user_prompt = user_prompt_template
        replacements = {
            "{range}": range_str,
            "{projects_summary}": projects_text,
            "{customers_summary}": customers_text,
            "{meetings_summary}": meetings_text,
            "{reports_summary}": reports_text,
            "{weeklies_summary}": weeklies_text,
        }
        for var, val in replacements.items():
            user_prompt = user_prompt.replace(var, val)

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=300,
        )
        text = _extract_message_text(response.choices[0].message)
        lines = [line.strip().lstrip("•").strip() for line in text.split("\n") if line.strip()]
        insights = lines[:3]
        if not insights:
            insights = [text.strip()]
        return {
            "insights": insights,
            "period": period,
            "range": {"start": range_start.isoformat(), "end": range_end.isoformat()},
            "sources": sources,
            "updated_at": datetime.now().isoformat(),
        }
    except Exception:
        return {"insights": [], "period": period, "sources": sources, "updated_at": None}
