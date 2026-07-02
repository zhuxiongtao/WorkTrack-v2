"""add access_url and usage_url to channel

Revision ID: c1h2a3n4u5r6
Revises: s1e2t3t4l5e6
Create Date: 2026-07-01
"""
from alembic import op
import sqlalchemy as sa

revision = 'c1h2a3n4u5r6'
down_revision = 's1e2t3t4l5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('channel', sa.Column('access_url', sa.String(), nullable=True))
    op.add_column('channel', sa.Column('usage_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('channel', 'usage_url')
    op.drop_column('channel', 'access_url')
