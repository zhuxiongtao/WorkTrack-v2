"""create payment_request + seal_request tables, fix contract approval flow

Revision ID: p1a2y3s4e5a6
Revises: f1e2e3d4b5a6
Create Date: 2026-06-23 14:00:00.000000

新增「付款申请」「盖章申请」两张业务表；并把系统预置的合同审批流（contract_approval）
节点更新为真实流程：部门负责人/分管领导 → 法务初审 → 财务初审 → 总经理 → 盖章。
仅当该流程仍是旧的默认三节点（法务→财务→总经理、未被管理员改过）时才更新，避免覆盖自定义。
"""
import json
from alembic import op
import sqlalchemy as sa

revision = 'p1a2y3s4e5a6'
down_revision = 'f1e2e3d4b5a6'
branch_labels = None
depends_on = None


# 旧默认（未改动判定基准）
_OLD_CONTRACT_NODES = [
    {"name": "法务审查", "approver_type": "role", "approver_value": "legal", "order": 1},
    {"name": "财务审批", "approver_type": "role", "approver_value": "finance", "order": 2},
    {"name": "总经理审批", "approver_type": "role", "approver_value": "boss", "order": 3},
]
# 新流程
_NEW_CONTRACT_NODES = [
    {"name": "部门负责人/分管领导", "approver_type": "dept_or_leader", "approver_value": "", "order": 1},
    {"name": "法务初审", "approver_type": "role", "approver_value": "legal", "order": 2},
    {"name": "财务初审", "approver_type": "role", "approver_value": "finance", "order": 3},
    {"name": "总经理审批", "approver_type": "role", "approver_value": "boss", "order": 4},
    {"name": "盖章", "approver_type": "role", "approver_value": "seal_keeper", "order": 5,
     "node_kind": "execution", "action_label": "确认盖章"},
]


def upgrade():
    op.create_table(
        'payment_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('payment_type', sa.String(), nullable=False, server_default='其他'),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('currency', sa.String(), nullable=False, server_default='CNY'),
        sa.Column('payee', sa.String(), nullable=False, server_default=''),
        sa.Column('payee_account', sa.String(), nullable=True),
        sa.Column('reason', sa.String(), nullable=False, server_default=''),
        sa.Column('contract_id', sa.Integer(), nullable=True),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='草稿'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['contract_id'], ['contract.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_payment_request_user_id', 'payment_request', ['user_id'])
    op.create_index('ix_payment_request_payment_type', 'payment_request', ['payment_type'])
    op.create_index('ix_payment_request_status', 'payment_request', ['status'])
    op.create_index('ix_payment_request_contract_id', 'payment_request', ['contract_id'])

    op.create_table(
        'seal_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('seal_type', sa.String(), nullable=False, server_default='公章'),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('reason', sa.String(), nullable=False, server_default=''),
        sa.Column('copies', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('is_contract_related', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('contract_id', sa.Integer(), nullable=True),
        sa.Column('attachments', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='草稿'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['contract_id'], ['contract.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_seal_request_user_id', 'seal_request', ['user_id'])
    op.create_index('ix_seal_request_seal_type', 'seal_request', ['seal_type'])
    op.create_index('ix_seal_request_status', 'seal_request', ['status'])
    op.create_index('ix_seal_request_contract_id', 'seal_request', ['contract_id'])

    # 合同审批流订正（仅在未被管理员改动时）
    conn = op.get_bind()
    row = conn.execute(sa.text(
        "SELECT id, nodes FROM approval_flow WHERE code = 'contract_approval'"
    )).fetchone()
    if row:
        try:
            current = json.loads(row[1] or "[]")
        except (TypeError, ValueError):
            current = None
        if current == _OLD_CONTRACT_NODES:
            conn.execute(
                sa.text(
                    "UPDATE approval_flow SET nodes = :nodes, "
                    "description = :desc WHERE id = :id"
                ),
                {
                    "nodes": json.dumps(_NEW_CONTRACT_NODES, ensure_ascii=False),
                    "desc": "合同提交后依次经部门负责人/分管领导、法务初审、财务初审、总经理审批，最后用印盖章方可生效",
                    "id": row[0],
                },
            )


def downgrade():
    conn = op.get_bind()
    row = conn.execute(sa.text(
        "SELECT id, nodes FROM approval_flow WHERE code = 'contract_approval'"
    )).fetchone()
    if row:
        try:
            current = json.loads(row[1] or "[]")
        except (TypeError, ValueError):
            current = None
        if current == _NEW_CONTRACT_NODES:
            conn.execute(
                sa.text("UPDATE approval_flow SET nodes = :nodes WHERE id = :id"),
                {"nodes": json.dumps(_OLD_CONTRACT_NODES, ensure_ascii=False), "id": row[0]},
            )

    op.drop_index('ix_seal_request_contract_id', table_name='seal_request')
    op.drop_index('ix_seal_request_status', table_name='seal_request')
    op.drop_index('ix_seal_request_seal_type', table_name='seal_request')
    op.drop_index('ix_seal_request_user_id', table_name='seal_request')
    op.drop_table('seal_request')

    op.drop_index('ix_payment_request_contract_id', table_name='payment_request')
    op.drop_index('ix_payment_request_status', table_name='payment_request')
    op.drop_index('ix_payment_request_payment_type', table_name='payment_request')
    op.drop_index('ix_payment_request_user_id', table_name='payment_request')
    op.drop_table('payment_request')
