"""remove payment draft concept: server_default 草稿 -> 待完善, purge leftover draft rows

Revision ID: p2n3o4d5r6a7
Revises: c1h2a3n4u5r6
Create Date: 2026-07-02
"""
from alembic import op
import sqlalchemy as sa

revision = "p2n3o4d5r6a7"
down_revision = "c1h2a3n4u5r6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 用户创建的付款申请不再有「草稿」中间态，历史遗留的草稿从未真正提交审批，直接清理
    op.execute("DELETE FROM payment_request WHERE status = '草稿'")
    # 列默认值改为「待完善」（仅用于系统自动生成的存根，如加班费待填金额）
    op.alter_column(
        "payment_request", "status",
        server_default="待完善",
        existing_type=sa.String(length=20),
    )


def downgrade() -> None:
    op.alter_column(
        "payment_request", "status",
        server_default="草稿",
        existing_type=sa.String(length=20),
    )
