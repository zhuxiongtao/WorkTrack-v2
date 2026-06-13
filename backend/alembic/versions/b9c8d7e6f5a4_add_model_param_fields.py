"""add_model_param_fields

P0 模型参数分级配置：
- ProviderModel：14 个默认参数/能力字段
- TaskModelConfig：11 个 override 字段 + preset_id 引用
- ModelParamPreset：参数预设模板（新建表）

Revision ID: b9c8d7e6f5a4
Revises: a3b4c5d6e7f8
Create Date: 2026-06-04 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9c8d7e6f5a4'
# merge 两个 head：主流 a3b4c5d6e7f8（Maas 字段） + 分支 a1b2c3d4e5f7（会议协作）
down_revision: Union[str, tuple, None] = ('a3b4c5d6e7f8', 'a1b2c3d4e5f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ===== ProviderModel 加 14 个字段 =====
    op.add_column('providermodel', sa.Column('default_temperature', sa.Float(), nullable=True))
    op.add_column('providermodel', sa.Column('default_top_p', sa.Float(), nullable=True))
    op.add_column('providermodel', sa.Column('default_max_tokens', sa.Integer(), nullable=True))
    op.add_column('providermodel', sa.Column('default_frequency_penalty', sa.Float(), nullable=True))
    op.add_column('providermodel', sa.Column('default_presence_penalty', sa.Float(), nullable=True))
    op.add_column('providermodel', sa.Column('default_stop', sa.String(500), nullable=True))
    op.add_column('providermodel', sa.Column('default_thinking_mode', sa.String(20), nullable=True))
    op.add_column('providermodel', sa.Column('default_thinking_budget', sa.Integer(), nullable=True))
    op.add_column('providermodel', sa.Column('default_response_format', sa.String(20), nullable=True))
    op.add_column('providermodel', sa.Column('default_json_schema', sa.Text(), nullable=True))
    op.add_column('providermodel', sa.Column('context_window', sa.Integer(), nullable=True))
    op.add_column('providermodel', sa.Column('supports_streaming', sa.Boolean(), nullable=True, server_default=sa.text('true')))
    op.add_column('providermodel', sa.Column('supports_function_calling', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('providermodel', sa.Column('supports_vision', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('providermodel', sa.Column('supports_json_mode', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('providermodel', sa.Column('supports_thinking', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('providermodel', sa.Column('supports_system_prompt', sa.Boolean(), nullable=True, server_default=sa.text('true')))
    op.add_column('providermodel', sa.Column('extra_params_json', sa.Text(), nullable=True))
    op.add_column('providermodel', sa.Column('description', sa.String(500), nullable=True))
    op.add_column('providermodel', sa.Column('tags', sa.String(500), nullable=True))

    # ===== 新建 ModelParamPreset 表（必须在 preset_id FK 之前） =====
    op.create_table(
        'modelparampreset',
        sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.String(500), nullable=True, server_default=''),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=True, server_default=sa.text('false')),
        sa.Column('temperature', sa.Float(), nullable=True),
        sa.Column('top_p', sa.Float(), nullable=True),
        sa.Column('max_tokens', sa.Integer(), nullable=True),
        sa.Column('frequency_penalty', sa.Float(), nullable=True),
        sa.Column('presence_penalty', sa.Float(), nullable=True),
        sa.Column('stop', sa.String(500), nullable=True),
        sa.Column('thinking_mode', sa.String(20), nullable=True),
        sa.Column('thinking_budget', sa.Integer(), nullable=True),
        sa.Column('response_format', sa.String(20), nullable=True),
        sa.Column('json_schema', sa.Text(), nullable=True),
        sa.Column('extra_params_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_modelparampreset_user_id', 'modelparampreset', ['user_id'], unique=False)

    # ===== TaskModelConfig 加 11 个 override 字段 + preset_id =====
    op.add_column('taskmodelconfig', sa.Column('override_temperature', sa.Float(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_top_p', sa.Float(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_max_tokens', sa.Integer(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_frequency_penalty', sa.Float(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_presence_penalty', sa.Float(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_stop', sa.String(500), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_thinking_mode', sa.String(20), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_thinking_budget', sa.Integer(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_response_format', sa.String(20), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_json_schema', sa.Text(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('override_extra_params_json', sa.Text(), nullable=True))
    op.add_column('taskmodelconfig', sa.Column('preset_id', sa.Integer(), nullable=True))
    op.create_index('ix_taskmodelconfig_preset_id', 'taskmodelconfig', ['preset_id'], unique=False)
    op.create_foreign_key(
        'fk_taskmodelconfig_preset_id',
        'taskmodelconfig', 'modelparampreset',
        ['preset_id'], ['id'],
        ondelete='SET NULL',
    )

    # ===== 预置 4 个系统级预设（供 P1 UI 直接显示） =====
    import datetime
    now = datetime.datetime.utcnow()
    op.bulk_insert(
        sa.table(
            'modelparampreset',
            sa.column('name', sa.String),
            sa.column('description', sa.String),
            sa.column('user_id', sa.Integer),
            sa.column('is_system', sa.Boolean),
            sa.column('temperature', sa.Float),
            sa.column('top_p', sa.Float),
            sa.column('max_tokens', sa.Integer),
            sa.column('response_format', sa.String),
            sa.column('thinking_mode', sa.String),
            sa.column('thinking_budget', sa.Integer),
            sa.column('created_at', sa.DateTime),
            sa.column('updated_at', sa.DateTime),
        ),
        [
            # 严谨分析：低温度、文本输出、中等 token
            {
                'name': '严谨分析', 'description': '低温度、确定性高，适合数据分析、报告生成',
                'user_id': None, 'is_system': True,
                'temperature': 0.2, 'top_p': 0.9, 'max_tokens': 3000,
                'response_format': 'text', 'thinking_mode': None, 'thinking_budget': None,
                'created_at': now, 'updated_at': now,
            },
            # 代码生成：极低温度、JSON 或 text
            {
                'name': '代码生成', 'description': '极低温度、结果可复现，适合编程辅助',
                'user_id': None, 'is_system': True,
                'temperature': 0.1, 'top_p': 0.95, 'max_tokens': 4000,
                'response_format': 'text', 'thinking_mode': None, 'thinking_budget': None,
                'created_at': now, 'updated_at': now,
            },
            # 创意写作：高温度、自由发散
            {
                'name': '创意写作', 'description': '高温度、多样性强，适合文案、策划、头脑风暴',
                'user_id': None, 'is_system': True,
                'temperature': 0.9, 'top_p': 0.95, 'max_tokens': 3000,
                'response_format': 'text', 'thinking_mode': None, 'thinking_budget': None,
                'created_at': now, 'updated_at': now,
            },
            # JSON 提取：极低温度、强制 JSON
            {
                'name': 'JSON 提取', 'description': '极低温度、强制 JSON 输出，适合结构化数据抽取',
                'user_id': None, 'is_system': True,
                'temperature': 0.1, 'top_p': 1.0, 'max_tokens': 4000,
                'response_format': 'json_object', 'thinking_mode': None, 'thinking_budget': None,
                'created_at': now, 'updated_at': now,
            },
        ],
    )


def downgrade() -> None:
    op.drop_table('modelparampreset')

    op.drop_constraint('fk_taskmodelconfig_preset_id', 'taskmodelconfig', type_='foreignkey')
    op.drop_index('ix_taskmodelconfig_preset_id', table_name='taskmodelconfig')
    for col in [
        'preset_id', 'override_extra_params_json', 'override_json_schema',
        'override_response_format', 'override_thinking_budget', 'override_thinking_mode',
        'override_stop', 'override_presence_penalty', 'override_frequency_penalty',
        'override_max_tokens', 'override_top_p', 'override_temperature',
    ]:
        op.drop_column('taskmodelconfig', col)

    for col in [
        'tags', 'description', 'extra_params_json', 'supports_system_prompt',
        'supports_thinking', 'supports_json_mode', 'supports_vision',
        'supports_function_calling', 'supports_streaming', 'context_window',
        'default_json_schema', 'default_response_format', 'default_thinking_budget',
        'default_thinking_mode', 'default_stop', 'default_presence_penalty',
        'default_frequency_penalty', 'default_max_tokens', 'default_top_p',
        'default_temperature',
    ]:
        op.drop_column('providermodel', col)
