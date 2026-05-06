"""add_project_analysis

Revision ID: f6e7d8c9b0a1
Revises: d1e2f3a4b5c6
Create Date: 2026-04-30 21:00:00.000000

为 project 表添加 analysis 列，存储 AI 项目分析结果
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6e7d8c9b0a1'
down_revision: Union[str, None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('project') as batch_op:
        batch_op.add_column(sa.Column('analysis', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('project') as batch_op:
        batch_op.drop_column('analysis')
