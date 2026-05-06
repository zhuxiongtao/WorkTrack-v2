"""add ai_summary to meeting_note

Revision ID: 7a5b7ec15043
Revises: 69ded8d00a67
Create Date: 2026-05-05 22:12:03.931416

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '7a5b7ec15043'
down_revision: Union[str, None] = '69ded8d00a67'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('meetingnote', sa.Column('ai_summary', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('meetingnote', 'ai_summary')
