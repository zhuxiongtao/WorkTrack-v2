from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PurchaseSupplierCreate(BaseModel):
    name: str
    short_name: Optional[str] = None
    category: str = "其他"
    status: str = "合作中"
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    address: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    tax_no: Optional[str] = None
    invoice_title: Optional[str] = None
    remarks: Optional[str] = None


class PurchaseSupplierUpdate(BaseModel):
    name: Optional[str] = None
    short_name: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    address: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    tax_no: Optional[str] = None
    invoice_title: Optional[str] = None
    remarks: Optional[str] = None


class PurchaseSupplierOut(BaseModel):
    id: int
    name: str
    short_name: Optional[str] = None
    category: str
    status: str
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    address: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    tax_no: Optional[str] = None
    invoice_title: Optional[str] = None
    remarks: Optional[str] = None
    created_at: datetime
    updated_at: datetime
