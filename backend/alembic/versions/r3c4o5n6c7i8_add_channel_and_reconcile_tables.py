"""add_channel_and_reconcile_tables

Revision ID: r3c4o5n6c7i8
Revises: 2d773ed63e6d
Create Date: 2026-06-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

# revision identifiers, used by Alembic.
revision: str = 'r3c4o5n6c7i8'
down_revision: Union[str, None] = '2d773ed63e6d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. channel 表
    op.create_table('channel',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=False),
        sa.Column('model_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('code', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('kind', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('cost_price', sa.Float(), nullable=False),
        sa.Column('price_unit', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('discount_rate', sa.Float(), nullable=False),
        sa.Column('suggested_markup', sa.Float(), nullable=False),
        sa.Column('contract_start', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('contract_end', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('sla_json', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('inventory_total', sa.Integer(), nullable=False),
        sa.Column('inventory_available', sa.Integer(), nullable=False),
        sa.Column('active_projects', sa.Integer(), nullable=False),
        sa.Column('monthly_cost', sa.Float(), nullable=False),
        sa.Column('remarks', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['supplier_id'], ['supplier.id']),
    )
    op.create_index(op.f('ix_channel_supplier_id'), 'channel', ['supplier_id'], unique=False)

    # 2. reconcile_sales 表
    op.create_table('reconcile_sales',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('period', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('customer_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('call_volume', sa.Float(), nullable=False),
        sa.Column('call_volume_unit', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('final_price', sa.Float(), nullable=False),
        sa.Column('amount_due', sa.Float(), nullable=False),
        sa.Column('invoice_status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('diff_amount', sa.Float(), nullable=False),
        sa.Column('remarks', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['project.id']),
    )
    op.create_index(op.f('ix_reconcile_sales_project_id'), 'reconcile_sales', ['project_id'], unique=False)
    op.create_index(op.f('ix_reconcile_sales_period'), 'reconcile_sales', ['period'], unique=False)

    # 3. reconcile_supply 表
    op.create_table('reconcile_supply',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('channel_id', sa.Integer(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=False),
        sa.Column('period', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('call_volume', sa.Float(), nullable=False),
        sa.Column('call_volume_unit', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('cost_price', sa.Float(), nullable=False),
        sa.Column('amount_payable', sa.Float(), nullable=False),
        sa.Column('bill_status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('diff_amount', sa.Float(), nullable=False),
        sa.Column('remarks', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['channel_id'], ['channel.id']),
        sa.ForeignKeyConstraint(['supplier_id'], ['supplier.id']),
    )
    op.create_index(op.f('ix_reconcile_supply_channel_id'), 'reconcile_supply', ['channel_id'], unique=False)
    op.create_index(op.f('ix_reconcile_supply_supplier_id'), 'reconcile_supply', ['supplier_id'], unique=False)
    op.create_index(op.f('ix_reconcile_supply_period'), 'reconcile_supply', ['period'], unique=False)

    # 4. reconcile_summary 表
    op.create_table('reconcile_summary',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('period', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('total_revenue', sa.Float(), nullable=False),
        sa.Column('invoice_count', sa.Integer(), nullable=False),
        sa.Column('total_cost', sa.Float(), nullable=False),
        sa.Column('paid_count', sa.Integer(), nullable=False),
        sa.Column('test_cost', sa.Float(), nullable=False),
        sa.Column('gross_profit', sa.Float(), nullable=False),
        sa.Column('final_profit', sa.Float(), nullable=False),
        sa.Column('gross_margin', sa.Float(), nullable=True),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('finalized_at', sa.DateTime(), nullable=True),
        sa.Column('remarks', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('period'),
    )
    op.create_index(op.f('ix_reconcile_summary_period'), 'reconcile_summary', ['period'], unique=True)

    # 5. reconcile_diff 表
    op.create_table('reconcile_diff',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('period', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('channel_id', sa.Integer(), nullable=True),
        sa.Column('diff_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('sales_call_volume', sa.Float(), nullable=False),
        sa.Column('supply_call_volume', sa.Float(), nullable=False),
        sa.Column('diff_volume', sa.Float(), nullable=False),
        sa.Column('diff_amount', sa.Float(), nullable=False),
        sa.Column('diff_pct', sa.Float(), nullable=True),
        sa.Column('reason', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('resolution', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['project_id'], ['project.id']),
        sa.ForeignKeyConstraint(['channel_id'], ['channel.id']),
    )
    op.create_index(op.f('ix_reconcile_diff_period'), 'reconcile_diff', ['period'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_reconcile_diff_period'), table_name='reconcile_diff')
    op.drop_table('reconcile_diff')
    op.drop_index(op.f('ix_reconcile_summary_period'), table_name='reconcile_summary')
    op.drop_table('reconcile_summary')
    op.drop_index(op.f('ix_reconcile_supply_period'), table_name='reconcile_supply')
    op.drop_index(op.f('ix_reconcile_supply_supplier_id'), table_name='reconcile_supply')
    op.drop_index(op.f('ix_reconcile_supply_channel_id'), table_name='reconcile_supply')
    op.drop_table('reconcile_supply')
    op.drop_index(op.f('ix_reconcile_sales_period'), table_name='reconcile_sales')
    op.drop_index(op.f('ix_reconcile_sales_project_id'), table_name='reconcile_sales')
    op.drop_table('reconcile_sales')
    op.drop_index(op.f('ix_channel_supplier_id'), table_name='channel')
    op.drop_table('channel')
