from typing import Optional
from datetime import date, datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class Contract(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    customer_id: Optional[int] = Field(default=None, foreign_key="customer.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")
    title: str
    contract_no: str = ""
    file_path: str = ""
    file_name: str = ""
    file_type: str = ""
    file_size: int = 0
    sign_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    party_a: str = ""
    party_b: str = ""
    contract_amount: Optional[float] = None
    amount_unit: str = "万元"  # 合同金额单位：元 | 万元
    currency: str = "CNY"
    payment_terms: Optional[str] = None
    key_clauses: Optional[str] = None
    summary: Optional[str] = None
    raw_text: Optional[str] = None
    status: str = "草稿"
    remarks: Optional[str] = None

    # ===== 阶段 1+2 新增：业务字段 =====
    # 合同类型：销售/采购/服务/租赁/劳动合同/保密/技术/咨询/其他
    contract_type: str = ""
    # 合同期限原文（"自 X 起 3 年"等推算不出的情况保留原文）
    effective_term: str = ""
    # 自动续约条款原文（"期满前 30 日未提出书面异议则自动续约 1 年"）
    auto_renew: str = ""
    # 违约金条款
    penalty_clause: str = ""
    # 验收条款
    acceptance_terms: str = ""
    # 付款节点（JSON 字符串：[{"phase":"预付款","percent":30,"condition":"合同签订后"},{"phase":"验收款","percent":60,"condition":"验收合格后"}]）
    payment_schedule: str = ""
    # 知识产权归属
    ip_clause: str = ""
    # 争议解决（仲裁机构/法院/适用法律）
    dispute_resolution: str = ""
    # 适用法律
    governing_law: str = ""
    # 通知与送达条款
    notice_clause: str = ""

    # ===== 解析质量元数据 =====
    # 解析状态：pending / parsing / success / failed
    parse_status: str = "pending"
    # 解析失败时的错误信息
    parse_error: str = ""
    # 解析完成时间
    parsed_at: Optional[datetime] = None
    # 字段级抽取元数据 JSON：{field: {"confidence": 0-1, "source_text": "原文引用"}}
    extraction_meta: str = ""

    # ===== 合同来源与模板 =====
    # 来源：self_made（从模板自建）/ external（对方发来的合同）
    source: str = "external"
    # 使用的模板 ID（仅 self_made 时有值）
    template_id: Optional[int] = Field(default=None)
    # 可编辑合同 HTML 正文（self_made 时保存；external 时为空）
    content_html: Optional[str] = None

    # ===== 签章归档 =====
    signed_file_path: str = ""
    signed_file_name: str = ""

    # ===== 用章申请（提交审批前选择，逗号分隔，如"公章,合同章"）=====
    seal_types_requested: str = ""

    # ===== 历史归档标识 =====
    is_historical: bool = False

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
