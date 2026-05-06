"""add_amount_to_project

Revision ID: 17353d557e34
Revises: f8c93d152e1c
Create Date: 2026-05-05 15:26:17.598873

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '17353d557e34'
down_revision: Union[str, None] = 'f8c93d152e1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project', sa.Column('amount', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('project', 'amount')
