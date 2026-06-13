"""add ai_initiatives to customer

Revision ID: a7c8d9e0f1a2
Revises:
Create Date: 2026-06-05 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7c8d9e0f1a2'
down_revision = 'a5b6c7d8e9f0'  # 接到当前 head 之一，避免多 head
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('customer', sa.Column('ai_initiatives', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('customer', 'ai_initiatives')
