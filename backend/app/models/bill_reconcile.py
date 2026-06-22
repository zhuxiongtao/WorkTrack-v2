"""Token 三方对账：供应商账单 vs MaaS平台 vs 客户账单

对账维度：月度 × 模型ID × tokens（input/output/cache_read/cache_write/total）

流程：
1. 上传三方 Excel 账单（source_type: supplier / maas / customer）
2. 系统解析并入库（BillUploadRow）
3. 执行比对（BillReconcileItem），差异超阈值自动标记
4. 存在差异则触发审批（人工确认）
5. 审批通过 → session 置 approved，作为月度正式账单
"""
from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field, Column
from sqlalchemy import Text


class BillUpload(SQLModel, table=True):
    """每次上传的账单文件记录"""
    __tablename__ = "bill_upload"

    id: Optional[int] = Field(default=None, primary_key=True)
    period: str = Field(index=True)              # YYYY-MM
    source_type: str                              # supplier | maas | customer
    source_name: Optional[str] = None            # 供应商名 / MaaS平台名 / 客户名
    filename: Optional[str] = None
    file_path: Optional[str] = None
    row_count: int = 0
    status: str = "parsed"                       # parsed | error
    parse_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    uploaded_by: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BillUploadRow(SQLModel, table=True):
    """账单文件解析后的每行数据（按模型 ID 归集）"""
    __tablename__ = "bill_upload_row"

    id: Optional[int] = Field(default=None, primary_key=True)
    upload_id: int = Field(foreign_key="bill_upload.id", index=True)
    period: str = Field(index=True)
    model_id: str = Field(index=True)            # 模型ID（对账主键）
    model_name: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_tokens: int = 0
    amount: Optional[float] = None               # 账单金额（可选）
    raw_row: Optional[str] = Field(default=None, sa_column=Column(Text))  # JSON 原始行


class BillReconcileSession(SQLModel, table=True):
    """每个月份的对账会话（汇总状态）"""
    __tablename__ = "bill_reconcile_session"

    id: Optional[int] = Field(default=None, primary_key=True)
    period: str = Field(unique=True, index=True)   # YYYY-MM
    status: str = "draft"                         # draft | compared | pending_review | approved | rejected
    model_count: int = 0
    diff_supplier_count: int = 0                  # 与供应商有差异的模型数
    diff_customer_count: int = 0                  # 与客户有差异的模型数
    has_supplier_bill: bool = False
    has_maas_bill: bool = False
    has_customer_bill: bool = False
    notes: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_by: Optional[int] = Field(default=None, foreign_key="user.id")
    approval_instance_id: Optional[int] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BillReconcileItem(SQLModel, table=True):
    """按模型ID的三方对账明细（比对结果）"""
    __tablename__ = "bill_reconcile_item"

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="bill_reconcile_session.id", index=True)
    period: str = Field(index=True)
    model_id: str = Field(index=True)
    model_name: Optional[str] = None

    # MaaS 平台侧
    maas_input_tokens: int = 0
    maas_output_tokens: int = 0
    maas_cache_read_tokens: int = 0
    maas_cache_write_tokens: int = 0
    maas_total_tokens: int = 0

    # 供应商侧（若无账单则为 None）
    supplier_input_tokens: Optional[int] = None
    supplier_output_tokens: Optional[int] = None
    supplier_cache_read_tokens: Optional[int] = None
    supplier_cache_write_tokens: Optional[int] = None
    supplier_total_tokens: Optional[int] = None

    # 客户侧（若无账单则为 None）
    customer_input_tokens: Optional[int] = None
    customer_output_tokens: Optional[int] = None
    customer_cache_read_tokens: Optional[int] = None
    customer_cache_write_tokens: Optional[int] = None
    customer_total_tokens: Optional[int] = None

    # 差异：MaaS vs 供应商
    supplier_diff_tokens: Optional[int] = None   # maas_total - supplier_total
    supplier_diff_pct: Optional[float] = None    # 百分比
    has_supplier_diff: bool = False

    # 差异：MaaS vs 客户
    customer_diff_tokens: Optional[int] = None
    customer_diff_pct: Optional[float] = None
    has_customer_diff: bool = False

    # 人工复核
    review_status: str = "pending"               # pending | confirmed | disputed
    review_note: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
