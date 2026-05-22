from typing import Optional
from sqlmodel import SQLModel, Field

class Department(SQLModel, table=True):
    __tablename__ = "department"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=100)
    manager_id: Optional[int] = Field(default=None, foreign_key="user.id") # 部门主管/负责人 ID
    parent_id: Optional[int] = Field(default=None, foreign_key="department.id") # 父级部门 ID（支持嵌套层级）
