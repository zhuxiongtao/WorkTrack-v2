"""add amount_unit fields to project, contract, payment

Revision ID: u1n2i3t4s5y6
Revises: x1h2i3s4t5o6
Create Date: 2026-06-24 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'u1n2i3t4s5y6'
down_revision = 'x1h2i3s4t5o6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('project', sa.Column('opportunity_amount_unit', sa.String(length=10), nullable=False, server_default='万元'))
    op.add_column('project', sa.Column('deal_amount_unit', sa.String(length=10), nullable=False, server_default='万元'))
    op.add_column('contract', sa.Column('amount_unit', sa.String(length=10), nullable=False, server_default='万元'))
    op.add_column('payment_request', sa.Column('amount_unit', sa.String(length=10), nullable=False, server_default='元'))


def downgrade():
    op.drop_column('project', 'opportunity_amount_unit')
    op.drop_column('project', 'deal_amount_unit')
    op.drop_column('contract', 'amount_unit')
    op.drop_column('payment_request', 'amount_unit')
