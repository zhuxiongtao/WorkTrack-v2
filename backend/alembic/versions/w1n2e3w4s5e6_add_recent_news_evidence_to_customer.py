"""add recent_news_evidence to customer

Revision ID: w1n2e3w4s5e6
Revises: v1u2s3e4r5w6
Create Date: 2026-06-23 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'w1n2e3w4s5e6'
down_revision = 'v1u2s3e4r5w6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('customer', sa.Column('recent_news_evidence', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('customer', 'recent_news_evidence')
