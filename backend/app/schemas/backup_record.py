"""BackupRecord schema：备份历史记录响应模型"""
from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel


class BackupRecordOut(SQLModel):
    """备份历史响应 schema（仅作响应模型，不建表）

    字段顺序参考 routers/data_export.py 中 backup_history 端点的原始 inline dict。
    size_bytes 为模型原字段名（替代前端旧字段 size）；
    size_label 为计算字段，由 router 在构造时填入。
    """
    id: Optional[int] = None
    backup_type: str
    filename: str
    file_path: str
    size_bytes: int = 0
    size_label: Optional[str] = None
    model_count: int = 0
    record_count: int = 0
    modules: Optional[str] = None
    operator_id: int = 0
    operator_name: str = ""
    note: Optional[str] = None
    file_exists: bool = True
    created_at: Optional[datetime] = None

    class Config:
        table = False
