"""contract: customer_id optional + seal_types_requested

Revision ID: c1o2n3t4y5p6
Revises: p2h3a4s5e2p3
Create Date: 2026-06-24 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'c1o2n3t4y5p6'
down_revision = 'p2h3a4s5e2p3'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('contract', 'customer_id', nullable=True)
    op.add_column('contract', sa.Column('seal_types_requested', sa.String(200), nullable=False, server_default=''))


def downgrade():
    op.drop_column('contract', 'seal_types_requested')
    op.alter_column('contract', 'customer_id', nullable=False)
