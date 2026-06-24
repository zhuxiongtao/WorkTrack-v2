"""add P2 OA module tables: expense_request, business_trip_request, purchase_request, asset

Revision ID: p2o2a3m4o5d6
Revises: o1a2m3o4d5u6
Create Date: 2026-06-25 00:30:00.000000

新增 P2 OA 办公模块数据表：
- expense_request：报销申请
- business_trip_request：出差申请
- purchase_request：采购申请
- asset：企业资产
"""
from alembic import op
import sqlalchemy as sa


revision = 'p2o2a3m4o5d6'
down_revision = 'o1a2m3o4d5u6'
branch_labels = None
depends_on = None


def upgrade():
    # ── 报销申请 ──
    op.create_table(
        'expense_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('expense_type', sa.String(), nullable=False),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('amount_unit', sa.String(), nullable=False, server_default='元'),
        sa.Column('currency', sa.String(), nullable=False, server_default='CNY'),
        sa.Column('expense_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reason', sa.String(), nullable=False, server_default=''),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='草稿'),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('paid_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['paid_by'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_expense_request_user_id', 'expense_request', ['user_id'])
    op.create_index('ix_expense_request_expense_type', 'expense_request', ['expense_type'])
    op.create_index('ix_expense_request_status', 'expense_request', ['status'])

    # ── 出差申请 ──
    op.create_table(
        'business_trip_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('destination', sa.String(), nullable=False),
        sa.Column('start_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('days', sa.Float(), nullable=False, server_default='0'),
        sa.Column('purpose', sa.String(), nullable=False, server_default=''),
        sa.Column('budget', sa.Float(), nullable=False, server_default='0'),
        sa.Column('budget_unit', sa.String(), nullable=False, server_default='元'),
        sa.Column('currency', sa.String(), nullable=False, server_default='CNY'),
        sa.Column('transport', sa.String(), nullable=False, server_default='其他'),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='草稿'),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_business_trip_request_user_id', 'business_trip_request', ['user_id'])
    op.create_index('ix_business_trip_request_status', 'business_trip_request', ['status'])

    # ── 采购申请 ──
    op.create_table(
        'purchase_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('purchase_type', sa.String(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=True),
        sa.Column('items', sa.Text(), nullable=True),
        sa.Column('total_amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('amount_unit', sa.String(), nullable=False, server_default='元'),
        sa.Column('currency', sa.String(), nullable=False, server_default='CNY'),
        sa.Column('reason', sa.String(), nullable=False, server_default=''),
        sa.Column('expected_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='草稿'),
        sa.Column('purchased_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('stored_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['supplier_id'], ['purchase_supplier.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_purchase_request_user_id', 'purchase_request', ['user_id'])
    op.create_index('ix_purchase_request_purchase_type', 'purchase_request', ['purchase_type'])
    op.create_index('ix_purchase_request_supplier_id', 'purchase_request', ['supplier_id'])
    op.create_index('ix_purchase_request_status', 'purchase_request', ['status'])

    # ── 企业资产 ──
    op.create_table(
        'asset',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('asset_no', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=False, server_default='其他'),
        sa.Column('spec', sa.String(), nullable=True),
        sa.Column('purchase_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('purchase_price', sa.Float(), nullable=False, server_default='0'),
        sa.Column('amount_unit', sa.String(), nullable=False, server_default='元'),
        sa.Column('currency', sa.String(), nullable=False, server_default='CNY'),
        sa.Column('status', sa.String(), nullable=False, server_default='在用'),
        sa.Column('location', sa.String(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('supplier_id', sa.Integer(), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['supplier_id'], ['purchase_supplier.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_asset_name', 'asset', ['name'])
    op.create_index('ix_asset_asset_no', 'asset', ['asset_no'])
    op.create_index('ix_asset_category', 'asset', ['category'])
    op.create_index('ix_asset_status', 'asset', ['status'])
    op.create_index('ix_asset_user_id', 'asset', ['user_id'])


def downgrade():
    op.drop_index('ix_asset_user_id', table_name='asset')
    op.drop_index('ix_asset_status', table_name='asset')
    op.drop_index('ix_asset_category', table_name='asset')
    op.drop_index('ix_asset_asset_no', table_name='asset')
    op.drop_index('ix_asset_name', table_name='asset')
    op.drop_table('asset')

    op.drop_index('ix_purchase_request_status', table_name='purchase_request')
    op.drop_index('ix_purchase_request_supplier_id', table_name='purchase_request')
    op.drop_index('ix_purchase_request_purchase_type', table_name='purchase_request')
    op.drop_index('ix_purchase_request_user_id', table_name='purchase_request')
    op.drop_table('purchase_request')

    op.drop_index('ix_business_trip_request_status', table_name='business_trip_request')
    op.drop_index('ix_business_trip_request_user_id', table_name='business_trip_request')
    op.drop_table('business_trip_request')

    op.drop_index('ix_expense_request_status', table_name='expense_request')
    op.drop_index('ix_expense_request_expense_type', table_name='expense_request')
    op.drop_index('ix_expense_request_user_id', table_name='expense_request')
    op.drop_table('expense_request')
