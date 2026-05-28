"""add_rbac_tables_and_usergroup_description

Revision ID: 0878267666e3
Revises: db7f19878733
Create Date: 2026-05-19 16:51:40.329821

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '0878267666e3'
down_revision: Union[str, None] = 'db7f19878733'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 0. 创建部门表（department 表缺少迁移脚本，需在此补充）
    op.create_table('department',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('manager_id', sa.Integer(), nullable=True),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['manager_id'], ['user.id'], ),
        sa.ForeignKeyConstraint(['parent_id'], ['department.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )

    # 1. 创建权限表
    op.create_table('rbac_permission',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('code', sa.String(length=100), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('module', sa.String(length=50), nullable=False),
        sa.Column('action', sa.String(length=50), nullable=False),
        sa.Column('description', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code', name='rbac_permission_code_key'),
    )
    op.create_index(op.f('ix_rbac_permission_code'), 'rbac_permission', ['code'], unique=True)
    op.create_index(op.f('ix_rbac_permission_module'), 'rbac_permission', ['module'], unique=False)

    # 2. 创建角色表
    op.create_table('rbac_role',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('code', sa.String(length=50), nullable=False),
        sa.Column('description', sa.String(length=200), nullable=False),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code', name='rbac_role_code_key'),
    )
    op.create_index(op.f('ix_rbac_role_code'), 'rbac_role', ['code'], unique=True)

    # 3. 创建角色-权限关联表
    op.create_table('rbac_role_permission',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('permission_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['permission_id'], ['rbac_permission.id'], ),
        sa.ForeignKeyConstraint(['role_id'], ['rbac_role.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('role_id', 'permission_id', name='uq_role_perm'),
    )
    op.create_index(op.f('ix_rbac_role_permission_permission_id'), 'rbac_role_permission', ['permission_id'], unique=False)
    op.create_index(op.f('ix_rbac_role_permission_role_id'), 'rbac_role_permission', ['role_id'], unique=False)

    # 4. 创建用户-角色关联表
    op.create_table('rbac_user_role',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['role_id'], ['rbac_role.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'role_id', name='uq_user_role'),
    )
    op.create_index(op.f('ix_rbac_user_role_role_id'), 'rbac_user_role', ['role_id'], unique=False)
    op.create_index(op.f('ix_rbac_user_role_user_id'), 'rbac_user_role', ['user_id'], unique=False)

    # 5. 创建用户组-角色关联表
    op.create_table('rbac_group_role',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['group_id'], ['wiki_user_group.id'], ),
        sa.ForeignKeyConstraint(['role_id'], ['rbac_role.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_rbac_group_role_group_id'), 'rbac_group_role', ['group_id'], unique=False)
    op.create_index(op.f('ix_rbac_group_role_role_id'), 'rbac_group_role', ['role_id'], unique=False)

    # 6. 扩展 wiki_user_group 表增加 description 字段
    op.add_column('wiki_user_group', sa.Column('description', sa.String(length=500), nullable=False, server_default=sa.text("''")))


def downgrade() -> None:
    op.drop_column('wiki_user_group', 'description')
    op.drop_table('rbac_group_role')
    op.drop_table('rbac_user_role')
    op.drop_table('rbac_role_permission')
    op.drop_table('rbac_role')
    op.drop_table('rbac_permission')
    op.drop_table('department')
