"""add_user_id_to_aiprompt

Revision ID: 8700d1fcb0e4
Revises: ba5411e0317b
Create Date: 2026-05-03 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '8700d1fcb0e4'
down_revision: Union[str, None] = 'ba5411e0317b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 添加 user_id 列，默认值为 0（系统默认提示词）
    op.add_column('aiprompt', sa.Column('user_id', sa.Integer(), nullable=False, server_default='0'))
    
    # 删除 task_type 上的唯一索引
    op.drop_index(op.f('ix_aiprompt_task_type'), table_name='aiprompt')
    
    # 创建新的非唯一索引（现在 task_type + user_id 组合唯一）
    op.create_index(op.f('ix_aiprompt_task_type'), 'aiprompt', ['task_type'], unique=False)
    
    # 创建 user_id 索引
    op.create_index(op.f('ix_aiprompt_user_id'), 'aiprompt', ['user_id'], unique=False)


def downgrade() -> None:
    # 删除 user_id 索引
    op.drop_index(op.f('ix_aiprompt_user_id'), table_name='aiprompt')
    
    # 恢复 task_type 唯一索引
    op.drop_index(op.f('ix_aiprompt_task_type'), table_name='aiprompt')
    op.create_index(op.f('ix_aiprompt_task_type'), 'aiprompt', ['task_type'], unique=True)
    
    # 删除 user_id 列
    op.drop_column('aiprompt', 'user_id')
