"""add_opportunity_and_deal_amount_to_project

Revision ID: e3203bdf737d
Revises: e26c84f63155
Create Date: 2026-05-05 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3203bdf737d'
down_revision: Union[str, None] = 'e26c84f63155'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 先删除旧的 amount 字段
    op.drop_column('project', 'amount')
    # 新增两个金额字段
    op.add_column('project', sa.Column('opportunity_amount', sa.Float(), nullable=True))
    op.add_column('project', sa.Column('deal_amount', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('project', 'deal_amount')
    op.drop_column('project', 'opportunity_amount')
    # 恢复旧的 amount 字段
    op.add_column('project', sa.Column('amount', sa.Float(), nullable=True))
