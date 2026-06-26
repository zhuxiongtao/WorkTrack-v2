"""add backup_record table for data management history

Revision ID: b1a2c3k4u5p6
Revises: e1x2p3v4v5a6
Create Date: 2026-06-27 00:00:00.000000

数据管理模块重构：新增 backup_record 表，记录每次备份/导出的元信息，
便于追溯历史与重新下载。备份文件持久化存储于 /app/data/backups/。
"""
from alembic import op
import sqlalchemy as sa


revision = 'b1a2c3k4u5p6'
down_revision = 'e1x2p3v4v5a6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'backup_record',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('backup_type', sa.String(length=20), nullable=False, server_default='json'),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('file_path', sa.String(length=500), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('model_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('record_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('modules', sa.Text(), nullable=True),
        sa.Column('operator_id', sa.Integer(), nullable=False),
        sa.Column('operator_name', sa.String(length=100), nullable=False, server_default=''),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('file_exists', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['operator_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_backup_record_backup_type', 'backup_record', ['backup_type'])
    op.create_index('ix_backup_record_operator_id', 'backup_record', ['operator_id'])
    op.create_index('ix_backup_record_created_at', 'backup_record', ['created_at'])


def downgrade():
    op.drop_index('ix_backup_record_created_at', table_name='backup_record')
    op.drop_index('ix_backup_record_operator_id', table_name='backup_record')
    op.drop_index('ix_backup_record_backup_type', table_name='backup_record')
    op.drop_table('backup_record')
