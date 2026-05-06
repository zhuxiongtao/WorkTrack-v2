"""add_termination_date_to_project

Revision ID: 69ded8d00a67
Revises: e3203bdf737d
Create Date: 2026-05-05 17:20:27.032565

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '69ded8d00a67'
down_revision: Union[str, None] = 'e3203bdf737d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project', sa.Column('termination_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('project', 'termination_date')
