"""rename_industry_to_product_add_project_scenario

Revision ID: d1e2f3a4b5c6
Revises: c8d9e0f1a2b3
Create Date: 2026-04-30 20:00:00.000000

将 project 表 industry 列重命名为 product，新增 project_scenario 列
同时更新 field_option 表中 category 从 industry 改为 product
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 重命名 industry 列为 product
    with op.batch_alter_table('project') as batch_op:
        batch_op.alter_column('industry', new_column_name='product')
        batch_op.add_column(sa.Column('project_scenario', sa.String(), nullable=True))

    # 更新 fieldoption 表中 industry 分类为 product
    op.execute("UPDATE fieldoption SET category = 'product' WHERE category = 'industry'")


def downgrade() -> None:
    # 还原 fieldoption 分类
    op.execute("UPDATE fieldoption SET category = 'industry' WHERE category = 'product'")

    with op.batch_alter_table('project') as batch_op:
        batch_op.drop_column('project_scenario')
        batch_op.alter_column('product', new_column_name='industry')
