"""enhance_project_fields_and_options

Revision ID: 4b55afe28268
Revises: e5fa48c22824
Create Date: 2026-04-29 11:10:51.687695

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4b55afe28268'
down_revision: Union[str, None] = 'e5fa48c22824'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('fieldoption',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('category', sa.String(), nullable=False),
    sa.Column('value', sa.String(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('project') as batch_op:
        batch_op.add_column(sa.Column('customer_name', sa.String(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('start_date', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('industry', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('sales_person', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('progress', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()))
        batch_op.alter_column('customer_id', existing_type=sa.INTEGER(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('project') as batch_op:
        batch_op.alter_column('customer_id', existing_type=sa.INTEGER(), nullable=False)
        batch_op.drop_column('updated_at')
        batch_op.drop_column('progress')
        batch_op.drop_column('sales_person')
        batch_op.drop_column('industry')
        batch_op.drop_column('start_date')
        batch_op.drop_column('customer_name')
    op.drop_table('fieldoption')
