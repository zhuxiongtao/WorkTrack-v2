"""add_cloud_provider_to_project

Revision ID: a45e53731f5b
Revises: 4b55afe28268
Create Date: 2026-04-30 00:54:40.328736

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'a45e53731f5b'
down_revision: Union[str, None] = '4b55afe28268'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project', sa.Column('cloud_provider', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    op.drop_column('project', 'cloud_provider')
