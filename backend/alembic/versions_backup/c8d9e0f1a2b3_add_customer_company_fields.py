"""add_customer_company_fields

Revision ID: c8d9e0f1a2b3
Revises: 4b55afe28268
Create Date: 2026-04-30 14:00:00.000000

为 customer 表添加公司详情字段：核心产品、主营业务、规模、简介、近期动向
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, None] = '4b55afe28268'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('customer') as batch_op:
        batch_op.add_column(sa.Column('core_products', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('business_scope', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('scale', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('profile', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('recent_news', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('customer') as batch_op:
        batch_op.drop_column('recent_news')
        batch_op.drop_column('profile')
        batch_op.drop_column('scale')
        batch_op.drop_column('business_scope')
        batch_op.drop_column('core_products')
