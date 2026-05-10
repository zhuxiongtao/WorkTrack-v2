from typing import Optional
from datetime import date, datetime
from sqlmodel import SQLModel, Field


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=1, foreign_key="user.id", index=True)
    customer_id: Optional[int] = Field(default=None, foreign_key="customer.id")
    customer_name: str = ""  # 客户名称
    name: str  # 项目名称
    opportunity_amount: Optional[float] = None  # 商机金额（万）
    deal_amount: Optional[float] = None  # 成交价格（万）
    currency: str = "CNY"  # 币种: CNY-人民币, USD-美元
    start_date: Optional[date] = None  # 开始时间
    termination_date: Optional[date] = None  # 终止时间
    product: Optional[str] = None  # 涉及产品（选项管理）
    project_scenario: Optional[str] = None  # 项目场景（选项管理）
    sales_person: Optional[str] = None  # 销售（选项管理）
    status: str = ""  # 状态（选项管理）
    progress: Optional[str] = None  # 进展记录
    analysis: Optional[str] = None  # AI 项目分析结果
    cloud_provider: Optional[str] = None  # 供应商（逗号分隔多选）
    files_json: Optional[str] = Field(default=None, description="附件列表 JSON: [{name, path, size, type}]")
    deadline: Optional[date] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
