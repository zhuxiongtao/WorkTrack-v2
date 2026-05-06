"""add_currency_to_project

Revision ID: e26c84f63155
Revises: 17353d557e34
Create Date: 2026-05-05 15:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e26c84f63155'
down_revision: Union[str, None] = '17353d557e34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project', sa.Column('currency', sa.String(10), nullable=False, server_default='CNY'))


def downgrade() -> None:
    op.drop_column('project', 'currency')
