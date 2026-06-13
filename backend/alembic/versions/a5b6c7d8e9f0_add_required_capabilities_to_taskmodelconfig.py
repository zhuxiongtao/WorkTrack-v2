"""add_required_capabilities_to_taskmodelconfig

Revision ID: a5b6c7d8e9f0
Revises: 7a3b8c1d2e4f
Create Date: 2026-06-05 11:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, None] = '7a3b8c1d2e4f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 任务级「需要能力」约束（JSON 数组），可选值：
    # function_calling / vision / json_mode / thinking / streaming / system_prompt
    op.add_column(
        'taskmodelconfig',
        sa.Column('required_capabilities', sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('taskmodelconfig', 'required_capabilities')
