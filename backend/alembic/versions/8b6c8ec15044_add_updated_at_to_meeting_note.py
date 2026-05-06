"""add updated_at to meeting_note

Revision ID: 8b6c8ec15044
Revises: 7a5b7ec15043
Create Date: 2026-05-05 22:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '8b6c8ec15044'
down_revision: Union[str, None] = '7a5b7ec15043'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('meetingnote', sa.Column('updated_at', sa.DateTime(), nullable=True))
    # Set default value for existing rows
    op.execute("UPDATE meetingnote SET updated_at = created_at WHERE updated_at IS NULL")


def downgrade() -> None:
    op.drop_column('meetingnote', 'updated_at')
