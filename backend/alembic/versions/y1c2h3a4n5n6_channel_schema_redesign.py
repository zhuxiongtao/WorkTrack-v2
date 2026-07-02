"""channel schema redesign: remove discount/contract fields, add cost/scope/validity

Revision ID: y1c2h3a4n5n6
Revises: x1h2i3s4t5o6
Create Date: 2026-06-30 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'y1c2h3a4n5n6'
down_revision = '7c5dc6831753'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('channel') as batch_op:
        # 新增字段
        batch_op.add_column(sa.Column('api_protocol', sa.String(), nullable=False, server_default='openai_compat'))
        batch_op.add_column(sa.Column('cost_discount', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('cost_source', sa.String(), nullable=False, server_default='manual'))
        batch_op.add_column(sa.Column('scope_type', sa.String(), nullable=False, server_default='all'))
        batch_op.add_column(sa.Column('model_family', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('model_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('valid_from', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('valid_until', sa.String(), nullable=True))

        # 删除旧字段
        batch_op.drop_column('kind')
        batch_op.drop_column('model_type')
        batch_op.drop_column('discount_rate')
        batch_op.drop_column('nominal_discount')
        batch_op.drop_column('actual_discount')
        batch_op.drop_column('cost_price')
        batch_op.drop_column('price_unit')
        batch_op.drop_column('suggested_markup')
        batch_op.drop_column('contract_start')
        batch_op.drop_column('contract_end')


def downgrade():
    with op.batch_alter_table('channel') as batch_op:
        # 恢复旧字段
        batch_op.add_column(sa.Column('model_type', sa.String(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('kind', sa.String(), nullable=False, server_default='官网通道'))
        batch_op.add_column(sa.Column('discount_rate', sa.Float(), nullable=False, server_default='1.0'))
        batch_op.add_column(sa.Column('nominal_discount', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('actual_discount', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('cost_price', sa.Float(), nullable=False, server_default='0.0'))
        batch_op.add_column(sa.Column('price_unit', sa.String(), nullable=False, server_default='per_1k_token'))
        batch_op.add_column(sa.Column('suggested_markup', sa.Float(), nullable=False, server_default='0.2'))
        batch_op.add_column(sa.Column('contract_start', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('contract_end', sa.String(), nullable=True))

        # 删除新字段
        batch_op.drop_column('api_protocol')
        batch_op.drop_column('cost_discount')
        batch_op.drop_column('cost_source')
        batch_op.drop_column('scope_type')
        batch_op.drop_column('model_family')
        batch_op.drop_column('model_id')
        batch_op.drop_column('valid_from')
        batch_op.drop_column('valid_until')
