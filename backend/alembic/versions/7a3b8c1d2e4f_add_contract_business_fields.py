"""add_contract_business_fields

Revision ID: 7a3b8c1d2e4f
Revises: c1d2e3f4a5b6
Create Date: 2026-06-04 16:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = '7a3b8c1d2e4f'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 业务字段
    op.add_column('contract', sa.Column('contract_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('effective_term', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('auto_renew', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('penalty_clause', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('acceptance_terms', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('payment_schedule', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('ip_clause', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('dispute_resolution', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('governing_law', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('notice_clause', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))

    # 解析元数据
    op.add_column('contract', sa.Column('parse_status', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='pending'))
    op.add_column('contract', sa.Column('parse_error', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    op.add_column('contract', sa.Column('parsed_at', sa.DateTime(), nullable=True))
    op.add_column('contract', sa.Column('extraction_meta', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))


def downgrade() -> None:
    op.drop_column('contract', 'extraction_meta')
    op.drop_column('contract', 'parsed_at')
    op.drop_column('contract', 'parse_error')
    op.drop_column('contract', 'parse_status')
    op.drop_column('contract', 'notice_clause')
    op.drop_column('contract', 'governing_law')
    op.drop_column('contract', 'dispute_resolution')
    op.drop_column('contract', 'ip_clause')
    op.drop_column('contract', 'payment_schedule')
    op.drop_column('contract', 'acceptance_terms')
    op.drop_column('contract', 'penalty_clause')
    op.drop_column('contract', 'auto_renew')
    op.drop_column('contract', 'effective_term')
    op.drop_column('contract', 'contract_type')
