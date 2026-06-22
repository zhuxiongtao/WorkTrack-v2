"""add_gcp_labels_to_modelprovider

Revision ID: t1g2c3p4l5b6
Revises: s1c2o3n4t5r6
Create Date: 2026-06-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 't1g2c3p4l5b6'
down_revision: Union[str, None] = 's1c2o3n4t5r6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('modelprovider', sa.Column('gcp_label_team', sa.String(), nullable=True))
    op.add_column('modelprovider', sa.Column('gcp_label_app', sa.String(), nullable=True))
    op.add_column('modelprovider', sa.Column('gcp_label_env', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('modelprovider', 'gcp_label_env')
    op.drop_column('modelprovider', 'gcp_label_app')
    op.drop_column('modelprovider', 'gcp_label_team')
