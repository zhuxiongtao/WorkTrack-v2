"""create feedback table

Revision ID: f1e2e3d4b5a6
Revises: w1n2e3w4s5e6
Create Date: 2026-06-23 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'f1e2e3d4b5a6'
down_revision = 'w1n2e3w4s5e6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'feedback',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(), nullable=False, server_default='feature'),
        sa.Column('module', sa.String(), nullable=False),
        sa.Column('is_custom_module', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('images', sa.Text(), nullable=True),
        sa.Column('contact', sa.String(), nullable=True),
        sa.Column('user_priority', sa.String(), nullable=False, server_default='medium'),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('admin_priority', sa.String(), nullable=True),
        sa.Column('handler_id', sa.Integer(), nullable=True),
        sa.Column('admin_reply', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['handler_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_feedback_user_id', 'feedback', ['user_id'])
    op.create_index('ix_feedback_category', 'feedback', ['category'])
    op.create_index('ix_feedback_status', 'feedback', ['status'])


def downgrade():
    op.drop_index('ix_feedback_status', table_name='feedback')
    op.drop_index('ix_feedback_category', table_name='feedback')
    op.drop_index('ix_feedback_user_id', table_name='feedback')
    op.drop_table('feedback')
