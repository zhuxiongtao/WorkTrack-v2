"""add quote extra fields

Revision ID: q1u2o3t4e5x6
Revises: s1h2a3r4e5t6
Create Date: 2026-07-01
"""
from alembic import op
import sqlalchemy as sa

revision = 'q1u2o3t4e5x6'
down_revision = 's1h2a3r4e5t6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('quote_record', sa.Column('quote_number', sa.String(), nullable=True))
    op.add_column('quote_record', sa.Column('contact_name', sa.String(), nullable=True))
    op.add_column('quote_record', sa.Column('app_scenario', sa.String(), nullable=True))
    op.add_column('quote_record', sa.Column('special_requirements', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('quote_record', 'special_requirements')
    op.drop_column('quote_record', 'app_scenario')
    op.drop_column('quote_record', 'contact_name')
    op.drop_column('quote_record', 'quote_number')
