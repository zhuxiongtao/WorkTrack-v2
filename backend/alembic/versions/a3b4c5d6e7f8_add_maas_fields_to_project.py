"""add_maas_fields_to_project

MaaS 平台扩展字段：
- discount_rate: 客户折扣率（百分比）
- cost_amount: 内部成本金额
- gross_margin: 毛利率（自动计算）
- upstream_channels: 上游供应商通道（逗号分隔）
- models: 使用的模型（逗号分隔）
- monthly_call_volume: 预计月调用量
- usage_scenario: 客户使用场景
- contract_period: 合同周期

Revision ID: a3b4c5d6e7f8
Revises: 7a5b7ec15043
Create Date: 2026-06-03 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, None] = '7a5b7ec15043'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('project', sa.Column('discount_rate', sa.Float(), nullable=True))
    op.add_column('project', sa.Column('cost_amount', sa.Float(), nullable=True))
    op.add_column('project', sa.Column('gross_margin', sa.Float(), nullable=True))
    op.add_column('project', sa.Column('upstream_channels', sa.String(500), nullable=True))
    op.add_column('project', sa.Column('models', sa.String(500), nullable=True))
    op.add_column('project', sa.Column('monthly_call_volume', sa.String(100), nullable=True))
    op.add_column('project', sa.Column('usage_scenario', sa.Text(), nullable=True))
    op.add_column('project', sa.Column('contract_period', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('project', 'contract_period')
    op.drop_column('project', 'usage_scenario')
    op.drop_column('project', 'monthly_call_volume')
    op.drop_column('project', 'models')
    op.drop_column('project', 'upstream_channels')
    op.drop_column('project', 'gross_margin')
    op.drop_column('project', 'cost_amount')
    op.drop_column('project', 'discount_rate')
