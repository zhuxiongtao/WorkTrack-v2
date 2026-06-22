"""add_model_usage_log

Revision ID: u1m2o3d4e5l6
Revises: t1g2c3p4l5b6
Create Date: 2026-06-22 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u1m2o3d4e5l6'
down_revision: Union[str, None] = 't1g2c3p4l5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'modelusagelog',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('provider_id', sa.Integer(), nullable=True),
        sa.Column('model_name', sa.String(), nullable=False),
        sa.Column('task_type', sa.String(), nullable=False, server_default='chat'),
        sa.Column('input_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('output_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cache_read_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cache_write_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['provider_id'], ['modelprovider.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_modelusagelog_user_id', 'modelusagelog', ['user_id'])
    op.create_index('ix_modelusagelog_provider_id', 'modelusagelog', ['provider_id'])
    op.create_index('ix_modelusagelog_model_name', 'modelusagelog', ['model_name'])
    op.create_index('ix_modelusagelog_task_type', 'modelusagelog', ['task_type'])
    op.create_index('ix_modelusagelog_created_at', 'modelusagelog', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_modelusagelog_created_at', 'modelusagelog')
    op.drop_index('ix_modelusagelog_task_type', 'modelusagelog')
    op.drop_index('ix_modelusagelog_model_name', 'modelusagelog')
    op.drop_index('ix_modelusagelog_provider_id', 'modelusagelog')
    op.drop_index('ix_modelusagelog_user_id', 'modelusagelog')
    op.drop_table('modelusagelog')
