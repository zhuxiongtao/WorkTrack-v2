"""add ai_evidence to customer

Revision ID: b2c3d4e5f6a7
Revises: a7c8d9e0f1a2
Create Date: 2026-06-09 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'a7c8d9e0f1a2'  # 接到 ai_initiatives 迁移之后
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('customer', sa.Column('ai_evidence', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('customer', 'ai_evidence')
