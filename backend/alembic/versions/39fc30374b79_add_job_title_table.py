"""add_job_title_table

Revision ID: 39fc30374b79
Revises: s5a6l7e8s9p0
Create Date: 2026-06-29 14:45:10.168170

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '39fc30374b79'
down_revision: Union[str, None] = 's5a6l7e8s9p0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_title',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )


def downgrade() -> None:
    op.drop_table('job_title')
