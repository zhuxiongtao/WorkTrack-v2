"""add_news_cache_table

Revision ID: n1e2w3s4c5a6
Revises: b2c3d4e5f6a7
Create Date: 2026-06-12 09:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'n1e2w3s4c5a6'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'newscache',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('guid', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column('url', sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=False),
        sa.Column('source', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=True),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('pub_date', sa.DateTime(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('guid'),
    )
    op.create_index('ix_newscache_guid', 'newscache', ['guid'], unique=True)
    op.create_index('ix_newscache_pub_date', 'newscache', ['pub_date'])
    op.create_index('ix_newscache_category', 'newscache', ['category'])


def downgrade() -> None:
    op.drop_index('ix_newscache_category', table_name='newscache')
    op.drop_index('ix_newscache_pub_date', table_name='newscache')
    op.drop_index('ix_newscache_guid', table_name='newscache')
    op.drop_table('newscache')
