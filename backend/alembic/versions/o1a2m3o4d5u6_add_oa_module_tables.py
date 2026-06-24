"""add OA module tables: purchase_supplier, leave_balance, leave_balance_log, leave_request, overtime_request

Revision ID: o1a2m3o4d5u6
Revises: c1o2n3t4y5p6
Create Date: 2026-06-24 23:00:00.000000

新增 OA 办公模块全部数据表：
- purchase_supplier：采购供应商（独立于 MaaS 模型供应商）
- leave_balance / leave_balance_log：假期额度账户与变动日志
- leave_request：请假申请
- overtime_request：加班申请
"""
from alembic import op
import sqlalchemy as sa


revision = 'o1a2m3o4d5u6'
down_revision = 'c1o2n3t4y5p6'
branch_labels = None
depends_on = None


def upgrade():
    # ── 采购供应商 ──
    op.create_table(
        'purchase_supplier',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('short_name', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=False, server_default='其他'),
        sa.Column('status', sa.String(), nullable=False, server_default='合作中'),
        sa.Column('contact_person', sa.String(), nullable=True),
        sa.Column('contact_phone', sa.String(), nullable=True),
        sa.Column('contact_email', sa.String(), nullable=True),
        sa.Column('address', sa.String(), nullable=True),
        sa.Column('bank_name', sa.String(), nullable=True),
        sa.Column('bank_account', sa.String(), nullable=True),
        sa.Column('tax_no', sa.String(), nullable=True),
        sa.Column('invoice_title', sa.String(), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_purchase_supplier_name', 'purchase_supplier', ['name'])
    op.create_index('ix_purchase_supplier_status', 'purchase_supplier', ['status'])

    # ── 假期额度账户 ──
    op.create_table(
        'leave_balance',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('leave_type', sa.String(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('used_hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_leave_balance_user_id', 'leave_balance', ['user_id'])
    op.create_index('ix_leave_balance_leave_type', 'leave_balance', ['leave_type'])
    op.create_index('ix_leave_balance_year', 'leave_balance', ['year'])
    # 同一用户同一年度同一假期类型唯一
    op.create_index(
        'ix_leave_balance_user_type_year',
        'leave_balance',
        ['user_id', 'leave_type', 'year'],
        unique=True,
    )

    # ── 额度变动日志 ──
    op.create_table(
        'leave_balance_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('balance_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('leave_type', sa.String(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('change_type', sa.String(), nullable=False),
        sa.Column('change_hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('reason', sa.String(), nullable=False, server_default=''),
        sa.Column('operator_id', sa.Integer(), nullable=True),
        sa.Column('related_request_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['balance_id'], ['leave_balance.id']),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['operator_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_leave_balance_log_balance_id', 'leave_balance_log', ['balance_id'])
    op.create_index('ix_leave_balance_log_user_id', 'leave_balance_log', ['user_id'])

    # ── 请假申请 ──
    op.create_table(
        'leave_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('leave_type', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('start_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('reason', sa.String(), nullable=False, server_default=''),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='草稿'),
        sa.Column('actual_end_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_leave_request_user_id', 'leave_request', ['user_id'])
    op.create_index('ix_leave_request_leave_type', 'leave_request', ['leave_type'])
    op.create_index('ix_leave_request_status', 'leave_request', ['status'])

    # ── 加班申请 ──
    op.create_table(
        'overtime_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('start_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('reason', sa.String(), nullable=False, server_default=''),
        sa.Column('compensate_type', sa.String(), nullable=False, server_default='调休'),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='草稿'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_overtime_request_user_id', 'overtime_request', ['user_id'])
    op.create_index('ix_overtime_request_status', 'overtime_request', ['status'])


def downgrade():
    op.drop_index('ix_overtime_request_status', table_name='overtime_request')
    op.drop_index('ix_overtime_request_user_id', table_name='overtime_request')
    op.drop_table('overtime_request')

    op.drop_index('ix_leave_request_status', table_name='leave_request')
    op.drop_index('ix_leave_request_leave_type', table_name='leave_request')
    op.drop_index('ix_leave_request_user_id', table_name='leave_request')
    op.drop_table('leave_request')

    op.drop_index('ix_leave_balance_log_user_id', table_name='leave_balance_log')
    op.drop_index('ix_leave_balance_log_balance_id', table_name='leave_balance_log')
    op.drop_table('leave_balance_log')

    op.drop_index('ix_leave_balance_user_type_year', table_name='leave_balance')
    op.drop_index('ix_leave_balance_year', table_name='leave_balance')
    op.drop_index('ix_leave_balance_leave_type', table_name='leave_balance')
    op.drop_index('ix_leave_balance_user_id', table_name='leave_balance')
    op.drop_table('leave_balance')

    op.drop_index('ix_purchase_supplier_status', table_name='purchase_supplier')
    op.drop_index('ix_purchase_supplier_name', table_name='purchase_supplier')
    op.drop_table('purchase_supplier')
