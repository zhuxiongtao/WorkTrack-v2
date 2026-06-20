"""add_contract_template_and_signed_fields

Revision ID: s1c2o3n4t5r6
Revises: r3c4o5n6c7i8
Create Date: 2026-06-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

revision: str = 's1c2o3n4t5r6'
down_revision: Union[str, None] = 'q1m2o3d4p5r6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 新建合同模板表
    op.create_table(
        'contract_template',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('category', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
        sa.Column('content', sa.Text(), nullable=False, server_default=''),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )

    # Contract 表新增字段
    op.add_column('contract', sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='external'))
    op.add_column('contract', sa.Column('template_id', sa.Integer(), nullable=True))
    op.add_column('contract', sa.Column('content_html', sa.Text(), nullable=True))
    op.add_column('contract', sa.Column('signed_file_path', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('signed_file_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))


def downgrade() -> None:
    op.drop_column('contract', 'signed_file_name')
    op.drop_column('contract', 'signed_file_path')
    op.drop_column('contract', 'content_html')
    op.drop_column('contract', 'template_id')
    op.drop_column('contract', 'source')
    op.drop_table('contract_template')
