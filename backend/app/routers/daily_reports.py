import os
from datetime import date, datetime
from typing import Optional
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, UploadFile, File
from pydantic import BaseModel
from sqlmodel import Session, select
from app.database import get_session
from app.models.daily_report import DailyReport
from app.models.weekly_summary import WeeklySummary
from app.models.user import User
from app.auth import get_current_user
from app.schemas import DailyReportCreate, DailyReportUpdate, DailyReportOut
from app.services.vector_store import index_document, delete_document
from app.services.ai_service import summarize_daily_report, _get_prompt, _fill_template, _get_active_provider, _get_client, _extract_message_text
from app.routers.logs import write_log
from datetime import timedelta

router = APIRouter(prefix="/api/v1/reports", tags=["日报"])


def _background_ai_summarize(report_id: int, content: str):
    """后台任务：AI 总结日报并写入数据库"""
    from app.database import engine
    with Session(engine) as db:
        try:
            report = db.get(DailyReport, report_id)
            user_id = report.user_id if report else 0
            summary = summarize_daily_report(content, db, user_id)
            if report:
                report.ai_summary = summary
                report.updated_at = datetime.now()
                db.add(report)
                db.commit()
                write_log("info", "ai", f"后台AI总结日报#{report_id}完成", db=db)
        except Exception as e:
            write_log("error", "ai", f"后台AI总结日报#{report_id}失败: {str(e)[:150]}", details=str(e))


@router.get("/weekly")
def list_weekly_reports(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """按周聚合日报，返回每周汇总及日报列表（含已保存的 AI 周报总结）"""
    reports = db.exec(
        select(DailyReport)
        .where(DailyReport.user_id == current_user.id)
        .order_by(DailyReport.report_date.desc())
    ).all()

    # 加载已保存的周报 AI 总结（仅当前用户）
    saved_summaries = {
        str(s.week_start): s.summary_text
        for s in db.exec(
            select(WeeklySummary).where(WeeklySummary.user_id == current_user.id)
        ).all()
    }

    def week_range(d: date):
        return d - timedelta(days=d.weekday())

    tree: dict = defaultdict(lambda: defaultdict(list))
    for r in reports:
        wk = week_range(r.report_date)
        week_end = wk + timedelta(days=6)
        tree[r.report_date.year][str(wk)].append({
            "id": r.id,
            "date": str(r.report_date),
            "title": r.content_md.split("\n")[0][:60] if r.content_md else "无标题",
            "snippet": (r.ai_summary or r.content_md)[:120].replace("\n", " "),
            "ai_summary": r.ai_summary or "",
            "has_summary": bool(r.ai_summary),
        })

    weeks = []
    for year in sorted(tree.keys(), reverse=True):
        for wk_str in sorted(tree[year].keys(), reverse=True):
            wk_date = date.fromisoformat(wk_str)
            week_end = wk_date + timedelta(days=6)
            entries = tree[year][wk_str]
            weeks.append({
                "week_start": wk_str,
                "week_end": str(week_end),
                "year": year,
                "report_count": len(entries),
                "reports": entries,
                "weekly_summary": saved_summaries.get(wk_str, ""),
            })

    return {"weeks": weeks, "total_weeks": len(weeks)}


@router.get("/grouped")
def list_reports_grouped(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """按年份→月份→工作周归类的日报列表，仅返回摘要"""
    reports = db.exec(
        select(DailyReport)
        .where(DailyReport.user_id == current_user.id)
        .order_by(DailyReport.report_date.desc())
    ).all()
    
    def week_range(d: date):
        """返回该日期所在周的周一日期"""
        return d - timedelta(days=d.weekday())
    
    # 构建 year → month → week → reports
    tree: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for r in reports:
        wk = week_range(r.report_date)
        tree[r.report_date.year][r.report_date.month][str(wk)].append({
            "id": r.id,
            "date": str(r.report_date),
            "title": r.content_md.split("\n")[0][:60] if r.content_md else "无标题",
            "snippet": (r.ai_summary or r.content_md)[:120].replace("\n", " "),
            "ai_summary": r.ai_summary or "",
            "has_summary": bool(r.ai_summary),
        })
    
    # 转为有序列表
    grouped = []
    for year in sorted(tree.keys(), reverse=True):
        year_node = {"year": year, "months": []}
        for month in sorted(tree[year].keys(), reverse=True):
            month_node = {"month": month, "weeks": []}
            for wk_str in sorted(tree[year][month].keys(), reverse=True):
                month_node["weeks"].append({"week_start": wk_str, "reports": tree[year][month][wk_str]})
            year_node["months"].append(month_node)
        grouped.append(year_node)
    
    return {"grouped": grouped, "total": len(reports)}


@router.get("", response_model=list[DailyReportOut])
def list_reports(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    query = select(DailyReport).where(DailyReport.user_id == current_user.id)
    if start_date:
        query = query.where(DailyReport.report_date >= start_date)
    if end_date:
        query = query.where(DailyReport.report_date <= end_date)
    query = query.order_by(DailyReport.report_date.desc())
    return db.exec(query).all()


@router.get("/{report_id}", response_model=DailyReportOut)
def get_report(report_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    report = db.get(DailyReport, report_id)
    if not report or report.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="日报不存在")
    return report


@router.post("", response_model=DailyReportOut, status_code=201)
def create_report(data: DailyReportCreate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    create_data = data.model_dump()
    create_data["user_id"] = current_user.id
    report = DailyReport(**create_data)
    db.add(report)
    db.commit()
    db.refresh(report)
    # 后台索引到向量数据库
    background_tasks.add_task(
        index_document,
        collection_name="daily_reports",
        doc_id=str(report.id),
        text=report.content_md,
        metadata={"report_date": str(report.report_date), "user_id": report.user_id},
    )
    # 后台 AI 自动总结
    background_tasks.add_task(_background_ai_summarize, report.id, report.content_md)
    return report


@router.put("/{report_id}", response_model=DailyReportOut)
def update_report(report_id: int, data: DailyReportUpdate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    report = db.get(DailyReport, report_id)
    if not report or report.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="日报不存在")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(report, key, value)
    db.add(report)
    db.commit()
    db.refresh(report)
    # 后台更新向量索引 + AI 自动总结
    content_changed = data.content_md is not None
    if content_changed:
        background_tasks.add_task(
            index_document,
            collection_name="daily_reports",
            doc_id=str(report.id),
            text=report.content_md,
            metadata={"report_date": str(report.report_date), "user_id": report.user_id},
        )
        background_tasks.add_task(_background_ai_summarize, report.id, report.content_md)
    return report


@router.delete("/{report_id}", status_code=204)
def delete_report(report_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    report = db.get(DailyReport, report_id)
    if not report or report.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="日报不存在")
    db.delete(report)
    db.commit()
    # 后台删除向量索引
    background_tasks.add_task(delete_document, "daily_reports", str(report_id))


@router.post("/{report_id}/ai-summarize", response_model=DailyReportOut)
def ai_summarize_report(report_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """手动触发 AI 总结日报"""
    report = db.get(DailyReport, report_id)
    if not report or report.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="日报不存在")
    summary = summarize_daily_report(report.content_md, db, current_user.id)
    report.ai_summary = summary
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


# ===== 周报 AI 总结 =====

class WeeklySummaryRequest(BaseModel):
    week_start: str  # YYYY-MM-DD
    week_end: str    # YYYY-MM-DD


@router.get("/weekly-summaries")
def get_weekly_summaries(current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """获取当前用户已保存的周报 AI 总结"""
    summaries = db.exec(
        select(WeeklySummary)
        .where(WeeklySummary.user_id == current_user.id)
        .order_by(WeeklySummary.week_start.desc())
    ).all()
    return {
        str(s.week_start): {
            "week_start": str(s.week_start),
            "week_end": str(s.week_end),
            "summary_text": s.summary_text,
            "created_at": s.created_at,
        }
        for s in summaries
    }


@router.post("/weekly-summary")
def generate_weekly_summary(data: WeeklySummaryRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_session)):
    """生成并保存某周的 AI 总结"""
    week_start = date.fromisoformat(data.week_start)
    week_end = date.fromisoformat(data.week_end)

    # 获取该周日报（仅当前用户）
    reports = db.exec(
        select(DailyReport)
        .where(DailyReport.user_id == current_user.id, DailyReport.report_date >= week_start, DailyReport.report_date <= week_end)
        .order_by(DailyReport.report_date)
    ).all()

    if not reports:
        return {"summary_text": "本周暂无日报记录", "saved": False}

    # 构建日报内容
    reports_content = "\n\n---\n\n".join([
        f"【{r.report_date}】\n{r.content_md[:800]}"
        for r in reports
    ])

    week_range = f"{week_start} 至 {week_end}"

    # 使用配置的提示词（按用户隔离）
    system_prompt, template = _get_prompt("weekly_summary", db, current_user.id)
    user_prompt = _fill_template(template, week_range=week_range, reports_content=reports_content)

    try:
        base_url, api_key, model = _get_active_provider(db, "chat", current_user.id)
        client = _get_client(base_url, api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.5,
        )
        summary_text = _extract_message_text(response.choices[0].message) or "AI 总结生成失败"

        # 持久化存储（按用户隔离）
        existing = db.exec(
            select(WeeklySummary).where(
                WeeklySummary.week_start == week_start,
                WeeklySummary.user_id == current_user.id,
            )
        ).first()
        if existing:
            existing.summary_text = summary_text
            existing.week_end = week_end
            existing.created_at = datetime.now().isoformat()
        else:
            db.add(WeeklySummary(
                user_id=current_user.id,
                week_start=week_start,
                week_end=week_end,
                summary_text=summary_text,
                created_at=datetime.now().isoformat(),
            ))
        db.commit()
        return {"summary_text": summary_text, "saved": True}
    except Exception as e:
        write_log("error", "ai", f"周报AI总结失败: {str(e)[:150]}", details=str(e), db=db)
        return {"summary_text": f"AI 总结生成失败: {str(e)[:200]}", "saved": False}


# ===== 文件上传提取文本 =====

@router.post("/upload-file")
async def upload_report_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """上传文件并提取文本内容（用于日报编写）"""
    # 读取文件内容
    content = await file.read()
    filename = file.filename or "unknown"
    ext = os.path.splitext(filename)[1].lower()

    # 支持的文件类型
    if ext in ('.txt', '.md', '.markdown'):
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            try:
                text = content.decode('gbk')
            except UnicodeDecodeError:
                text = content.decode('utf-8', errors='replace')
        return {"filename": filename, "text": text, "type": "text"}

    elif ext in ('.docx',):
        # 尝试提取 docx 文本
        try:
            import io, zipfile
            from xml.etree import ElementTree
            with zipfile.ZipFile(io.BytesIO(content)) as z:
                xml_content = z.read('word/document.xml')
            tree = ElementTree.fromstring(xml_content)
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            paragraphs = []
            for p in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
                texts = [t.text or '' for t in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')]
                paragraphs.append(''.join(texts))
            text = '\n'.join(paragraphs)
            return {"filename": filename, "text": text, "type": "docx"}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"无法解析 docx 文件: {str(e)}")

    else:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}，支持 .txt .md .docx")


# ===== 语音转写 =====

@router.post("/transcribe-audio")
async def transcribe_report_audio(file: UploadFile = File(...), current_user: User = Depends(get_current_user),
                                  db: Session = Depends(get_session)):
    """上传音频并转写为文字（用于日报语音录入）"""
    import uuid as _uuid
    audio_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "audio")
    os.makedirs(audio_dir, exist_ok=True)
    
    filename = f"daily_{current_user.id}_{_uuid.uuid4().hex[:8]}.webm"
    filepath = os.path.join(audio_dir, filename)
    
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
    
    try:
        from app.services.ai_service import transcribe_audio
        text = transcribe_audio(filepath, db, current_user.id)
        return {"success": True, "text": text}
    except Exception as e:
        return {"success": False, "message": f"转写失败: {str(e)[:200]}"}
    finally:
        try:
            os.remove(filepath)
        except OSError:
            pass


# ===== 编辑周报总结 =====

class WeeklySummaryUpdate(BaseModel):
    summary_text: str


@router.put("/weekly-summary/{week_start}")
def update_weekly_summary(week_start: str, data: WeeklySummaryUpdate,
                          current_user: User = Depends(get_current_user),
                          db: Session = Depends(get_session)):
    """编辑/更新某周的 AI 总结"""
    week_start_date = date.fromisoformat(week_start)
    existing = db.exec(
        select(WeeklySummary).where(
            WeeklySummary.week_start == week_start_date,
            WeeklySummary.user_id == current_user.id,
        )
    ).first()
    if existing:
        existing.summary_text = data.summary_text
        db.add(existing)
    else:
        # 没有则创建
        db.add(WeeklySummary(
            user_id=current_user.id,
            week_start=week_start_date,
            week_end=week_start_date + timedelta(days=6),
            summary_text=data.summary_text,
            created_at=datetime.now().isoformat(),
        ))
    db.commit()
    return {"week_start": week_start, "saved": True}
