"""add_supplier_table_and_project_cost_supplier_id

Revision ID: 2d773ed63e6d
Revises: p1c2o3s4t5a6
Create Date: 2026-06-12 23:23:24.329122

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

# revision identifiers, used by Alembic.
revision: str = '2d773ed63e6d'
down_revision: Union[str, None] = 'p1c2o3s4t5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 创建 supplier 表
    op.create_table('supplier',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('code', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('contact_person', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('contact_email', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('contact_phone', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('settlement_currency', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('payment_terms', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('contract_start', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('contract_end', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('api_endpoint', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('models_provided', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('auth_type', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('total_cost', sa.Float(), nullable=True),
        sa.Column('project_count', sa.Integer(), nullable=True),
        sa.Column('remarks', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # project_cost 表新增 supplier_id 列
    op.add_column('project_cost', sa.Column('supplier_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_project_cost_supplier_id'), 'project_cost', ['supplier_id'], unique=False)
    op.create_foreign_key(None, 'project_cost', 'supplier', ['supplier_id'], ['id'])


def downgrade() -> None:
    # 移除 project_cost 的 supplier_id
    op.drop_constraint(None, 'project_cost', type_='foreignkey')
    op.drop_index(op.f('ix_project_cost_supplier_id'), table_name='project_cost')
    op.drop_column('project_cost', 'supplier_id')

    # 删除 supplier 表
    op.drop_table('supplier')
