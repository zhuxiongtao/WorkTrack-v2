"""merge_three_heads

Revision ID: 1f0d98cf577a
Revises: 7f3c2a1b9d0e, b1c2d3e4f5a6, f6e7d8c9b0a1
Create Date: 2026-05-02 01:12:03.785901

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1f0d98cf577a'
down_revision: Union[str, None] = ('7f3c2a1b9d0e', 'b1c2d3e4f5a6', 'f6e7d8c9b0a1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
