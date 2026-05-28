"""add_data_share_tables

Revision ID: a1b2c3d4e5f6
Revises: 050821918a70
Create Date: 2026-05-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '050821918a70'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # data_share table
    op.create_table(
        'data_share',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('target_type', sa.String(length=20), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('shared_by', sa.Integer(), nullable=False),
        sa.Column('shared_to', sa.Integer(), nullable=False),
        sa.Column('permission', sa.String(length=20), nullable=False, server_default='viewer'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['shared_by'], ['user.id'], ),
        sa.ForeignKeyConstraint(['shared_to'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('target_type', 'target_id', 'shared_to', name='uq_share_target_to'),
    )
    op.create_index(op.f('ix_data_share_shared_to'), 'data_share', ['shared_to'], unique=False)
    op.create_index(op.f('ix_data_share_target'), 'data_share', ['target_type', 'target_id'], unique=False)
    op.create_index(op.f('ix_data_share_shared_by'), 'data_share', ['shared_by'], unique=False)

    # data_share_comment table
    op.create_table(
        'data_share_comment',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('share_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['share_id'], ['data_share.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_data_share_comment_share_id'), 'data_share_comment', ['share_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_data_share_comment_share_id'), table_name='data_share_comment')
    op.drop_table('data_share_comment')
    op.drop_index(op.f('ix_data_share_shared_by'), table_name='data_share')
    op.drop_index(op.f('ix_data_share_target'), table_name='data_share')
    op.drop_index(op.f('ix_data_share_shared_to'), table_name='data_share')
    op.drop_table('data_share')
