"""Wiki 模块数据模型：空间、页面、权限、用户组、页面版本"""

from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field, Relationship


# ===== 用户组 =====
class UserGroup(SQLModel, table=True):
    __tablename__ = "wiki_user_group"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=100)
    description: str = Field(default="", max_length=500)  # 用户组描述
    owner_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserGroupMember(SQLModel, table=True):
    __tablename__ = "wiki_user_group_member"
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="wiki_user_group.id")
    user_id: int = Field(foreign_key="user.id")


# ===== Wiki 空间 =====
class WikiSpace(SQLModel, table=True):
    __tablename__ = "wiki_space"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=200)
    description: str = Field(default="", max_length=1000)
    owner_id: int = Field(foreign_key="user.id")
    is_public: bool = Field(default=False)
    cover_type: str = Field(default="gradient-1", max_length=50)  # "gradient-1"~"gradient-6" 或 "custom"
    cover_url: str = Field(default="", max_length=500)  # 自定义封面图片 URL
    share_password: Optional[str] = Field(default=None, max_length=100) # 共享提取码/密码
    share_expires_at: Optional[datetime] = Field(default=None) # 共享到期失效时间
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===== Wiki 页面 =====
class WikiPage(SQLModel, table=True):
    __tablename__ = "wiki_page"
    id: Optional[int] = Field(default=None, primary_key=True)
    space_id: int = Field(foreign_key="wiki_space.id")
    parent_id: Optional[int] = Field(default=None, foreign_key="wiki_page.id")
    title: str = Field(max_length=500)
    content: str = Field(default="")  # 内容（JSON/Markdown）
    sort_order: int = Field(default=0)
    created_by: int = Field(foreign_key="user.id")
    updated_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===== Wiki 权限 =====
class WikiPermission(SQLModel, table=True):
    __tablename__ = "wiki_permission"
    id: Optional[int] = Field(default=None, primary_key=True)
    target_type: str = Field(max_length=10)  # "space" 或 "page"
    target_id: int = Field()  # space_id 或 page_id
    subject_type: str = Field(max_length=10)  # "user" 或 "group"
    subject_id: int = Field()  # user_id 或 group_id
    permission: str = Field(max_length=20)  # "viewer" / "editor" / "admin"


# ===== Wiki 页面版本 =====
class WikiPageVersion(SQLModel, table=True):
    __tablename__ = "wiki_page_version"
    id: Optional[int] = Field(default=None, primary_key=True)
    page_id: int = Field(foreign_key="wiki_page.id")
    content: str = Field()  # 该版本的完整内容快照
    version: int = Field()  # 版本号
    created_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
