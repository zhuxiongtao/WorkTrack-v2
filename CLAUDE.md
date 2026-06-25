# WorkTrack-v2 开发规范

本文件记录项目开发中的设计决策与反复确认的标准，供每次会话直接参考，无需重复说明。

---

## 技术栈

- **后端**：FastAPI + SQLModel + PostgreSQL（psycopg2）
- **前端**：React + TypeScript + Vite + Tailwind CSS
- **部署**：Docker buildx `linux/amd64`（Mac M1 → 香港 amd64 服务器）

---

## 前端 UI 规范

### 下拉选择框

不使用原生 `<select>`，根据场景二选一：

| 场景 | 组件 | 说明 |
|---|---|---|
| **全部业务下拉** | `SearchableSelect` | 统一使用，不论选项多少，保持视觉风格一致 |
| 货币选择器（仅此一处例外） | `CurrencySelector`（内部组件） | `appearance-none` + `ChevronDown`，因币种无需搜索且展示格式特殊 |

**`SearchableSelect` 单选字符串字段用法：**
```tsx
<SearchableSelect
  options={[{ id: '', label: '不指定' }, ...list.map(s => ({ id: s, label: s }))]}
  value={form.field}
  onChange={(v) => updateField('field', v === 0 ? '' : String(v))}
  clearValue=""
/>
```

**`StyledSelect` 用法（用于月调用量单位等固定枚举）：**
```tsx
<StyledSelect value={form.unit} onChange={(e) => updateField('unit', e.target.value)}>
  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
</StyledSelect>
```

### 信息网格（图标 + 标签 + 值）对齐规范

在任何"图标 + 标签文字 + 值"的网格/列表布局中，**标签必须固定宽度**，确保值列对齐，不因标签字数不同而参差不齐。

```tsx
<div className="flex items-start gap-1.5 min-w-0">
  <Icon size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" />
  <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 w-[4em]">{label}</span>
  <span className="text-xs text-gray-700 dark:text-gray-200 break-words min-w-0 flex-1">{value}</span>
</div>
```

- `w-[4em]`：适配最长 4 字中文标签（技术支持、上游通道等），`shrink-0` 防止被挤压
- `flex-1 min-w-0`：值列自动撑满剩余空间，长文本正常换行

**禁止**将标签和值写成同一 `<span>` 内的 inline 文本（`<span>label </span><span>value</span>` 同处于同一 `<div>`但没有固定宽约束），会导致值起始位置随标签长度漂移。

### 按钮视觉层级规范

页面顶部操作区按钮区分主次：

| 层级 | 用途 | 样式 |
|---|---|---|
| **主操作**（如"新建合同"） | 核心创建入口 | `bg-accent-blue text-white hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30` |
| **次操作**（如"历史归档"） | 辅助/低频入口 | `border border-border bg-bg-card text-gray-600 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue` |

**禁止**在次操作按钮上使用半透明彩色背景（如 `bg-purple-500/15 text-purple-300`）——浅色模式下颜色对比度差，视觉干扰大。次操作统一用中性边框样式，hover 时借用主色呼应即可。

### 表单整体原则

- 组件样式与现有卡片主题保持一致，不单独引入新款式
- 输入框统一用 `rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15`
- 新建表单中，**销售负责人默认填入当前登录用户**（`user?.name`）

### 项目表单字段命名约定

| 字段 | 正确表述 |
|---|---|
| `usage_scenario` | 项目背景与需求 |
| `cloud_provider` | 客户技术能力（选项为 AI 基础设施维度） |
| `project_scenario` | 项目场景（使用 AI 行业预设场景，见下） |

**`project_scenario` 预设场景（来自 `DEFAULT_AI_SCENARIOS`）：**
智能客服/客服机器人、知识库问答（RAG）、文档处理与分析、代码辅助/Copilot、内容生成与创作、数据分析与报告、企业搜索增强、工作流自动化、AI Agent/任务规划、多模态理解（图文/语音）、垂直行业大模型定制、模型评测与对比

**`cloud_provider`（客户技术能力）预设选项：**
自建 AI 网关、具备访问海外模型的网络能力、聚合平台对外服务、私有化部署（K8s/Docker）、公有云（已有账户）、裸金属/GPU 服务器、自建向量数据库/知识库、API 网关已有、混合云架构、无技术团队（纯 API 接入）

---

## 后端规范

### 金额单位约定

平台金额字段分两类，**单位由字段或用户选择决定，不统一强制**：

| 字段 | 单位来源 | 说明 |
|---|---|---|
| `project.opportunity_amount` | `opportunity_amount_unit`（万元/元，用户选择） | 用户录入 |
| `project.deal_amount` | `deal_amount_unit`（万元/元，用户选择） | 用户录入 |
| `project.cost_amount` | **始终元**（无 unit 字段） | `_sync_project_cost` 直接聚合 `SUM(project_cost.amount)`，不转换 |
| `project_cost.amount` | 元 | API 账单明细 |
| `contract.contract_amount` | `amount_unit`（万元/元，用户选择） | 用户录入 |
| `payment_request.amount` | `amount_unit`（元/万元，用户选择，默认元） | 用户录入 |

**毛利率计算**：`cost_amount`（元）/ `deal_amount`（按 unit 换算为元）后再算百分比，见 `_sync_project_cost`。

**前端 `formatAmount(value, currency, unit?)`**：接受显式 `unit`（`'万元'` 或 `'元'`），不再硬编码"万"。`cost_amount` 调用时传 `'元'`。

**AI prompt**：金额格式化为 `¥45万元` / `¥35,907元` 风格，禁止传裸数字 + 货币代码。

### 时间处理

```python
# ✅ 正确：使用 app/utils/time.py 中的 now()，返回北京时间 naive datetime
from app.utils.time import now
created_at: datetime = Field(default_factory=lambda: now())

# ❌ 禁止：aware datetime 会被 psycopg2 转为 UTC 存入，导致显示偏差 8 小时
datetime.now(BEIJING_TZ)     # 产生 aware datetime → 存 UTC → 显示 -8h
datetime.utcnow()             # 同上
```

### Python 变量命名陷阱

```python
# ❌ 错误：将导入函数名作为本地变量名，Python 会把整个函数作用域内的 now 视为 local
from app.utils.time import now
now = now()   # UnboundLocalError: local variable 'now' referenced before assignment

# ✅ 正确：重命名本地变量
now_dt = now()
```

### 权限模型

- 权限检查统一用 `require_permission("module:action")` 装饰器
- 新功能上线前在 `database.py` 的种子数据中注册权限和角色映射
- **技术角色（tech）权限**：`project:read` + `project:follow_tech`，不含 `project:edit/create/delete`

### AI 提示词规范

- system_prompt 中**明确字数上限**（如"严格在 100 字以内"），不写无限制长度的提示词
- 聚焦核心：卡点/风险 + 最关键一条建议，避免列小标题和重复已知信息
- user_prompt_template 末尾重申字数要求以强化约束

---

## 数据库迁移

- 新增字段/表后，在对应 Pydantic schema（`schemas/`）同步更新 `Create`、`Update`、`Out` 三个类
- `DEFAULT_FIELD_OPTIONS`（`database.py`）仅在首次初始化时写入，生产环境已有数据不受影响
- 迁移脚本使用 **Alembic**（`backend/alembic/versions/`），不使用 `scripts/` 目录
- 新增迁移：在 `backend/` 下执行 `python -m alembic revision --autogenerate -m "描述"`，生成后检查 `upgrade()`/`downgrade()` 是否正确
- 新模型必须在 `alembic/env.py` 的 `from app.models import (...)` 中导入，否则 autogenerate 无法识别
- 迁移文件命名格式：`<revision_id>_<description>.py`，`down_revision` 必须指向当前 head（`python -m alembic heads` 查看）
- 应用迁移：`python -m alembic upgrade head`；回滚：`python -m alembic downgrade -1`

---

## 部署

### 镜像信息

- **仓库**：`zxt815/worktrack-v2`（Docker Hub）
- **构建脚本**：`./build-and-push.sh <版本号>`

### 版本历史

| 标签 | 说明 |
|---|---|
| `v2.1.0` | 早期版本 |
| `v2.2.0` | 早期版本 |
| `v2.3.0` | 早期版本 |
| `v2.3.1` | 修复健康检查 datetime 类型错误 |
| `v2.3.2` | 功能迭代 |
| `v2.3.3` | 功能迭代 |
| `v2.3.4` | 功能迭代 |
| `20260622` | v2.3.5–v2.3.9 补丁合集：时区修复、用户管理 UnboundLocalError、看板权限、重发邮件、Wiki AI Markdown |
| `v2.4.0` | 付款/盖章/反馈/项目跟进模块上线；审批引擎增强（dept_or_leader 或签、执行节点、审批人不再强制排除发起人）；合同删除 FK 级联修复 + 上传签章版权限放宽 + 审批预览真实姓名；RBAC 新增出纳/印章管理员；项目管理表单重构；全站浅色主题对比度优化 |
| `v2.5.0` | OA 办公模块全量上线：请假、加班、报销、出差、采购（含供应商台账）、资产管理；假期额度账户（LeaveBalance + LeaveBalanceLog）；审批引擎回调接入 OA 各模块；Alembic 迁移两批次（P1+P2） |
| `v2.5.1` | 修复向量索引误用 LLM_BASE_URL（Google）导致 /v1/embeddings 404；扩展 googleapis.com 全域过滤；AI 交互中心卡片按权限过滤（去日报，加项目/客户/审批/合同/会议/假期）；侧边栏 AI 入口紧凑化 |
| `v2.5.2` (latest) | 修复角色权限容器重启后回退（仅对本次新建权限码补默认授权，不再覆盖管理员手动增删）；修复 8 处 AI 功能未用各自任务模型（日报/会议/项目分析/公司信息/看板洞察/周报均误读 chat），并在解析器内置「专属 task_type→chat」回落；Agent 对话改用 resolve_chat_params（温度/参数配置生效）；修复看板洞察对 Vertex 供应商永远返回空 |

### 版本号规范

```
vMAJOR.MINOR.PATCH
```
- **MAJOR**：架构级重构或不兼容变更
- **MINOR**：新功能模块上线（如审批引擎、项目跟进记录等）
- **PATCH**：Bug 修复、小优化

### 发版时必须同步更新的版本号位置

每次发布新版本，以下四处**必须同步修改**，缺一不可：

| 位置 | 文件 | 修改内容 |
|---|---|---|
| 平台侧边栏展示 | `frontend/src/components/layout/AppSidebar.tsx` | `APP_VERSION = 'vX.X.X'` |
| 前端包版本 | `frontend/package.json` | `"version": "X.X.X"` |
| 后端 API 版本 | `backend/app/main.py` | `version="X.X.X"`（FastAPI + root 接口各一处） |
| 开发规范历史 | `CLAUDE.md` 版本历史表 | 新增行，前一行去掉 `(latest)` 标注 |

### 构建命令

```bash
# 构建并推送指定版本
./build-and-push.sh v2.4.0

# 如遇 push EOF（网络问题），手动分步推送
docker push zxt815/worktrack-v2:latest
docker push zxt815/worktrack-v2:v2.4.0
```
