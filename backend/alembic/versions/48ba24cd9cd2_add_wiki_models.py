"""add_wiki_models

Revision ID: 48ba24cd9cd2
Revises: b8bc7eb89a63
Create Date: 2026-05-12 09:47:38.804759

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '48ba24cd9cd2'
down_revision: Union[str, None] = 'b8bc7eb89a63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('wiki_user_group',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['user.id'], name='fk_wiki_user_group_owner'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('wiki_user_group_member',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['group_id'], ['wiki_user_group.id'], name='fk_wiki_member_group'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], name='fk_wiki_member_user'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('wiki_space',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.String(length=1000), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('is_public', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['user.id'], name='fk_wiki_space_owner'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('wiki_page',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('space_id', sa.Integer(), nullable=False),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('updated_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['space_id'], ['wiki_space.id'], name='fk_wiki_page_space'),
        sa.ForeignKeyConstraint(['parent_id'], ['wiki_page.id'], name='fk_wiki_page_parent'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], name='fk_wiki_page_creator'),
        sa.ForeignKeyConstraint(['updated_by'], ['user.id'], name='fk_wiki_page_updater'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('wiki_permission',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('target_type', sa.String(length=10), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('subject_type', sa.String(length=10), nullable=False),
        sa.Column('subject_id', sa.Integer(), nullable=False),
        sa.Column('permission', sa.String(length=20), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('wiki_page_version',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('page_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['page_id'], ['wiki_page.id'], name='fk_wiki_version_page'),
        sa.ForeignKeyConstraint(['created_by'], ['user.id'], name='fk_wiki_version_creator'),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('wiki_page_version')
    op.drop_table('wiki_permission')
    op.drop_table('wiki_page')
    op.drop_table('wiki_space')
    op.drop_table('wiki_user_group_member')
    op.drop_table('wiki_user_group')
