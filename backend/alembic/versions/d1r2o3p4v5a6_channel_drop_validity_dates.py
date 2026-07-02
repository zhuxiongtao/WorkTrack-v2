"""channel: drop valid_from/valid_until, status derived from supplier contract

Revision ID: d1r2o3p4v5a6
Revises: y1c2h3a4n5n6
Create Date: 2026-07-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd1r2o3p4v5a6'
down_revision = 'y1c2h3a4n5n6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('channel') as batch_op:
        batch_op.drop_column('valid_from')
        batch_op.drop_column('valid_until')


def downgrade():
    with op.batch_alter_table('channel') as batch_op:
        batch_op.add_column(sa.Column('valid_from', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('valid_until', sa.String(), nullable=True))
