"""盖章（用印）申请模型：公章 / 财务章 / 法人章

走统一审批引擎，business_type="seal"。审批链末节点为「盖章」执行节点，
全部通过后 status→已盖章（见 approval_engine._on_finished）。
法务/财务初审节点恒存在，非合同相关用印可快速通过。
"""
from typing import Optional
from datetime import datetime, timezone
from app.utils.time import BEIJING_TZ, now
from sqlmodel import SQLModel, Field


class SealRequest(SQLModel, table=True):
    """用印申请单"""
    __tablename__ = "seal_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)   # 申请人

    # 公章 | 财务章 | 法人章
    seal_type: str = Field(default="公章", index=True, max_length=20)
    title: str = Field(max_length=200)                        # 用印文件 / 一句话摘要
    reason: str = Field(default="", max_length=2000)          # 用印事由
    copies: int = Field(default=1)                            # 用印份数
    is_contract_related: bool = Field(default=False)          # 是否涉及合同
    contract_id: Optional[int] = Field(default=None, foreign_key="contract.id", index=True)  # 关联合同（可选）

    # 用印文件附件，JSON 数组（与前端 FileUpload filesJson 一致）
    attachments: Optional[str] = Field(default=None)

    # 草稿 | 审批中 | 已盖章 | 已驳回 | 已撤回
    status: str = Field(default="草稿", index=True, max_length=20)

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
