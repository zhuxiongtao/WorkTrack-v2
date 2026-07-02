"""channel: add markup field for sell-price calculation

Revision ID: m1a2r3k4u5p6
Revises: d1r2o3p4v5a6
Create Date: 2026-07-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'm1a2r3k4u5p6'
down_revision = 'd1r2o3p4v5a6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('channel') as batch_op:
        batch_op.add_column(sa.Column('markup', sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table('channel') as batch_op:
        batch_op.drop_column('markup')
