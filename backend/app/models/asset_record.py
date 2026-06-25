"""资产履历模型：记录资产每一次状态/使用人变动，可追溯历任使用人与时间。

由 routers/assets.py 的领用/归还/调拨/维修/报废操作写入，
与 Asset 表配合：Asset 记录「当前」状态，AssetRecord 记录「全程」流转。
"""
from typing import Optional
from datetime import datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class AssetRecord(SQLModel, table=True):
    """资产流转履历"""
    __tablename__ = "asset_record"

    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: int = Field(foreign_key="asset.id", index=True)

    # 领用 / 归还 / 调拨 / 维修 / 报废 / 入库
    action: str = Field(max_length=20)
    from_user_id: Optional[int] = Field(default=None, foreign_key="user.id")  # 原使用人
    to_user_id: Optional[int] = Field(default=None, foreign_key="user.id")    # 新使用人
    operator_id: Optional[int] = Field(default=None, foreign_key="user.id")   # 操作人（管理员）
    from_status: Optional[str] = Field(default=None, max_length=20)           # 变动前状态
    to_status: Optional[str] = Field(default=None, max_length=20)             # 变动后状态
    note: Optional[str] = Field(default=None, max_length=500)                 # 备注

    created_at: datetime = Field(default_factory=lambda: now())
