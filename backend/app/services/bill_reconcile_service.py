"""Token 三方对账服务：Excel 解析 + 三方比对 + 差异聚合"""
import io
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

import openpyxl

from sqlmodel import Session, select

from app.models.bill_reconcile import (
    BillUpload, BillUploadRow, BillReconcileSession, BillReconcileItem
)

logger = logging.getLogger("worktrack.bill_reconcile")

# 差异触发阈值：总 token 差异 > 1% 或 > 10000 tokens 则标记差异
DIFF_PCT_THRESHOLD = 1.0    # %
DIFF_ABS_THRESHOLD = 10000  # tokens

# ─── 列名归一化映射 ───────────────────────────────────────────────────────────

_MODEL_ID_KEYS = {
    "model_id", "model", "modelid", "model_version", "modelversion",
    "api_model", "apimodel", "version_id", "versionid",
    "模型id", "模型", "模型名称", "模型版本", "api模型", "版本id",
}
_MODEL_NAME_KEYS = {
    "model_name", "modelname", "name", "display_name",
    "模型名", "模型显示名", "名称",
}
_INPUT_KEYS = {
    "input_tokens", "input", "prompt_tokens", "prompttokens",
    "input_token", "inputtokens", "inputtoken",
    "输入tokens", "输入token", "输入token数", "输入量",
}
_OUTPUT_KEYS = {
    "output_tokens", "output", "completion_tokens", "completiontokens",
    "output_token", "outputtokens", "outputtoken",
    "输出tokens", "输出token", "输出token数", "输出量",
}
_CACHE_READ_KEYS = {
    "cache_read_tokens", "cache_read", "cacheread", "cache_read_token",
    "缓存读tokens", "缓存读token", "缓存读取tokens",
}
_CACHE_WRITE_KEYS = {
    "cache_write_tokens", "cache_write", "cachewrite", "cache_write_token",
    "缓存写tokens", "缓存写token", "缓存写入tokens",
}
_TOTAL_KEYS = {
    "total_tokens", "total", "total_token", "totaltokens", "total_usage",
    "合计tokens", "合计token", "总tokens", "总token", "总token量", "合计", "总量",
}
_AMOUNT_KEYS = {
    "amount", "cost", "fee", "total_amount", "totalamount",
    "金额", "费用", "计费金额", "合计金额", "总金额", "账单金额",
}


def _norm(s: str) -> str:
    """列名规范化：小写、去空格/下划线/连字符"""
    return re.sub(r"[\s_\-]", "", str(s).lower().strip())


def _detect_columns(headers: list[str]) -> dict[str, int]:
    """把 Excel 表头映射到字段名 → 列下标"""
    mapping: dict[str, int] = {}
    groups = [
        ("model_id",           _MODEL_ID_KEYS),
        ("model_name",         _MODEL_NAME_KEYS),
        ("input_tokens",       _INPUT_KEYS),
        ("output_tokens",      _OUTPUT_KEYS),
        ("cache_read_tokens",  _CACHE_READ_KEYS),
        ("cache_write_tokens", _CACHE_WRITE_KEYS),
        ("total_tokens",       _TOTAL_KEYS),
        ("amount",             _AMOUNT_KEYS),
    ]
    for i, h in enumerate(headers):
        norm = _norm(h)
        for field, keys in groups:
            if field not in mapping and norm in keys:
                mapping[field] = i
                break
    return mapping


def _safe_int(v) -> int:
    if v is None:
        return 0
    try:
        return int(float(str(v).replace(",", "").strip()))
    except (ValueError, TypeError):
        return 0


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


# ─── Excel 解析 ──────────────────────────────────────────────────────────────

def parse_excel(
    file_bytes: bytes,
    period: str,
    source_type: str,
    source_name: Optional[str],
    uploaded_by: Optional[int],
    filename: str,
    db: Session,
) -> BillUpload:
    """解析 Excel 文件，入库 BillUpload + BillUploadRow，返回 BillUpload 记录"""
    upload = BillUpload(
        period=period,
        source_type=source_type,
        source_name=source_name,
        filename=filename,
        status="parsed",
        uploaded_by=uploaded_by,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)

    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active

        rows_iter = ws.iter_rows(values_only=True)
        headers_raw = next(rows_iter, None)
        if not headers_raw:
            raise ValueError("Excel 无表头行")

        # 跳过全空的表头行（有些文件有多行表头）
        headers: list[str] = []
        for h in headers_raw:
            headers.append(str(h) if h is not None else "")

        col_map = _detect_columns(headers)
        if "model_id" not in col_map:
            raise ValueError(
                f"未找到模型ID列，请确认表头包含: model_id / 模型ID / 模型 等字段。"
                f"实际表头: {[h for h in headers if h][:10]}"
            )

        model_agg: dict[str, dict] = {}  # model_id → aggregated row

        for raw_row in rows_iter:
            if all(v is None for v in raw_row):
                continue
            get = lambda field: raw_row[col_map[field]] if field in col_map else None

            model_id = str(get("model_id") or "").strip()
            if not model_id or model_id.lower() in ("none", "null", "nan"):
                continue

            model_name = str(get("model_name") or "").strip() or model_id

            inp = _safe_int(get("input_tokens"))
            out = _safe_int(get("output_tokens"))
            cr  = _safe_int(get("cache_read_tokens"))
            cw  = _safe_int(get("cache_write_tokens"))
            tot = _safe_int(get("total_tokens"))

            # 若没有 total，用 input+output+cache_read+cache_write 推算
            if tot == 0:
                tot = inp + out + cr + cw

            amt = _safe_float(get("amount"))

            if model_id in model_agg:
                agg = model_agg[model_id]
                agg["input_tokens"]       += inp
                agg["output_tokens"]      += out
                agg["cache_read_tokens"]  += cr
                agg["cache_write_tokens"] += cw
                agg["total_tokens"]       += tot
                if amt is not None:
                    agg["amount"] = (agg.get("amount") or 0) + amt
            else:
                model_agg[model_id] = {
                    "model_id":          model_id,
                    "model_name":        model_name,
                    "input_tokens":      inp,
                    "output_tokens":     out,
                    "cache_read_tokens": cr,
                    "cache_write_tokens": cw,
                    "total_tokens":      tot,
                    "amount":            amt,
                    "raw_row":           json.dumps(
                        {h: str(v) for h, v in zip(headers, raw_row) if v is not None},
                        ensure_ascii=False,
                    ),
                }

        row_count = 0
        for agg in model_agg.values():
            row = BillUploadRow(
                upload_id=upload.id,
                period=period,
                model_id=agg["model_id"],
                model_name=agg["model_name"],
                input_tokens=agg["input_tokens"],
                output_tokens=agg["output_tokens"],
                cache_read_tokens=agg["cache_read_tokens"],
                cache_write_tokens=agg["cache_write_tokens"],
                total_tokens=agg["total_tokens"],
                amount=agg.get("amount"),
                raw_row=agg.get("raw_row"),
            )
            db.add(row)
            row_count += 1

        upload.row_count = row_count
        db.add(upload)
        db.commit()
        logger.info("账单解析完成: upload_id=%d source=%s/%s rows=%d",
                    upload.id, source_type, source_name, row_count)
        return upload

    except Exception as e:
        upload.status = "error"
        upload.parse_error = str(e)[:1000]
        db.add(upload)
        db.commit()
        logger.warning("账单解析失败: %s", e)
        raise


# ─── 三方比对 ────────────────────────────────────────────────────────────────

def run_compare(period: str, db: Session) -> BillReconcileSession:
    """对指定月份的所有已上传账单执行三方对账，生成/覆盖 BillReconcileItem"""
    uploads = db.exec(
        select(BillUpload).where(
            BillUpload.period == period,
            BillUpload.status == "parsed",
        )
    ).all()

    if not uploads:
        raise ValueError(f"月份 {period} 尚无已解析的账单，请先上传")

    # 按 source_type 分组归集 tokens（同类型可多份，按 model_id 加总）
    by_type: dict[str, dict[str, dict]] = {"maas": {}, "supplier": {}, "customer": {}}

    for upload in uploads:
        stype = upload.source_type
        if stype not in by_type:
            continue
        rows = db.exec(
            select(BillUploadRow).where(BillUploadRow.upload_id == upload.id)
        ).all()
        for r in rows:
            mid = r.model_id
            if mid not in by_type[stype]:
                by_type[stype][mid] = {
                    "model_name":         r.model_name or mid,
                    "input_tokens":       0,
                    "output_tokens":      0,
                    "cache_read_tokens":  0,
                    "cache_write_tokens": 0,
                    "total_tokens":       0,
                }
            d = by_type[stype][mid]
            d["input_tokens"]       += r.input_tokens
            d["output_tokens"]      += r.output_tokens
            d["cache_read_tokens"]  += r.cache_read_tokens
            d["cache_write_tokens"] += r.cache_write_tokens
            d["total_tokens"]       += r.total_tokens

    maas_data     = by_type["maas"]
    supplier_data = by_type["supplier"]
    customer_data = by_type["customer"]

    # 所有出现过的 model_id 的并集
    all_model_ids = set(maas_data) | set(supplier_data) | set(customer_data)

    has_maas     = bool(maas_data)
    has_supplier = bool(supplier_data)
    has_customer = bool(customer_data)

    # 获取或创建会话
    session = db.exec(
        select(BillReconcileSession).where(BillReconcileSession.period == period)
    ).first()
    now = datetime.now(timezone.utc)
    if not session:
        session = BillReconcileSession(
            period=period,
            status="draft",
            created_at=now,
            updated_at=now,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

    # 删除旧的比对明细
    old_items = db.exec(
        select(BillReconcileItem).where(BillReconcileItem.session_id == session.id)
    ).all()
    for item in old_items:
        db.delete(item)
    db.commit()

    diff_supplier_count = 0
    diff_customer_count = 0

    for mid in sorted(all_model_ids):
        m_row   = maas_data.get(mid, {})
        s_row   = supplier_data.get(mid)
        c_row   = customer_data.get(mid)

        m_total = m_row.get("total_tokens", 0) if m_row else 0
        model_name = (
            (m_row.get("model_name") if m_row else None)
            or (s_row.get("model_name") if s_row else None)
            or (c_row.get("model_name") if c_row else None)
            or mid
        )

        # 供应商 diff
        supplier_diff_tokens: Optional[int] = None
        supplier_diff_pct: Optional[float] = None
        has_supplier_diff = False
        if s_row is not None and has_maas:
            s_total = s_row.get("total_tokens", 0)
            supplier_diff_tokens = m_total - s_total
            if s_total > 0:
                supplier_diff_pct = round(abs(supplier_diff_tokens) / s_total * 100, 4)
            elif m_total > 0:
                supplier_diff_pct = 100.0
            has_supplier_diff = (
                supplier_diff_pct is not None and supplier_diff_pct > DIFF_PCT_THRESHOLD
            ) or (
                supplier_diff_tokens is not None and abs(supplier_diff_tokens) > DIFF_ABS_THRESHOLD
            )
            if has_supplier_diff:
                diff_supplier_count += 1

        # 客户 diff
        customer_diff_tokens: Optional[int] = None
        customer_diff_pct: Optional[float] = None
        has_customer_diff = False
        if c_row is not None and has_maas:
            c_total = c_row.get("total_tokens", 0)
            customer_diff_tokens = m_total - c_total
            if c_total > 0:
                customer_diff_pct = round(abs(customer_diff_tokens) / c_total * 100, 4)
            elif m_total > 0:
                customer_diff_pct = 100.0
            has_customer_diff = (
                customer_diff_pct is not None and customer_diff_pct > DIFF_PCT_THRESHOLD
            ) or (
                customer_diff_tokens is not None and abs(customer_diff_tokens) > DIFF_ABS_THRESHOLD
            )
            if has_customer_diff:
                diff_customer_count += 1

        item = BillReconcileItem(
            session_id=session.id,
            period=period,
            model_id=mid,
            model_name=model_name,
            # MaaS
            maas_input_tokens=       m_row.get("input_tokens",       0) if m_row else 0,
            maas_output_tokens=      m_row.get("output_tokens",      0) if m_row else 0,
            maas_cache_read_tokens=  m_row.get("cache_read_tokens",  0) if m_row else 0,
            maas_cache_write_tokens= m_row.get("cache_write_tokens", 0) if m_row else 0,
            maas_total_tokens=       m_row.get("total_tokens",       0) if m_row else 0,
            # 供应商
            supplier_input_tokens=       s_row.get("input_tokens")       if s_row else None,
            supplier_output_tokens=      s_row.get("output_tokens")      if s_row else None,
            supplier_cache_read_tokens=  s_row.get("cache_read_tokens")  if s_row else None,
            supplier_cache_write_tokens= s_row.get("cache_write_tokens") if s_row else None,
            supplier_total_tokens=       s_row.get("total_tokens")       if s_row else None,
            # 客户
            customer_input_tokens=       c_row.get("input_tokens")       if c_row else None,
            customer_output_tokens=      c_row.get("output_tokens")      if c_row else None,
            customer_cache_read_tokens=  c_row.get("cache_read_tokens")  if c_row else None,
            customer_cache_write_tokens= c_row.get("cache_write_tokens") if c_row else None,
            customer_total_tokens=       c_row.get("total_tokens")       if c_row else None,
            # diff
            supplier_diff_tokens=supplier_diff_tokens,
            supplier_diff_pct=supplier_diff_pct,
            has_supplier_diff=has_supplier_diff,
            customer_diff_tokens=customer_diff_tokens,
            customer_diff_pct=customer_diff_pct,
            has_customer_diff=has_customer_diff,
            review_status="pending" if (has_supplier_diff or has_customer_diff) else "ok",
            created_at=now,
            updated_at=now,
        )
        db.add(item)

    session.status = "compared"
    session.model_count = len(all_model_ids)
    session.diff_supplier_count = diff_supplier_count
    session.diff_customer_count = diff_customer_count
    session.has_maas_bill     = has_maas
    session.has_supplier_bill = has_supplier
    session.has_customer_bill = has_customer
    session.updated_at = now
    db.add(session)
    db.commit()
    db.refresh(session)

    logger.info(
        "三方比对完成: period=%s models=%d diff_supplier=%d diff_customer=%d",
        period, len(all_model_ids), diff_supplier_count, diff_customer_count
    )
    return session
