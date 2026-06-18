"""add_approval_tables

Revision ID: a1p2p3r4o5v6
Revises: m0d1e2l3c4t5
Create Date: 2026-06-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

# revision identifiers, used by Alembic.
revision: str = 'a1p2p3r4o5v6'
down_revision: Union[str, None] = 'm0d1e2l3c4t5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. approval_flow 审批模板
    op.create_table('approval_flow',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('business_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False),
        sa.Column('trigger_condition', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('nodes', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
    )
    op.create_index(op.f('ix_approval_flow_code'), 'approval_flow', ['code'], unique=True)
    op.create_index(op.f('ix_approval_flow_business_type'), 'approval_flow', ['business_type'], unique=False)

    # 2. approval_instance 审批实例
    op.create_table('approval_instance',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('flow_id', sa.Integer(), nullable=False),
        sa.Column('flow_code', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('target_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('current_node_index', sa.Integer(), nullable=False),
        sa.Column('nodes_snapshot', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('submitted_by', sa.Integer(), nullable=False),
        sa.Column('submitted_at', sa.DateTime(), nullable=False),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['flow_id'], ['approval_flow.id']),
        sa.ForeignKeyConstraint(['submitted_by'], ['user.id']),
    )
    op.create_index(op.f('ix_approval_instance_flow_id'), 'approval_instance', ['flow_id'], unique=False)
    op.create_index(op.f('ix_approval_instance_target_type'), 'approval_instance', ['target_type'], unique=False)
    op.create_index(op.f('ix_approval_instance_target_id'), 'approval_instance', ['target_id'], unique=False)
    op.create_index(op.f('ix_approval_instance_status'), 'approval_instance', ['status'], unique=False)
    op.create_index(op.f('ix_approval_instance_submitted_by'), 'approval_instance', ['submitted_by'], unique=False)

    # 3. approval_record 审批留痕
    op.create_table('approval_record',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('instance_id', sa.Integer(), nullable=False),
        sa.Column('node_index', sa.Integer(), nullable=False),
        sa.Column('node_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('approver_id', sa.Integer(), nullable=False),
        sa.Column('action', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('comment', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['instance_id'], ['approval_instance.id']),
        sa.ForeignKeyConstraint(['approver_id'], ['user.id']),
    )
    op.create_index(op.f('ix_approval_record_instance_id'), 'approval_record', ['instance_id'], unique=False)
    op.create_index(op.f('ix_approval_record_approver_id'), 'approval_record', ['approver_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_approval_record_approver_id'), table_name='approval_record')
    op.drop_index(op.f('ix_approval_record_instance_id'), table_name='approval_record')
    op.drop_table('approval_record')
    op.drop_index(op.f('ix_approval_instance_submitted_by'), table_name='approval_instance')
    op.drop_index(op.f('ix_approval_instance_status'), table_name='approval_instance')
    op.drop_index(op.f('ix_approval_instance_target_id'), table_name='approval_instance')
    op.drop_index(op.f('ix_approval_instance_target_type'), table_name='approval_instance')
    op.drop_index(op.f('ix_approval_instance_flow_id'), table_name='approval_instance')
    op.drop_table('approval_instance')
    op.drop_index(op.f('ix_approval_flow_business_type'), table_name='approval_flow')
    op.drop_index(op.f('ix_approval_flow_code'), table_name='approval_flow')
    op.drop_table('approval_flow')
