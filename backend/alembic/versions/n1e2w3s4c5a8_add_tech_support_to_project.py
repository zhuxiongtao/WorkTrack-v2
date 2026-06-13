"""add_tech_support_to_project

项目新增字段：
- tech_support_person: 技术支持（选项管理）

Revision ID: n1e2w3s4c5a8
Revises: n1e2w3s4c5a7
Create Date: 2026-06-12 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'n1e2w3s4c5a8'
down_revision: Union[str, None] = 'n1e2w3s4c5a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project', sa.Column('tech_support_person', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('project', 'tech_support_person')
