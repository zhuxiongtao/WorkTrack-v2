from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel


class ExpenseItemIn(BaseModel):
    name: str = ""
    expense_type: str = "其他"
    department_id: Optional[int] = None
    city: str = ""
    expense_date: Optional[date] = None
    amount: float = 0
    note: str = ""
    remark: str = ""
    attachments: Optional[str] = None
    sort_order: int = 0


class ExpenseItemOut(ExpenseItemIn):
    id: int
    expense_id: int
    department_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ExpenseRelationIn(BaseModel):
    target_type: str
    target_id: int
    relation_note: str = ""


class ExpenseRelationOut(ExpenseRelationIn):
    id: int
    expense_id: int
    target_title: Optional[str] = None  # 关联单据的标题/编号
    target_meta: Optional[dict] = None  # 关联单据的概览（出差：起止日期/目的地；请假：类型/时长）
    created_at: datetime


class ExpenseCreate(BaseModel):
    title: str
    expense_type: str = "其他"
    amount: float = 0
    amount_unit: str = "元"
    currency: str = "CNY"
    expense_date: datetime
    reason: str = ""
    attachments: Optional[str] = None
    items: Optional[List[ExpenseItemIn]] = None          # 明细（v2：写库为主）
    relations: Optional[List[ExpenseRelationIn]] = None  # 通用关联（v2 新增）
    invoice_entity_id: Optional[int] = None
    priority_offset_loan: bool = False
    # 兼容旧字段
    trip_id: Optional[int] = None


class ExpenseUpdate(BaseModel):
    title: Optional[str] = None
    expense_type: Optional[str] = None
    amount: Optional[float] = None
    amount_unit: Optional[str] = None
    currency: Optional[str] = None
    expense_date: Optional[datetime] = None
    reason: Optional[str] = None
    attachments: Optional[str] = None
    items: Optional[List[ExpenseItemIn]] = None
    relations: Optional[List[ExpenseRelationIn]] = None
    invoice_entity_id: Optional[int] = None
    priority_offset_loan: Optional[bool] = None
    trip_id: Optional[int] = None


class ExpenseOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    title: str
    expense_type: str
    amount: float
    amount_unit: str
    currency: str
    expense_date: datetime
    reason: str
    attachments: Optional[str] = None
    status: str
    paid_at: Optional[datetime] = None
    paid_by: Optional[int] = None
    # V2
    invoice_entity_id: Optional[int] = None
    invoice_entity_name: Optional[str] = None
    priority_offset_loan: bool
    offset_loan_amount: float
    account_balance: float
    company_should_pay: float
    actual_pay_amount: float
    company_owes_personal: float
    items: List[ExpenseItemOut] = []
    relations: List[ExpenseRelationOut] = []
    created_at: datetime
    updated_at: datetime


class ExpenseLoanLinkOut(BaseModel):
    """借款抵消明细（前端展示"个人欠款情况"）"""
    loan_id: int
    loan_date: date
    original_amount: float
    offset_amount: float
    remaining_after: float
