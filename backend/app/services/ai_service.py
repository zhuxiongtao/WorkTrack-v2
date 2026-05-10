import json
import re as _re_module
from urllib.parse import urlparse
from openai import OpenAI
from sqlmodel import Session, select
from app.config import settings
from app.models.daily_report import DailyReport
from app.models.project import Project
from app.models.meeting_note import MeetingNote
from app.models.customer import Customer
from app.models.model_provider import ModelProvider, TaskModelConfig, ProviderModel
from app.models.ai_prompt import AIPrompt
from app.models.user import User
from app.services.web_search import search_and_summarize, _get_tavily_api_key


# ---- Vertex AI 认证支持 ----

def _is_vertex_ai(provider: ModelProvider) -> bool:
    """判断是否为 Vertex AI 供应商（通过 project_id 字段识别）"""
    return bool(provider.project_id and provider.project_id.strip())


def _get_vertex_credentials(provider: ModelProvider):
    """从服务账号 JSON（api_key 字段）加载 Google Cloud 凭据"""
    from google.oauth2 import service_account
    try:
        creds_info = json.loads(provider.api_key)
        return service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    except (ValueError, json.JSONDecodeError):
        import google.auth
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        return credentials


# ---- Vertex AI 原生 SDK 包装器 ----

# 伪响应类型：模拟 OpenAI chat completion response
class _FakeMessage:
    def __init__(self, content=None, role="assistant", tool_calls=None):
        self.content = content
        self.role = role
        self.tool_calls = tool_calls or []


class _FakeChoice:
    def __init__(self, message: _FakeMessage, finish_reason="stop"):
        self.message = message
        self.finish_reason = finish_reason


class _FakeStreamChunk:
    """模拟 OpenAI 流式 chunk"""
    def __init__(self, content: str):
        self.choices = [_FakeChoice(_FakeMessage(content=content))]


class _VertexGenAIClient:
    """包装 google-genai SDK，对外暴露与 OpenAI 客户端兼容的 .chat.completions.create() 接口"""

    def __init__(self, provider: ModelProvider):
        from google import genai
        credentials = _get_vertex_credentials(provider)
        self._genai = genai.Client(
            vertexai=True,
            project=provider.project_id,
            location=provider.location or "global",
            credentials=credentials,
        )
        self._provider = provider
        self.chat = _VertexChat(self)


class _VertexChat:
    def __init__(self, client: "_VertexGenAIClient"):
        self.completions = _VertexCompletions(client)


class _VertexCompletions:
    """模拟 openai.chat.completions.create()，内部调用 google-genai SDK"""

    def __init__(self, client: "_VertexGenAIClient"):
        self._client = client

    @staticmethod
    def _genai_to_openai_messages(messages: list[dict]) -> tuple:
        """
        将 OpenAI 消息格式转换为 genai contents 格式
        返回: (contents, system_instruction)
        """
        from google.genai import types
        contents = []
        system_instruction = None

        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")

            if role == "system":
                if isinstance(content, list):
                    text_parts = [p.get("text", "") for p in content if isinstance(p, dict)]
                    system_instruction = "\n".join(text_parts) if text_parts else content
                else:
                    system_instruction = content
            elif role == "user":
                if isinstance(content, str):
                    contents.append(types.Content(role="user", parts=[types.Part(text=content)]))
                elif isinstance(content, list):
                    parts = []
                    for p in content:
                        if isinstance(p, dict) and "text" in p:
                            parts.append(types.Part(text=p["text"]))
                    if parts:
                        contents.append(types.Content(role="user", parts=parts))
            elif role == "assistant":
                if isinstance(content, str) and content:
                    contents.append(types.Content(role="model", parts=[types.Part(text=content)]))
            elif role == "tool":
                # 工具调用结果：作为 user 消息追加
                if isinstance(content, str) and content:
                    contents.append(types.Content(role="user", parts=[
                        types.Part(text=f"[工具返回] {content}")
                    ]))

        return contents, system_instruction

    @staticmethod
    def _build_genai_config(temperature=0.7, max_tokens=None, response_format=None, extra_body=None):
        from google.genai import types

        config_kwargs = {}
        if temperature is not None:
            config_kwargs["temperature"] = temperature
        if max_tokens is not None:
            config_kwargs["max_output_tokens"] = max_tokens
        if response_format and response_format.get("type") == "json_object":
            config_kwargs["response_mime_type"] = "application/json"

        # Vertex AI gemini-2.5 系列默认关闭 thinking，避免消耗 token 预算
        config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)

        # 联网搜索
        if extra_body and extra_body.get("enable_search"):
            tools_list = [types.Tool(google_search=types.GoogleSearch())]
            config_kwargs["tools"] = tools_list

        if not config_kwargs:
            return None
        return types.GenerateContentConfig(**config_kwargs)

    @staticmethod
    def _openai_tools_to_genai(openai_tools: list) -> list:
        from google.genai import types
        func_decls = []
        for tool in openai_tools:
            if tool.get("type") == "function":
                func = tool["function"]
                params_schema = func.get("parameters", {})
                schema = types.Schema(
                    type=params_schema.get("type", "OBJECT"),
                    properties=params_schema.get("properties", {}),
                    required=params_schema.get("required", []),
                )
                func_decls.append(types.FunctionDeclaration(
                    name=func["name"],
                    description=func.get("description", ""),
                    parameters=schema,
                ))
        return [types.Tool(function_declarations=func_decls)] if func_decls else []

    @staticmethod
    def _genai_func_call_to_openai(func_calls: list) -> list:
        tool_calls = []
        for i, fc in enumerate(func_calls):
            tool_calls.append(_FakeToolCall(
                id=f"call_{i}",
                type="function",
                function=_FakeFunctionCall(
                    name=fc.name,
                    arguments=json.dumps(fc.args, ensure_ascii=False) if fc.args else "{}",
                ),
            ))
        return tool_calls

    def create(self, **kwargs):
        """
        与 OpenAI client.chat.completions.create() 兼容的接口
        内部调用 google-genai SDK
        """
        from google.genai import types

        model = kwargs.get("model", "gemini-2.5-flash")
        # 移除 google/ 前缀（genai SDK 不需要）
        if model.startswith("google/"):
            model = model[len("google/"):]

        messages = kwargs.get("messages", [])
        temperature = kwargs.get("temperature", 0.7)
        max_tokens = kwargs.get("max_tokens", kwargs.get("max_completion_tokens"))
        response_format = kwargs.get("response_format")
        extra_body = kwargs.get("extra_body")
        stream = kwargs.get("stream", False)
        tools = kwargs.get("tools")

        # 转换消息格式
        contents, system_instruction = self._genai_to_openai_messages(messages)

        # 构建配置
        config = self._build_genai_config(
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format,
            extra_body=extra_body,
        ) or types.GenerateContentConfig()

        if system_instruction:
            config.system_instruction = system_instruction

        if tools:
            genai_tools = self._openai_tools_to_genai(tools)
            config.tools = genai_tools

        # 流式
        if stream:
            return _VertexStreamResponse(
                self._client._genai, model, contents, config
            )

        # 非流式
        response = self._client._genai.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )

        # 提取文本或函数调用
        if response.function_calls:
            tool_calls = self._genai_func_call_to_openai(response.function_calls)
            return _FakeResponse(
                choices=[_FakeChoice(
                    message=_FakeMessage(content=None, tool_calls=tool_calls),
                )],
            )

        text = response.text or ""
        return _FakeResponse(
            choices=[_FakeChoice(message=_FakeMessage(content=text))],
        )


class _VertexStreamResponse:
    """模拟 OpenAI 流式响应迭代器"""

    def __init__(self, genai_client, model, contents, config):
        self._genai = genai_client
        self._model = model
        self._contents = contents
        self._config = config

    def __iter__(self):
        response = self._genai.models.generate_content_stream(
            model=self._model,
            contents=self._contents,
            config=self._config,
        )
        for chunk in response:
            if chunk.text:
                yield _FakeStreamChunk(content=chunk.text)


class _FakeToolCall:
    def __init__(self, id, type, function):
        self.id = id
        self.type = type
        self.function = function


class _FakeFunctionCall:
    def __init__(self, name, arguments):
        self.name = name
        self.arguments = arguments


class _FakeResponse:
    def __init__(self, choices):
        self.choices = choices




# 默认提示词（与 settings.py 中的 DEFAULT_PROMPTS 保持一致）
_DEFAULT_PROMPTS = {
    "daily_summary": {
        "system_prompt": "你是一个专业的工作助手，请用简洁的中文总结以下日报内容，提取关键工作事项和成果。",
        "user_prompt_template": "请总结以下工作日报：\n{content}",
    },
    "weekly_summary": {
        "system_prompt": "你是一个专业的周报总结助手。请根据本周的日报内容，生成一份简洁的工作周报总结。要求：1. 概括本周主要工作内容 2. 突出重要进展和成果 3. 指出待解决的问题 4. 用 markdown 格式输出，结构清晰。",
        "user_prompt_template": "请总结本周（{week_range}）的工作情况：\n\n{reports_content}",
    },
    "meeting_organize": {
        "system_prompt": "你是一个专业的会议纪要整理助手。请将以下语音转文字内容整理成结构化的会议纪要。\n要求：\n1. 修正转写错误，补充上下文使语句通顺\n2. 按讨论主题分段，每段有小标题\n3. 提取关键决策和待办事项\n4. 用 markdown 格式输出\n请直接输出整理后的会议纪要，不要加\"以下是整理后的...\"之类的引导语。",
        "user_prompt_template": "请整理以下会议录音转写内容：\n{content}",
    },
    "meeting_extract": {
        "system_prompt": "你是一个专业的会议纪要分析助手。请从会议内容中提取结构化信息。\n以 JSON 格式返回，包含以下字段：\n- decisions: 会议决议列表\n- todos: 待办事项列表，每项包含 task 和 assignee\n- conclusions: 会议结论摘要\n只返回 JSON，不要有其他内容。",
        "user_prompt_template": "请以 json 格式分析以下会议纪要，返回 decisions、todos、conclusions 三个字段：\n{content}",
    },
    "project_analysis": {
        "system_prompt": "你是一个专业的项目管理助手，请基于项目跟进记录、客户情况、会议纪要等多维度信息，综合分析项目状态并给出专业建议。",
        "user_prompt_template": "请分析以下项目：\n\n【基本信息】\n项目名称: {name}\n当前状态: {status}\n涉及产品: {product}\n项目场景: {scenario}\n销售负责人: {sales_person}\n商机金额: {amount}\n截止日期: {deadline}\n\n【客户信息】\n客户名称: {customer_name}\n客户行业: {customer_industry}\n客户规模: {customer_scale}\n核心产品: {customer_products}\n客户简介: {customer_profile}\n\n【跟进记录】\n{progress}\n\n【关联会议】\n{meetings}\n\n请基于以上信息给出全面的项目分析，包括：\n1. 当前状态评估（结合跟进记录和客户情况）\n2. 风险提示（考虑客户行业、规模、项目进展等）\n3. 后续建议（具体的下一步行动建议）",
    },
}


def _get_prompt(task_type: str, db: Session, user_id: int = 0):
    """获取 AI 提示词：优先从数据库读取（按用户隔离），没有则使用默认值"""
    default = _DEFAULT_PROMPTS.get(task_type)
    if not default:
        return "", ""
    # 先查用户自定义提示词
    saved = db.exec(
        select(AIPrompt).where(
            AIPrompt.task_type == task_type,
            AIPrompt.user_id == user_id,
        )
    ).first()
    # 没找到用户自定义的，查系统默认（user_id=0）
    if not saved and user_id != 0:
        saved = db.exec(
            select(AIPrompt).where(
                AIPrompt.task_type == task_type,
                AIPrompt.user_id == 0,
            )
        ).first()
    system = saved.system_prompt or default["system_prompt"] if saved else default["system_prompt"]
    template = saved.user_prompt_template or default["user_prompt_template"] if saved else default["user_prompt_template"]
    return system, template


def _fill_template(template: str, **kwargs) -> str:
    """用变量填充提示词模板"""
    result = template
    for key, value in kwargs.items():
        result = result.replace("{" + key + "}", str(value or ""))
    return result


def _get_active_provider(db: Session, task_type: str = "chat", user_id: int = 0) -> tuple:
    """获取活跃的模型供应商和模型名：优先用户私有 > 管理员共享（需权限）
    返回 (base_url, api_key, model_name, provider)
    - 对于 Vertex AI：base_url/api_key 不使用，model_name 为原始名称（无 google/ 前缀）
    - 对于 OpenAI 兼容：base_url/api_key 正常返回，model_name 保持原样"""
    use_shared = True
    user = None
    if user_id:
        user = db.get(User, user_id)
        use_shared = bool(user and (user.is_admin or user.use_shared_models))

    def _resolve(provider: ModelProvider, model_name: str):
        if _is_vertex_ai(provider):
            # Vertex AI 原生：不需要 base_url/api_key，移除可能存在的 google/ 前缀
            if model_name.startswith("google/"):
                model_name = model_name[len("google/"):]
            return None, None, model_name
        else:
            return provider.base_url, provider.api_key, model_name

    # 1. 用户自己的任务配置
    if user:
        task_cfg = db.exec(
            select(TaskModelConfig).where(
                TaskModelConfig.task_type == task_type,
                TaskModelConfig.user_id == user_id,
            )
        ).first()
        if task_cfg and task_cfg.provider_id and task_cfg.model_name:
            provider = db.get(ModelProvider, task_cfg.provider_id)
            if provider and provider.is_active and provider.api_key:
                base_url, api_key, model_name = _resolve(provider, task_cfg.model_name)
                return base_url, api_key, model_name, provider

    # 2. 管理员共享的任务配置（需 use_shared_models 权限）
    if use_shared:
        task_cfg = db.exec(
            select(TaskModelConfig).where(
                TaskModelConfig.task_type == task_type,
                TaskModelConfig.user_id == None,
            )
        ).first()
        if task_cfg and task_cfg.provider_id and task_cfg.model_name:
            provider = db.get(ModelProvider, task_cfg.provider_id)
            if provider and provider.is_active and provider.api_key:
                base_url, api_key, model_name = _resolve(provider, task_cfg.model_name)
                return base_url, api_key, model_name, provider

    # 3. 如果没有任何 TaskModelConfig，报错而不是随机选一个 provider
    raise RuntimeError("未配置模型供应商，请先在设置中配置")


def _get_client(base_url: str, api_key: str, provider: ModelProvider = None):
    """
    获取 LLM 客户端：
    - Vertex AI 供应商：返回 _VertexGenAIClient（genai SDK 原生调用）
    - 其他供应商：返回 OpenAI 客户端
    """
    if provider and _is_vertex_ai(provider):
        return _VertexGenAIClient(provider)
    return OpenAI(base_url=base_url, api_key=api_key, timeout=90 if _is_vertex_ai(provider) else 30)


def _extract_message_text(message) -> str:
    """从 OpenAI 消息中提取纯回复文本；自动剥离 reasoning_content（思考内容）"""
    # 如果模型有 reasoning_content，优先取 content，忽略思考过程
    content = getattr(message, "content", None) or ""
    # MiniMax/DeepSeek 等模型的 reasoning_content 字段
    reasoning = getattr(message, "reasoning_content", None)
    # 某些模型可能把思考内容混在 content 中（<think>...</think> 标签）
    if content:
        content = _re_module.sub(r"<think>[\s\S]*?</think>", "", content).strip()
        content = _re_module.sub(r"<思考>[\s\S]*?</思考>", "", content).strip()
    return content


def summarize_daily_report(content: str, db: Session, user_id: int = 0) -> str:
    """AI 总结日报内容"""
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)
    system_prompt, template = _get_prompt("daily_summary", db, user_id)
    user_prompt = _fill_template(template, content=content)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
    )
    return _extract_message_text(response.choices[0].message)


def _strip_html(text: str) -> str:
    return _re_module.sub(r'<[^>]+>', '', text)


def extract_meeting_minutes(content: str, db: Session, user_id: int = 0) -> dict:
    """AI 从会议纪要中提取结构化信息"""
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)
    system_prompt, template = _get_prompt("meeting_extract", db, user_id)
    # 去除 HTML 标签，发送纯文本给 AI
    clean_content = _strip_html(content)
    user_prompt = _fill_template(template, content=clean_content)
    # 确保 prompt 包含 "json" 关键字（部分模型要求）
    if "json" not in user_prompt.lower() and "json" not in system_prompt.lower():
        system_prompt += "\n\n请以 json 格式返回结果。"
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        response_format={"type": "json_object"},
    )
    raw_text = _extract_message_text(response.choices[0].message) or "{}"
    try:
        result = json.loads(raw_text)
        result["_raw_text"] = raw_text
        return result
    except json.JSONDecodeError:
        return {"_raw_text": raw_text, "fallback": raw_text}


def generate_project_analysis(project_id: int, db: Session, user_id: int = 0) -> str:
    """AI 生成项目分析报告"""
    project = db.get(Project, project_id)
    if not project:
        return "项目不存在"

    customer = db.get(Customer, project.customer_id) if project.customer_id else None

    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)

    meetings = db.exec(
        select(MeetingNote).where(MeetingNote.project_id == project_id).limit(10)
    ).all()
    meetings_text = "\n".join(
        [f"- [{m.meeting_date}] {m.title}: {m.content_md[:200]}" for m in meetings]
    ) if meetings else "暂无会议记录"

    progress_text = project.progress or "暂无跟进记录"
    if len(progress_text) > 3000:
        progress_text = progress_text[-3000:] + "\n\n...(以上为最近跟进记录)"

    amount_text = "未设置"
    if project.opportunity_amount or project.deal_amount:
        parts = []
        if project.opportunity_amount:
            parts.append(f"商机金额: {project.opportunity_amount} {project.currency or 'CNY'}")
        if project.deal_amount:
            parts.append(f"成交金额: {project.deal_amount} {project.currency or 'CNY'}")
        amount_text = " / ".join(parts)

    system_prompt, template = _get_prompt("project_analysis", db, user_id)
    user_prompt = _fill_template(
        template,
        name=project.name,
        status=project.status,
        deadline=str(project.deadline) if project.deadline else "未设置",
        product=project.product or "未指定",
        scenario=project.project_scenario or "未指定",
        sales_person=project.sales_person or "未指定",
        amount=amount_text,
        customer_name=customer.name if customer else "未关联客户",
        customer_industry=customer.industry if customer else "未知",
        customer_scale=customer.scale if customer else "未知",
        customer_products=customer.core_products if customer else "未知",
        customer_profile=customer.profile if customer else "暂无",
        progress=progress_text,
        meetings=meetings_text,
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.5,
    )
    return _extract_message_text(response.choices[0].message)


def ai_chat(messages: list[dict], db: Session, user_id: int = 0) -> str:
    """通用 AI 对话"""
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.7,
    )
    return _extract_message_text(response.choices[0].message)


def transcribe_audio(audio_path: str, db: Session, user_id: int = 0) -> str:
    """将音频文件转写为文字（使用 ASR 模型）"""
    base_url, api_key, model, provider = _get_active_provider(db, "speech_to_text", user_id)
    client = _get_client(base_url, api_key, provider)
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(
            model=model,
            file=("audio.webm", f, "audio/webm"),
        )
    return resp.text or ""


def organize_transcript(raw_text: str, db: Session, user_id: int = 0) -> str:
    """AI 整理转写文字，生成结构化会议纪要"""
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)
    system_prompt, template = _get_prompt("meeting_organize", db, user_id)
    user_prompt = _fill_template(template, content=raw_text)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
    )
    return _extract_message_text(response.choices[0].message)


def search_company_names(keyword: str, db: Session, user_id: int = 0) -> list[dict]:
    """使用 Tavily 联网搜索 + LLM 根据关键词搜索匹配的公司全称"""
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)

    # 先尝试用 Tavily 搜索
    search_context = ""
    try:
        has_tavily = bool(_get_tavily_api_key(db, user_id))
        if has_tavily:
            search_context = search_and_summarize(f"{keyword} 公司 企业信息 官网", db, search_depth="basic", user_id=user_id)
    except Exception:
        pass

    # 构建提示词
    search_hint = (
        f"\n\n以下是从搜索引擎获取的相关信息，请参考：\n{search_context[:3000]}"
        if search_context else ""
    )

    extra = {}
    if not search_context:
        # 没有 Tavily 时尝试使用模型自带的联网搜索
        extra = {"extra_body": {"enable_search": True}}

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是一个企业信息查询助手。用户输入公司名称关键词，你返回最匹配的完整公司全称。\n"
                    "请严格以 JSON 数组格式返回，每个元素包含:\n"
                    '  - "name": 公司简称或通用名称\n'
                    '  - "full_name": 公司完整注册名称\n'
                    "只返回最可能的 5-8 个结果。只返回 JSON 数组，不要有其他内容。\n"
                    '格式示例: [{"name":"腾讯","full_name":"深圳市腾讯计算机系统有限公司"}]'
                ),
            },
            {"role": "user", "content": f"关键词：{keyword}{search_hint}"},
        ],
        temperature=0.3,
        **extra,
    )
    text = _extract_message_text(response.choices[0].message)
    try:
        results = json.loads(text)
        if isinstance(results, list):
            return results[:8]
    except json.JSONDecodeError:
        pass
    # 尝试从文本中提取 JSON 数组
    import re as _re_search
    match = _re_search.search(r'\[[\s\S]*\]', text)
    if match:
        try:
            return json.loads(match.group())[:8]
        except json.JSONDecodeError:
            pass
    return []


def fetch_company_info(company_name: str, db: Session, user_id: int = 0) -> dict:
    """使用 Tavily 联网搜索 + LLM 获取公司详细信息，动态新闻单独搜索确保时效性"""
    from datetime import datetime
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)

    # 搜索1：公司基本信息
    search_context = ""
    search_sources = []
    website_sources = []  # 专门用于提取官网的搜索结果
    news_context = ""
    try:
        has_tavily = bool(_get_tavily_api_key(db, user_id))
        if has_tavily:
            from app.services.web_search import search_web
            # 搜索公司基本信息
            raw = search_web(f"{company_name} 公司简介 主营业务 行业 规模", db, search_depth="advanced", max_results=4, user_id=user_id)
            for r in raw:
                if r["type"] == "result" and r.get("url"):
                    search_sources.append({"title": r.get("title", ""), "url": r["url"]})
            search_context = search_and_summarize(f"{company_name} 公司简介 主营业务 行业 规模", db, search_depth="advanced", user_id=user_id)

            # 搜索2：官网（单独搜索，提高命中率）
            raw_website = search_web(f"{company_name} 官网 首页", db, search_depth="basic", max_results=3, user_id=user_id)
            for r in raw_website:
                if r["type"] == "result" and r.get("url"):
                    website_sources.append({"title": r.get("title", ""), "url": r["url"]})

            # 搜索3：最新动态（半年内），使用当前年份关键词
            current_year = datetime.now().year
            last_year = current_year - 1
            news_query = f"{company_name} {current_year} {last_year} 最新新闻 动态 融资 合作 产品发布 财报"
            news_context = search_and_summarize(news_query, db, search_depth="advanced", user_id=user_id)
    except Exception:
        pass

    # 构建提示词
    search_hint = ""
    if search_context:
        search_hint += f"\n\n【公司基本信息】\n{search_context[:3000]}"
    if news_context:
        search_hint += f"\n\n【最新动态信息】\n{news_context[:2000]}"
    # 附加官网搜索结果给 AI 参考
    if website_sources:
        ws_text = "\n".join(f"- [{s['title']}]({s['url']})" for s in website_sources[:3])
        search_hint += f"\n\n【官网搜索链接（从中提取最可靠的官网网址）】\n{ws_text}"

    extra = {}
    if not search_context and not news_context:
        extra = {"extra_body": {"enable_search": True}}

    current_date = datetime.now().strftime("%Y年%m月")

    # 读取行业标准化分类
    industry_categories = []
    try:
        from app.models.system_preference import SystemPreference
        pref = db.exec(
            select(SystemPreference).where(
                SystemPreference.key == "industry_categories",
                SystemPreference.user_id == None,
            )
        ).first()
        if pref and pref.value:
            industry_categories = [c.strip() for c in pref.value.split("\n") if c.strip()]
    except Exception:
        pass
    if not industry_categories:
        industry_categories = [
            "大模型基础研发与训练平台", "AI Agent / 智能体开发", "向量数据库 / 知识检索 RAG",
            "模型推理优化与部署 MLOps", "AI 安全 / 对齐 / 可解释性", "多模态 / 视觉生成 AIGC",
            "语音 / NLP / 对话 AI", "AI 芯片 / 算力基础设施", "开源模型生态与工具链",
            "云原生 / 容器 / Kubernetes", "公有云 IaaS / PaaS", "混合云 / 多云管理",
            "边缘计算 / CDN / 分布式云", "Serverless / FaaS", "云安全 / 零信任 / WAF",
            "FinOps / 云成本优化", "DevOps / CI/CD / GitOps", "可观测性 / AIOps / 运维平台",
            "协同办公 / 企业 IM", "CRM / 营销自动化", "ERP / 财务 / HR SaaS",
            "低代码 / 无代码平台", "数据中台 / 数据治理",
            "金融科技 / 支付 / 数字银行", "新能源汽车 / 智能出行", "半导体 / 芯片 / EDA",
            "电商 / 新零售 / 跨境电商", "社交媒体 / 内容平台", "游戏 / 互动娱乐",
            "在线教育 / 教育科技", "医疗健康 / 数字医疗", "物流 / 供应链 / 配送",
            "网络安全 / 信息安全", "物联网 / 智能硬件", "消费电子 / 智能家居",
            "农业科技 / 食品科技", "新能源 / 碳中和 / 环保", "法律科技 / 合规科技",
            "航空航天 / 卫星 / 低空经济", "自动驾驶 / 智能交通", "工业互联网 / 智能制造",
            "旅游 / 出行服务", "本地生活 / 餐饮 / 即时零售", "保险科技",
            "通信 / 5G / 6G", "政务 / 智慧城市 / 数字政府", "区块链 / Web3 / 数字资产",
            "广告营销 / MarTech", "人力资源 / 招聘科技",
        ]
    industry_list_str = "\n".join(f"  - {c}" for c in industry_categories)

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是一个企业信息查询助手。请根据提供的搜索信息，整理该公司的基本信息。\n"
                    f"当前日期：{current_date}\n"
                    "请严格以 JSON 格式返回，包含以下字段:\n"
                    '  - "name": 公司全称\n'
                    f'  - "industry": 所属行业（必须从以下标准行业中选择最匹配的一个，不要自创）：\n{industry_list_str}\n'
                    '  - "core_products": 核心产品或明星产品\n'
                    '  - "business_scope": 主营业务\n'
                    '  - "scale": 规模人数（如\"1000-5000人\"或\"500人以上\"）\n'
                    '  - "profile": 公司简介（100字以内）\n'
                    f'  - "recent_news": 近半年内（{current_date}前后）的最新重要动态，如融资、新品发布、合作、财报等，100字以内。请优先从"最新动态信息"中提取，确保信息的时效性。如果搜索信息中无近期动态，请标注"暂无近期公开动态"\n'
                    '  - "logo_url": 公司官网域名（如 "example.com"），如果搜索信息中包含官网地址则提取域名，否则留空字符串\n'
                    '  - "website": 公司官网完整网址（如 "https://www.example.com"），优先从【官网搜索链接】中提取标题含"官网""官方"的结果；若无则从搜索信息中提取公司主域名；若均无则留空字符串\n'
                    "只返回 JSON，不要有其他内容。"
                ),
            },
            {"role": "user", "content": f"公司名称：{company_name}{search_hint}"},
        ],
        temperature=0.0,
        **extra,
    )
    text = _extract_message_text(response.choices[0].message)
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            # 校验 AI 返回的 website
            ai_website = result.get("website", "")
            if ai_website and not _domain_looks_plausible(ai_website, result.get("name", company_name)):
                result["website"] = ""  # 不可信，清空
            # 补充：从官网搜索 URL 提取官网（优先于 AI 返回）
            extracted_website = _extract_website_from_search(website_sources, company_name)
            if extracted_website and not result.get("website"):
                result["website"] = extracted_website
            # 用官网域名替换 logo_url（AI 返回的域名可能不准确）
            website_url = result.get("website", "") or extracted_website
            if website_url:
                domain = urlparse(website_url).netloc.replace('www.', '')
                if domain:
                    result["logo_url"] = _fetch_company_logo(domain)
            elif result.get("logo_url"):
                # AI 返回了 logo_url 但没有 website，用 logo_url 域名查 Clearbit
                raw = result["logo_url"].replace('https://', '').replace('http://', '').split('/')[0]
                result["logo_url"] = _fetch_company_logo(raw)
            if search_sources:
                result["sources"] = search_sources
            return result
    except json.JSONDecodeError:
        pass
    # 尝试从文本中提取 JSON 对象
    match = _re_module.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result, dict):
                # 校验 AI 返回的 website
                ai_website = result.get("website", "")
                if ai_website and not _domain_looks_plausible(ai_website, result.get("name", company_name)):
                    result["website"] = ""
                extracted_website = _extract_website_from_search(website_sources, company_name)
                if extracted_website and not result.get("website"):
                    result["website"] = extracted_website
                website_url = result.get("website", "") or extracted_website
                if website_url:
                    domain = urlparse(website_url).netloc.replace('www.', '')
                    if domain:
                        result["logo_url"] = _fetch_company_logo(domain)
                elif result.get("logo_url"):
                    raw = result["logo_url"].replace('https://', '').replace('http://', '').split('/')[0]
                    result["logo_url"] = _fetch_company_logo(raw)
            if search_sources:
                result["sources"] = search_sources
            return result
        except json.JSONDecodeError:
            pass
    return {}


def _extract_website_from_search(search_sources: list[dict], company_name: str) -> str:
    """
    从 Tavily 搜索结果 URL 中提取公司官网网址。
    排除百科、新闻、招聘等非官网链接，匹配最可能的主域名。
    """
    # 需要排除的非官网域名关键词（搜素引擎、财经、新闻、招聘、电商等）
    skip_domains = [
        # 百科全书/知识库
        'wikipedia', 'wikimedia', 'baike.baidu', 'zh.wikipedia', 'wiki.', 'mbd.baidu',
        # 搜索引擎
        'sogou.com', 'sougou.com', 'baidu.com', 'google.com', 'bing.com', 'yandex.com',
        # 新闻/媒体
        'sohu.com', 'sina.com.cn', 'sina.com', '163.com', 'qq.com', 'ifeng.com',
        '36kr.com', 'ithome.com', 'infoq.com', 'thepaper.cn', 'wallstreetcn.com',
        'guancha.cn', 'huxiu.com', 'geekpark.net', 'pingwest.com', 'tmtpost.com',
        'lieyunwang.com', 'cyzone.cn', 'pedaily.cn', 'cls.cn', 'jiemian.com',
        # 财经/股票
        'eastmoney.com', 'dfcfw.com', 'xueqiu.com', 'cninfo.com.cn', '10jqka.com',
        'hexun.com', 'jrj.com.cn', 'stockstar.com', 'cnstock.com', 'nbd.com.cn',
        'yicai.com', 'caixin.com', 'finance.', 'money.',
        # 社交媒体/社区
        'zhihu.com', 'weixin.qq.com', 'mp.weixin', 'juejin.cn', 'douban.com',
        'weibo.com', 'tieba.baidu', 'xiaohongshu.com', 'bilibili.com',
        # 职业/招聘
        'linkedin.com', 'zhaopin.com', '51job.com', 'lagou.com', 'liepin.com',
        'bosszhipin.com', 'maimai.cn', 'jobs.', 'job.',
        # 企业信息
        'crunchbase.com', 'tianyancha.com', 'qichacha.com', '企查查', '天眼查',
        # 技术社区
        'csdn.net', 'cnblogs.com', 'oschina.net', 'segmentfault.com', 'v2ex.com',
        'github.com', 'gitee.com', 'gitlab.com', 'stackoverflow.com',
        # 电商/平台
        'taobao.com', 'tmall.com', 'jd.com', 'pinduoduo.com', 'suning.com',
        'alibaba.com', '1688.com', 'amazon.', 'shopee.',
        # 企业协作
        'feishu.cn', 'larkoffice.com', 'dingtalk.com', 'teams.microsoft',
        # 文档/PDF
        'pdf.', '.pdf', 'doc88.com', 'docin.com', 'slideshare',
        # 其他不可靠源
        'research.', 'report.', 'analyst.', 'static.', 'cdn.',
    ]
    candidates = []
    for src in search_sources:
        url = src.get("url", "")
        if not url:
            continue
        # 排除 PDF 文件和非 http 链接
        if url.lower().endswith('.pdf') or '/pdf/' in url.lower():
            continue
        if not url.startswith(('http://', 'https://')):
            continue
        parsed = urlparse(url)
        domain = parsed.netloc.lower().replace('www.', '')
        if not domain or '.' not in domain:
            continue
        # 排除已知非官网域名
        if any(skip in domain for skip in skip_domains):
            continue
        # 排除多级子域名
        parts = domain.split('.')
        if len(parts) > 3:
            continue
        # 排除太长的路径
        path_parts = [p for p in parsed.path.split('/') if p]
        if len(path_parts) > 2:
            continue
        full_url = (parsed.scheme or 'https') + '://' + parsed.netloc
        # 评分
        score = 0
        # 公司名匹配域名
        clean_name = company_name.lower().replace(' ', '').replace('-', '').replace('（', '').replace('(', '')
        clean_domain = domain.replace('-', '').replace('.', '')
        if clean_name in clean_domain or any(part in clean_domain for part in clean_name.split(')')[0].split('）')[0].split() if len(part) >= 3):
            score += 10
        # 短域名加分
        main_part = parts[-2] if len(parts) >= 2 else parts[0]
        if 2 <= len(main_part) <= 20:
            score += 1
        # 常见 TLD 加分
        if domain.endswith(('.cn', '.com.cn', '.ai', '.com', '.net', '.org')):
            score += 1
        candidates.append((score, full_url))
    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        best = candidates[0][1]
        # 最终校验：域名必须与公司名有一定关联
        if _domain_looks_plausible(best, company_name):
            return best
    return ""


def _domain_looks_plausible(website_url: str, company_name: str) -> bool:
    """
    检查提取到的域名是否与公司名有一定关联。
    避免搜狗/百度等搜索引擎链接被误认为官网。
    """
    if not website_url or not company_name:
        return False
    try:
        from urllib.parse import urlparse
        parsed = urlparse(website_url)
        domain = parsed.netloc.lower().replace('www.', '')
        # 完全禁止的域名特征
        forbidden = [
            'sogou', 'sougou', 'baidu', 'google', 'bing', 'yandex',
            'search.', 'so.', 's.',
        ]
        if any(f in domain for f in forbidden):
            return False
        # 如果 AI 返回的名称包含在公司域名中，可信
        clean_name = company_name.lower().replace(' ', '').replace('-', '').replace('（', '').replace('(', '')
        clean_domain = domain.replace('-', '').replace('.', '')
        if clean_name in clean_domain:
            return True
        # 如果域名太短且不含公司名任何部分，可能不靠谱
        # 但允许短域名（如 mi.com 对应小米）
        name_chars = set(clean_name)
        domain_chars = set(clean_domain)
        overlap = name_chars & domain_chars
        # 至少要有 1 个字符重叠，或者域名长度 >= 4（排除搜索等黑名单后基本可信）
        if len(overlap) >= 1 or len(clean_domain) >= 4:
            return True
        return False
    except Exception:
        return True  # 解析失败不过滤，交给前端展示


def _fetch_company_logo(domain: str) -> str:
    """
    直接返回域名，前端会通过多源加载获取 Logo：
    Google Favicons → DuckDuckGo → UpLead → 首字母头像
    """
    return domain if domain else ""


def refresh_company_news(company_name: str, db: Session, user_id: int = 0) -> str:
    """单独刷新公司最新动态，专注于半年内的新闻"""
    from datetime import datetime
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)

    # Tavily 搜索最新新闻
    news_context = ""
    try:
        has_tavily = bool(_get_tavily_api_key(db, user_id))
        if has_tavily:
            from app.services.web_search import search_and_summarize as _sas
            current_year = datetime.now().year
            last_year = current_year - 1
            news_query = f"{company_name} {current_year} {last_year} 最新新闻 动态 融资 合作 产品发布 财报"
            news_context = _sas(news_query, db, search_depth="advanced", user_id=user_id)
    except Exception:
        pass

    current_date = datetime.now().strftime("%Y年%m月")
    system_prompt = (
        f"当前日期：{current_date}\n"
        f"请从搜索信息中提取 {company_name} 近半年内的最新重要动态。\n"
        "关注：融资、新品发布、战略合作、财报业绩、市场扩张、人事变动等。\n"
        "要求：\n"
        "1. 只返回近半年内的动态，忽略超过半年的旧闻\n"
        "2. 100字以内，简洁有力\n"
        "3. 如果搜索信息中确实没有近期动态，返回\"暂无近期公开动态\"\n"
        "4. 只返回纯文本，不要JSON格式"
    )

    search_hint = f"\n\n搜索信息：\n{news_context[:3000]}" if news_context else ""

    extra = {}
    if not news_context:
        extra = {"extra_body": {"enable_search": True}}

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"公司：{company_name}{search_hint}"},
        ],
        temperature=0.3,
        **extra,
    )
    text = _extract_message_text(response.choices[0].message)
    return text.strip()
