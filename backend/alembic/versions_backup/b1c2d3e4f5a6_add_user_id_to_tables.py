"""add_user_id_to_tables

Revision ID: b1c2d3e4f5a6
Revises: a45e53731f5b
Create Date: 2026-04-30 12:00:00.000000

为 project/customer/meetingnote/chatconversation/weeklysummary/systempreference 添加 user_id 列
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a45e53731f5b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # project
    with op.batch_alter_table('project') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.create_index('ix_project_user_id', ['user_id'])

    # customer
    with op.batch_alter_table('customer') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.create_index('ix_customer_user_id', ['user_id'])

    # meetingnote
    with op.batch_alter_table('meetingnote') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.create_index('ix_meetingnote_user_id', ['user_id'])

    # chatconversation
    with op.batch_alter_table('chatconversation') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.create_index('ix_chatconversation_user_id', ['user_id'])

    # weeklysummary
    with op.batch_alter_table('weeklysummary') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.create_index('ix_weeklysummary_user_id', ['user_id'])

    # systempreference - user_id 可为空（全局设置），移除 key 的 unique 约束（改为 key+user_id 组合唯一）
    with op.batch_alter_table('systempreference') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.create_index('ix_systempreference_user_id', ['user_id'])
        # SQLite 不支持直接删除唯一约束，跳过


def downgrade() -> None:
    tables = ['project', 'customer', 'meetingnote', 'chatconversation', 'weeklysummary']
    for table in tables:
        with op.batch_alter_table(table) as batch_op:
            batch_op.drop_index(f'ix_{table}_user_id')
            batch_op.drop_column('user_id')

    with op.batch_alter_table('systempreference') as batch_op:
        batch_op.drop_index('ix_systempreference_user_id')
        batch_op.drop_column('user_id')
