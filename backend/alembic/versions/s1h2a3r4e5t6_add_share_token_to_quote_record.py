"""add_share_token_to_quote_record

Revision ID: s1h2a3r4e5t6
Revises: 47691daa4f41
Create Date: 2026-07-01

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 's1h2a3r4e5t6'
down_revision: Union[str, None] = '47691daa4f41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('quote_record', sa.Column('share_token', sa.String(), nullable=True))
    op.create_index('ix_quote_record_share_token', 'quote_record', ['share_token'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_quote_record_share_token', table_name='quote_record')
    op.drop_column('quote_record', 'share_token')
