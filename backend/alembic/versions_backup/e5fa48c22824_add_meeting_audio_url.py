"""add_meeting_audio_url

Revision ID: e5fa48c22824
Revises: 839a1e540d17
Create Date: 2026-04-29 10:37:16.524417

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5fa48c22824'
down_revision: Union[str, None] = '839a1e540d17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('meetingnote', sa.Column('audio_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('meetingnote', 'audio_url')
