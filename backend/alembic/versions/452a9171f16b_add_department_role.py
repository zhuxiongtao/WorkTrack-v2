"""add_department_role

Revision ID: 452a9171f16b
Revises: 0878267666e3
Create Date: 2026-05-21 21:36:08.830555

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '452a9171f16b'
down_revision: Union[str, None] = '0878267666e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'rbac_department_role',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['department.id'], ),
        sa.ForeignKeyConstraint(['role_id'], ['rbac_role.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_rbac_department_role_department_id'), 'rbac_department_role', ['department_id'], unique=False)
    op.create_index(op.f('ix_rbac_department_role_role_id'), 'rbac_department_role', ['role_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_rbac_department_role_role_id'), table_name='rbac_department_role')
    op.drop_index(op.f('ix_rbac_department_role_department_id'), table_name='rbac_department_role')
    op.drop_table('rbac_department_role')
