"""add_vertex_ai_fields_to_provider

Revision ID: f9a1b2c3d4e5
Revises: f8c93d152e1c
Create Date: 2026-05-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f9a1b2c3d4e5'
down_revision: Union[str, None] = '1b3539421c81'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Vertex AI 需要 project_id 和 location 字段
    op.add_column('modelprovider', sa.Column('project_id', sa.String(255), nullable=True))
    op.add_column('modelprovider', sa.Column('location', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('modelprovider', 'location')
    op.drop_column('modelprovider', 'project_id')
