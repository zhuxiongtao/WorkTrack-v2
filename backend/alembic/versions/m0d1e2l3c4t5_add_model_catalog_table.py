"""add_model_catalog_table

模型目录表（AI 资讯抓取 + LLM 抽取产出）：
- 用于在「业务管理 → 模型管理」审校后台展示
- 采集入库默认 is_active=False，需管理员确认后才对业务可见

Revision ID: m0d1e2l3c4t5
Revises: r3c4o5n6c7i8
Create Date: 2026-06-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'm0d1e2l3c4t5'
down_revision: Union[str, None] = 'r3c4o5n6c7i8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'modelcatalog',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(255), nullable=False, index=True, comment='模型显示名，如 GPT-5'),
        sa.Column('version_id', sa.String(255), nullable=True, index=True, comment='API 调用 ID，如 gpt-5-2025-08-07'),
        sa.Column('provider', sa.String(120), nullable=True, index=True, comment='提供方，如 OpenAI'),
        sa.Column('region', sa.String(20), nullable=False, index=True, comment='domestic / international'),
        sa.Column('modality', sa.String(40), nullable=True, comment='text / multimodal / code / embedding'),
        sa.Column('release_date', sa.Date(), nullable=True, comment='发布日期'),
        sa.Column('description', sa.Text(), nullable=True, comment='描述'),
        sa.Column('source_url', sa.String(1000), nullable=True, comment='来源链接'),
        sa.Column('confidence', sa.Float(), nullable=True, comment='LLM 抽取置信度 0~1'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false', index=True, comment='是否对业务可见'),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True, comment='最近一次搜索结果中出现的日期'),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True, comment='审校时间'),
        sa.Column('reviewed_by', sa.Integer(), nullable=True, comment='审校人 user.id'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('name', 'version_id', name='uq_modelcatalog_name_version'),
    )
    op.create_index('ix_modelcatalog_region_active', 'modelcatalog', ['region', 'is_active'])


def downgrade() -> None:
    op.drop_index('ix_modelcatalog_region_active', table_name='modelcatalog')
    op.drop_table('modelcatalog')
