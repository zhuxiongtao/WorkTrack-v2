"""add_logo_url_to_customer

Revision ID: e54c346bfd1a
Revises: 1f0d98cf577a
Create Date: 2026-05-02 13:30:37.106338

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'e54c346bfd1a'
down_revision: Union[str, None] = '1f0d98cf577a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('customer') as batch_op:
        batch_op.add_column(sa.Column('logo_url', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('customer') as batch_op:
        batch_op.drop_column('logo_url')
