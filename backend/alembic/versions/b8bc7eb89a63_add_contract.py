"""add_contract

Revision ID: b8bc7eb89a63
Revises: feac5e1d1cb6
Create Date: 2026-05-10 15:09:57.301373

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision: str = 'b8bc7eb89a63'
down_revision: Union[str, None] = 'feac5e1d1cb6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('contract',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('customer_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('contract_no', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('file_path', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('file_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('file_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('sign_date', sa.Date(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('party_a', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('party_b', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('contract_amount', sa.Float(), nullable=True),
        sa.Column('currency', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('payment_terms', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('key_clauses', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('summary', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('raw_text', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('remarks', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.ForeignKeyConstraint(['customer_id'], ['customer.id'], ),
        sa.ForeignKeyConstraint(['project_id'], ['project.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_contract_user_id'), 'contract', ['user_id'], unique=False)
    op.create_index(op.f('ix_contract_customer_id'), 'contract', ['customer_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_contract_customer_id'), table_name='contract')
    op.drop_index(op.f('ix_contract_user_id'), table_name='contract')
    op.drop_table('contract')
