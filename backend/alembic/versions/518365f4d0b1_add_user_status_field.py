"""add_user_status_field

Revision ID: 518365f4d0b1
Revises: 452a9171f16b
Create Date: 2026-05-22 10:33:25.066663

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '518365f4d0b1'
down_revision: Union[str, None] = '452a9171f16b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 添加 status 字段
    op.add_column('user', sa.Column('status', sa.String(length=20), nullable=True))
    # 现有数据：is_active=True → 'active', is_active=False → 'disabled'
    op.execute("UPDATE \"user\" SET status = 'active' WHERE is_active = true")
    op.execute("UPDATE \"user\" SET status = 'disabled' WHERE is_active = false")
    # 设置 NOT NULL 和默认值
    op.alter_column('user', 'status', nullable=False, server_default='active')


def downgrade() -> None:
    op.drop_column('user', 'status')
