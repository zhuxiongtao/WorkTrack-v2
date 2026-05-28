"""add_meeting_collab_tables

Revision ID: a1b2c3d4e5f7
Revises: a1b2c3d4e5f6
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa


revision = 'a1b2c3d4e5f7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('meeting_permission',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('meeting_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('permission', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetingnote.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_meeting_permission_meeting_id', 'meeting_permission', ['meeting_id'])
    op.create_index('ix_meeting_permission_user_id', 'meeting_permission', ['user_id'])
    op.create_index('uq_meeting_perm_user', 'meeting_permission', ['meeting_id', 'user_id'], unique=True)

    op.create_table('meeting_comment',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('meeting_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetingnote.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_meeting_comment_meeting_id', 'meeting_comment', ['meeting_id'])


def downgrade() -> None:
    op.drop_index('ix_meeting_comment_meeting_id', table_name='meeting_comment')
    op.drop_table('meeting_comment')
    op.drop_index('uq_meeting_perm_user', table_name='meeting_permission')
    op.drop_index('ix_meeting_permission_user_id', table_name='meeting_permission')
    op.drop_index('ix_meeting_permission_meeting_id', table_name='meeting_permission')
    op.drop_table('meeting_permission')
