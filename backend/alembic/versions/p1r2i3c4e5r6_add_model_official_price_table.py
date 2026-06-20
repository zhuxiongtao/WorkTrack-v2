"""add model_official_price table with seed data

Revision ID: p1r2i3c4e5r6
Revises: m1c2h3a4n5g6
Create Date: 2026-06-19
"""
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa

revision = "p1r2i3c4e5r6"
down_revision = "m1c2h3a4n5g6"
branch_labels = None
depends_on = None

NOW = datetime.now(timezone.utc)

# 种子数据：主流模型官网定价（USD / 1M tokens，截至 2026-06）
# 来源：各家官网 Pricing 页
SEED = [
    # ── Anthropic Claude ──────────────────────────────────────────────────────
    ("claude", "claude-opus-4-5-20251001",  "Claude Opus 4.5",   15.0,  75.0,  1.5,   18.75, "https://www.anthropic.com/pricing"),
    ("claude", "claude-sonnet-4-5-20251015","Claude Sonnet 4.5",  3.0,  15.0,  0.3,    3.75, "https://www.anthropic.com/pricing"),
    ("claude", "claude-haiku-4-5-20251001", "Claude Haiku 4.5",   0.8,   4.0,  0.08,   1.0,  "https://www.anthropic.com/pricing"),
    ("claude", "claude-opus-4-8",           "Claude Opus 4.8",   15.0,  75.0,  1.5,   18.75, "https://www.anthropic.com/pricing"),

    # ── OpenAI GPT ────────────────────────────────────────────────────────────
    ("gpt",    "gpt-4o",                    "GPT-4o",             2.5,  10.0,  1.25,   5.0,  "https://openai.com/pricing"),
    ("gpt",    "gpt-4o-mini",               "GPT-4o mini",        0.15,  0.6,  0.075,  0.3,  "https://openai.com/pricing"),
    ("gpt",    "o1",                        "o1",                15.0,  60.0,  None,  None,   "https://openai.com/pricing"),
    ("gpt",    "o1-mini",                   "o1-mini",            3.0,  12.0,  None,  None,   "https://openai.com/pricing"),
    ("gpt",    "o3",                        "o3",                10.0,  40.0,  None,  None,   "https://openai.com/pricing"),
    ("gpt",    "o4-mini",                   "o4-mini",            1.1,   4.4,  None,  None,   "https://openai.com/pricing"),

    # ── Google Gemini ─────────────────────────────────────────────────────────
    ("gemini", "gemini-2.5-pro",            "Gemini 2.5 Pro",     1.25,  10.0, None,  None,   "https://ai.google.dev/pricing"),
    ("gemini", "gemini-2.5-flash",          "Gemini 2.5 Flash",   0.3,   2.5, None,  None,   "https://ai.google.dev/pricing"),
    ("gemini", "gemini-2.5-flash-lite",     "Gemini 2.5 Flash Lite", 0.1, 0.4, None, None,   "https://ai.google.dev/pricing"),
    ("gemini", "gemini-2.0-flash",          "Gemini 2.0 Flash",   0.1,   0.4, None,  None,   "https://ai.google.dev/pricing"),
    ("gemini", "gemini-1.5-pro",            "Gemini 1.5 Pro",     1.25,  5.0, None,  None,   "https://ai.google.dev/pricing"),
    ("gemini", "gemini-1.5-flash",          "Gemini 1.5 Flash",   0.075, 0.3, None,  None,   "https://ai.google.dev/pricing"),

    # ── DeepSeek ──────────────────────────────────────────────────────────────
    ("deepseek", "deepseek-chat",           "DeepSeek-V3",        0.27,  1.1, None,  None,   "https://platform.deepseek.com/pricing"),
    ("deepseek", "deepseek-reasoner",       "DeepSeek-R1",        0.55,  2.19,None,  None,   "https://platform.deepseek.com/pricing"),
]


def upgrade() -> None:
    op.create_table(
        "model_official_price",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("model_family", sa.String(30), nullable=False, index=True),
        sa.Column("model_name", sa.String(100), nullable=False, index=True),
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

    # 写入种子数据
    price_table = sa.table(
        "model_official_price",
        sa.column("model_family", sa.String),
        sa.column("model_name", sa.String),
        sa.column("display_name", sa.String),
        sa.column("input_price", sa.Float),
        sa.column("output_price", sa.Float),
        sa.column("cache_read_price", sa.Float),
        sa.column("cache_write_price", sa.Float),
        sa.column("currency", sa.String),
        sa.column("is_active", sa.Boolean),
        sa.column("source_url", sa.String),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    op.bulk_insert(price_table, [
        {
            "model_family": row[0],
            "model_name": row[1],
            "display_name": row[2],
            "input_price": row[3],
            "output_price": row[4],
            "cache_read_price": row[5],
            "cache_write_price": row[6],
            "currency": "USD",
            "is_active": True,
            "source_url": row[7],
            "created_at": NOW,
            "updated_at": NOW,
        }
        for row in SEED
    ])


def downgrade() -> None:
    op.drop_table("model_official_price")
