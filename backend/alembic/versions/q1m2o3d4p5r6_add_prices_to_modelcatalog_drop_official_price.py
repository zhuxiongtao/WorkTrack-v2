"""add price fields to modelcatalog, drop model_official_price

Revision ID: q1m2o3d4p5r6
Revises: p1r2i3c4e5r6
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = "q1m2o3d4p5r6"
down_revision = "p1r2i3c4e5r6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 在 modelcatalog 表加价格列（均可空，手动维护）
    op.add_column("modelcatalog", sa.Column("input_price", sa.Float(), nullable=True))
    op.add_column("modelcatalog", sa.Column("output_price", sa.Float(), nullable=True))
    op.add_column("modelcatalog", sa.Column("cache_read_price", sa.Float(), nullable=True))
    op.add_column("modelcatalog", sa.Column("cache_write_price", sa.Float(), nullable=True))

    # 2. 废弃独立的官网定价表（已合并入 modelcatalog）
    op.drop_table("model_official_price")


def downgrade() -> None:
    # 恢复 model_official_price 表（空表）
    op.create_table(
        "model_official_price",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("model_family", sa.String(30), nullable=False),
        sa.Column("model_name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("input_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("output_price", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cache_read_price", sa.Float(), nullable=True),
        sa.Column("cache_write_price", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(5), nullable=False, server_default="USD"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.drop_column("modelcatalog", "cache_write_price")
    op.drop_column("modelcatalog", "cache_read_price")
    op.drop_column("modelcatalog", "output_price")
    op.drop_column("modelcatalog", "input_price")
