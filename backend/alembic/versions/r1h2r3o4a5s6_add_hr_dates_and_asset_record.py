"""add HR dates to user + asset_record table

Revision ID: r1h2r3o4a5s6
Revises: p2o2a3m4o5d6
Create Date: 2026-06-25 12:00:00.000000

- user 表新增 first_work_date（参加工作日期，法定累计工龄→年假档位）、hire_date（本公司入职日期）
- asset_record：资产履历（领用/归还/调拨/维修/报废全程留痕）

幂等实现：init_db 运行时补丁可能已提前用 ALTER ... ADD COLUMN IF NOT EXISTS
加好这两列，故此处先检查再操作，避免 DuplicateColumn。
"""
from alembic import op
import sqlalchemy as sa


revision = 'r1h2r3o4a5s6'
down_revision = 'p2o2a3m4o5d6'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # ── user：HR 档案日期（若已被 init_db 补丁添加则跳过）──
    user_cols = {c["name"] for c in inspector.get_columns("user")}
    if "first_work_date" not in user_cols:
        op.add_column("user", sa.Column("first_work_date", sa.Date(), nullable=True))
    if "hire_date" not in user_cols:
        op.add_column("user", sa.Column("hire_date", sa.Date(), nullable=True))

    # ── 资产履历 ──
    if "asset_record" not in inspector.get_table_names():
        op.create_table(
            'asset_record',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('asset_id', sa.Integer(), nullable=False),
            # 领用 / 归还 / 调拨 / 维修 / 报废 / 入库
            sa.Column('action', sa.String(), nullable=False),
            sa.Column('from_user_id', sa.Integer(), nullable=True),
            sa.Column('to_user_id', sa.Integer(), nullable=True),
            sa.Column('operator_id', sa.Integer(), nullable=True),
            sa.Column('from_status', sa.String(), nullable=True),
            sa.Column('to_status', sa.String(), nullable=True),
            sa.Column('note', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
            sa.ForeignKeyConstraint(['from_user_id'], ['user.id'], ),
            sa.ForeignKeyConstraint(['to_user_id'], ['user.id'], ),
            sa.ForeignKeyConstraint(['operator_id'], ['user.id'], ),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_asset_record_asset_id', 'asset_record', ['asset_id'])


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "asset_record" in inspector.get_table_names():
        op.drop_index('ix_asset_record_asset_id', table_name='asset_record')
        op.drop_table('asset_record')
    user_cols = {c["name"] for c in inspector.get_columns("user")}
    if "hire_date" in user_cols:
        op.drop_column('user', 'hire_date')
    if "first_work_date" in user_cols:
        op.drop_column('user', 'first_work_date')
