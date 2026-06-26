"""数据备份历史记录模型：记录每次手动备份的元信息，便于追溯与重新下载"""
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field
from app.utils.time import now


class BackupRecord(SQLModel, table=True):
    """备份历史记录（表名显式声明，避免 SQLModel 默认从类名推导为 backuprecord）"""
    __tablename__ = "backup_record"

    id: Optional[int] = Field(default=None, primary_key=True)
    # 备份类型：json=JSON结构化 / sql=SQL dump / excel=Excel模块导出
    backup_type: str = Field(default="json", index=True)
    # 文件名（含扩展名，存储于 /app/data/backups/）
    filename: str
    # 文件相对路径（相对于 /app/data/backups/）
    file_path: str
    # 文件大小（字节）
    size_bytes: int = Field(default=0)
    # 涵盖模型数量（JSON/SQL 备份用）
    model_count: int = Field(default=0)
    # 涵盖记录总数（JSON/SQL 备份用）
    record_count: int = Field(default=0)
    # 涵盖模块列表（Excel 导出用，逗号分隔模块 key）
    modules: Optional[str] = None
    # 操作人
    operator_id: int = Field(foreign_key="user.id", index=True)
    operator_name: str = ""
    # 备注信息（如导出范围说明）
    note: Optional[str] = None
    # 文件是否仍存在（超过保留期会被清理）
    file_exists: bool = Field(default=True)

    created_at: datetime = Field(default_factory=lambda: now())
