"""add must_change_password to user

Revision ID: v1u2s3e4r5w6
Revises: u1m2o3d4e5l6
Create Date: 2026-06-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v1u2s3e4r5w6'
down_revision: Union[str, None] = 'u1m2o3d4e5l6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'user',
        sa.Column(
            'must_change_password',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column('user', 'must_change_password')
