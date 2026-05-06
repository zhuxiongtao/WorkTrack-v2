import json
from sqlmodel import Session, select
from datetime import date, datetime
from app.services.ai_service import _get_active_provider, _get_client, _extract_message_text
from app.services.vector_store import search_similar
from app.models import Customer, Project, DailyReport, MeetingNote
from app.routers.logs import write_log


# ===== AI Agent 工具集 =====
# 覆盖平台全部核心能力
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_all",
            "description": "全局搜索：同时搜索日报、客户、项目、会议纪要，返回综合结果",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "top_k": {"type": "integer", "description": "每种类型返回数量，默认3"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_reports",
            "description": "语义搜索日报内容，返回匹配的日报记录。注意：此工具不擅长处理日期查询，如果用户明确提到了具体日期（如'上周二'、'4月27日'），请改用 get_reports_by_date 工具",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "top_k": {"type": "integer", "description": "返回结果数量，默认5"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reports_by_date",
            "description": "按日期精确查询日报。当用户询问某一天的日报（如'上周二的日报'、'4月27日的日报'）时必须使用此工具，不要使用语义搜索",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "日期，格式 YYYY-MM-DD，如'2026-04-27'。如果用户说'上周二'，请计算出具体日期"},
                },
                "required": ["date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reports_by_date_range",
            "description": "按日期范围查询日报，适合'上周'、'本月'、'最近N天'等时间段查询",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "开始日期，格式 YYYY-MM-DD"},
                    "end_date": {"type": "string", "description": "结束日期，格式 YYYY-MM-DD"},
                },
                "required": ["start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_today_reports",
            "description": "获取今天所有日报并 AI 总结，了解当日工作进展",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_customer_summary",
            "description": "获取客户详细信息，包括关联项目、最近会议记录",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "integer", "description": "客户ID"},
                },
                "required": ["customer_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_projects",
            "description": "列出所有项目或按关键词搜索项目，返回项目列表（含ID、名称、状态等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词（项目名称或客户名），留空则列出全部"},
                    "limit": {"type": "integer", "description": "返回数量上限，默认20"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_project_analysis",
            "description": "获取项目详情并 AI 分析项目状态、风险和建议",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "integer", "description": "项目ID"},
                },
                "required": ["project_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_meetings",
            "description": "搜索会议纪要，可按客户、项目、日期筛选",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词（会议标题或内容）"},
                    "customer_id": {"type": "integer", "description": "按客户筛选（可选）"},
                    "project_id": {"type": "integer", "description": "按项目筛选（可选）"},
                    "limit": {"type": "integer", "description": "返回数量，默认5"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_scheduled_task",
            "description": "创建定时自动任务，支持：日报 AI 总结、项目分析、会议提醒",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "任务名称"},
                    "cron": {"type": "string", "description": "Cron 表达式，如 '0 18 * * *' 表示每天18:00"},
                    "action_type": {"type": "string", "description": "操作类型: ai_summarize_daily / ai_analyze_project"},
                    "params": {"type": "object", "description": "附加参数 JSON，如 {\"project_id\": 1}"},
                },
                "required": ["name", "cron", "action_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_company_info",
            "description": "搜索公司/客户信息。优先查询本地已录入的客户，同时支持联网搜索新公司。输入公司名称或关键词，返回匹配的本地客户列表和联网搜索结果",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "公司名称或关键词，如'华为'、'腾讯'、'涂鸦智能'"},
                    "search_web": {"type": "boolean", "description": "是否联网搜索新公司信息，默认true"},
                },
                "required": ["keyword"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_customer",
            "description": "将公司信息录入本地客户系统。搜索到新公司后，用户可请求将其保存为本地客户",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "公司全称（必填）"},
                    "industry": {"type": "string", "description": "所属行业"},
                    "contact": {"type": "string", "description": "联系方式"},
                    "status": {"type": "string", "description": "客户状态：潜在/接洽中/已签约/维护中，默认'潜在'"},
                    "core_products": {"type": "string", "description": "核心产品或明星产品"},
                    "business_scope": {"type": "string", "description": "主营业务"},
                    "scale": {"type": "string", "description": "规模人数"},
                    "profile": {"type": "string", "description": "公司简介（100字以内）"},
                    "recent_news": {"type": "string", "description": "近期重要动态"},
                    "logo_url": {"type": "string", "description": "公司官网域名，如 tuya.com"},
                },
                "required": ["name"],
            },
        },
    },
]


def execute_tool(tool_name: str, arguments: dict, db: Session, user_id: int = 1) -> str:
    """执行工具调用并返回结果"""

    # ===== 全局搜索 =====
    if tool_name == "search_all":
        q = arguments["query"]
        top_k = arguments.get("top_k", 3)
        result = {"reports": [], "customers": [], "projects": [], "meetings": []}
        # 全文搜索日报
        reports = db.exec(
            select(DailyReport).where(DailyReport.content_md.contains(q)).limit(top_k)
        ).all()
        result["reports"] = [{"id": r.id, "date": str(r.report_date), "snippet": r.content_md[:150]} for r in reports]
        # 全文搜索客户
        customers = db.exec(
            select(Customer).where(Customer.name.contains(q)).limit(top_k)
        ).all()
        result["customers"] = [{"id": c.id, "name": c.name, "industry": c.industry, "status": c.status} for c in customers]
        # 全文搜索项目
        projects = db.exec(
            select(Project).where(
                Project.name.contains(q) | Project.customer_name.contains(q)
            ).limit(top_k)
        ).all()
        result["projects"] = [{"id": p.id, "name": p.name, "customer_name": p.customer_name, "status": p.status} for p in projects]
        # 全文搜索会议
        meetings = db.exec(
            select(MeetingNote).where(
                MeetingNote.title.contains(q) | MeetingNote.content_md.contains(q)
            ).limit(top_k)
        ).all()
        result["meetings"] = [{"id": m.id, "title": m.title, "date": str(m.meeting_date)} for m in meetings]
        return json.dumps(result, ensure_ascii=False)

    # ===== 语义搜索日报 =====
    elif tool_name == "search_reports":
        results = search_similar(
            "daily_reports", arguments["query"], arguments.get("top_k", 5), db=db
        )
        return json.dumps(
            [
                {"id": id_, "metadata": meta, "content": doc}
                for id_, meta, doc in zip(
                    results["ids"][0],
                    results["metadatas"][0] if results["metadatas"] else [],
                    results["documents"][0] if results["documents"] else [],
                )
            ],
            ensure_ascii=False,
        )

    # ===== 按日期查询日报 =====
    elif tool_name == "get_reports_by_date":
        target_date = date.fromisoformat(arguments["date"])
        reports = db.exec(
            select(DailyReport).where(
                DailyReport.user_id == user_id,
                DailyReport.report_date == target_date,
            )
        ).all()
        if not reports:
            return json.dumps({"found": False, "message": f"{arguments['date']} 没有日报记录", "date": arguments["date"]}, ensure_ascii=False)
        return json.dumps(
            {"found": True, "date": arguments["date"], "count": len(reports), "reports": [
                {"id": r.id, "date": str(r.report_date), "content": r.content_md[:300], "ai_summary": r.ai_summary}
                for r in reports
            ]},
            ensure_ascii=False,
        )

    # ===== 按日期范围查询日报 =====
    elif tool_name == "get_reports_by_date_range":
        start = date.fromisoformat(arguments["start_date"])
        end = date.fromisoformat(arguments["end_date"])
        reports = db.exec(
            select(DailyReport).where(
                DailyReport.user_id == user_id,
                DailyReport.report_date >= start,
                DailyReport.report_date <= end,
            ).order_by(DailyReport.report_date)
        ).all()
        if not reports:
            return json.dumps({"found": False, "message": f"{arguments['start_date']} ~ {arguments['end_date']} 没有日报记录", "start_date": arguments["start_date"], "end_date": arguments["end_date"]}, ensure_ascii=False)
        return json.dumps(
            {"found": True, "start_date": arguments["start_date"], "end_date": arguments["end_date"], "count": len(reports), "reports": [
                {"id": r.id, "date": str(r.report_date), "content": r.content_md[:200], "ai_summary": r.ai_summary}
                for r in reports
            ]},
            ensure_ascii=False,
        )

    # ===== 客户详情 =====
    elif tool_name == "get_customer_summary":
        customer_id = arguments["customer_id"]
        customer = db.get(Customer, customer_id)
        if not customer:
            return json.dumps({"error": "客户不存在"})
        projects = db.exec(
            select(Project).where(Project.customer_id == customer_id)
        ).all()
        meetings = db.exec(
            select(MeetingNote).where(MeetingNote.customer_id == customer_id)
            .order_by(MeetingNote.meeting_date.desc()).limit(5)
        ).all()
        return json.dumps(
            {
                "customer": {
                    "id": customer.id,
                    "name": customer.name,
                    "industry": customer.industry,
                    "status": customer.status,
                    "contact": customer.contact or "",
                    "core_products": customer.core_products or "",
                    "business_scope": customer.business_scope or "",
                    "scale": customer.scale or "",
                    "profile": customer.profile or "",
                    "recent_news": customer.recent_news or "",
                },
                "project_count": len(projects),
                "projects": [{"id": p.id, "name": p.name, "status": p.status} for p in projects],
                "recent_meetings": [
                    {"id": m.id, "title": m.title, "date": str(m.meeting_date)}
                    for m in meetings
                ],
            },
            ensure_ascii=False,
        )

    # ===== 列出/搜索项目 =====
    elif tool_name == "list_projects":
        q = arguments.get("query", "")
        limit = arguments.get("limit", 20)
        query = select(Project).order_by(Project.updated_at.desc())
        if q:
            query = query.where(
                Project.name.contains(q) | Project.customer_name.contains(q)
            )
        projects = db.exec(query.limit(limit)).all()
        return json.dumps(
            {
                "total": len(projects),
                "projects": [
                    {"id": p.id, "name": p.name, "customer_name": p.customer_name,
                     "status": p.status, "product": p.product,
                     "start_date": str(p.start_date) if p.start_date else None}
                    for p in projects
                ],
            },
            ensure_ascii=False,
        )

    # ===== AI 项目分析 =====
    elif tool_name == "get_project_analysis":
        from app.services.ai_service import generate_project_analysis
        project_id = arguments["project_id"]
        project = db.get(Project, project_id)
        if not project:
            return json.dumps({"error": "项目不存在"})
        meetings = db.exec(
            select(MeetingNote).where(MeetingNote.project_id == project_id)
            .order_by(MeetingNote.meeting_date.desc()).limit(5)
        ).all()
        analysis = generate_project_analysis(project_id, db, user_id)
        return json.dumps(
            {
                "project": {"id": project.id, "name": project.name, "status": project.status,
                            "deadline": str(project.deadline) if project.deadline else None},
                "recent_meetings": [
                    {"id": m.id, "title": m.title, "date": str(m.meeting_date)}
                    for m in meetings
                ],
                "ai_analysis": analysis,
            },
            ensure_ascii=False,
        )

    # ===== 搜索会议 =====
    elif tool_name == "search_meetings":
        q = arguments.get("query", "")
        cid = arguments.get("customer_id")
        pid = arguments.get("project_id")
        limit = arguments.get("limit", 5)
        query = select(MeetingNote).order_by(MeetingNote.meeting_date.desc())
        if q:
            query = query.where(
                MeetingNote.title.contains(q) | MeetingNote.content_md.contains(q)
            )
        if cid:
            query = query.where(MeetingNote.customer_id == cid)
        if pid:
            query = query.where(MeetingNote.project_id == pid)
        meetings = db.exec(query.limit(limit)).all()
        return json.dumps(
            [{"id": m.id, "title": m.title, "date": str(m.meeting_date),
              "content": m.content_md[:200], "has_audio": bool(m.audio_url)}
             for m in meetings],
            ensure_ascii=False,
        )

    # ===== 创建定时任务 =====
    elif tool_name == "create_scheduled_task":
        from app.models.scheduled_task import ScheduledTask
        from app.services.scheduler import _register_task
        task = ScheduledTask(
            name=arguments["name"],
            trigger_type="cron",
            trigger_config=json.dumps({"cron": arguments["cron"]}),
            action_type=arguments["action_type"],
            action_params=json.dumps(arguments.get("params", {})),
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        _register_task(task)
        return json.dumps(
            {"success": True, "task_id": task.id, "name": task.name},
            ensure_ascii=False,
        )

    # ===== 今日日报总结 =====
    elif tool_name == "summarize_today_reports":
        from app.services.ai_service import summarize_daily_report
        today = date.today()
        reports = db.exec(
            select(DailyReport).where(DailyReport.report_date == today)
        ).all()
        if not reports:
            return "今天还没有日报记录"
        summaries = []
        for report in reports:
            if not report.ai_summary:
                try:
                    summary = summarize_daily_report(report.content_md, db, user_id)
                    report.ai_summary = summary
                except Exception as e:
                    write_log("error", "ai", f"日报AI总结失败 [report_id={report.id}]: {str(e)[:150]}", details=str(e), db=db)
                    summary = "AI总结失败"
            else:
                summary = report.ai_summary
            summaries.append(f"[日报{report.id}] {report.content_md[:100]}... => {summary}")
        db.commit()
        return "\n".join(summaries)

    # ===== 公司/客户搜索（本地 + 联网） =====
    elif tool_name == "search_company_info":
        keyword = arguments.get("keyword", "").strip()
        do_web = arguments.get("search_web", True)
        if not keyword:
            return json.dumps({"error": "请输入公司名称或关键词"}, ensure_ascii=False)

        result = {"local_customers": [], "web_results": [], "keyword": keyword}

        # 1. 搜索本地客户库（全文模糊匹配）
        local_customers = db.exec(
            select(Customer).where(Customer.name.contains(keyword)).limit(10)
        ).all()
        result["local_customers"] = [
            {
                "id": c.id,
                "name": c.name,
                "industry": c.industry or "",
                "status": c.status or "",
                "core_products": c.core_products or "",
                "scale": c.scale or "",
                "profile": c.profile or "",
                "recent_news": c.recent_news or "",
            }
            for c in local_customers
        ]

        # 2. 联网搜索新公司（如果 Tavily 已配置且用户允许）
        if do_web:
            try:
                from app.services.ai_service import search_company_names, fetch_company_info
                # 先搜索匹配的公司全称
                candidates = search_company_names(keyword, db)
                # 取第一个候选公司获取详细信息
                if candidates:
                    top = candidates[0]
                    full_name = top.get("full_name") or top.get("name")
                    info = fetch_company_info(full_name, db)
                    if info and info.get("name"):
                        result["web_results"].append(info)
                    # 如果有多个候选，追加简称
                    result["candidates"] = candidates[:5]
            except Exception as e:
                result["web_error"] = f"联网搜索失败: {str(e)[:100]}"

        return json.dumps(result, ensure_ascii=False)

    # ===== 创建客户（将搜索到的公司录入本地系统） =====
    elif tool_name == "create_customer":
        name = arguments.get("name", "").strip()
        if not name:
            return json.dumps({"error": "公司名称不能为空"}, ensure_ascii=False)

        # 检查是否已存在同名客户
        existing = db.exec(
            select(Customer).where(Customer.name == name)
        ).first()
        if existing:
            return json.dumps(
                {"success": False, "error": f"客户「{name}」已存在于系统中（ID: {existing.id}）", "customer_id": existing.id},
                ensure_ascii=False,
            )

        # 创建客户
        customer = Customer(
            user_id=user_id,
            name=name,
            industry=arguments.get("industry") or None,
            contact=arguments.get("contact") or None,
            status=arguments.get("status") or "潜在",
            core_products=arguments.get("core_products") or None,
            business_scope=arguments.get("business_scope") or None,
            scale=arguments.get("scale") or None,
            profile=arguments.get("profile") or None,
            recent_news=arguments.get("recent_news") or None,
            logo_url=arguments.get("logo_url") or None,
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)

        # 写入向量索引
        try:
            from app.services.vector_store import index_document
            index_document(
                collection_name="customers",
                doc_id=str(customer.id),
                text=f"{customer.name} {customer.industry or ''}",
                metadata={"status": customer.status},
            )
        except Exception:
            pass

        return json.dumps(
            {
                "success": True,
                "customer_id": customer.id,
                "name": customer.name,
                "message": f"已成功创建客户「{customer.name}」（ID: {customer.id}）",
            },
            ensure_ascii=False,
        )

    return json.dumps({"error": f"未知工具: {tool_name}"})


def run_agent_chat(user_message: str, history: list[dict], db: Session, user_id: int = 1) -> str:
    """运行 AI Agent 对话，支持多轮工具调用"""
    messages = [
        {
            "role": "system",
            "content": """你是 WorkTrack 智能工作助手，一个集成在 WorkTrack 工作管理平台中的 AI 助手。

## 你能做什么

📋 **日报管理**
- 搜索历史日报（全文+语义搜索），快速找到相关记录
- **按日期查询日报**：当用户询问某一天（如'上周二'、'4月27日'）的日报时，使用 get_reports_by_date 工具；问'上周'、'本月'时使用 get_reports_by_date_range
- 总结今日日报，一键了解当日工作进展
- 对单篇日报进行 AI 精炼总结

📝 **会议纪要**
- 搜索会议纪要，可按客户、项目、日期筛选
- 查看会议详情，包括录音（如有）
- 会议支持录音转文字（ASR）和 AI 整理

👥 **客户管理**
- 查询客户详情：获取基本信息、关联项目、最近会议
- 搜索客户信息（支持通过 ID 或名称查询）
- 获取客户最新动态（可刷新近半年新闻）

🌐 **公司/客户搜索（核心能力）**
- 输入公司名称或关键词（如"华为""涂鸦智能""字节跳动"），同时搜本地客户库和联网
- 优先返回已录入系统的客户详情（ID、行业、产品、规模、简介、最新动态）
- 联网搜索新公司信息：通过 Tavily 搜索引擎获取行业、产品、规模、简介、近期动态
- 搜索到本地不存在的公司后，可直接将其录入客户系统（调用 create_customer 工具）
- 基于 Tavily + AI 整理，信息时效性强

📊 **项目管理**
- 浏览和搜索项目列表（可列出全部项目或按关键词搜索）
- 查询项目详情和状态（含客户名称、产品、云平台等）
- AI 分析项目：评估进展、识别风险、给出建议
- 查看项目关联的会议记录

⏰ **定时任务**
- 创建定时自动任务：日报 AI 总结、项目定期分析
- 支持 Cron 表达式配置执行时间

🔍 **全局搜索**
- 同时搜索日报、客户、项目、会议，快速定位信息

## 使用示例

"帮我搜索一下上周关于XXX的日报"
"今天都写了什么？"
"查看客户 ID 为 1 的详细信息"
"分析一下项目 ID 为 2 的进展"
"最近关于客户A的会议有哪些？"
"帮我创建一个每天18:00自动总结日报的任务"
"现在有哪些项目？"
"总结下现在的项目情况"
"搜索一下华为公司的信息"
"帮我查一下腾讯最近的动态"
"把涂鸦智能录入我的客户系统"

## 回复格式要求（必须严格遵守）

**所有回复必须使用 Markdown 格式！**

1. **段落**：不同主题之间用空行分隔，避免内容堆在一起
2. **列表**：功能列举、搜索结果、步骤说明必须使用 `- ` 无序列表，每条单独一行
3. **强调**：关键术语、名称用 `**粗体**`
4. **标题**：长回复使用 `### ` 三级标题分段，如 `### 📋 日报管理`
5. **分隔**：不同功能模块之间用 `---` 分隔线隔开
6. **代码/命令**：涉及代码或命令使用反引号 `` ` `` 包裹
7. **表格**：对比信息推荐使用 Markdown 表格

**正确示例**：

欢迎使用 WorkTrack AI 助手！以下是核心功能：

### 📋 日报管理

- **搜索日报**：全文 + 语义搜索历史日报
- **AI 总结**：自动精炼日报内容，提取要点
- **按日期查询**：支持"上周二""4月27日"等自然语言日期

### 👥 客户管理

- **客户查询**：查看客户详情、关联项目和会议
- **联网搜索**：通过 Tavily 实时搜索新公司信息
- **一键录入**：搜索到新公司后可直接录入客户系统

有什么我可以帮你的吗？😊

## 回复要求
- 用中文回复，语气友好专业
- 搜索结果用简洁格式呈现，重点突出
- 当用户问及平台没有的功能时，坦诚告知
- 自我介绍时按上述能力描述，不要凭空编造功能""",
        }
    ]

    # 添加历史对话
    for msg in history[-10:]:  # 保留最近10条
        messages.append(msg)

    # 添加用户消息
    messages.append({"role": "user", "content": user_message})

    # 最多 5 轮工具调用
    try:
        base_url, api_key, model = _get_active_provider(db, "chat", user_id)
        client = _get_client(base_url, api_key)
    except Exception as e:
        write_log("error", "ai", f"AI模型配置失败: {str(e)[:150]}", details=str(e), db=db)
        return f"AI 模型配置失败: {str(e)[:200]}"
    for _ in range(5):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=TOOLS,
                temperature=0.7,
            )
        except Exception as e:
            write_log("error", "ai", f"AI API调用失败: {str(e)[:150]}", details=str(e), db=db)
            return f"AI API 调用失败: {str(e)[:200]}"

        choice = response.choices[0]

        # 如果有工具调用
        if choice.message.tool_calls:
            # 将 assistant 消息（含 tool_calls）加入历史
            messages.append(choice.message)

            for tool_call in choice.message.tool_calls:
                tool_name = tool_call.function.name
                arguments = json.loads(tool_call.function.arguments)

                # 执行工具
                try:
                    result = execute_tool(tool_name, arguments, db, user_id)
                except Exception as e:
                    error_msg = f"工具执行失败 [{tool_name}]: {str(e)[:150]}"
                    write_log("error", "ai", error_msg, details=str(e), db=db)
                    result = json.dumps({"error": error_msg}, ensure_ascii=False)

                # 将工具结果加入历史
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result,
                    }
                )
        else:
            # 没有工具调用，返回最终回复
            final_text = _extract_message_text(choice.message)
            if not final_text:
                write_log("warning", "ai", "AI返回空内容", details=f"模型: {model}, 用户消息: {user_message[:100]}", db=db)
                return "抱歉，我无法处理这个请求。"
            return final_text

    write_log("warning", "ai", "工具调用次数过多(>5轮)", details=f"用户消息: {user_message[:100]}", db=db)
    return "工具调用次数过多，请简化您的问题。"
