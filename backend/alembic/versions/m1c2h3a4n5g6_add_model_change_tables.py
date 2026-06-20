"""add model change management tables

Revision ID: m1c2h3a4n5g6
Revises: r3c4o5n6c7i8
Create Date: 2026-06-19

三张表：model_change_event / model_change_stage / model_change_customer_task
"""

from alembic import op
import sqlalchemy as sa

revision = "m1c2h3a4n5g6"
down_revision = "a1p2p3r4o5v6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 变更事件主表 ──────────────────────────────────────────────────────────
    op.create_table(
        "model_change_event",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("change_type", sa.String(30), nullable=False, index=True),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("supplier.id"), nullable=False, index=True),
        sa.Column("channel_ids", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("effective_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(200), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("risk_level", sa.String(10), nullable=False, server_default="medium"),
        sa.Column("affected_projects", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft", index=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # ── 阶段记录 ──────────────────────────────────────────────────────────────
    op.create_table(
        "model_change_stage",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("model_change_event.id"), nullable=False, index=True),
        sa.Column("stage_type", sa.String(30), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending", index=True),
        sa.Column("assigned_to", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("assigned_by", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("action_summary", sa.Text(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("attachments", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("approval_required", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("approver_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approval_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # ── 客户跟进子任务 ────────────────────────────────────────────────────────
    op.create_table(
        "model_change_customer_task",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("model_change_event.id"), nullable=False, index=True),
        sa.Column("stage_id", sa.Integer(), sa.ForeignKey("model_change_stage.id"), nullable=False, index=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customer.id"), nullable=False, index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("project.id"), nullable=True),
        sa.Column("assigned_to", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending", index=True),
        sa.Column("contact_method", sa.String(30), nullable=True),
        sa.Column("contacted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("customer_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("customer_response", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("model_change_customer_task")
    op.drop_table("model_change_stage")
    op.drop_table("model_change_event")
