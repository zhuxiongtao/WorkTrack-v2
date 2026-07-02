"""add_supplier_finance_channel_discount_modelcatalog_tiers

Revision ID: 7c5dc6831753
Revises: 39fc30374b79
Create Date: 2026-06-30 16:38:13.147884

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '7c5dc6831753'
down_revision: Union[str, None] = '39fc30374b79'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # supplier: 财务账户字段
    op.add_column('supplier', sa.Column('settlement_method', sa.String(), nullable=True))
    op.add_column('supplier', sa.Column('settlement_cycle_days', sa.Integer(), nullable=True))
    op.add_column('supplier', sa.Column('prepaid_balance', sa.Float(), nullable=True))
    op.add_column('supplier', sa.Column('credit_limit', sa.Float(), nullable=True))
    op.add_column('supplier', sa.Column('current_month_consumed', sa.Float(), nullable=True))
    op.add_column('supplier', sa.Column('api_doc_url', sa.String(), nullable=True))
    op.add_column('supplier', sa.Column('im_group', sa.String(), nullable=True))

    # channel: 折扣拆分
    op.add_column('channel', sa.Column('nominal_discount', sa.Float(), nullable=True))
    op.add_column('channel', sa.Column('actual_discount', sa.Float(), nullable=True))

    # modelcatalog: 价格增强
    op.add_column('modelcatalog', sa.Column('price_currency', sa.String(length=10), nullable=False, server_default='USD'))
    op.add_column('modelcatalog', sa.Column('price_unit', sa.String(length=40), nullable=False, server_default='美元/百万tokens'))
    op.add_column('modelcatalog', sa.Column('price_tiers', sa.String(), nullable=True))
    op.add_column('modelcatalog', sa.Column('suppliers_list', sa.String(), nullable=True))
    op.add_column('modelcatalog', sa.Column('source', sa.String(length=20), nullable=False, server_default='tavily'))


def downgrade() -> None:
    op.drop_column('modelcatalog', 'source')
    op.drop_column('modelcatalog', 'suppliers_list')
    op.drop_column('modelcatalog', 'price_tiers')
    op.drop_column('modelcatalog', 'price_unit')
    op.drop_column('modelcatalog', 'price_currency')

    op.drop_column('channel', 'actual_discount')
    op.drop_column('channel', 'nominal_discount')

    op.drop_column('supplier', 'im_group')
    op.drop_column('supplier', 'api_doc_url')
    op.drop_column('supplier', 'current_month_consumed')
    op.drop_column('supplier', 'credit_limit')
    op.drop_column('supplier', 'prepaid_balance')
    op.drop_column('supplier', 'settlement_cycle_days')
    op.drop_column('supplier', 'settlement_method')
