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


def _ocr_single_page(img_b64: str, model_name: str, base_url: str, api_key: str, provider) -> str:
    from openai import OpenAI
    client = OpenAI(base_url=base_url, api_key=api_key, timeout=120)
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
    return response.choices[0].message.content or ""


def _extract_text_via_vision(file_path: str, db: Session, user_id: int = 0) -> str:
    import fitz
    provider, model_name = _resolve_vision_provider(db, user_id)
    base_url, api_key, _, _ = _get_active_provider(db, "vision", user_id)

    doc = fitz.open(file_path)
    all_text = ""
    for page_num in range(len(doc)):
        pix = doc[page_num].get_pixmap(dpi=150)
        img_b64 = base64.b64encode(pix.tobytes("png")).decode("utf-8")
        text = _ocr_single_page(img_b64, model_name, base_url, api_key, provider)
        all_text += text + "\n"
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
    import tempfile, os as _os
    tmp_pdf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False).name
    try:
        try:
            import win32com.client
            word = win32com.client.Dispatch("Word.Application")
            word.Visible = False
            word.DisplayAlerts = 0
            doc = None
            try:
                doc = word.Documents.Open(file_path)
                doc.SaveAs(tmp_pdf, FileFormat=17)
            finally:
                if doc:
                    try:
                        doc.Close()
                    except Exception:
                        pass
                try:
                    word.Quit()
                except Exception:
                    pass
        except Exception:
            pass

        if not _os.path.exists(tmp_pdf) or _os.path.getsize(tmp_pdf) < 100:
            return ""

        if _os.path.getsize(tmp_pdf) < 100:
            return ""

        import fitz
        pdf = fitz.open(tmp_pdf)
        text = ""
        for page in pdf:
            text += page.get_text() + "\n"
        pdf.close()
        return text.strip() if text.strip() else ""
    except Exception:
        return ""
    finally:
        try:
            _os.remove(tmp_pdf)
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
    if not text and file_type in (".pdf", "pdf", ".docx", "docx"):
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

    prompt = f"""你是一个专业的合同分析助手。请分析以下合同文本，提取关键信息并以JSON格式返回。

要求：
1. 返回纯JSON，不要有其他内容
2. 所有日期格式为 YYYY-MM-DD
3. 金额统一使用"万元"为单位，如85.85万则填85.85。如果原文是其他单位请换算（如500000元 → 50.00）
4. 如果某字段无法确定，设为 null

JSON格式：
{{
  "sign_date": "签订日期(YYYY-MM-DD)",
  "start_date": "合同开始日期(YYYY-MM-DD)",
  "end_date": "合同截止日期(YYYY-MM-DD)",
  "party_a": "甲方全称",
  "party_b": "乙方全称",
  "contract_amount": 金额(万元),
  "currency": "CNY/USD等",
  "payment_terms": "付款方式简述",
  "key_clauses": "关键条款摘要（交付、违约、知识产权、保密、验收等）",
  "summary": "合同核心内容2-3句话摘要"
}}

合同文本：
{raw_text[:8000]}
"""

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是一个专业的合同分析助手，输出JSON格式的结构化数据。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        content = response.choices[0].message.content or ""
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            if content.endswith("```"):
                content = content[:-3]
        return json.loads(content)
    except Exception as e:
        return {"error": str(e)}
