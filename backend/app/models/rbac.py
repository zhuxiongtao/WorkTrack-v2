"""RBAC 数据模型：权限、角色、用户角色关联、组角色关联"""

from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


class Permission(SQLModel, table=True):
    """权限定义：模块:操作粒度"""
    __tablename__ = "rbac_permission"
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(unique=True, index=True, max_length=100)  # "project:create"
    name: str = Field(max_length=100)  # "创建项目"
    module: str = Field(index=True, max_length=50)  # "project"
    action: str = Field(max_length=50)  # "create"
    description: str = Field(default="", max_length=200)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Role(SQLModel, table=True):
    """角色定义"""
    __tablename__ = "rbac_role"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=100)  # "销售经理"
    code: str = Field(unique=True, index=True, max_length=50)  # "sales"
    description: str = Field(default="", max_length=200)
    is_system: bool = Field(default=False)  # 预置系统角色不可删除
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")  # NULL=系统预置
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RolePermission(SQLModel, table=True):
    """角色-权限关联"""
    __tablename__ = "rbac_role_permission"
    id: Optional[int] = Field(default=None, primary_key=True)
    role_id: int = Field(foreign_key="rbac_role.id", index=True)
    permission_id: int = Field(foreign_key="rbac_permission.id", index=True)


class UserRole(SQLModel, table=True):
    """用户-角色关联"""
    __tablename__ = "rbac_user_role"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    role_id: int = Field(foreign_key="rbac_role.id", index=True)


class GroupRole(SQLModel, table=True):
    """用户组-角色关联"""
    __tablename__ = "rbac_group_role"
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="wiki_user_group.id", index=True)
    role_id: int = Field(foreign_key="rbac_role.id", index=True)


class DepartmentRole(SQLModel, table=True):
    """部门-角色关联"""
    __tablename__ = "rbac_department_role"
    id: Optional[int] = Field(default=None, primary_key=True)
    department_id: int = Field(foreign_key="department.id", index=True)
    role_id: int = Field(foreign_key="rbac_role.id", index=True)
