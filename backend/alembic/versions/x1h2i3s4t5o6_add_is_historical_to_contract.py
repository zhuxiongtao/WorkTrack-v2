"""add is_historical to contract

Revision ID: x1h2i3s4t5o6
Revises: w1n2e3w4s5e6
Create Date: 2026-06-24 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'x1h2i3s4t5o6'
down_revision = 'p1a2y3s4e5a6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('contract', sa.Column('is_historical', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    op.drop_column('contract', 'is_historical')
