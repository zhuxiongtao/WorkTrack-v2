from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class WikiSpaceCreate(BaseModel):
    name: str
    description: str = ""
    cover_type: str = "gradient-1"
    cover_url: str = ""


class WikiSpaceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    cover_type: Optional[str] = None
    cover_url: Optional[str] = None
    share_password: Optional[str] = None
    share_expires_at: Optional[datetime] = None


class WikiSpaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    owner_id: int
    is_public: bool
    cover_type: str
    cover_url: str
    share_password: Optional[str] = None
    share_expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    is_owner: bool = False
    is_shared: bool = False
    is_page_collaborative: bool = False


class WikiPageCreate(BaseModel):
    space_id: int
    parent_id: Optional[int] = None
    title: str
    content: str = ""


class WikiPageUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class WikiPageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    space_id: int
    parent_id: Optional[int] = None
    title: str
    content: str = ""
    sort_order: int
    created_by: int
    updated_by: int
    created_at: datetime
    updated_at: datetime
    creator_name: Optional[str] = None
    editor_names: list[str] = []
    my_permission: str = "viewer"


class WikiPageTreeNode(BaseModel):
    """页面树节点，用于前端目录树渲染"""
    id: int
    title: str
    parent_id: Optional[int] = None
    sort_order: int
    children: list["WikiPageTreeNode"] = []


class WikiPermissionCreate(BaseModel):
    target_type: str
    target_id: int
    subject_type: str
    subject_id: int
    permission: str


class WikiPermissionOut(BaseModel):
    id: int
    target_type: str
    target_id: int
    subject_type: str
    subject_id: int
    permission: str
    subject_name: str = ""
    subject_username: str = ""


class WikiPageVersionOut(BaseModel):
    id: int
    page_id: int
    content: str
    version: int
    created_by: int
    created_at: datetime


class WikiUserGroupCreate(BaseModel):
    name: str


class WikiUserGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    owner_id: int
    created_at: datetime
    member_count: int = 0


class WikiUserGroupMemberAdd(BaseModel):
    user_id: int
