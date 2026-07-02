"""add settlement_method to quote_record

Revision ID: s1e2t3t4l5e6
Revises: q1u2o3t4e5x6
Create Date: 2026-07-01
"""
from alembic import op
import sqlalchemy as sa

revision = 's1e2t3t4l5e6'
down_revision = 'q1u2o3t4e5x6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('quote_record', sa.Column('settlement_method', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('quote_record', 'settlement_method')
