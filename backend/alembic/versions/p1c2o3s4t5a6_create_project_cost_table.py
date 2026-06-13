"""create project_cost table

Revision ID: p1c2o3s4t5a6
Revises: n1e2w3s4c5a8
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = 'p1c2o3s4t5a6'
down_revision = 'n1e2w3s4c5a8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'project_cost',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('project.id'), index=True, nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id'), index=True),
        sa.Column('category', sa.String(50), nullable=False, server_default='通道费'),
        sa.Column('description', sa.String(500), server_default=''),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('cost_month', sa.String(7)),
        sa.Column('remarks', sa.String(500)),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('project_cost')
