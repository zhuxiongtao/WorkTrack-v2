"""add_cover_to_wiki_space

Revision ID: db7f19878733
Revises: 48ba24cd9cd2
Create Date: 2026-05-12 14:46:50.690794

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'db7f19878733'
down_revision: Union[str, None] = '48ba24cd9cd2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('wiki_space', sa.Column('cover_type', sa.String(length=50), nullable=False, server_default='gradient-1'))
    op.add_column('wiki_space', sa.Column('cover_url', sa.String(length=500), nullable=False, server_default=''))


def downgrade() -> None:
    op.drop_column('wiki_space', 'cover_url')
    op.drop_column('wiki_space', 'cover_type')
