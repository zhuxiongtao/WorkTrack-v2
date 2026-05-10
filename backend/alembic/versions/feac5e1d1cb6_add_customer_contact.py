"""add_customer_contact

Revision ID: feac5e1d1cb6
Revises: f9a1b2c3d4e5
Create Date: 2026-05-10 15:01:18.302927

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision: str = 'feac5e1d1cb6'
down_revision: Union[str, None] = 'f9a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('customercontact',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('customer_id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('phone', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('email', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('position', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['customer_id'], ['customer.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_customercontact_customer_id'), 'customercontact', ['customer_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_customercontact_customer_id'), table_name='customercontact')
    op.drop_table('customercontact')
