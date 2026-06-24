from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PaymentCreate(BaseModel):
    payment_type: str = "其他"            # 供应商付款 / 员工报销 / 工资 / 其他
    title: str
    amount: float = 0
    amount_unit: str = "元"
    currency: str = "CNY"
    payee: str = ""
    payee_account: Optional[str] = None
    reason: str = ""
    contract_id: Optional[int] = None
    attachments: Optional[str] = None


class PaymentUpdate(BaseModel):
    payment_type: Optional[str] = None
    title: Optional[str] = None
    amount: Optional[float] = None
    amount_unit: Optional[str] = None
    currency: Optional[str] = None
    payee: Optional[str] = None
    payee_account: Optional[str] = None
    reason: Optional[str] = None
    contract_id: Optional[int] = None
    attachments: Optional[str] = None


class PaymentOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None       # 申请人姓名
    payment_type: str
    title: str
    amount: float
    amount_unit: str = "元"
    currency: str
    payee: str
    payee_account: Optional[str] = None
    reason: str
    contract_id: Optional[int] = None
    contract_title: Optional[str] = None  # 关联合同标题（展示用）
    attachments: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime
