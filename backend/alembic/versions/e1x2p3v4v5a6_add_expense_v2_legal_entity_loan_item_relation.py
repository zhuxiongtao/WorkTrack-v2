"""add expense v2: legal_entity, employee_loan, expense_item, expense_relation; extend expense_request

Revision ID: e1x2p3v4v5a6
Revises: r1h2r3o4a5s6
Create Date: 2026-06-26 18:00:00.000000

报销申请重构（V2）：
- 新增 legal_entity：公司主体（我方名义）
- 新增 employee_loan：员工借款台账
- 新增 expense_item：报销明细（升级从 JSON 到独立表）
- 新增 expense_relation：通用关联申请单（多对多）
- 扩展 expense_request：
  - invoice_entity_id、priority_offset_loan、offset_loan_amount
  - account_balance、company_should_pay、actual_pay_amount、company_owes_personal
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = 'e1x2p3v4v5a6'
down_revision = 'r1h2r3o4a5s6'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. 公司主体（我方名义） ──
    op.create_table(
        'legal_entity',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('short_name', sa.String(length=50), nullable=False),
        sa.Column('tax_id', sa.String(length=50), nullable=True),
        sa.Column('balance', sa.Float(), nullable=False, server_default='0'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_legal_entity_name', 'legal_entity', ['name'])
    op.create_index('ix_legal_entity_is_active', 'legal_entity', ['is_active'])

    # ── 2. 员工借款台账 ──
    op.create_table(
        'employee_loan',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('entity_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('used_amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('remaining', sa.Float(), nullable=False, server_default='0'),
        sa.Column('loan_date', sa.Date(), nullable=False),
        sa.Column('reason', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='借款中'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['entity_id'], ['legal_entity.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_employee_loan_user_id', 'employee_loan', ['user_id'])
    op.create_index('ix_employee_loan_entity_id', 'employee_loan', ['entity_id'])
    op.create_index('ix_employee_loan_status', 'employee_loan', ['status'])

    # ── 3. 报销明细（独立表） ──
    op.create_table(
        'expense_item',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('expense_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False, server_default=''),
        sa.Column('expense_type', sa.String(length=50), nullable=False, server_default='其他'),
        sa.Column('department_id', sa.Integer(), nullable=True),
        sa.Column('city', sa.String(length=50), nullable=False, server_default=''),
        sa.Column('expense_date', sa.Date(), nullable=True),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('note', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('remark', sa.String(length=500), nullable=False, server_default=''),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['expense_id'], ['expense_request.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['department.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_expense_item_expense_id', 'expense_item', ['expense_id'])
    op.create_index('ix_expense_item_expense_type', 'expense_item', ['expense_type'])

    # ── 4. 通用关联申请单 ──
    op.create_table(
        'expense_relation',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('expense_id', sa.Integer(), nullable=False),
        sa.Column('target_type', sa.String(length=30), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('relation_note', sa.String(length=200), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['expense_id'], ['expense_request.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_expense_relation_expense_id', 'expense_relation', ['expense_id'])
    op.create_index('ix_expense_relation_target', 'expense_relation', ['target_type', 'target_id'])

    # ── 5. 扩展 expense_request 字段 ──
    op.add_column('expense_request', sa.Column('invoice_entity_id', sa.Integer(), nullable=True))
    op.add_column('expense_request', sa.Column('priority_offset_loan', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('expense_request', sa.Column('offset_loan_amount', sa.Float(), nullable=False, server_default='0'))
    op.add_column('expense_request', sa.Column('account_balance', sa.Float(), nullable=False, server_default='0'))
    op.add_column('expense_request', sa.Column('company_should_pay', sa.Float(), nullable=False, server_default='0'))
    op.add_column('expense_request', sa.Column('actual_pay_amount', sa.Float(), nullable=False, server_default='0'))
    op.add_column('expense_request', sa.Column('company_owes_personal', sa.Float(), nullable=False, server_default='0'))
    op.create_foreign_key(
        'fk_expense_request_invoice_entity',
        'expense_request', 'legal_entity',
        ['invoice_entity_id'], ['id'],
    )
    op.create_index('ix_expense_request_invoice_entity_id', 'expense_request', ['invoice_entity_id'])

    # ── 6. 数据回填：把旧 items JSON 解析后写进 expense_item；把旧 trip_id 写进 expense_relation ──
    bind = op.get_bind()
    rows = bind.execute(text("SELECT id, items, trip_id, amount FROM expense_request")).fetchall()
    for row in rows:
        expense_id, items_json, trip_id, fallback_amount = row
        if items_json:
            try:
                import json
                items = json.loads(items_json)
                for idx, it in enumerate(items or []):
                    if not isinstance(it, dict):
                        continue
                    bind.execute(text(
                        "INSERT INTO expense_item (expense_id, name, expense_type, department_id, city, expense_date, amount, note, remark, attachments, sort_order, created_at, updated_at) "
                        "VALUES (:eid, :n, :t, NULL, :c, NULL, :a, :nt, :rk, NULL, :ord, NOW(), NOW())"
                    ), {
                        'eid': expense_id,
                        'n': str(it.get('name', '') or it.get('description', '') or '')[:100],
                        't': str(it.get('expense_type', '') or it.get('type', '') or '其他')[:50],
                        'c': str(it.get('city', '') or '')[:50],
                        'a': float(it.get('amount', 0) or 0),
                        'nt': str(it.get('note', '') or it.get('description', '') or '')[:500],
                        'rk': str(it.get('remark', '') or '')[:500],
                        'ord': idx,
                    })
            except Exception as e:
                print(f"[migration] expense {expense_id} items JSON parse failed: {e}")
        if trip_id:
            bind.execute(text(
                "INSERT INTO expense_relation (expense_id, target_type, target_id, relation_note, created_at) "
                "VALUES (:eid, 'business_trip', :tid, '从 trip_id 字段迁移', NOW())"
            ), {'eid': expense_id, 'tid': trip_id})


def downgrade():
    op.drop_index('ix_expense_request_invoice_entity_id', table_name='expense_request')
    op.drop_constraint('fk_expense_request_invoice_entity', 'expense_request', type_='foreignkey')
    op.drop_column('expense_request', 'company_owes_personal')
    op.drop_column('expense_request', 'actual_pay_amount')
    op.drop_column('expense_request', 'company_should_pay')
    op.drop_column('expense_request', 'account_balance')
    op.drop_column('expense_request', 'offset_loan_amount')
    op.drop_column('expense_request', 'priority_offset_loan')
    op.drop_column('expense_request', 'invoice_entity_id')

    op.drop_index('ix_expense_relation_target', table_name='expense_relation')
    op.drop_index('ix_expense_relation_expense_id', table_name='expense_relation')
    op.drop_table('expense_relation')

    op.drop_index('ix_expense_item_expense_type', table_name='expense_item')
    op.drop_index('ix_expense_item_expense_id', table_name='expense_item')
    op.drop_table('expense_item')

    op.drop_index('ix_employee_loan_status', table_name='employee_loan')
    op.drop_index('ix_employee_loan_entity_id', table_name='employee_loan')
    op.drop_index('ix_employee_loan_user_id', table_name='employee_loan')
    op.drop_table('employee_loan')

    op.drop_index('ix_legal_entity_is_active', table_name='legal_entity')
    op.drop_index('ix_legal_entity_name', table_name='legal_entity')
    op.drop_table('legal_entity')
