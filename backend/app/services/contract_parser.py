import json
import os
import base64
from sqlmodel import Session, select
from app.services.ai_service import _get_active_provider, _get_client
from app.models.model_provider import TaskModelConfig, ModelProvider


UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "contracts")


def _resolve_vision_provider(db: Session, user_id: int):
    vision_cfg = db.exec(
        select(TaskModelConfig).where(
            TaskModelConfig.task_type == "vision",
            TaskModelConfig.user_id == user_id,
        )
    ).first()
    if not vision_cfg:
        vision_cfg = db.exec(
            select(TaskModelConfig).where(
                TaskModelConfig.task_type == "vision",
                TaskModelConfig.user_id == None,
            )
        ).first()
    if not vision_cfg or not vision_cfg.provider_id or not vision_cfg.model_name:
        raise RuntimeError("未配置视觉模型")
    provider = db.get(ModelProvider, vision_cfg.provider_id)
    if not provider or not provider.is_active or not provider.api_key:
        raise RuntimeError("视觉模型供应商未激活")
    return provider, vision_cfg.model_name


def _extract_text_via_vision(file_path: str, db: Session, user_id: int = 0) -> str:
    import fitz
    provider, model_name = _resolve_vision_provider(db, user_id)
    base_url, api_key, _, _ = _get_active_provider(db, "vision", user_id)
    client = _get_client(base_url, api_key, provider)

    doc = fitz.open(file_path)
    all_text = ""
    for page_num in range(len(doc)):
        pix = doc[page_num].get_pixmap(dpi=150)
        img_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")
        response = client.chat.completions.create(
            model=model_name,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "请逐字识别并提取图片中所有文字，直接输出文字内容。"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                ]
            }],
            temperature=0.1,
        )
        all_text += (response.choices[0].message.content or "") + "\n"
    doc.close()
    return all_text.strip()


def extract_text_from_pdf(file_path: str) -> str:
    import fitz
    doc = fitz.open(file_path)
    text = ""
    for page in doc:
        text += page.get_text() + "\n"
    doc.close()
    return text.strip()


def extract_text_from_docx(file_path: str) -> str:
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs)
    except Exception:
        return ""


def extract_text_from_legacy_doc(file_path: str) -> str:
    import tempfile, subprocess, platform, os as _os
    tmp_txt = tempfile.NamedTemporaryFile(suffix=".txt", delete=False).name
    try:
        # macOS: 使用 textutil 直接转 txt
        if platform.system() == "Darwin":
            result = subprocess.run(
                ["textutil", "-convert", "txt", file_path, "-output", tmp_txt],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0 and _os.path.exists(tmp_txt) and _os.path.getsize(tmp_txt) > 0:
                with open(tmp_txt, "r", encoding="utf-8", errors="ignore") as f:
                    return f.read().strip()

        # Windows: 使用 win32com 转 PDF 再提取文字
        if platform.system() == "Windows":
            try:
                import win32com.client
                word = win32com.client.Dispatch("Word.Application")
                word.Visible = False
                word.DisplayAlerts = 0
                doc = None
                try:
                    doc = word.Documents.Open(file_path)
                    tmp_pdf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name
                    doc.SaveAs(tmp_pdf, FileFormat=17)
                finally:
                    if doc:
                        try: doc.Close()
                        except Exception: pass
                    try: word.Quit()
                    except Exception: pass

                if _os.path.exists(tmp_pdf) and _os.path.getsize(tmp_pdf) > 100:
                    import fitz
                    pdf = fitz.open(tmp_pdf)
                    text = ""
                    for page in pdf:
                        text += page.get_text() + "\n"
                    pdf.close()
                    try: _os.remove(tmp_pdf)
                    except Exception: pass
                    return text.strip()
            except Exception:
                pass

        return ""
    except Exception:
        return ""
    finally:
        try:
            _os.remove(tmp_txt)
        except Exception:
            pass


def extract_text(file_path: str, file_type: str) -> str:
    if file_type in (".pdf", "pdf"):
        text = extract_text_from_pdf(file_path)
        return text if text else ""
    elif file_type in (".docx", "docx"):
        return extract_text_from_docx(file_path)
    elif file_type in (".doc", "doc"):
        text = extract_text_from_docx(file_path)
        if not text:
            text = extract_text_from_legacy_doc(file_path)
        return text
    return ""


def extract_text_with_vision_fallback(file_path: str, file_type: str, db: Session, user_id: int = 0) -> str:
    text = extract_text(file_path, file_type)
    if not text and file_type in (".pdf", "pdf", ".docx", "docx", ".doc", "doc"):
        import traceback
        try:
            text = _extract_text_via_vision(file_path, db, user_id)
        except RuntimeError as e:
            raise RuntimeError(f"此合同无法直接提取文字，需要配置视觉模型来识别：{e}")
        except Exception:
            raise RuntimeError(f"此合同无法直接提取文字，视觉识别失败：{traceback.format_exc()[-300:]}")
    return text


def parse_contract(raw_text: str, db: Session, user_id: int = 0) -> dict:
    base_url, api_key, model, provider = _get_active_provider(db, "chat", user_id)
    client = _get_client(base_url, api_key, provider)

    # 预处理：提取关键段落，避免关键信息被 8000 字截断
    focused_text = _extract_key_sections(raw_text)

    prompt = f"""你是一个专业的合同分析助手。请仔细分析以下合同文本，提取关键信息并以JSON格式返回。

## 核心要求

### 日期识别（非常重要！）
合同中最关键的两个日期是 **生效时间（start_date）** 和 **失效时间（end_date）**，请务必准确识别。
日期统一格式为 YYYY-MM-DD。

合同中表示日期/期限的常见中文表述：
- "本合同自 2024年1月1日 起生效" → start_date: "2024-01-01"
- "有效期自 2024年1月1日 至 2025年12月31日" → start_date: "2024-01-01", end_date: "2025-12-31"
- "合同期限为三年，自2024年1月1日至2026年12月31日" → start_date: "2024-01-01", end_date: "2026-12-31"
- "服务期限：2024.1.1 - 2025.12.31" → start_date: "2024-01-01", end_date: "2025-12-31"
- "自双方签字盖章之日起生效，有效期一年" → 如果能从签订日期推算则推算，否则保持原文描述
- "本合同有效期为自生效日起36个月" → 如果能推算则推算具体日期

**关键词提示**：看到"期限"、"有效期"、"履行期限"、"服务期"、"合同期"、"起始"、"截止"、"届满"、"终止"等字样时，重点关注其前后的日期信息。

**特别提醒**：
1. end_date 是合同终止/失效/到期日期，不是签订日期
2. 如果原文写明了具体日期，请原样提取
3. 如果只有模糊描述（如"三年"），优先根据 start_date 推算具体日期，推算不出才留 null
4. 中文日期格式"2024年1月1日"请转换为"2024-01-01"

### 签订日期（sign_date）
签订日期是合同签署的日期，通常出现在合同开头或末尾签字处。
看到"签订日期"、"签署日期"、"签约日期"、"于____年__月__日签订"等字样时提取。

### 金额处理
- 统一使用"万元"为单位，如 85.85万则填 85.85
- 原文为"元"请换算（如 500000元 → 50.00）
- 注意区分"合同金额"、"总价"、"合同价款"等表述

### 输出格式
返回**纯JSON**，不要有 markdown 代码块，不要有其他文字：

{{
  "sign_date": "签订日期(YYYY-MM-DD) 或 null",
  "start_date": "合同生效/开始日期(YYYY-MM-DD) 或 null",
  "end_date": "合同失效/截止/到期日期(YYYY-MM-DD) 或 null",
  "party_a": "甲方全称 或 null",
  "party_b": "乙方全称 或 null",
  "contract_amount": 金额(万元) 或 null,
  "currency": "CNY/USD等 或 null",
  "payment_terms": "付款方式简述 或 null",
  "key_clauses": "关键条款摘要（交付、违约、知识产权、保密、验收等）或 null",
  "summary": "合同核心内容2-3句话摘要 或 null"
}}

合同文本：
{focused_text[:12000]}
"""

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是一个专业的合同分析助手，尤其擅长从中文合同中提取日期、金额、甲乙方等关键字段。请严格按照JSON格式输出，不要添加任何解释文字。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        content = response.choices[0].message.content or ""
        content = content.strip()
        # 清理 markdown 代码块
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:])
            if content.endswith("```"):
                content = content[:-3]
        content = content.strip()
        return json.loads(content)
    except Exception as e:
        return {"error": str(e)}


def _extract_key_sections(raw_text: str) -> str:
    """
    从合同原文中提取包含关键信息的段落，确保 AI 优先看到重要内容。
    按照关键词匹配优先级排序：日期/期限 > 甲乙方 > 金额 > 其他。
    """
    if len(raw_text) <= 12000:
        return raw_text

    lines = raw_text.split("\n")
    key_lines = []
    other_lines = []

    # 高优先级关键词（日期、合同期限相关）
    high_priority = [
        "期限", "有效期", "履行期", "服务期", "合同期",
        "生效", "失效", "起始", "截止", "届满", "终止",
        "签订日期", "签署日期", "签约日期",
        "自20", "至20", "自 20", "至 20",
        "年", "月", "日",
    ]
    # 中优先级关键词
    medium_priority = [
        "甲方", "乙方", "出卖人", "买受人", "委托方", "受托方",
        "金额", "价款", "总价", "合同价格", "费用",
        "付款", "支付",
    ]

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # 高优先级匹配
        if any(kw in stripped for kw in high_priority):
            key_lines.append(stripped)
        elif any(kw in stripped for kw in medium_priority):
            # 中优先级放在后面
            key_lines.append(stripped)
        else:
            other_lines.append(stripped)

    # 先放关键行，再放其他行，控制总长度
    result = "\n".join(key_lines)
    remaining = 12000 - len(result)
    if remaining > 0:
        extra = "\n".join(other_lines)
        result = result + "\n" + extra[:remaining]

    return result[:12000]
