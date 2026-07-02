"""add_quote_record_table

Revision ID: 47691daa4f41
Revises: m1a2r3k4u5p6
Create Date: 2026-07-01

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '47691daa4f41'
down_revision: Union[str, None] = 'm1a2r3k4u5p6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'quote_record',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=False),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('customer_name', sa.String(), nullable=True),
        sa.Column('valid_days', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('items_json', sa.Text(), nullable=False, server_default="'[]'"),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_quote_record_user_id', 'quote_record', ['user_id'])
    op.create_index('ix_quote_record_expires_at', 'quote_record', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_quote_record_expires_at', table_name='quote_record')
    op.drop_index('ix_quote_record_user_id', table_name='quote_record')
    op.drop_table('quote_record')
