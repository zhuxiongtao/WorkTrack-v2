import json
import logging
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
from app.services.param_resolver import resolve_chat_params, get_model_capabilities
from app.exceptions import AIServiceError, AITimeoutError, AIRateLimitError
from app.utils.time import utc_now

logger = logging.getLogger("worktrack")


# ---- GCP Billing Labels 支持 ----

def _normalize_label_value(value: str) -> str:
    """将任意字符串转为合法的 GCP label value（小写字母/数字/下划线/短横线，最长63字符）"""
    if not value:
        return ""
    value = value.strip().lower()
    value = _re_module.sub(r"[^a-z0-9_-]", "_", value)
    value = _re_module.sub(r"_+", "_", value)
    return value[:63]


def _build_vertex_labels(provider: "ModelProvider", feature: str = "general") -> dict:
    """构建 Vertex AI 请求的 billing labels，从供应商配置读取，feature 按调用场景传入"""
    return {
        "team": _normalize_label_value(provider.gcp_label_team or ""),
        "app":  _normalize_label_value(provider.gcp_label_app or ""),
        "feature": _normalize_label_value(feature),
        "environment": _normalize_label_value(provider.gcp_label_env or ""),
    }


# ---- Vertex AI 认证支持 ----

def _is_vertex_ai(provider: ModelProvider) -> bool:
    """判断是否为 Vertex AI 供应商（通过 project_id 字段识别）"""
    return bool(provider.project_id and provider.project_id.strip())


def _is_gemini(provider: ModelProvider) -> bool:
    """判断是否为 Gemini 供应商（Google AI Studio原生SDK）"""
    return provider and "generativelanguage.googleapis.com" in (provider.base_url or "")


def _is_anthropic(provider: ModelProvider) -> bool:
    """判断是否为 Anthropic（Claude）供应商"""
    return provider and "api.anthropic.com" in (provider.base_url or "")


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

    def get(self, key, default=None):
        """支持 dict-like 访问，兼容消息列表转换"""
        if key == "content":
            return self.content
        if key == "role":
            return self.role
        if key == "tool_calls":
            return self.tool_calls
        return default

    def __contains__(self, key):
        return key in ("content", "role", "tool_calls")


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
                # 检查是否有 tool_calls
                tool_calls = msg.get("tool_calls", []) or []
                if tool_calls:
                    # 有函数调用：转换为 genai function_call
                    parts = []
                    for tc in tool_calls:
                        func = tc.function if hasattr(tc, 'function') else tc.get("function", {})
                        name = func.name if hasattr(func, 'name') else func.get("name", "")
                        args = func.arguments if hasattr(func, 'arguments') else func.get("arguments", "{}")
                        try:
                            args_dict = json.loads(args) if isinstance(args, str) else args
                        except (json.JSONDecodeError, TypeError):
                            args_dict = {}
                        parts.append(types.Part(function_call=types.FunctionCall(name=name, args=args_dict)))
                    if parts:
                        contents.append(types.Content(role="model", parts=parts))
                elif isinstance(content, str) and content:
                    contents.append(types.Content(role="model", parts=[types.Part(text=content)]))
            elif role == "tool":
                # 工具调用结果：作为 user 消息追加
                if isinstance(content, str) and content:
                    contents.append(types.Content(role="user", parts=[
                        types.Part(text=f"[工具返回] {content}")
                    ]))

        return contents, system_instruction

    @staticmethod
    def _build_genai_config(temperature=0.7, max_tokens=None, response_format=None, extra_body=None, labels=None):
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

        # GCP Billing Labels（仅 Vertex AI 生效，用于账单归因）
        if labels:
            config_kwargs["labels"] = labels

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

        # 构建 GCP Billing Labels：feature 由调用方通过 extra_body["gcp_feature"] 传入
        feature = (extra_body or {}).get("gcp_feature", "general")
        labels = _build_vertex_labels(self._client._provider, feature)

        # 构建配置
        config = self._build_genai_config(
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format,
            extra_body=extra_body,
            labels=labels,
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

        # 提取 token 用量（usage_metadata）
        um = getattr(response, 'usage_metadata', None)
        usage = _FakeUsage(
            prompt_tokens=getattr(um, 'prompt_token_count', 0) or 0,
            completion_tokens=getattr(um, 'candidates_token_count', 0) or 0,
            cache_read_tokens=getattr(um, 'cached_content_token_count', 0) or 0,
        ) if um else None

        # 提取文本或函数调用
        if response.function_calls:
            tool_calls = self._genai_func_call_to_openai(response.function_calls)
            return _FakeResponse(
                choices=[_FakeChoice(
                    message=_FakeMessage(content=None, tool_calls=tool_calls),
                )],
                usage=usage,
            )

        text = response.text or ""
        return _FakeResponse(
            choices=[_FakeChoice(message=_FakeMessage(content=text))],
            usage=usage,
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


# ---- Anthropic SDK 包装器 ----
class _AnthropicClient:
    """Anthropic SDK 包装，提供与 OpenAI 兼容的接口"""
    def __init__(self, provider: ModelProvider):
        self._api_key = provider.api_key
        try:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self._api_key)
        except ImportError:
            raise AIServiceError("请先安装 anthropic SDK: pip install anthropic")
        # 兼容的 chat completions 接口
        self.chat = type('', (), {})()
        self.chat.completions = type('', (), {})()
        self.chat.completions.create = self.create

    def create(self, **kwargs):
        model = kwargs.get("model", "claude-3-5-sonnet-20241022")
        messages = kwargs.get("messages", [])
        max_tokens = kwargs.get("max_tokens", 8192)
        temperature = kwargs.get("temperature", 0.7)
        stream = kwargs.get("stream", False)

        # 转换系统提示
        system_prompt = ""
        new_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content", "")
            else:
                new_messages.append(msg)
        messages = new_messages

        if stream:
            return self._stream_wrapper(model, messages, system_prompt, max_tokens, temperature)

        response = self._client.messages.create(
            model=model,
            messages=messages,
            system=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        text = "".join([block.text for block in response.content if block.type == "text"])
        au = getattr(response, 'usage', None)
        usage = _FakeUsage(
            prompt_tokens=getattr(au, 'input_tokens', 0) or 0,
            completion_tokens=getattr(au, 'output_tokens', 0) or 0,
            cache_read_tokens=getattr(au, 'cache_read_input_tokens', 0) or 0,
            cache_write_tokens=getattr(au, 'cache_creation_input_tokens', 0) or 0,
        ) if au else None
        return _FakeResponse(choices=[_FakeChoice(message=_FakeMessage(content=text))], usage=usage)

    def _stream_wrapper(self, model, messages, system_prompt, max_tokens, temperature):
        from anthropic.types import MessageStreamEvent
        with self._client.messages.stream(
            model=model,
            messages=messages,
            system=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        ) as stream:
            for text in stream.text_stream:
                yield _FakeStreamChunk(content=text)


# ---- Gemini SDK 包装器 ----
class _GeminiClient:
    """Gemini SDK 包装，提供与 OpenAI 兼容的接口"""
    def __init__(self, provider: ModelProvider):
        self._api_key = provider.api_key
        try:
            from google import genai
            self._client = genai.Client(api_key=self._api_key)
        except ImportError:
            raise AIServiceError("请先安装 google-genai SDK: pip install google-genai")
        except Exception as e:
            raise AIServiceError(f"Gemini SDK 初始化失败: {e}")
        self.chat = type('', (), {})()
        self.chat.completions = type('', (), {})()
        self.chat.completions.create = self.create

    def _convert_messages(self, messages: list) -> tuple:
        """将 OpenAI 格式消息转换为 Gemini 格式"""
        contents = []
        system_instruction = None
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                system_instruction = content
            elif role == "user":
                contents.append({"role": "user", "parts": [{"text": content}]})
            elif role == "assistant":
                contents.append({"role": "model", "parts": [{"text": content}]})
        return contents, system_instruction

    def create(self, **kwargs):
        model = kwargs.get("model", "gemini-2.5-flash")
        messages = kwargs.get("messages", [])
        temperature = kwargs.get("temperature", 0.7)
        max_tokens = kwargs.get("max_tokens", 8192)
        stream = kwargs.get("stream", False)

        contents, system_instruction = self._convert_messages(messages)

        config = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if system_instruction:
            config["system_instruction"] = {"parts": [{"text": system_instruction}]}

        if stream:
            return self._stream_wrapper(model, contents, config)

        response = self._client.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )
        text = response.text or ""
        um = getattr(response, 'usage_metadata', None)
        usage = _FakeUsage(
            prompt_tokens=getattr(um, 'prompt_token_count', 0) or 0,
            completion_tokens=getattr(um, 'candidates_token_count', 0) or 0,
            cache_read_tokens=getattr(um, 'cached_content_token_count', 0) or 0,
        ) if um else None
        return _FakeResponse(choices=[_FakeChoice(message=_FakeMessage(content=text))], usage=usage)

    def _stream_wrapper(self, model, contents, config):
        stream_response = self._client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=config,
        )
        for chunk in stream_response:
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


class _FakeUsage:
    """统一的 token 用量对象，供各 SDK 包装器填写后交给 _record_usage_silent 读取"""
    def __init__(self, prompt_tokens=0, completion_tokens=0,
                 cache_read_tokens=0, cache_write_tokens=0, total_tokens=0):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.cache_read_tokens = cache_read_tokens
        self.cache_write_tokens = cache_write_tokens
        self.total_tokens = total_tokens or (prompt_tokens + completion_tokens)


class _FakeResponse:
    def __init__(self, choices, usage=None):
        self.choices = choices
        self.usage = usage  # _FakeUsage | None


def _record_usage_silent(db, response, user_id: int, provider_id, model_name: str, task_type: str = "chat"):
    """记录一次 LLM 调用的 token 消耗；任何异常都静默忽略，绝不影响主流程"""
    try:
        from app.models.model_usage_log import ModelUsageLog
        usage = getattr(response, 'usage', None)
        if usage is None:
            return

        input_t = getattr(usage, 'prompt_tokens', 0) or 0
        output_t = getattr(usage, 'completion_tokens', 0) or 0
        cache_r = getattr(usage, 'cache_read_tokens', 0) or 0
        cache_w = getattr(usage, 'cache_write_tokens', 0) or 0
        total_t = getattr(usage, 'total_tokens', 0) or getattr(usage, 'prompt_tokens', 0) + getattr(usage, 'completion_tokens', 0)

        # OpenAI standard: prompt_tokens_details.cached_tokens
        if cache_r == 0:
            details = getattr(usage, 'prompt_tokens_details', None)
            if details:
                cache_r = getattr(details, 'cached_tokens', 0) or 0

        if input_t == 0 and output_t == 0:
            return  # 没有有效数据，跳过

        log = ModelUsageLog(
            user_id=user_id or None,
            provider_id=provider_id,
            model_name=model_name,
            task_type=task_type,
            input_tokens=input_t,
            output_tokens=output_t,
            cache_read_tokens=cache_r,
            cache_write_tokens=cache_w,
            total_tokens=total_t or (input_t + output_t),
        )
        db.add(log)
        db.commit()
    except Exception:
        pass



# 统一默认提示词（单一来源，与 settings.py 中的 DEFAULT_PROMPTS 同步）
_DEFAULT_PROMPTS = {
    "daily_summary": {
        "system_prompt": "你是工作效率助手。将日报内容提炼为简洁摘要，突出今日完成的关键事项与重要进展。输出 3-5 条以「•」开头的要点，每条不超过 30 字，语言简洁直接。",
        "user_prompt_template": "请总结以下工作日报：\n{content}",
    },
    "weekly_summary": {
        "system_prompt": "你是工作效率助手。根据本周日报内容生成结构化周报总结。\n要求：\n1. 本周主要完成事项（3-5 条要点）\n2. 重要进展与成果\n3. 待解决的问题或风险\n用 markdown 格式输出，结构清晰，总字数控制在 400 字以内。",
        "user_prompt_template": "请总结本周（{week_range}）的工作情况：\n\n{reports_content}",
    },
    "meeting_organize": {
        "system_prompt": "你是专业的会议纪要助手。将语音转写内容整理为规范的会议纪要。\n要求：\n1. 修正转写错误，补充上下文，语句通顺\n2. 按讨论主题分段，每段有小标题\n3. 末尾单独列出「决议事项」和「待办清单」（含负责人）\n4. 用 markdown 格式输出\n直接输出纪要内容，不要加前缀引导语。",
        "user_prompt_template": "请整理以下会议录音转写内容：\n{content}",
    },
    "meeting_extract": {
        "system_prompt": "你是一个专业的会议纪要分析助手。请从会议内容中提取结构化信息。\n以 JSON 格式返回，包含以下字段：\n- decisions: 会议决议列表\n- todos: 待办事项列表，每项包含 task 和 assignee\n- conclusions: 会议结论摘要\n只返回 JSON，不要有其他内容。",
        "user_prompt_template": "请以 json 格式分析以下会议纪要，返回 decisions、todos、conclusions 三个字段：\n{content}",
    },
    "project_analysis": {
        "system_prompt": "你是专业的销售项目管理助手。综合分析销售项目的跟进现状，给出客观的状态评估、潜在风险和具体的下一步行动建议。结合客户背景、项目进展和历史会议作出判断，输出简洁专业，避免空洞套话。",
        "user_prompt_template": "请分析以下项目：\n\n【基本信息】\n项目名称: {name}\n当前状态: {status}\n涉及产品: {product}\n项目场景: {scenario}\n销售负责人: {sales_person}\n商机金额: {amount}\n截止日期: {deadline}\n\n【客户信息】\n客户名称: {customer_name}\n客户行业: {customer_industry}\n客户规模: {customer_scale}\n核心产品: {customer_products}\n客户简介: {customer_profile}\n\n【跟进记录】\n{progress}\n\n【关联会议】\n{meetings}\n\n请给出：\n1. 当前状态评估（结合跟进记录和客户情况）\n2. 风险提示（考虑客户行业、规模、项目进展）\n3. 后续建议（具体的下一步行动）",
    },
    "insight_week": {
        "system_prompt": "你是 WorkTrack 数据分析助手。根据本周工作数据，从项目进展、日报完成、会议效率、客户动态等维度给出综合洞察。\n要求：\n1. 给出本周最值得关注的 3 个洞察点\n2. 每条以「•」开头，不超过 40 字\n3. 侧重趋势发现和行动建议\n4. 直接输出 3 行，不加序号或其他内容",
        "user_prompt_template": "请分析本周（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}",
    },
    "insight_month": {
        "system_prompt": "你是 WorkTrack 数据分析助手。根据本月工作数据，分析月度趋势变化、工作效率和团队协作情况，给出综合洞察。\n要求：\n1. 给出本月最值得关注的 3 个洞察点\n2. 每条以「•」开头，不超过 40 字\n3. 侧重月度趋势和结构性问题\n4. 直接输出 3 行，不加序号或其他内容",
        "user_prompt_template": "请分析本月（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}\n周报: {weeklies_summary}",
    },
    "insight_quarter": {
        "system_prompt": "你是 WorkTrack 数据分析助手。根据本季度工作数据，进行战略性综合分析，识别季度趋势、瓶颈和优化方向。\n要求：\n1. 给出本季度最关键的 3 个战略洞察\n2. 每条以「•」开头，不超过 40 字\n3. 侧重战略层面和长期改进方向\n4. 直接输出 3 行，不加序号或其他内容",
        "user_prompt_template": "请分析本季度（{range}）工作数据：\n\n项目: {projects_summary}\n客户: {customers_summary}\n会议: {meetings_summary}\n日报: {reports_summary}\n周报: {weeklies_summary}",
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

    # 按「专属 task_type → chat」顺序查找：每档先用户私有，后管理员共享。
    # 这样为某任务（如 project_analysis）单独配置的模型会真正生效；
    # 未单独配置时回落到通用 chat 模型，保证只配了 chat 的部署不受影响。
    candidates = [task_type] + (["chat"] if task_type != "chat" else [])
    for tt in candidates:
        if user:
            task_cfg = db.exec(
                select(TaskModelConfig).where(
                    TaskModelConfig.task_type == tt,
                    TaskModelConfig.user_id == user_id,
                )
            ).first()
            if task_cfg and task_cfg.provider_id and task_cfg.model_name:
                provider = db.get(ModelProvider, task_cfg.provider_id)
                if provider and provider.is_active and provider.api_key:
                    base_url, api_key, model_name = _resolve(provider, task_cfg.model_name)
                    return base_url, api_key, model_name, provider

        if use_shared:
            task_cfg = db.exec(
                select(TaskModelConfig).where(
                    TaskModelConfig.task_type == tt,
                    TaskModelConfig.user_id == None,
                )
            ).first()
            if task_cfg and task_cfg.provider_id and task_cfg.model_name:
                provider = db.get(ModelProvider, task_cfg.provider_id)
                if provider and provider.is_active and provider.api_key:
                    base_url, api_key, model_name = _resolve(provider, task_cfg.model_name)
                    return base_url, api_key, model_name, provider

    # 没有任何可用 TaskModelConfig，报错而不是随机选一个 provider
    raise AIServiceError("未配置模型供应商，请先在设置中配置")


def _get_active_provider_full(db: Session, task_type: str = "chat", user_id: int = 0) -> tuple:
    """
    P0 扩展版：返回完整配置 6 元组
    (base_url, api_key, model_name, provider, task_cfg, provider_model)
    让业务函数能直接调用 resolve_chat_params
    """
    use_shared = True
    user = None
    if user_id:
        user = db.get(User, user_id)
        use_shared = bool(user and (user.is_admin or user.use_shared_models))

    def _resolve(provider: ModelProvider, model_name: str):
        if _is_vertex_ai(provider):
            if model_name.startswith("google/"):
                model_name = model_name[len("google/"):]
            return None, None, model_name
        else:
            return provider.base_url, provider.api_key, model_name

    # 按「专属 task_type → chat」顺序查找：每档先用户私有，后管理员共享。
    # 与 _get_active_provider 保持一致，确保 task_cfg 取自对应任务的配置，
    # resolve_chat_params 据此应用该任务专属的模型参数。
    candidates = [task_type] + (["chat"] if task_type != "chat" else [])
    for tt in candidates:
        if user:
            task_cfg = db.exec(
                select(TaskModelConfig).where(
                    TaskModelConfig.task_type == tt,
                    TaskModelConfig.user_id == user_id,
                )
            ).first()
            if task_cfg and task_cfg.provider_id and task_cfg.model_name:
                provider = db.get(ModelProvider, task_cfg.provider_id)
                if provider and provider.is_active and provider.api_key:
                    pm = db.exec(
                        select(ProviderModel).where(
                            ProviderModel.provider_id == task_cfg.provider_id,
                            ProviderModel.model_name == task_cfg.model_name,
                        )
                    ).first()
                    base_url, api_key, model_name = _resolve(provider, task_cfg.model_name)
                    return base_url, api_key, model_name, provider, task_cfg, pm

        if use_shared:
            task_cfg = db.exec(
                select(TaskModelConfig).where(
                    TaskModelConfig.task_type == tt,
                    TaskModelConfig.user_id == None,
                )
            ).first()
            if task_cfg and task_cfg.provider_id and task_cfg.model_name:
                provider = db.get(ModelProvider, task_cfg.provider_id)
                if provider and provider.is_active and provider.api_key:
                    pm = db.exec(
                        select(ProviderModel).where(
                            ProviderModel.provider_id == task_cfg.provider_id,
                            ProviderModel.model_name == task_cfg.model_name,
                        )
                    ).first()
                    base_url, api_key, model_name = _resolve(provider, task_cfg.model_name)
                    return base_url, api_key, model_name, provider, task_cfg, pm

    raise AIServiceError("未配置模型供应商，请先在设置中配置")


def _get_client(base_url: str, api_key: str, provider: ModelProvider = None):
    """
    获取 LLM 客户端：
    - Vertex AI 供应商：返回 _VertexGenAIClient（genai SDK 原生调用）
    - Gemini 供应商：返回 _GeminiClient（google-genai SDK 原生调用）
    - Anthropic 供应商：返回 _AnthropicClient（Anthropic SDK 原生调用）
    - 其他供应商：返回 OpenAI 客户端
    """
    if provider and _is_vertex_ai(provider):
        return _VertexGenAIClient(provider)
    if provider and _is_gemini(provider):
        return _GeminiClient(provider)
    if provider and _is_anthropic(provider):
        return _AnthropicClient(provider)
    return OpenAI(base_url=base_url, api_key=api_key, timeout=30)


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
    base_url, api_key, model, provider, task_cfg, pm = _get_active_provider_full(db, "daily_summary", user_id)
    client = _get_client(base_url, api_key, provider)
    system_prompt, template = _get_prompt("daily_summary", db, user_id)
    user_prompt = _fill_template(template, content=content)
    params = resolve_chat_params(
        db, model=pm, task_cfg=task_cfg,
        func_defaults={"temperature": 0.3},  # 业务软默认：日报要求稳定结果
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        **params,
    )
    _record_usage_silent(db, response, user_id, getattr(provider, 'id', None), model, "daily_summary")
    return _extract_message_text(response.choices[0].message)


def _strip_html(text: str) -> str:
    return _re_module.sub(r'<[^>]+>', '', text)


def extract_meeting_minutes(content: str, db: Session, user_id: int = 0) -> dict:
    """AI 从会议纪要中提取结构化信息"""
    base_url, api_key, model, provider, task_cfg, pm = _get_active_provider_full(db, "meeting_extract", user_id)
    client = _get_client(base_url, api_key, provider)
    system_prompt, template = _get_prompt("meeting_extract", db, user_id)
    # 去除 HTML 标签，发送纯文本给 AI
    clean_content = _strip_html(content)
    user_prompt = _fill_template(template, content=clean_content)
    # 确保 prompt 包含 "json" 关键字（部分模型要求）
    if "json" not in user_prompt.lower() and "json" not in system_prompt.lower():
        system_prompt += "\n\n请以 json 格式返回结果。"
    params = resolve_chat_params(
        db, model=pm, task_cfg=task_cfg,
        func_defaults={"temperature": 0.3},  # 业务软默认：抽取要稳定
        func_overrides={"response_format": "json_object"},  # 业务硬约束：必须 JSON
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        **params,
    )
    _record_usage_silent(db, response, user_id, getattr(provider, 'id', None), model, "meeting_extract")
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

    base_url, api_key, model, provider = _get_active_provider(db, "project_analysis", user_id)
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

    _CURRENCY_SYMBOL = {'CNY': '¥', 'USD': '$', 'HKD': 'HK$', 'EUR': '€', 'JPY': '¥'}

    def _fmt_amount(value, currency, unit):
        sym = _CURRENCY_SYMBOL.get(currency or 'CNY', currency or '')
        num = f"{value:,.2f}".rstrip('0').rstrip('.')
        return f"{sym}{num}{unit}"

    amount_text = "未设置"
    if project.opportunity_amount or project.deal_amount:
        parts = []
        if project.opportunity_amount:
            unit = getattr(project, 'opportunity_amount_unit', '万元') or '万元'
            parts.append(f"商机金额: {_fmt_amount(project.opportunity_amount, project.currency, unit)}")
        if project.deal_amount:
            unit = getattr(project, 'deal_amount_unit', '万元') or '万元'
            parts.append(f"成交金额: {_fmt_amount(project.deal_amount, project.currency, unit)}")
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
    _record_usage_silent(db, response, user_id, getattr(provider, 'id', None), model, "project_analysis")
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
    _record_usage_silent(db, response, user_id, getattr(provider, 'id', None), model, "chat")
    return _extract_message_text(response.choices[0].message)


def transcribe_audio(audio_path: str, db: Session, user_id: int = 0) -> str:
    """将音频文件转写为文字（使用 ASR 模型）

    - Vertex AI / Gemini 供应商：用 genai SDK 的 generate_content 传音频 Part 转写（Gemini 原生支持音频理解）
    - OpenAI 兼容供应商：用 client.audio.transcriptions.create（Whisper 接口）
    """
    import os
    import mimetypes
    base_url, api_key, model, provider = _get_active_provider(db, "speech_to_text", user_id)

    # Vertex AI / Gemini：genai SDK 原生音频转写
    if provider and (_is_vertex_ai(provider) or _is_gemini(provider)):
        return _transcribe_with_genai(audio_path, model, provider)

    # OpenAI 兼容：Whisper 接口
    client = _get_client(base_url, api_key, provider)
    # 根据文件扩展名推断 MIME，默认 audio/webm
    ext = os.path.splitext(audio_path)[1].lower().lstrip(".")
    mime_map = {
        "webm": "audio/webm", "wav": "audio/wav", "mp3": "audio/mpeg",
        "m4a": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac",
        "aac": "audio/aac", "aiff": "audio/aiff",
    }
    mime_type = mime_map.get(ext) or mimetypes.guess_type(audio_path)[0] or "audio/webm"
    filename = f"audio.{ext or 'webm'}"
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(
            model=model,
            file=(filename, f, mime_type),
        )
    return resp.text or ""


def _transcribe_with_genai(audio_path: str, model: str, provider: ModelProvider) -> str:
    """用 Google genai SDK（Vertex AI 或 Gemini API）做音频转写

    Gemini 原生支持音频输入，通过 generate_content 传音频 Part + 转写指令即可。
    """
    import os
    from google import genai
    from google.genai import types

    ext = os.path.splitext(audio_path)[1].lower().lstrip(".")
    mime_map = {
        "webm": "audio/webm", "wav": "audio/wav", "mp3": "audio/mpeg",
        "m4a": "audio/mp4", "ogg": "audio/ogg", "flac": "audio/flac",
        "aac": "audio/aac", "aiff": "audio/aiff",
    }
    mime_type = mime_map.get(ext) or "audio/webm"

    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    # 构建 genai client（Vertex AI 走服务账号，Gemini API 走 api_key）
    if _is_vertex_ai(provider):
        credentials = _get_vertex_credentials(provider)
        client = genai.Client(
            vertexai=True,
            project=provider.project_id,
            location=provider.location or "global",
            credentials=credentials,
        )
    else:
        client = genai.Client(api_key=provider.api_key)

    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
            "请将这段音频精确转写为文字。只输出转写出的文字内容，不要添加任何说明、标注或发言人标签。",
        ],
    )
    return response.text or ""


def organize_transcript(raw_text: str, db: Session, user_id: int = 0) -> str:
    """AI 整理转写文字，生成结构化会议纪要"""
    base_url, api_key, model, provider, task_cfg, pm = _get_active_provider_full(db, "meeting_organize", user_id)
    client = _get_client(base_url, api_key, provider)
    system_prompt, template = _get_prompt("meeting_organize", db, user_id)
    user_prompt = _fill_template(template, content=raw_text)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        **resolve_chat_params(
            db, model=pm, task_cfg=task_cfg,
            func_defaults={"temperature": 0.3},  # 业务软默认：会议整理要稳定
        ),
    )
    _record_usage_silent(db, response, user_id, getattr(provider, 'id', None), model, "meeting_organize")
    return _extract_message_text(response.choices[0].message)


def search_company_names(keyword: str, db: Session, user_id: int = 0, diag: dict | None = None) -> list[dict]:
    """根据关键词返回匹配的公司全称候选列表（用于"安踏 → 安踏体育..."联想）

    加速策略：
    1. 进程内 TTL 缓存 10 分钟（同一关键词不重复打 LLM/Tavily）
    2. LLM 优先（直接基于内置知识答，1-3s，绝大多数公司 LLM 都认识）
    3. Tavily 仅在 LLM 返回 < 2 条时启用作为兜底（搜网页找小众/新公司）

    diag: 传入 dict 时进入「诊断模式」——绕过缓存实时跑，并把每个 provider 的
          尝试结果（跳过/报错/空/成功）写入该 dict，供前端/日志定位 prod 问题。
    """
    from app.services.cache import cached_call

    if not keyword or not keyword.strip():
        return []
    kw = keyword.strip()

    # 诊断模式：绕过进程内缓存，实时跑并回填 diag
    if diag is not None:
        return _search_company_names_impl(kw, db, user_id, diag=diag)

    cache_key = f"search_company:u{user_id}:{kw.lower()}"

    def _compute() -> list[dict]:
        return _search_company_names_impl(kw, db, user_id)

    results, _hit = cached_call(cache_key, ttl=600, factory=_compute)
    return results


def _summarize_company_diag(diag: dict) -> str:
    """把 diag 里的 provider 尝试结果归纳成一句给用户/管理员看的原因。"""
    providers = diag.get("providers", [])
    if not providers:
        return "没有启用的对话(chat)模型 Provider，请到「模型管理」配置并启用一个对话模型。"
    outcomes = [p.get("outcome") for p in providers]
    if any(o == "ok" for o in outcomes):
        return ""  # 有成功的，不算失败
    errs = [p for p in providers if p.get("outcome") == "error"]
    if errs:
        return f"对话模型调用失败：{errs[0].get('detail', '')[:160]}。请检查该 Provider 的 API Key / base_url / 余额 / 网络可达性。"
    if all(o == "empty" for o in outcomes):
        return ("对话模型有响应但未能解析出公司列表（可能该模型不擅长结构化/JSON 输出）。"
                "建议在「模型管理」为对话任务换一个更强的模型。")
    return "公司搜索未返回结果，请查看运行日志获取详细原因。"


def _search_company_names_impl(keyword: str, db: Session, user_id: int, diag: dict | None = None) -> list[dict]:
    """search_company_names 的实际实现（无缓存）

    多 provider fallback：默认走 task_cfg 配置的 provider；调用失败时
    自动切到下一个 is_active 的 chat provider（避免 Vertex AI 不可达时卡死）
    """
    from sqlmodel import select
    from app.models.model_provider import ModelProvider, TaskModelConfig

    def _diag_add(provider, outcome: str, detail: str = "", count: int | None = None):
        if diag is None:
            return
        diag.setdefault("providers", []).append({
            "name": getattr(provider, "name", "?"),
            "is_vertex": _is_vertex_ai(provider) if provider else False,
            "outcome": outcome,   # skipped_vertex | error | empty | ok
            "detail": detail,
            "count": count,
        })

    providers_to_try: list[tuple] = []
    primary = _get_active_provider_full(db, "chat", user_id)
    if primary and primary[3]:  # (base_url, api_key, model, provider, task_cfg, pm)
        providers_to_try.append(primary)

    # 找所有 is_active 的 chat provider 作为 fallback
    active_providers = db.exec(
        select(ModelProvider).where(
            ModelProvider.is_active == True,
            ModelProvider.provider_type == "chat",
        )
    ).all()
    used_pids = {p[3].id for p in providers_to_try if p[3]}
    for prov in active_providers:
        if prov.id in used_pids:
            continue
        # 找一个该 provider 下的 chat 模型
        chat_model = next((m for m in prov.models_rel if "chat" in (m.supported_task_types or ["chat"])), None)
        if not chat_model:
            continue
        # 构造一个兼容 (base_url, api_key, model, provider, task_cfg, pm) 的 6 元组
        # 用真实的 chat_model 对象（带 default_temperature 等所有属性）
        providers_to_try.append((prov.base_url, prov.api_key, chat_model.model_name, prov, None, chat_model))

    if diag is not None:
        diag["providers_considered"] = len(providers_to_try)

    last_error = None
    best_results: list[dict] = []
    for base_url, api_key, model, provider, task_cfg, pm in providers_to_try:
        try:
            client = _get_client(base_url, api_key, provider)
            partial = _llm_company_names(client, model, task_cfg, pm, db, keyword, with_search_hint=False, user_id=user_id, provider_id=provider.id)
            if len(partial) >= 2:
                _diag_add(provider, "ok", f"模型 {model}", count=len(partial))
                return partial
            if len(partial) > len(best_results):
                best_results = partial
            if not partial:
                logger.warning("search_company: provider=%s keyword=%r 返回0条，LLM 原始文本可能解析失败", getattr(provider, "name", "?"), keyword)
                _diag_add(provider, "empty", f"模型 {model} 有响应但解析出 0 条", count=0)
            else:
                _diag_add(provider, "ok", f"模型 {model}", count=len(partial))
            last_error = None
        except Exception as e:
            logger.warning("provider=%s LLM 失败: %s", getattr(provider, "name", "?"), e)
            _diag_add(provider, "error", f"{type(e).__name__}: {str(e)[:200]}")
            last_error = e
            continue
    results = best_results

    # 阶段2：LLM 回答不充分 → Tavily 兜底（搜网页找小众/新公司）
    try:
        has_tavily = bool(_get_tavily_api_key(db, user_id))
    except Exception:
        has_tavily = False
    if has_tavily:
        try:
            search_context = search_and_summarize(
                f"{keyword} 公司 全称 注册名 官网",
                db, search_depth="basic", user_id=user_id, force_tavily=True,
            )
            if search_context:
                # 重新选一个可用的 chat provider（避免主循环残留 FakePM）
                fallback_client, fallback_model, fallback_pm = _pick_chat_provider(
                    db, user_id, exclude_vertex=True,
                )
                if fallback_client is not None:
                    results2 = _llm_company_names(
                        fallback_client, fallback_model, None, fallback_pm, db, keyword,
                        with_search_hint=search_context[:3000],
                        user_id=user_id,
                    )
                    if len(results2) > len(results):
                        results = results2
                        if diag is not None:
                            diag.setdefault("providers", []).append(
                                {"name": "Tavily兜底", "is_vertex": False,
                                 "outcome": "ok" if results2 else "empty", "count": len(results2)}
                            )
        except Exception as e:
            logger.error("Tavily 兜底搜索失败: %s", e)
            if diag is not None:
                diag["tavily_error"] = str(e)[:200]
    if diag is not None:
        diag["final_count"] = len(results)
        diag["reason"] = _summarize_company_diag(diag) if not results else ""
    return results


def _pick_chat_provider(db: Session, user_id: int, exclude_vertex: bool = True):
    """从 task_cfg + is_active providers 里挑一个能用的 chat provider

    返回 (client, model, pm) 三元组；挑不到时返回 (None, None, None)
    """
    tried: set[int] = set()
    # 1) task_cfg 配的
    try:
        b, k, m, prov, tc, pm = _get_active_provider_full(db, "chat", user_id)
        if prov:
            return _get_client(b, k, prov), m, pm
    except Exception:
        pass
    # 2) 其他 is_active 的 chat provider
    from sqlmodel import select
    from app.models.model_provider import ModelProvider
    rows = db.exec(
        select(ModelProvider).where(
            ModelProvider.is_active == True,
            ModelProvider.provider_type == "chat",
        )
    ).all()
    for prov in rows:
        if prov.id in tried:
            continue
        if exclude_vertex and _is_vertex_ai(prov):
            continue
        chat_model = next(
            (mm for mm in prov.models_rel if "chat" in (mm.supported_task_types or ["chat"])),
            None,
        )
        if not chat_model:
            continue
        return _get_client(prov.base_url, prov.api_key, prov), chat_model.model_name, chat_model
    # 3) 如果上面都没找到（比如只有 Vertex AI 且 exclude_vertex=True），放宽限制再试一次
    if exclude_vertex:
        for prov in rows:
            if prov.id in tried:
                continue
            if not _is_vertex_ai(prov):
                continue
            chat_model = next(
                (mm for mm in prov.models_rel if "chat" in (mm.supported_task_types or ["chat"])),
                None,
            )
            if not chat_model:
                continue
            return _get_client(prov.base_url, prov.api_key, prov), chat_model.model_name, chat_model
    return None, None, None


def _llm_company_names(client, model, task_cfg, pm, db, keyword: str, with_search_hint: str = "", user_id: int = None, provider_id=None) -> list[dict]:
    """单次 LLM 调用：根据关键词给 5-8 个公司全称候选"""
    search_hint = (
        f"\n\n以下是从联网搜索获取的信息，请参考：\n{with_search_hint}"
        if with_search_hint else ""
    )
    params = resolve_chat_params(
        db, model=pm, task_cfg=task_cfg,
        func_defaults={"temperature": 0.2},
        # 强制 text 模式：json_object 模式要求返回对象而非数组，会导致解析失败
        func_overrides={"response_format": "text"},
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是企业信息查询助手。用户输入公司名称关键词（可能是简称、拼音、错别字或部分名称），"
                    "你返回最可能匹配的真实公司全称列表。\n"
                    "严格要求：\n"
                    "1. 优先基于你的内置知识直接回答（绝大多数公司你都认识）\n"
                    "2. 只返回真实存在的公司，不要编造\n"
                    "3. 名称要完整、官方注册全称优先\n"
                    "4. 返回 3-8 个最相关的结果，按可能性从高到低排序\n"
                    "5. 严格以 JSON 数组格式返回，每个元素包含:\n"
                    '     - "name": 简称或通用名称\n'
                    '     - "full_name": 公司完整注册名称\n'
                    "6. 只返回 JSON 数组，不要有其他内容、解释或 markdown 代码块。\n"
                    '格式示例: [{"name":"腾讯","full_name":"深圳市腾讯计算机系统有限公司"}]'
                ),
            },
            {"role": "user", "content": f"关键词：{keyword}{search_hint}"},
        ],
        **params,
    )
    _record_usage_silent(db, response, user_id or 0, provider_id, model, "company_search")
    text = _extract_message_text(response.choices[0].message)
    return _parse_company_names_json(text)


def _parse_company_names_json(text: str) -> list[dict]:
    """从 LLM 文本里抽 JSON 数组（兼容多种包装）"""
    if not text:
        return []
    # 1) 剥 markdown 代码块 ```json ... ``` 或 ``` ... ```
    cleaned = text.strip()
    m = _re_module.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, _re_module.IGNORECASE)
    if m:
        cleaned = m.group(1).strip()
    # 2) 直接 JSON
    try:
        arr = json.loads(cleaned)
        if isinstance(arr, list):
            return [x for x in arr if isinstance(x, dict) and (x.get("name") or x.get("full_name"))][:8]
        # json_object 模式：模型返回 {"companies": [...]} 包装对象
        if isinstance(arr, dict):
            for wrapper_key in ("companies", "results", "data", "list", "items"):
                val = arr.get(wrapper_key)
                if isinstance(val, list):
                    items = [x for x in val if isinstance(x, dict) and (x.get("name") or x.get("full_name"))]
                    if items:
                        return items[:8]
    except json.JSONDecodeError:
        pass
    # 3) 从文本里抽第一个 [ ... ] 数组
    m = _re_module.search(r"\[[\s\S]*?\]", cleaned)
    if m:
        try:
            arr = json.loads(m.group())
            if isinstance(arr, list):
                return [x for x in arr if isinstance(x, dict) and (x.get("name") or x.get("full_name"))][:8]
        except json.JSONDecodeError:
            pass
    # 4) 从文本里抽第一个 { ... }（单条），包成数组
    m = _re_module.search(r"\{[\s\S]*?\}", cleaned)
    if m:
        try:
            obj = json.loads(m.group())
            if isinstance(obj, dict) and (obj.get("name") or obj.get("full_name")):
                return [obj]
        except json.JSONDecodeError:
            pass
    return []


def fetch_company_info(company_name: str, db: Session, user_id: int = 0, progress: list | None = None) -> dict:
    """多源公司信息采集：Tavily(3 角度) + 官网深度 + 维基/百度 + DuckDuckGo 兜底

    progress: 可选，进度回调列表（append dict 如 {"stage":"tavily","msg":"..."}），
              用来支持 SSE 流式进度推送
    """
    from datetime import datetime
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from app.services.company_aggregator import (
        aggregate_company_sources, duckduckgo_search,
    )
    base_url, api_key, model, provider, task_cfg, pm = _get_active_provider_full(db, "company_info", user_id)
    client = _get_client(base_url, api_key, provider)

    def _emit(stage: str, msg: str = ""):
        if progress is not None:
            progress.append({"stage": stage, "msg": msg})

    # 阶段1：联网搜索
    _emit("search", f"开始联网搜索 {company_name}")
    search_context = ""
    search_sources: list[dict] = []
    website_sources: list[dict] = []
    news_context = ""
    news_sources: list[dict] = []
    ai_context = ""
    ai_sources: list[dict] = []

    # 优先：Gemini 接地搜索。单次调用即可返回综合信息 + 来源，避免多次慢调用
    # （接地搜索单次 ~20-30s，若沿用 Tavily 的 6 次调用模式会非常慢甚至超时）
    grounding_done = False
    try:
        from app.services.web_search import _resolve_search_provider
        from app.services.grounding_search import grounding_search, has_grounding_provider
        _mode = _resolve_search_provider(db, user_id)
        if _mode in ("auto", "gemini_grounding") and has_grounding_provider(db, user_id):
            _emit("grounding", f"Gemini 接地搜索 {company_name}")
            _cur = utc_now().year
            _gq = (
                f"{company_name} 公司简介、主营业务、所属行业、规模人数、官网网址；"
                f"以及 {_cur} 年最新动态（融资/合作/新品发布/财报）；"
                f"以及该公司在 AI、大模型、生成式AI 领域的真实动向"
            )
            _g = grounding_search(_gq, db, user_id=user_id, max_results=8)
            _ans = next((r.get("content", "") for r in _g if r.get("type") == "answer"), "")
            if _ans:
                search_context = _ans
                for _r in _g:
                    if _r.get("type") == "result" and _r.get("url"):
                        search_sources.append({"title": _r.get("title", ""), "url": _r.get("url", "")})
                grounding_done = True
    except Exception as e:
        logger.warning("接地搜索采集公司信息失败，回退 Tavily: %s", e)

    has_tavily = False
    if not grounding_done:
        try:
            has_tavily = bool(_get_tavily_api_key(db, user_id))
        except Exception:
            pass
    if not grounding_done and has_tavily:
        from app.services.web_search import search_web
        # 并发跑 3 角度
        def _tavily_basic():
            return search_web(
                f"{company_name} 公司简介 主营业务 行业 规模 官网",
                db, search_depth="advanced", max_results=5, user_id=user_id, force_tavily=True,
            )
        def _tavily_news():
            current_year = utc_now().year
            last_year = current_year - 1
            return search_web(
                f"{company_name} {current_year} {last_year} 最新新闻 动态 融资 合作 产品发布 财报",
                db, search_depth="advanced", max_results=5, user_id=user_id, force_tavily=True,
            )
        def _tavily_ai():
            return search_web(
                f"{company_name} AI 人工智能 大模型 生成式AI LLM 机器学习 智能化转型 创新 应用 落地",
                db, search_depth="advanced", max_results=5, user_id=user_id, force_tavily=True,
            )
        with ThreadPoolExecutor(max_workers=3) as ex:
            f_basic = ex.submit(_tavily_basic)
            f_news = ex.submit(_tavily_news)
            f_ai = ex.submit(_tavily_ai)
            try:
                raw_basic = f_basic.result(timeout=25)
            except Exception as e:
                logger.error("tavily basic fail: %s", e); raw_basic = []
            try:
                raw_news = f_news.result(timeout=25)
            except Exception as e:
                logger.error("tavily news fail: %s", e); raw_news = []
            try:
                raw_ai = f_ai.result(timeout=25)
            except Exception as e:
                logger.error("tavily ai fail: %s", e); raw_ai = []
        # 处理 basic 结果
        for r in raw_basic:
            if r.get("type") == "result" and r.get("url"):
                url = r.get("url", "")
                title = r.get("title", "").lower()
                if any(kw in title for kw in ["官网", "官方网站", "首页", "home", "official"]):
                    website_sources.append({"title": r.get("title", ""), "url": url})
                else:
                    search_sources.append({"title": r.get("title", ""), "url": url})
        # 处理 news 结果
        for r in raw_news:
            if r.get("type") == "result" and r.get("url"):
                search_sources.append({"title": r.get("title", ""), "url": r.get("url", "")})
        # 处理 ai 结果
        for r in raw_ai:
            if r.get("type") == "result" and r.get("url"):
                ai_sources.append({"title": r.get("title", ""), "url": r.get("url", "")})
        # 摘要
        try:
            search_context = search_and_summarize(
                f"{company_name} 公司简介 主营业务 行业 规模 官网",
                db, search_depth="advanced", user_id=user_id, force_tavily=True,
            )
        except Exception as e:
            logger.error("summarize basic fail: %s", e)
        try:
            current_year = utc_now().year
            last_year = current_year - 1
            from app.services.web_search import search_web_with_sources as _swws_news
            news_context, news_sources = _swws_news(
                f"{company_name} {current_year} {last_year} 最新新闻 动态 融资 合作 产品发布 财报",
                db, search_depth="advanced", user_id=user_id, force_tavily=True,
            )
        except Exception as e:
            logger.error("summarize news fail: %s", e)
        try:
            ai_context = search_and_summarize(
                f"{company_name} AI 人工智能 大模型 生成式AI LLM 机器学习 智能化转型 创新 应用 落地",
                db, search_depth="advanced", user_id=user_id, force_tavily=True,
            )
        except Exception as e:
            logger.error("summarize ai fail: %s", e)

    # 阶段2：官网抓取 + 维基百科 + 百度百科（并发）
    _emit("site", "抓取官网 + 维基/百度百科")
    # 推测官网域名（从 website_sources 或 search_sources）
    inferred_domain = _infer_company_domain(search_sources + website_sources, company_name)
    aggregator_data: dict = {}
    try:
        agg = aggregate_company_sources(company_name, website_domain=inferred_domain)
        aggregator_data = agg if isinstance(agg, dict) else {}
    except Exception as e:
        logger.error("aggregator fail: %s", e)

    site_meta = aggregator_data.get("site", {}) or {}
    wiki_items: list[dict] = aggregator_data.get("wikipedia", []) or []
    baidu_item: dict | None = aggregator_data.get("baidu_baike")

    # 阶段3：Tavily 来源太少 → DuckDuckGo 兜底
    if len(search_sources) + len(ai_sources) < 3:
        _emit("ddg", "DuckDuckGo 兜底搜索")
        try:
            ddg_results = duckduckgo_search(
                f"{company_name} 公司简介 主营业务 行业 AI 动向", max_results=5,
            )
            for r in ddg_results:
                search_sources.append({"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("snippet", "")})
        except Exception as e:
            logger.error("duckduckgo fail: %s", e)

    # 去重 sources（按 URL）
    seen_urls: set[str] = set()
    deduped_sources: list[dict] = []
    for s in search_sources + website_sources + ai_sources:
        u = s.get("url", "")
        if u and u not in seen_urls:
            seen_urls.add(u)
            deduped_sources.append(s)
    search_sources = deduped_sources

    # 构建提示词（含官网 + Wiki + Baidu 内容）
    _emit("llm", "AI 综合整理")
    search_hint = ""
    if search_context:
        search_hint += f"\n\n【公司基本信息（Tavily 摘要）】\n{search_context[:3000]}"
    if news_context:
        search_hint += f"\n\n【最新动态信息】\n{news_context[:2000]}"
    if ai_context:
        search_hint += f"\n\n【AI 相关真实信息（来自联网搜索）】\n{ai_context[:2500]}"
    if ai_sources:
        _ai_src_text = "\n".join(f"- [{s['title']}]({s['url']})" for s in ai_sources[:5])
        search_hint += f"\n\n【AI 相关信息来源（请只基于这些来源描述）】\n{_ai_src_text}"
    if website_sources:
        ws_text = "\n".join(f"- [{s['title']}]({s['url']})" for s in website_sources[:3])
        search_hint += f"\n\n【官网搜索链接（从中提取最可靠的官网网址）】\n{ws_text}"
    # 官网正文
    if site_meta:
        site_blocks = []
        if site_meta.get("title"):
            site_blocks.append(f"官网标题: {site_meta['title']}")
        if site_meta.get("description"):
            site_blocks.append(f"官网简介: {site_meta['description'][:400]}")
        if site_meta.get("keywords"):
            site_blocks.append(f"关键词: {site_meta['keywords'][:200]}")
        if site_meta.get("about_text"):
            site_blocks.append(f"官网 About 页内容（前 1500 字）:\n{site_meta['about_text'][:1500]}")
        if site_meta.get("product_text"):
            site_blocks.append(f"官网 Products 页内容（前 1500 字）:\n{site_meta['product_text'][:1500]}")
        if site_meta.get("news_text"):
            site_blocks.append(f"官网 News 页内容（前 1000 字）:\n{site_meta['news_text'][:1000]}")
        if site_blocks:
            search_hint += "\n\n【公司官网深度抓取】\n" + "\n\n".join(site_blocks)
    # 维基百科
    for it in wiki_items:
        search_hint += f"\n\n【维基百科（{it.get('lang','zh')}）摘要】\n标题: {it.get('title','')}\n简介: {it.get('description','')}\n内容: {it.get('extract','')[:800]}\n来源: {it.get('url','')}"
    # 百度百科
    if baidu_item:
        search_hint += f"\n\n【百度百科】\n标题: {baidu_item.get('title','')}\n描述: {baidu_item.get('description','')[:400]}\n摘要: {baidu_item.get('summary','')[:1000]}\n来源: {baidu_item.get('url','')}"

    extra = {}
    if not search_context and not news_context and not site_meta and not wiki_items and not baidu_item:
        extra = {"extra_body": {"enable_search": True}}

    current_date = utc_now().strftime("%Y年%m月")

    # 从数据库中已有客户行业聚合，作为AI归类参考
    industry_categories = []
    try:
        from app.services.industry_service import get_industry_categories_for_ai
        industry_categories = get_industry_categories_for_ai(db)
    except Exception as e:
        logger.error("读取行业分类失败: %s", e)
    industry_list_str = "\n".join(f"  - {c}" for c in industry_categories)

    params = resolve_chat_params(
        db, model=pm, task_cfg=task_cfg,
        func_defaults={"temperature": 0.0},  # 业务软默认：公司信息抽取要最稳定
        func_overrides={"extra_body": {"enable_search": True}} if (not search_context and not news_context and not site_meta and not wiki_items and not baidu_item) else {},
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是一个企业信息查询助手。请根据提供的多源搜索信息（联网搜索、官网深度抓取、维基百科、百度百科），整理该公司的基本信息。\n"
                    f"当前日期：{current_date}\n"
                    "请严格以 JSON 格式返回，包含以下字段:\n"
                    '  - "name": 公司全称\n'
                    '  - "industry": 所属行业（优先从以下已有行业分类中选择最匹配的，若无匹配则根据公司实际情况给出准确的行业名称）：\n{industry_list_str}\n'
                    '  - "core_products": 核心产品或明星产品\n'
                    '  - "business_scope": 主营业务\n'
                    '  - "scale": 规模人数（如"1000-5000人"或"500人以上"）\n'
                    '  - "profile": 公司简介（100字以内）\n'
                    f'  - "recent_news": 近半年内（{current_date}前后）的最新重要动态，如融资、新品发布、合作、财报等，100字以内。请优先从"最新动态信息"中提取，确保信息的时效性。如果搜索信息中无近期动态，请标注"暂无近期公开动态"\n'
                    '  - "logo_url": 公司官网域名（如 "example.com"），如果搜索信息中包含官网地址则提取域名，否则留空字符串\n'
                    '  - "website": 公司官网完整网址（如 "https://www.example.com"），优先从【官网搜索链接】和【公司官网深度抓取】中提取主域名；若无则从搜索信息中提取公司主域名；若均无则留空字符串\n'
                    '  - "ai_initiatives": 公司在 AI / 人工智能 / 大模型 / 生成式AI 等领域的真实动向（产品发布、模型训练、行业应用、智能化转型、专利、论文、收购、合作等）。【严格基于"AI 相关真实信息"或"AI 相关信息来源"中提供的搜索证据撰写，禁止凭空捏造】。以 Markdown 要点列表输出（3-6 条），每条 ≤ 50 字；如果搜索证据不足或该公司确实没有公开的 AI 动向，请输出"暂无公开可查的 AI 领域动向"。\n'
                    "只返回 JSON，不要有其他内容。"
                ),
            },
            {"role": "user", "content": f"公司名称：{company_name}{search_hint}"},
        ],
        **params,
    )
    _record_usage_silent(db, response, user_id, getattr(provider, 'id', None), model, "company_info")
    text = _extract_message_text(response.choices[0].message)
    # 兜底：如果 LLM 没回 ai_initiatives 字段，从 ai_context 提取要点
    fallback_ai = _format_ai_fallback(locals().get('ai_context'))

    # LLM 响应解析（两轮：完整 json / 文本中提取 json）
    def _postprocess(result: dict) -> dict:
        if not isinstance(result, dict):
            return result
        # 校验 AI 返回的 website
        ai_website = result.get("website", "")
        if ai_website and not _domain_looks_plausible(ai_website, result.get("name", company_name)):
            result["website"] = ""
        # 补充：从官网搜索 URL 提取官网（优先于 AI 返回）
        extracted_website = _extract_website_from_search(website_sources, company_name)
        if not result.get("website") and site_meta.get("sources"):
            # 兜底：把官网抓取时的 sources 第一条作为 website
            for s in site_meta.get("sources", []):
                if s.get("section") == "home" and s.get("url"):
                    result["website"] = s["url"]
                    break
        if extracted_website and not result.get("website"):
            result["website"] = extracted_website
        # 用官网域名替换 logo_url
        website_url = result.get("website", "") or extracted_website
        if website_url:
            domain = urlparse(website_url).netloc.replace('www.', '')
            if domain:
                result["logo_url"] = _fetch_company_logo(domain)
        elif result.get("logo_url"):
            raw = result["logo_url"].replace('https://', '').replace('http://', '').split('/')[0]
            result["logo_url"] = _fetch_company_logo(raw)
        # 兜底补全 ai_initiatives
        ai_v = result.get("ai_initiatives")
        if isinstance(ai_v, list):
            lines: list[str] = []
            for x in ai_v:
                s = str(x).strip()
                if not s:
                    continue
                if not s.startswith(("-", "*", "•", "·")):
                    s = f"- {s}"
                lines.append(s)
            result["ai_initiatives"] = "\n".join(lines) if lines else fallback_ai
        elif not (isinstance(ai_v, str) and ai_v.strip()):
            result["ai_initiatives"] = fallback_ai
        # 构建 ai_evidence 映射（按行匹配最近的 URL）
        # 接地搜索路径 ai_sources 为空，用 search_sources 兜底
        _eff_ai_sources = ai_sources or search_sources
        result["ai_evidence"] = _build_ai_evidence(result.get("ai_initiatives", ""), _eff_ai_sources)
        # 构建 recent_news_evidence（最新动态来源）
        # 接地搜索路径 news_sources 为空，用 search_sources 兜底
        _eff_news_sources = news_sources or search_sources
        if _eff_news_sources:
            result["recent_news_evidence"] = json.dumps(_eff_news_sources[:8], ensure_ascii=False)
        # 附加 sources
        if search_sources:
            result["sources"] = search_sources[:15]  # 截前 15
        return result

    # 阶段5：结构化补搜（关键字段缺失时）
    def _try_parse(t: str) -> dict | None:
        try:
            r = json.loads(t)
            return r if isinstance(r, dict) else None
        except json.JSONDecodeError:
            return None
    result: dict | None = _try_parse(text) or None
    if not result:
        m = _re_module.search(r'\{[\s\S]*\}', text)
        if m:
            result = _try_parse(m.group())

    if result:
        result = _postprocess(result)
        # 关键字段缺失则补搜一次
        missing = _missing_key_fields(result)
        if missing:
            _emit("supplement", f"补搜缺失字段: {missing}")
            try:
                result = _supplement_company_info(
                    company_name, result, missing, db, user_id,
                )
            except Exception as e:
                logger.error("supplement fail: %s", e)
        _emit("done", "完成")
        return result

    _emit("done", "完成")
    return {}


def _infer_company_domain(sources: list[dict], company_name: str) -> str | None:
    """从搜索结果中推断最可能的官网域名（不含 www.）"""
    skip_keywords = (
        "wikipedia", "baike.baidu", "zhihu", "weibo", "sohu", "163.com",
        "qq.com", "sina", "ifeng", "36kr", "ithome", "thepaper", "wallstreetcn",
        "huxiu", "geekpark", "tmtpost", "lieyunwang", "cyzone", "pedaily",
        "cls.cn", "jiemian", "eastmoney", "xueqiu", "cninfo", "10jqka",
        "hexun", "jrj", "yicai", "caixin", "linkedin", "zhaopin", "51job",
        "lagou", "liepin", "bosszhipin", "maimai", "tianyancha", "qichacha",
        "csdn", "cnblogs", "oschina", "segmentfault", "github", "gitee",
        "taobao", "tmall", "jd.com", "feishu", "dingtalk",
        "research.", "report.", "doc88", "docin", "slideshare",
        # 招股书 / 公告 / 新闻类
        "hkexnews", "sec.gov", "szse.cn", "sse.com.cn", "hkma.gov",
        "tidenews", "cnstock", "stcn", "nbd.com", "21jingji",
        "chinaventure", "webull", "futunn", "futu5", "investing.com",
        "pdf", ".pdf",
    )
    candidates: list[tuple[int, str]] = []
    cn = (company_name or "").lower()
    for s in sources:
        url = s.get("url", "")
        if not url:
            continue
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            domain = parsed.netloc.lower().replace("www.", "")
        except Exception:
            continue
        if not domain or "." not in domain:
            continue
        if any(sk in domain for sk in skip_keywords):
            continue
        score = 0
        # 域名含公司名/拼音 → 加分
        for token in _re_module.split(r"[\s\u4e00-\u9fff]+", cn):
            if token and len(token) >= 2 and token in domain:
                score += 5
        # https 优先
        if url.startswith("https://"):
            score += 1
        candidates.append((score, domain))
    if not candidates:
        return None
    candidates.sort(key=lambda x: -x[0])
    return candidates[0][1]


def _missing_key_fields(result: dict) -> list[str]:
    """返回 result 中关键字段为空/缺的值列表"""
    missing = []
    for k in ("industry", "core_products", "business_scope", "profile", "website"):
        v = result.get(k)
        if not v or (isinstance(v, str) and len(v.strip()) < 2):
            missing.append(k)
    if not (result.get("ai_initiatives") or "").strip() or result.get("ai_initiatives") == "暂无公开可查的 AI 领域动向":
        missing.append("ai_initiatives")
    return missing


def _supplement_company_info(company_name: str, result: dict, missing: list[str], db: Session, user_id: int) -> dict:
    """针对缺失字段追加一轮 DuckDuckGo 搜索 + LLM 重写"""
    from app.services.company_aggregator import duckduckgo_search
    if not missing:
        return result
    extra_hints: list[str] = []
    for f in missing[:3]:  # 最多补 3 个
        if f == "ai_initiatives":
            q = f"{company_name} AI 人工智能 大模型 创新 应用"
        elif f == "website":
            q = f"{company_name} 官网 official site"
        elif f == "industry":
            q = f"{company_name} 行业 主营业务 所属行业"
        else:
            q = f"{company_name} {f}"
        ddg = duckduckgo_search(q, max_results=3)
        if ddg:
            block = "\n".join(f"- [{r.get('title','')}]({r.get('url','')}) {r.get('snippet','')}" for r in ddg)
            extra_hints.append(f"\n\n【{f} 补充信息（DuckDuckGo）】\n{block}")
    if not extra_hints:
        return result
    # 用 LLM 修订 result
    base_url, api_key, model, provider, task_cfg, pm = _get_active_provider_full(db, "company_info", user_id)
    client = _get_client(base_url, api_key, provider)
    params = resolve_chat_params(db, model=pm, task_cfg=task_cfg, func_defaults={"temperature": 0.0})
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                "你是企业信息补全助手。基于以下补充信息，修订原 JSON 中缺失或不准确的字段（缺失字段列表: "
                + ", ".join(missing)
                + "）。只返回修订后的完整 JSON，不要有其他内容。\n原 JSON: " + json.dumps(result, ensure_ascii=False)
            )},
            {"role": "user", "content": "".join(extra_hints)},
        ],
        **params,
    )
    _record_usage_silent(db, resp, user_id, getattr(provider, 'id', None), model, "company_info")
    new_text = _extract_message_text(resp.choices[0].message)
    try:
        new_result = json.loads(new_text)
        if isinstance(new_result, dict):
            return new_result
    except json.JSONDecodeError:
        pass
    m = _re_module.search(r'\{[\s\S]*\}', new_text)
    if m:
        try:
            new_result = json.loads(m.group())
            if isinstance(new_result, dict):
                return new_result
        except json.JSONDecodeError:
            pass
    return result


def _build_ai_evidence(ai_text: str, sources: list[dict]) -> str:
    """根据 ai_initiatives 文本和 sources 构造来源映射 JSON 字符串。
    简化策略：每条要点均匀分配 sources（前 N 条轮流匹配）"""
    if not ai_text or not sources:
        return ""
    # 拆要点
    lines: list[str] = []
    for line in ai_text.split("\n"):
        s = line.strip()
        if not s:
            continue
        # 去掉列表符号
        s = s.lstrip("-*•· ").strip()
        if s and s != "暂无公开可查的 AI 领域动向":
            lines.append(s)
    if not lines:
        return ""
    evidence: list[dict] = []
    for i, line in enumerate(lines):
        src = sources[i % len(sources)]
        url = src.get("url", "")
        domain = ""
        try:
            from urllib.parse import urlparse
            domain = urlparse(url).netloc.replace("www.", "")
        except Exception:
            pass
        evidence.append({"text": line[:100], "url": url, "domain": domain, "title": src.get("title", "")[:80]})
    return json.dumps(evidence, ensure_ascii=False)


def _format_ai_fallback(ai_context: str | None) -> str:
    """当 LLM 未返回 ai_initiatives 时，从 ai_context 提取 3 条要点作为兜底"""
    if not ai_context:
        return "暂无公开可查的 AI 领域动向"
    # 尝试拆句：按 . ? ! 。？！ \n 拆，过滤太短/过长的
    raw = ai_context.replace("\r", "\n")
    # 先按换行，再按中文/英文句末符号拆
    chunks: list[str] = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        for sep in ["。", "！", "？", ". ", "? ", "! "]:
            line = line.replace(sep, "\n")
        for sub in line.split("\n"):
            sub = sub.strip().lstrip("-•·* ").strip()
            if 8 <= len(sub) <= 80:
                chunks.append(sub)
    if not chunks:
        return "暂无公开可查的 AI 领域动向"
    # 去重（粗略）
    seen: set[str] = set()
    uniq: list[str] = []
    for c in chunks:
        key = c[:20]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
        if len(uniq) >= 3:
            break
    if not uniq:
        return "暂无公开可查的 AI 领域动向"
    return "\n".join(f"- {c}" for c in uniq)


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
    except Exception as e:
        logger.error("域名可信度校验异常: %s", e)
        return True  # 解析失败不过滤，交给前端展示


def _fetch_company_logo(domain: str) -> str:
    """
    直接返回域名，前端会通过多源加载获取 Logo：
    Google Favicons → DuckDuckGo → UpLead → 首字母头像
    """
    return domain if domain else ""


def refresh_company_news(company_name: str, db: Session, user_id: int = 0) -> tuple[str, list[dict]]:
    """单独刷新公司最新动态，专注于半年内的新闻。

    返回 (news_text, sources) 二元组，sources 每条格式：
        {"url": ..., "title": ..., "domain": ...}
    """
    base_url, api_key, model, provider, task_cfg, pm = _get_active_provider_full(db, "company_info", user_id)
    client = _get_client(base_url, api_key, provider)

    # 搜索最新新闻（优先接地搜索，回退 Tavily）
    news_context = ""
    news_sources: list[dict] = []
    try:
        from app.services.web_search import search_web_with_sources as _swws
        current_year = utc_now().year
        last_year = current_year - 1
        news_query = f"{company_name} {current_year} {last_year} 最新新闻 动态 融资 合作 产品发布 财报"
        news_context, news_sources = _swws(news_query, db, search_depth="advanced", user_id=user_id)
    except Exception as e:
        logger.error("刷新公司新闻时搜索失败: %s", e)

    current_date = utc_now().strftime("%Y年%m月")
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

    params = resolve_chat_params(
        db, model=pm, task_cfg=task_cfg,
        func_defaults={"temperature": 0.3},
        func_overrides={"extra_body": {"enable_search": True}} if not news_context else {},
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"公司：{company_name}{search_hint}"},
        ],
        **params,
    )
    _record_usage_silent(db, response, user_id, getattr(provider, 'id', None), model, "company_news")
    text = _extract_message_text(response.choices[0].message)
    return text.strip(), news_sources
