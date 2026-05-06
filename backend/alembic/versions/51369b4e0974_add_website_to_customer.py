"""add_website_to_customer

Revision ID: 51369b4e0974
Revises: e521c231f2e2
Create Date: 2026-05-04 16:35:07.071006

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = '51369b4e0974'
down_revision: Union[str, None] = 'e521c231f2e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('customer', sa.Column('website', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    op.drop_column('customer', 'website')
