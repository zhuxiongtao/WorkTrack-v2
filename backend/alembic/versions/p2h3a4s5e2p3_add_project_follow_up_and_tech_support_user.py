"""add project_follow_up table and tech_support_user_id to project

Revision ID: p2h3a4s5e2p3
Revises: u1n2i3t4s5y6
Create Date: 2026-06-24 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'p2h3a4s5e2p3'
down_revision = 'u1n2i3t4s5y6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('project', sa.Column('tech_support_user_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_project_tech_support_user',
        'project', 'user',
        ['tech_support_user_id'], ['id'],
        ondelete='SET NULL'
    )

    op.create_table(
        'project_follow_up',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('project.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('track', sa.String(10), nullable=False, server_default='sales'),
        sa.Column('content', sa.String(4000), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('project_follow_up')
    op.drop_constraint('fk_project_tech_support_user', 'project', type_='foreignkey')
    op.drop_column('project', 'tech_support_user_id')
