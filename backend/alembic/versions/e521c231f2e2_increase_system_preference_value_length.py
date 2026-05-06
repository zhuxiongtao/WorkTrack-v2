"""increase_system_preference_value_length

Revision ID: e521c231f2e2
Revises: 8700d1fcb0e4
Create Date: 2026-05-04 16:11:47.782810

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e521c231f2e2'
down_revision: Union[str, None] = '8700d1fcb0e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('systempreference', 'value',
               existing_type=sa.VARCHAR(length=500),
               type_=sqlmodel.sql.sqltypes.AutoString(length=5000),
               existing_nullable=False)


def downgrade() -> None:
    op.alter_column('systempreference', 'value',
               existing_type=sqlmodel.sql.sqltypes.AutoString(length=5000),
               type_=sa.VARCHAR(length=500),
               existing_nullable=False)
