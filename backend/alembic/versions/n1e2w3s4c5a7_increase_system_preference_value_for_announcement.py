"""increase_system_preference_value_for_announcement

Revision ID: n1e2w3s4c5a7
Revises: n1e2w3s4c5a6
Create Date: 2026-06-12 09:05:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'n1e2w3s4c5a7'
down_revision: Union[str, None] = 'n1e2w3s4c5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'systempreference', 'value',
        existing_type=sqlmodel.sql.sqltypes.AutoString(length=5000),
        type_=sqlmodel.sql.sqltypes.AutoString(length=50000),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'systempreference', 'value',
        existing_type=sqlmodel.sql.sqltypes.AutoString(length=50000),
        type_=sqlmodel.sql.sqltypes.AutoString(length=5000),
        existing_nullable=False,
    )
