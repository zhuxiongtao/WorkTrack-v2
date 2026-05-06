"""add_user_id_to_providers_and_models

Revision ID: 1b3539421c81
Revises: 8b6c8ec15044
Create Date: 2026-05-06 14:57:59.987298

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1b3539421c81'
down_revision: Union[str, None] = '8b6c8ec15044'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('modelprovider', sa.Column('user_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_modelprovider_user_id'), 'modelprovider', ['user_id'], unique=False)
    op.create_foreign_key(None, 'modelprovider', 'user', ['user_id'], ['id'])

    op.add_column('taskmodelconfig', sa.Column('user_id', sa.Integer(), nullable=True))
    op.drop_constraint('taskmodelconfig_task_type_key', 'taskmodelconfig', type_='unique')
    op.create_index(op.f('ix_taskmodelconfig_task_type'), 'taskmodelconfig', ['task_type'], unique=False)
    op.create_index(op.f('ix_taskmodelconfig_user_id'), 'taskmodelconfig', ['user_id'], unique=False)
    op.create_foreign_key(None, 'taskmodelconfig', 'user', ['user_id'], ['id'])

    op.add_column('user', sa.Column('use_shared_models', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('user', sa.Column('can_manage_models', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('user', 'can_manage_models')
    op.drop_column('user', 'use_shared_models')
    op.drop_constraint(None, 'taskmodelconfig', type_='foreignkey')
    op.drop_index(op.f('ix_taskmodelconfig_user_id'), table_name='taskmodelconfig')
    op.drop_index(op.f('ix_taskmodelconfig_task_type'), table_name='taskmodelconfig')
    op.create_unique_constraint('taskmodelconfig_task_type_key', 'taskmodelconfig', ['task_type'])
    op.drop_column('taskmodelconfig', 'user_id')
    op.drop_constraint(None, 'modelprovider', type_='foreignkey')
    op.drop_index(op.f('ix_modelprovider_user_id'), table_name='modelprovider')
    op.drop_column('modelprovider', 'user_id')
