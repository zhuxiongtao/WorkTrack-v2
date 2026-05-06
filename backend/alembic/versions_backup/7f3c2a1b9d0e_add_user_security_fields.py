"""add_user_security_fields

Revision ID: 7f3c2a1b9d0e
Revises: e5fa48c22824
Create Date: 2026-04-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7f3c2a1b9d0e'
down_revision: Union[str, None] = 'e5fa48c22824'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 为 user 表添加安全相关字段
    op.add_column('user', sa.Column('email', sa.String(120), nullable=True))
    op.add_column('user', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')))
    op.add_column('user', sa.Column('created_at', sa.DateTime(), nullable=True))
    op.add_column('user', sa.Column('updated_at', sa.DateTime(), nullable=True))
    op.add_column('user', sa.Column('last_login_at', sa.DateTime(), nullable=True))
    op.add_column('user', sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('user', sa.Column('locked_until', sa.DateTime(), nullable=True))
    op.add_column('user', sa.Column('token_version', sa.Integer(), nullable=False, server_default=sa.text('1')))


def downgrade() -> None:
    op.drop_column('user', 'token_version')
    op.drop_column('user', 'locked_until')
    op.drop_column('user', 'failed_login_attempts')
    op.drop_column('user', 'last_login_at')
    op.drop_column('user', 'updated_at')
    op.drop_column('user', 'created_at')
    op.drop_column('user', 'is_active')
    op.drop_column('user', 'email')
