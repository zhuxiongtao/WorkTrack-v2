import json
from typing import Optional
from sqlmodel import Session, select, func
from datetime import date, datetime
from app.services.ai_service import _get_active_provider, _get_client, _extract_message_text
from app.services.vector_store import search_similar
from app.models import Customer, Project, DailyReport, MeetingNote
from app.models.contract import Contract
from app.models.customer_contact import CustomerContact
from app.models.user import User
from app.routers.logs import write_log
from app.auth import has_permission, get_visible_user_ids


# ─────────────────────────────────────────────────────────────────────────────
# 工具定义表
# 每个工具标注 required_perm：None 表示仅需登录，字符串表示需对应 RBAC 权限
# ─────────────────────────────────────────────────────────────────────────────

_ALL_TOOLS = [
    # ── 日报 ─────────────────────────────────────────────────────────────────
    {
        "_perm": "report:read",
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
        "_perm": "report:read",
        "type": "function",
        "function": {
            "name": "get_reports_by_date",
            "description": "按日期精确查询日报。当用户询问某一天的日报（如'上周二'、'4月27日'）时必须使用此工具，不要使用语义搜索",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "日期，格式 YYYY-MM-DD，如'2026-04-27'"},
                },
                "required": ["date"],
            },
        },
    },
    {
        "_perm": "report:read",
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
        "_perm": "report:read",
        "type": "function",
        "function": {
            "name": "summarize_today_reports",
            "description": "获取今天所有（权限范围内的）日报并 AI 总结，了解当日工作进展",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    # ── 客户 ─────────────────────────────────────────────────────────────────
    {
        "_perm": "customer:read",
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
        "_perm": "customer:read",
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
        "_perm": "customer:create",
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
    # ── 项目 ─────────────────────────────────────────────────────────────────
    {
        "_perm": "project:read",
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
        "_perm": "project:read",
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
    # ── 会议 ─────────────────────────────────────────────────────────────────
    {
        "_perm": "meeting:read",
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
    # ── 合同 ─────────────────────────────────────────────────────────────────
    {
        "_perm": "contract:read",
        "type": "function",
        "function": {
            "name": "search_contracts",
            "description": "搜索合同：关键词搜索合同标题、内容、摘要，返回匹配的合同列表及各合同的关键信息（金额、日期、甲乙双方、关键条款摘要等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词，如'云服务'、'保密协议'"},
                    "customer_name": {"type": "string", "description": "按客户名称筛选（可选）"},
                },
                "required": ["keyword"],
            },
        },
    },
    {
        "_perm": "contract:read",
        "type": "function",
        "function": {
            "name": "get_contract_detail",
            "description": "获取单个合同的完整详细信息，包括AI解析的关键条款、付款方式、合同摘要等",
            "parameters": {
                "type": "object",
                "properties": {
                    "contract_id": {"type": "integer", "description": "合同ID，从 search_contracts 结果中获取"},
                },
                "required": ["contract_id"],
            },
        },
    },
    # ── 对账 ─────────────────────────────────────────────────────────────────
    {
        "_perm": "project:read",
        "type": "function",
        "function": {
            "name": "query_reconcile",
            "description": "查询对账月结数据：某月份的销售对账、供应对账、毛利汇总；不传 period 则返回最近3个月概况",
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {"type": "string", "description": "月份，格式 YYYY-MM，如 '2026-05'；留空返回最近3个月"},
                },
            },
        },
    },
    # ── 供应商 & 通道 ─────────────────────────────────────────────────────────
    {
        "_perm": "project:read",
        "type": "function",
        "function": {
            "name": "list_suppliers",
            "description": "查看供应商列表，包括总成本、关联项目数、提供的模型列表",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "description": "按状态筛选，如'active'、'inactive'；留空全部"},
                },
            },
        },
    },
    {
        "_perm": "project:read",
        "type": "function",
        "function": {
            "name": "list_channels",
            "description": "查看模型通道列表，包括通道名称、模型类型、价格、库存状态",
            "parameters": {
                "type": "object",
                "properties": {
                    "supplier_id": {"type": "integer", "description": "按供应商筛选（可选）"},
                    "status": {"type": "string", "description": "按状态筛选，如'active'；留空全部"},
                },
            },
        },
    },
    # ── 审批 ─────────────────────────────────────────────────────────────────
    {
        "_perm": None,
        "type": "function",
        "function": {
            "name": "get_my_pending_approvals",
            "description": "查看我的待处理审批事项（需要我审批的）和我发起的审批申请及其状态",
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "description": "查询类型：'pending'=我需要处理的，'mine'=我发起的，'all'=全部；默认'pending'",
                    },
                },
            },
        },
    },
    # ── 数据看板 ─────────────────────────────────────────────────────────────
    {
        "_perm": "dashboard:read",
        "type": "function",
        "function": {
            "name": "get_dashboard_overview",
            "description": "获取数据看板概览：项目总数/状态分布、客户总数、近期日报提交情况、近期会议数等",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    # ── Wiki ─────────────────────────────────────────────────────────────────
    {
        "_perm": "wiki:read",
        "type": "function",
        "function": {
            "name": "search_wiki",
            "description": "搜索 Wiki 知识库页面，按标题或内容关键词查找文档",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "limit": {"type": "integer", "description": "返回数量，默认8"},
                },
                "required": ["query"],
            },
        },
    },
    # ── 定时任务 ─────────────────────────────────────────────────────────────
    {
        "_perm": "task:create",
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
    # ── 全局搜索 ─────────────────────────────────────────────────────────────
    {
        "_perm": None,
        "type": "function",
        "function": {
            "name": "search_all",
            "description": "全局搜索：同时搜索日报、客户、项目、会议，返回综合结果（仅返回当前用户权限范围内的数据）",
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
]


# 权限码 → 对应能力的中文描述（用于动态系统提示词）
_PERM_CAPABILITIES: dict[str, str] = {
    "report:read": """📋 **日报管理**
- 搜索历史日报（全文+语义搜索），快速找到相关记录
- 按日期精确查询日报（如"上周二的日报"、"4月27日"）
- 按日期范围查询（如"上周"、"本月"、"最近7天"）
- 总结今日日报，一键了解当日工作进展""",

    "customer:read": """👥 **客户管理**
- 查询客户详情：基本信息、关联项目、最近会议
- 搜索客户信息（支持联网搜索新公司）""",

    "customer:create": """- 录入新客户：搜索到的公司可一键保存为本地客户""",

    "project:read": """📊 **项目管理**
- 浏览和搜索项目列表
- 查询项目详情、AI 分析项目风险与进展
- 查看供应商列表及成本统计
- 查看模型通道列表（价格、库存、状态）
- 查询月度对账数据（销售对账、供应对账、毛利）""",

    "meeting:read": """📝 **会议纪要**
- 搜索会议纪要，可按客户、项目、日期筛选
- 查看会议详情（含录音转写，如有）""",

    "contract:read": """📄 **合同管理**
- 关键词搜索合同（标题、内容、摘要）
- 查看合同完整信息：金额、甲乙双方、付款方式
- AI 解析合同关键条款（交付、违约、知识产权、保密等）""",

    "wiki:read": """📖 **Wiki 知识库**
- 搜索公司内部知识库页面
- 按标题或内容关键词查找文档""",

    "dashboard:read": """📈 **数据看板**
- 获取业务概览：项目/客户/日报的统计数据
- 查看近期工作动态汇总""",

    "task:create": """⏰ **定时任务**
- 创建定时自动任务：日报 AI 总结、项目定期分析
- 支持 Cron 表达式配置执行时间""",
}

# 所有用户都有（仅需登录）
_BASE_CAPABILITIES = """🔔 **审批事项**
- 查看我的待审批事项（需要我处理的）
- 查看我发起的审批申请及当前状态

🔍 **全局搜索**
- 同时搜索日报、客户、项目、会议，快速定位信息（仅返回您权限范围内的数据）"""


def get_tools_for_user(user: User, db: Session) -> list[dict]:
    """返回当前用户有权使用的工具列表（去掉 _perm 元字段后传给 LLM）"""
    result = []
    for tool_def in _ALL_TOOLS:
        perm = tool_def.get("_perm")
        if perm is None or has_permission(user, perm, db):
            # 去掉内部字段，只保留 type + function
            result.append({k: v for k, v in tool_def.items() if k != "_perm"})
    return result


def get_system_prompt(user: User, db: Session) -> str:
    """根据用户权限动态生成系统提示词，仅描述该用户实际拥有的能力"""
    # 收集当前用户有哪些能力描述
    capability_parts: list[str] = []

    # 先追加需要权限的模块（按阅读顺序排）
    seen_project_read = False
    for perm_code, description in _PERM_CAPABILITIES.items():
        if perm_code == "customer:create":
            # 只有在 customer:read 也有的情况下才追加，否则单独追加无意义
            if has_permission(user, "customer:read", db) and has_permission(user, perm_code, db):
                # 拼在客户管理后面（已追加）—— 这里直接 continue，稍后一起处理
                pass
            continue
        if perm_code == "project:read" and seen_project_read:
            continue
        if has_permission(user, perm_code, db):
            if perm_code == "project:read":
                seen_project_read = True
            capability_parts.append(description)

    # customer:create 如果有，追加到客户部分后面
    if has_permission(user, "customer:read", db) and has_permission(user, "customer:create", db):
        for i, part in enumerate(capability_parts):
            if "👥 **客户管理**" in part:
                capability_parts[i] = part + "\n- 录入新客户：搜索到的公司可一键保存为本地客户"
                break

    # 追加基础能力（所有用户都有）
    capability_parts.append(_BASE_CAPABILITIES)

    capabilities_text = "\n\n".join(capability_parts)

    user_display = user.name or user.username
    job_title = f"（{user.job_title}）" if user.job_title else ""

    return f"""你是 WorkTrack 智能助手，为用户 **{user_display}**{job_title} 提供专属服务。

## 你的能力范围

{capabilities_text}

## 权限边界（重要）

你只能访问该用户权限范围内的数据，不能越权读取或操作：
- 未列出的功能模块不在你的服务范围内，请礼貌说明
- 数据查询自动按用户角色过滤，你看到的就是该用户可见的全部数据

## 使用示例

"帮我搜索上周关于XXX的日报"
"今天有哪些工作进展？"
"查一下华为公司的信息"
"分析一下项目 ID 为 2 的进展"
"我有哪些待审批的事项？"
"查一下 2026-05 的对账情况"

## 回复格式（必须遵守）

**所有回复必须使用 Markdown 格式！**

1. **段落**：不同主题之间用空行分隔
2. **列表**：搜索结果、步骤说明必须用 `- ` 无序列表，每条单独一行
3. **强调**：关键术语、名称用 `**粗体**`
4. **标题**：长回复使用 `### ` 三级标题分段
5. **分隔**：不同功能模块之间用 `---` 分隔线
6. **表格**：对比信息推荐 Markdown 表格

## 回复要求

- 用中文回复，语气友好专业
- 搜索结果简洁呈现，重点突出
- 当用户问及没有权限的功能时，坦诚告知（"您目前没有 XXX 模块的访问权限，请联系管理员"）
- 不要凭空编造系统中不存在的数据"""


# ─────────────────────────────────────────────────────────────────────────────
# 工具执行
# ─────────────────────────────────────────────────────────────────────────────

def execute_tool(tool_name: str, arguments: dict, db: Session, user: User) -> str:
    """执行工具调用并返回结果（含权限门控 + 数据可见性过滤）"""

    def _deny(perm_code: str) -> Optional[str]:
        """若用户没有对应权限则返回拒绝 JSON，否则返回 None"""
        if not has_permission(user, perm_code, db):
            return json.dumps({"error": f"权限不足，该操作需要「{perm_code}」权限，请联系管理员"}, ensure_ascii=False)
        return None

    # ── 全局搜索 ─────────────────────────────────────────────────────────────
    if tool_name == "search_all":
        q = arguments["query"]
        top_k = arguments.get("top_k", 3)
        result: dict = {}

        if has_permission(user, "report:read", db):
            visible = get_visible_user_ids(user, db, module="report")
            q_rep = select(DailyReport).where(DailyReport.content_md.contains(q))
            if visible is not None:
                q_rep = q_rep.where(DailyReport.user_id.in_(visible))
            reports = db.exec(q_rep.limit(top_k)).all()
            result["reports"] = [{"id": r.id, "date": str(r.report_date), "snippet": r.content_md[:150]} for r in reports]

        if has_permission(user, "customer:read", db):
            visible = get_visible_user_ids(user, db, module="customer")
            q_cus = select(Customer).where(Customer.name.contains(q))
            if visible is not None:
                q_cus = q_cus.where(Customer.user_id.in_(visible))
            customers = db.exec(q_cus.limit(top_k)).all()
            result["customers"] = [{"id": c.id, "name": c.name, "industry": c.industry, "status": c.status} for c in customers]

        if has_permission(user, "project:read", db):
            visible = get_visible_user_ids(user, db, module="project")
            q_proj = select(Project).where(Project.name.contains(q) | Project.customer_name.contains(q))
            if visible is not None:
                q_proj = q_proj.where(Project.user_id.in_(visible))
            projects = db.exec(q_proj.limit(top_k)).all()
            result["projects"] = [{"id": p.id, "name": p.name, "customer_name": p.customer_name, "status": p.status} for p in projects]

        if has_permission(user, "meeting:read", db):
            visible = get_visible_user_ids(user, db, module="meeting")
            q_meet = select(MeetingNote).where(MeetingNote.title.contains(q) | MeetingNote.content_md.contains(q))
            if visible is not None:
                q_meet = q_meet.where(MeetingNote.user_id.in_(visible))
            meetings = db.exec(q_meet.limit(top_k)).all()
            result["meetings"] = [{"id": m.id, "title": m.title, "date": str(m.meeting_date)} for m in meetings]

        return json.dumps(result, ensure_ascii=False)

    # ── 日报：语义搜索 ────────────────────────────────────────────────────────
    elif tool_name == "search_reports":
        if err := _deny("report:read"): return err
        # 向量搜索暂不做行级过滤（Chroma 无 user_id 元数据）；结果文本不含敏感关键字则可接受
        results = search_similar("daily_reports", arguments["query"], arguments.get("top_k", 5), db=db)
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

    # ── 日报：按日期 ──────────────────────────────────────────────────────────
    elif tool_name == "get_reports_by_date":
        if err := _deny("report:read"): return err
        visible = get_visible_user_ids(user, db, module="report")
        target_date = date.fromisoformat(arguments["date"])
        q = select(DailyReport).where(DailyReport.report_date == target_date)
        if visible is not None:
            q = q.where(DailyReport.user_id.in_(visible))
        reports = db.exec(q).all()
        if not reports:
            return json.dumps({"found": False, "message": f"{arguments['date']} 没有日报记录"}, ensure_ascii=False)
        return json.dumps(
            {"found": True, "date": arguments["date"], "count": len(reports), "reports": [
                {"id": r.id, "user_id": r.user_id, "date": str(r.report_date), "content": r.content_md[:300], "ai_summary": r.ai_summary}
                for r in reports
            ]},
            ensure_ascii=False,
        )

    # ── 日报：按日期范围 ──────────────────────────────────────────────────────
    elif tool_name == "get_reports_by_date_range":
        if err := _deny("report:read"): return err
        visible = get_visible_user_ids(user, db, module="report")
        start = date.fromisoformat(arguments["start_date"])
        end = date.fromisoformat(arguments["end_date"])
        q = select(DailyReport).where(DailyReport.report_date >= start, DailyReport.report_date <= end).order_by(DailyReport.report_date)
        if visible is not None:
            q = q.where(DailyReport.user_id.in_(visible))
        reports = db.exec(q).all()
        if not reports:
            return json.dumps({"found": False, "message": f"{arguments['start_date']} ~ {arguments['end_date']} 没有日报记录"}, ensure_ascii=False)
        return json.dumps(
            {"found": True, "start_date": arguments["start_date"], "end_date": arguments["end_date"],
             "count": len(reports), "reports": [
                {"id": r.id, "user_id": r.user_id, "date": str(r.report_date), "content": r.content_md[:200], "ai_summary": r.ai_summary}
                for r in reports
            ]},
            ensure_ascii=False,
        )

    # ── 日报：今日总结 ────────────────────────────────────────────────────────
    elif tool_name == "summarize_today_reports":
        if err := _deny("report:read"): return err
        from app.services.ai_service import summarize_daily_report
        visible = get_visible_user_ids(user, db, module="report")
        today = date.today()
        q = select(DailyReport).where(DailyReport.report_date == today)
        if visible is not None:
            q = q.where(DailyReport.user_id.in_(visible))
        reports = db.exec(q).all()
        if not reports:
            return "今天还没有日报记录"
        summaries = []
        for report in reports:
            if not report.ai_summary:
                try:
                    summary = summarize_daily_report(report.content_md, db, user.id)
                    report.ai_summary = summary
                except Exception as e:
                    write_log("error", "ai", f"日报AI总结失败 [report_id={report.id}]: {str(e)[:150]}", details=str(e), db=db)
                    summary = "AI总结失败"
            else:
                summary = report.ai_summary
            summaries.append(f"[日报{report.id}] {report.content_md[:100]}... => {summary}")
        db.commit()
        return "\n".join(summaries)

    # ── 客户详情 ──────────────────────────────────────────────────────────────
    elif tool_name == "get_customer_summary":
        if err := _deny("customer:read"): return err
        customer_id = arguments["customer_id"]
        customer = db.get(Customer, customer_id)
        if not customer:
            return json.dumps({"error": "客户不存在"}, ensure_ascii=False)
        # 行级访问校验
        visible = get_visible_user_ids(user, db, module="customer")
        if visible is not None and customer.user_id not in visible:
            return json.dumps({"error": "您没有访问该客户的权限"}, ensure_ascii=False)
        projects = db.exec(select(Project).where(Project.customer_id == customer_id)).all()
        meetings = db.exec(
            select(MeetingNote).where(MeetingNote.customer_id == customer_id)
            .order_by(MeetingNote.meeting_date.desc()).limit(5)
        ).all()
        return json.dumps(
            {
                "customer": {
                    "id": customer.id, "name": customer.name, "industry": customer.industry,
                    "status": customer.status, "contact": customer.contact or "",
                    "core_products": customer.core_products or "", "business_scope": customer.business_scope or "",
                    "scale": customer.scale or "", "profile": customer.profile or "",
                    "recent_news": customer.recent_news or "",
                },
                "project_count": len(projects),
                "projects": [{"id": p.id, "name": p.name, "status": p.status} for p in projects],
                "recent_meetings": [{"id": m.id, "title": m.title, "date": str(m.meeting_date)} for m in meetings],
            },
            ensure_ascii=False,
        )

    # ── 公司搜索（本地 + 联网） ───────────────────────────────────────────────
    elif tool_name == "search_company_info":
        if err := _deny("customer:read"): return err
        keyword = arguments.get("keyword", "").strip()
        do_web = arguments.get("search_web", True)
        if not keyword:
            return json.dumps({"error": "请输入公司名称或关键词"}, ensure_ascii=False)
        result = {"local_customers": [], "web_results": [], "keyword": keyword}
        visible = get_visible_user_ids(user, db, module="customer")
        q_cus = select(Customer).where(Customer.name.contains(keyword)).limit(10)
        if visible is not None:
            q_cus = q_cus.where(Customer.user_id.in_(visible))
        local_customers = db.exec(q_cus).all()
        result["local_customers"] = [
            {"id": c.id, "name": c.name, "industry": c.industry or "", "status": c.status or "",
             "core_products": c.core_products or "", "scale": c.scale or "",
             "profile": c.profile or "", "recent_news": c.recent_news or ""}
            for c in local_customers
        ]
        if do_web:
            try:
                from app.services.ai_service import search_company_names, fetch_company_info
                candidates = search_company_names(keyword, db)
                if candidates:
                    top = candidates[0]
                    full_name = top.get("full_name") or top.get("name")
                    info = fetch_company_info(full_name, db)
                    if info and info.get("name"):
                        result["web_results"].append(info)
                    result["candidates"] = candidates[:5]
            except Exception as e:
                result["web_error"] = f"联网搜索失败: {str(e)[:100]}"
        return json.dumps(result, ensure_ascii=False)

    # ── 创建客户 ──────────────────────────────────────────────────────────────
    elif tool_name == "create_customer":
        if err := _deny("customer:create"): return err
        name = arguments.get("name", "").strip()
        if not name:
            return json.dumps({"error": "公司名称不能为空"}, ensure_ascii=False)
        existing = db.exec(select(Customer).where(Customer.name == name)).first()
        if existing:
            return json.dumps({"success": False, "error": f"客户「{name}」已存在（ID: {existing.id}）", "customer_id": existing.id}, ensure_ascii=False)
        customer = Customer(
            user_id=user.id, name=name,
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
        try:
            from app.services.vector_store import index_document
            index_document("customers", str(customer.id), f"{customer.name} {customer.industry or ''}", {"status": customer.status})
        except Exception:
            pass
        return json.dumps({"success": True, "customer_id": customer.id, "name": customer.name, "message": f"已成功创建客户「{customer.name}」（ID: {customer.id}）"}, ensure_ascii=False)

    # ── 列出/搜索项目 ─────────────────────────────────────────────────────────
    elif tool_name == "list_projects":
        if err := _deny("project:read"): return err
        q = arguments.get("query", "")
        limit = arguments.get("limit", 20)
        visible = get_visible_user_ids(user, db, module="project")
        query = select(Project).order_by(Project.updated_at.desc())
        if q:
            query = query.where(Project.name.contains(q) | Project.customer_name.contains(q))
        if visible is not None:
            query = query.where(Project.user_id.in_(visible))
        projects = db.exec(query.limit(limit)).all()
        return json.dumps(
            {"total": len(projects), "projects": [
                {"id": p.id, "name": p.name, "customer_name": p.customer_name,
                 "status": p.status, "product": p.product,
                 "start_date": str(p.start_date) if p.start_date else None}
                for p in projects
            ]},
            ensure_ascii=False,
        )

    # ── AI 项目分析 ───────────────────────────────────────────────────────────
    elif tool_name == "get_project_analysis":
        if err := _deny("project:read"): return err
        from app.services.ai_service import generate_project_analysis
        project_id = arguments["project_id"]
        project = db.get(Project, project_id)
        if not project:
            return json.dumps({"error": "项目不存在"}, ensure_ascii=False)
        visible = get_visible_user_ids(user, db, module="project")
        if visible is not None and project.user_id not in visible:
            return json.dumps({"error": "您没有访问该项目的权限"}, ensure_ascii=False)
        meetings = db.exec(
            select(MeetingNote).where(MeetingNote.project_id == project_id)
            .order_by(MeetingNote.meeting_date.desc()).limit(5)
        ).all()
        analysis = generate_project_analysis(project_id, db, user.id)
        return json.dumps(
            {
                "project": {"id": project.id, "name": project.name, "status": project.status,
                            "deadline": str(project.deadline) if project.deadline else None},
                "recent_meetings": [{"id": m.id, "title": m.title, "date": str(m.meeting_date)} for m in meetings],
                "ai_analysis": analysis,
            },
            ensure_ascii=False,
        )

    # ── 搜索会议 ──────────────────────────────────────────────────────────────
    elif tool_name == "search_meetings":
        if err := _deny("meeting:read"): return err
        q = arguments.get("query", "")
        cid = arguments.get("customer_id")
        pid = arguments.get("project_id")
        limit = arguments.get("limit", 5)
        visible = get_visible_user_ids(user, db, module="meeting")
        query = select(MeetingNote).order_by(MeetingNote.meeting_date.desc())
        if q:
            query = query.where(MeetingNote.title.contains(q) | MeetingNote.content_md.contains(q))
        if cid:
            query = query.where(MeetingNote.customer_id == cid)
        if pid:
            query = query.where(MeetingNote.project_id == pid)
        if visible is not None:
            query = query.where(MeetingNote.user_id.in_(visible))
        meetings = db.exec(query.limit(limit)).all()
        return json.dumps(
            [{"id": m.id, "title": m.title, "date": str(m.meeting_date),
              "content": m.content_md[:200], "has_audio": bool(m.audio_url)}
             for m in meetings],
            ensure_ascii=False,
        )

    # ── 搜索合同 ──────────────────────────────────────────────────────────────
    elif tool_name == "search_contracts":
        if err := _deny("contract:read"): return err
        keyword = arguments.get("keyword", "")
        customer_name = arguments.get("customer_name", "")
        view_all = has_permission(user, "contract:view_all", db)
        query = select(Contract).where(
            Contract.title.contains(keyword) |
            Contract.contract_no.contains(keyword) |
            Contract.summary.contains(keyword) |
            Contract.raw_text.contains(keyword)
        ).order_by(Contract.created_at.desc()).limit(10)
        if not view_all:
            query = query.where(Contract.user_id == user.id)
        if customer_name:
            c_ids = [c.id for c in db.exec(select(Customer).where(Customer.name.contains(customer_name))).all()]
            if c_ids:
                query = query.where(Contract.customer_id.in_(c_ids))
        contracts = db.exec(query).all()
        results = []
        for ct in contracts:
            cust = db.get(Customer, ct.customer_id)
            results.append({
                "id": ct.id, "title": ct.title, "contract_no": ct.contract_no,
                "customer_name": cust.name if cust else "",
                "sign_date": str(ct.sign_date) if ct.sign_date else "",
                "end_date": str(ct.end_date) if ct.end_date else "",
                "amount": f"{ct.contract_amount} {ct.currency}" if ct.contract_amount else "",
                "status": ct.status, "summary": ct.summary or "",
                "key_clauses_snippet": (ct.key_clauses or "")[:300],
            })
        return json.dumps({"count": len(results), "contracts": results}, ensure_ascii=False)

    # ── 合同详情 ──────────────────────────────────────────────────────────────
    elif tool_name == "get_contract_detail":
        if err := _deny("contract:read"): return err
        ct_id = arguments.get("contract_id", 0)
        ct = db.get(Contract, ct_id)
        if not ct:
            return json.dumps({"error": "合同不存在"}, ensure_ascii=False)
        view_all = has_permission(user, "contract:view_all", db)
        if not view_all and ct.user_id != user.id:
            return json.dumps({"error": "您没有访问该合同的权限"}, ensure_ascii=False)
        cust = db.get(Customer, ct.customer_id)
        return json.dumps({
            "id": ct.id, "title": ct.title, "contract_no": ct.contract_no,
            "customer_name": cust.name if cust else "",
            "sign_date": str(ct.sign_date) if ct.sign_date else "",
            "start_date": str(ct.start_date) if ct.start_date else "",
            "end_date": str(ct.end_date) if ct.end_date else "",
            "party_a": ct.party_a, "party_b": ct.party_b,
            "contract_amount": ct.contract_amount, "currency": ct.currency,
            "payment_terms": ct.payment_terms or "",
            "key_clauses": ct.key_clauses or "",
            "summary": ct.summary or "",
            "status": ct.status, "remarks": ct.remarks or "",
        }, ensure_ascii=False)

    # ── 对账月结 ──────────────────────────────────────────────────────────────
    elif tool_name == "query_reconcile":
        if err := _deny("project:read"): return err
        from app.models.reconcile import ReconcileSales, ReconcileSupply, ReconcileSummary
        period = arguments.get("period", "")
        if period:
            periods = [period]
        else:
            # 最近3个月
            from datetime import date as _date
            from calendar import month_abbr
            today = _date.today()
            periods = []
            for i in range(3):
                m = today.month - i
                y = today.year
                if m <= 0:
                    m += 12
                    y -= 1
                periods.append(f"{y}-{m:02d}")
        results = []
        for p in periods:
            summary = db.exec(select(ReconcileSummary).where(ReconcileSummary.period == p)).first()
            sales = db.exec(select(ReconcileSales).where(ReconcileSales.period == p)).all()
            supply = db.exec(select(ReconcileSupply).where(ReconcileSupply.period == p)).all()
            results.append({
                "period": p,
                "status": summary.status if summary else "未录入",
                "total_revenue": float(summary.total_revenue or 0) if summary else 0,
                "total_cost": float(summary.total_cost or 0) if summary else 0,
                "gross_profit": float(summary.gross_profit or 0) if summary else 0,
                "sales_count": len(sales),
                "supply_count": len(supply),
            })
        return json.dumps({"periods": results}, ensure_ascii=False)

    # ── 供应商列表 ────────────────────────────────────────────────────────────
    elif tool_name == "list_suppliers":
        if err := _deny("project:read"): return err
        from app.models.supplier import Supplier
        from app.models.project_cost import ProjectCost
        status_filter = arguments.get("status")
        q = select(Supplier)
        if status_filter:
            q = q.where(Supplier.status == status_filter)
        suppliers = db.exec(q).all()
        result = []
        for s in suppliers:
            cost_total = db.exec(
                select(func.coalesce(func.sum(ProjectCost.amount), 0)).where(ProjectCost.supplier_id == s.id)
            ).one()
            result.append({
                "id": s.id, "name": s.name, "code": s.code,
                "category": s.category, "status": s.status,
                "settlement_currency": s.settlement_currency,
                "total_cost": round(float(cost_total), 2),
                "models_provided": s.models_provided or "",
            })
        return json.dumps({"count": len(result), "suppliers": result}, ensure_ascii=False)

    # ── 通道列表 ──────────────────────────────────────────────────────────────
    elif tool_name == "list_channels":
        if err := _deny("project:read"): return err
        from app.models.channel import Channel
        from app.models.supplier import Supplier as Sup
        sid = arguments.get("supplier_id")
        status_filter = arguments.get("status")
        q = select(Channel)
        if sid:
            q = q.where(Channel.supplier_id == sid)
        if status_filter:
            q = q.where(Channel.status == status_filter)
        channels = db.exec(q).all()
        result = []
        for c in channels:
            sup = db.get(Sup, c.supplier_id)
            result.append({
                "id": c.id, "name": c.name,
                "supplier_name": sup.name if sup else "",
                "model_type": c.model_type, "kind": c.kind,
                "status": c.status,
                "cost_price": str(c.cost_price) if c.cost_price else "",
                "price_unit": c.price_unit or "",
            })
        return json.dumps({"count": len(result), "channels": result}, ensure_ascii=False)

    # ── 我的审批事项 ──────────────────────────────────────────────────────────
    elif tool_name == "get_my_pending_approvals":
        from app.models.approval import ApprovalInstance, ApprovalRecord
        from app.services import approval_engine
        query_type = arguments.get("type", "pending")

        if query_type in ("pending", "all"):
            # 所有进行中的实例，看我是否是当前节点的审批人
            active = db.exec(
                select(ApprovalInstance).where(ApprovalInstance.status == "pending")
            ).all()
            pending_list = []
            for inst in active:
                if approval_engine.can_act(inst, user):
                    pending_list.append({
                        "id": inst.id, "title": inst.title,
                        "flow_code": inst.flow_code,
                        "target_type": inst.target_type, "target_id": inst.target_id,
                        "submitted_at": inst.submitted_at.isoformat() if inst.submitted_at else "",
                    })

        if query_type in ("mine", "all"):
            mine = db.exec(
                select(ApprovalInstance).where(ApprovalInstance.submitted_by == user.id)
                .order_by(ApprovalInstance.submitted_at.desc()).limit(10)
            ).all()
            mine_list = [
                {"id": inst.id, "title": inst.title, "flow_code": inst.flow_code,
                 "status": inst.status,
                 "submitted_at": inst.submitted_at.isoformat() if inst.submitted_at else "",
                 "finished_at": inst.finished_at.isoformat() if inst.finished_at else ""}
                for inst in mine
            ]

        if query_type == "pending":
            return json.dumps({"pending_approvals": pending_list, "count": len(pending_list)}, ensure_ascii=False)
        elif query_type == "mine":
            return json.dumps({"my_applications": mine_list, "count": len(mine_list)}, ensure_ascii=False)
        else:
            return json.dumps({"pending_approvals": pending_list, "my_applications": mine_list}, ensure_ascii=False)

    # ── 数据看板 ──────────────────────────────────────────────────────────────
    elif tool_name == "get_dashboard_overview":
        if err := _deny("dashboard:read"): return err
        from datetime import date as _date, timedelta
        today = _date.today()
        week_start = today - timedelta(days=today.weekday())

        # 项目统计
        total_projects = db.exec(select(func.count(Project.id))).one()
        status_rows = db.exec(
            select(Project.status, func.count(Project.id)).group_by(Project.status)
        ).all()
        project_by_status = {row[0]: row[1] for row in status_rows}

        # 客户统计
        total_customers = db.exec(select(func.count(Customer.id))).one()

        # 本周日报
        week_reports = db.exec(
            select(func.count(DailyReport.id)).where(DailyReport.report_date >= week_start)
        ).one()

        # 近7天会议
        recent_meetings = db.exec(
            select(func.count(MeetingNote.id)).where(MeetingNote.meeting_date >= today - timedelta(days=7))
        ).one()

        return json.dumps({
            "overview_date": str(today),
            "projects": {"total": total_projects, "by_status": project_by_status},
            "customers": {"total": total_customers},
            "reports": {"this_week": week_reports},
            "meetings": {"last_7_days": recent_meetings},
        }, ensure_ascii=False)

    # ── Wiki 搜索 ─────────────────────────────────────────────────────────────
    elif tool_name == "search_wiki":
        if err := _deny("wiki:read"): return err
        from app.models.wiki import WikiPage, WikiSpace, WikiPermission
        q = arguments.get("query", "")
        limit = arguments.get("limit", 8)
        # 仅搜索用户有读权限的空间
        # 简化：搜索用户创建的空间或被授予访问权限的空间下的页面
        accessible_space_ids = []
        all_spaces = db.exec(select(WikiSpace)).all()
        for space in all_spaces:
            if space.owner_id == user.id or space.is_public:
                accessible_space_ids.append(space.id)
                continue
            # 检查是否有显式权限
            perm = db.exec(
                select(WikiPermission).where(
                    WikiPermission.target_type == "space",
                    WikiPermission.target_id == space.id,
                    WikiPermission.subject_type == "user",
                    WikiPermission.subject_id == user.id,
                )
            ).first()
            if perm:
                accessible_space_ids.append(space.id)

        if not accessible_space_ids:
            return json.dumps({"pages": [], "message": "暂无可访问的 Wiki 空间"}, ensure_ascii=False)

        query = select(WikiPage).where(
            WikiPage.space_id.in_(accessible_space_ids),
            WikiPage.is_deleted == False,
        )
        if q:
            query = query.where(WikiPage.title.contains(q) | WikiPage.content.contains(q))
        pages = db.exec(query.limit(limit)).all()
        return json.dumps(
            {"count": len(pages), "pages": [
                {"id": p.id, "title": p.title, "space_id": p.space_id,
                 "updated_at": p.updated_at.isoformat() if p.updated_at else "",
                 "snippet": (p.content or "")[:200]}
                for p in pages
            ]},
            ensure_ascii=False,
        )

    # ── 创建定时任务 ──────────────────────────────────────────────────────────
    elif tool_name == "create_scheduled_task":
        if err := _deny("task:create"): return err
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
        return json.dumps({"success": True, "task_id": task.id, "name": task.name}, ensure_ascii=False)

    return json.dumps({"error": f"未知工具: {tool_name}"}, ensure_ascii=False)


# ─────────────────────────────────────────────────────────────────────────────
# 主入口
# ─────────────────────────────────────────────────────────────────────────────

def run_agent_chat(user_message: str, history: list[dict], db: Session, user: User, on_event=None) -> str:
    """运行 AI Agent 对话，支持多轮工具调用

    on_event: 可选回调 fn(event_type: str, data: dict)，用于 SSE 流式推送工具调用事件
    """
    # 动态生成系统提示词和工具列表（基于当前用户权限）
    system_prompt = get_system_prompt(user, db)
    tools_for_user = get_tools_for_user(user, db)

    messages = [{"role": "system", "content": system_prompt}]

    # 保留最近10条对话历史
    for msg in history[-10:]:
        messages.append(msg)
    messages.append({"role": "user", "content": user_message})

    try:
        base_url, api_key, model, provider = _get_active_provider(db, "chat", user.id)
        client = _get_client(base_url, api_key, provider)
    except Exception as e:
        write_log("error", "ai", f"AI模型配置失败: {str(e)[:150]}", details=str(e), db=db)
        return f"AI 模型配置失败: {str(e)[:200]}"

    for _ in range(5):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tools_for_user if tools_for_user else None,
                temperature=0.7,
            )
        except Exception as e:
            write_log("error", "ai", f"AI API调用失败: {str(e)[:150]}", details=str(e), db=db)
            return f"AI API 调用失败: {str(e)[:200]}"

        from app.services.ai_service import _record_usage_silent
        _record_usage_silent(db, response, user.id, getattr(provider, 'id', None), model, "chat")

        choice = response.choices[0]

        if choice.message.tool_calls:
            messages.append(choice.message)
            for tool_call in choice.message.tool_calls:
                tool_name = tool_call.function.name
                arguments = json.loads(tool_call.function.arguments)

                if on_event:
                    on_event("tool_start", {"tool": tool_name})

                try:
                    result = execute_tool(tool_name, arguments, db, user)
                except Exception as e:
                    error_msg = f"工具执行失败 [{tool_name}]: {str(e)[:150]}"
                    write_log("error", "ai", error_msg, details=str(e), db=db)
                    result = json.dumps({"error": error_msg}, ensure_ascii=False)

                if on_event:
                    on_event("tool_done", {"tool": tool_name})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })
        else:
            final_text = _extract_message_text(choice.message)
            if not final_text:
                write_log("warning", "ai", "AI返回空内容", details=f"模型: {model}, 用户消息: {user_message[:100]}", db=db)
                return "抱歉，我无法处理这个请求。"
            if on_event:
                on_event("text", {"content": final_text})
            return final_text

    write_log("warning", "ai", "工具调用次数过多(>5轮)", details=f"用户消息: {user_message[:100]}", db=db)
    return "工具调用次数过多，请简化您的问题。"
