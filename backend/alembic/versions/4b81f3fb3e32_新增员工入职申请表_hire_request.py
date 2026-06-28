"""新增员工入职申请表 hire_request

Revision ID: 4b81f3fb3e32
Revises: b1a2c3k4u5p6
Create Date: 2026-06-27 23:15:53.357230

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision: str = '4b81f3fb3e32'
down_revision: Union[str, None] = 'b1a2c3k4u5p6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 新增员工入职申请表
    op.create_table('hire_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('candidate_name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('candidate_username', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.Column('candidate_email', sqlmodel.sql.sqltypes.AutoString(length=120), nullable=False),
        sa.Column('candidate_phone', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=True),
        sa.Column('job_title', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column('department_id', sa.Integer(), nullable=True),
        sa.Column('leader_id', sa.Integer(), nullable=True),
        sa.Column('first_work_date', sa.Date(), nullable=True),
        sa.Column('hire_date', sa.Date(), nullable=False),
        sa.Column('is_admin', sa.Boolean(), nullable=False),
        sa.Column('use_shared_models', sa.Boolean(), nullable=False),
        sa.Column('salary', sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column('reason', sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=False),
        sa.Column('attachments', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column('created_user_id', sa.Integer(), nullable=True),
        sa.Column('onboarded_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_user_id'], ['user.id']),
        sa.ForeignKeyConstraint(['department_id'], ['department.id']),
        sa.ForeignKeyConstraint(['leader_id'], ['user.id']),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_hire_request_candidate_username'), 'hire_request', ['candidate_username'], unique=False)
    op.create_index(op.f('ix_hire_request_department_id'), 'hire_request', ['department_id'], unique=False)
    op.create_index(op.f('ix_hire_request_status'), 'hire_request', ['status'], unique=False)
    op.create_index(op.f('ix_hire_request_user_id'), 'hire_request', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_hire_request_user_id'), table_name='hire_request')
    op.drop_index(op.f('ix_hire_request_status'), table_name='hire_request')
    op.drop_index(op.f('ix_hire_request_department_id'), table_name='hire_request')
    op.drop_index(op.f('ix_hire_request_candidate_username'), table_name='hire_request')
    op.drop_table('hire_request')
