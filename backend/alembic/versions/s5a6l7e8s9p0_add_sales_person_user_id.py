"""add sales_person_user_id to project

Revision ID: s5a6l7e8s9p0
Revises: 4b81f3fb3e32
Create Date: 2026-06-28 00:00:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 's5a6l7e8s9p0'
down_revision = '4b81f3fb3e32'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 新增 sales_person_user_id 外键列（销售负责人用户关联）
    op.add_column('project', sa.Column('sales_person_user_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_project_sales_person_user_id_user',
        'project', 'user',
        ['sales_person_user_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_project_sales_person_user_id_user', 'project', type_='foreignkey')
    op.drop_column('project', 'sales_person_user_id')
