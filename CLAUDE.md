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

**全站统一标准**：禁止使用原生 `<select>`，所有业务下拉框一律使用 `SearchableSelect` 组件（`frontend/src/components/SearchableSelect.tsx`），不论选项多少，保持视觉风格一致。

> 参考样板：会议纪要新建中「关联客户」下拉框。该样式为全站唯一标准，后续开发不得引入其他下拉组件或原生 `<select>`。

**option 数据格式**（注意是 `value`/`label`，不是 `id`/`sub`）：
```tsx
import SearchableSelect from '../components/SearchableSelect'

// 数字 ID 场景
<SearchableSelect
  options={customers.map(c => ({ value: c.id, label: c.name }))}
  value={form.customer_id || null}
  onChange={(v) => setForm({ ...form, customer_id: (v as number) || 0 })}
  placeholder="选择客户..."
  emptyText="无匹配客户"
/>

// 字符串场景
<SearchableSelect
  options={[{ value: '', label: '不指定' }, ...list.map(s => ({ value: s, label: s }))]}
  value={form.field || null}
  onChange={(v) => updateField('field', v ?? '')}
  placeholder="选择..."
/>
```

**组件特性**：
- 折叠态：显示选中项 label + 清空按钮(X) + 下拉箭头
- 展开态：顶部搜索框 + 滚动选项列表 + 底部计数提示
- 模糊搜索：匹配 label + hint
- 键盘快捷键：↑↓ 移动、Enter 确认、Esc 关闭、Backspace 清空
- 支持自定义渲染：`renderTrigger`、`renderOption`
- 尺寸：`size="sm"`（表格内紧凑）或 `size="md"`（默认）

**禁止**：
- 使用原生 `<select>`
- 传 `id`/`sub` 字段（组件只认 `value`/`label`/`hint`）
- 传 `clearValue` prop（组件用 `onChange(null)` 清空，无需额外属性）

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

### 全局样式统一约束（按钮 / 选中态 / 标签）

> **核心原则**：整站只允许一个主色（`accent-blue` / `blue-500`）作为操作主色，禁止每个业务模块自创渐变和颜色。颜色服务于语义，不服务于页面装饰。

#### 按钮层级（全站仅 4 种，颜色锁死）

| 层级 | 用途 | 必用样式 | 禁止 |
|---|---|---|---|
| **primary** | 核心创建/保存/确认 | `bg-accent-blue hover:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium shadow-sm hover:shadow-lg hover:shadow-blue-500/30` | 渐变色（from-purple、from-emerald、from-orange 等一律禁止）；裸色值 `bg-[#3B82F6]`、`bg-[#8B5CF6]`、`bg-indigo-600` |
| **secondary** | 取消/关闭/历史归档/筛选 | `border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg px-3 py-1.5 text-xs hover:border-accent-blue/50 hover:text-accent-blue` | 半透明彩色底；`text-gray-500 hover:text-gray-800` 单独成派 |
| **danger** | 删除/作废 | `bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-lg px-3 py-1.5 text-xs` | 实色 `bg-red-500 text-white font-bold`（除非是确认弹窗内的最终执行按钮）；`bg-bg-hover text-red-400` 中性底变体 |
| **icon** | 图标按钮（编辑/复制/查看） | `p-1.5 rounded-lg text-gray-500 hover:text-accent-blue hover:bg-accent-blue/10` | hover 时换 brand 色（purple/emerald 等） |

**禁止行为**：
- 同一页面顶部操作区出现两种以上主色按钮（如新建用蓝、导出用紫、归档用橙）
- 业务模块按"主题色"配按钮（付款用绿、盖章用红、合同用蓝）——按钮颜色只表示层级，不表示业务
- `rounded-xl ... hover:scale-105` 等装饰性放大效果

#### 选中 / Active 态（全站仅 2 种）

| 类型 | 用途 | 必用样式 |
|---|---|---|
| **chip / tab 选中** | Tabs、Filter chips、Tag 选择器、Toggle 按钮 | `bg-accent-blue/15 text-accent-blue border border-accent-blue/30`（暗色主题下 `text-blue-300`） |
| **list row 选中** | 树节点、列表行、下拉项 hover/selected | `bg-accent-blue/10 text-accent-blue font-medium` + 可选左侧 `w-0.5` 高亮条 |

**禁止**：`bg-blue-500/20 text-blue-400 border-blue-500/40`、`bg-purple-500/15 text-purple-300`、`from-cyan-500 to-blue-500` 渐变 underline 等多色变体并存。Tab 的 active 下划线统一用 `bg-accent-blue`（不再每页换渐变）。

#### 业务类型标签 / 状态徽章（仅此处允许彩色）

业务类型标签（合同/付款/盖章/月结/供应商/通道/项目）和状态徽章（待审批/已通过/已驳回/进行中/已完成）**允许使用语义色**，因为颜色本身承载信息（如盖章用红、付款用绿、危险状态用红）。但必须：
- 从 `theme/tokens.ts` 的 `TONES` 中取色，禁止裸色值
- 使用 `StatusBadge` / `IconBox` 组件，不内联 className

#### 实施要求

- 新增/修改页面时，按钮和选中态必须从上述 4+2 种中选，不得引入新颜色
- 已存在的多色变体在迭代到对应页面时统一收敛到本规范
- 后续将补齐 `Button`、`Tabs`、`Chip` 基础组件封装，强制走 `TONES`，届时禁止再内联 className

### 表单整体原则

- 组件样式与现有卡片主题保持一致，不单独引入新款式
- 输入框统一用 `rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15`
- 新建表单中，**销售负责人默认填入当前登录用户**（`user?.name`）

### 卡片与页面配色规范（浅色/深色双主题）

> **核心原则**：所有页面必须同时适配浅色与深色主题，禁止只写深色样式（`text-white`、`bg-white/5`、`border-white/10`）。浅色模式下文字需深色（`text-gray-900`），深色模式下文字需浅色（`dark:text-white`），保证两种主题下都有足够的对比度。

**参考样板**：`ApprovalFlowsPage.tsx`（审批流配置页）。该页面的配色与对比度为全站执行标准，后续开发新页面或重构旧页面时必须对齐。

#### 文字颜色（按层级）

| 层级 | 用途 | 必用样式 |
|---|---|---|
| **标题/主名称** | 页面标题、卡片标题、节点名称 | `text-gray-900 dark:text-white` |
| **正文/重要值** | 描述文字、金额、审批人 | `text-gray-700 dark:text-gray-200` |
| **次要文字/标签** | 辅助说明、标签文字、计数 | `text-gray-500 dark:text-gray-400` |
| **占位/提示** | 空状态、placeholder、禁用 | `text-gray-400 dark:text-gray-600` |
| **图标** | 普通图标 | `text-gray-600 dark:text-gray-400` |

**禁止**：
- 只写 `text-white`（浅色模式下不可见）
- 只写 `text-gray-500`（浅色模式下对比度不足，用作正文时）
- `text-gray-300` 用于正文（浅色模式下几乎不可见）

#### 背景与边框（按容器）

| 容器 | 背景 | 边框 |
|---|---|---|
| **页面卡片** | `bg-bg-card` | `border border-border` |
| **内嵌区块**（触发条件区、节点编辑器） | `bg-bg-hover/30` | `border border-border` |
| **输入框** | `bg-bg-input` | `border border-border focus:border-accent-blue` |
| **标签/徽章底** | `bg-bg-hover`（中性）或 `bg-accent-blue/10`（主色） | `border-transparent` 或 `border-accent-blue/20` |

**禁止**：
- `bg-white/[0.03]`、`bg-white/5`、`bg-white/[0.02]` 等深色专用半透明底（浅色模式下完全透明，无层次感）
- `border-white/10`、`border-white/5` 等深色专用半透明边框
- 每个业务类型分配不同背景色（如合同蓝底、付款绿底）——背景一律中性，颜色只用于状态徽章

#### 状态徽章（仅此处允许彩色，但必须双主题）

| 状态 | 浅色模式 | 深色模式 |
|---|---|---|
| **启用/成功** | `bg-emerald-50 text-emerald-700 border-emerald-200` | `dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20` |
| **停用/中性** | `bg-gray-100 text-gray-500 border-gray-200` | `dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/20` |
| **警告/触发条件** | `bg-amber-50 text-amber-700 border-amber-200` | `dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20` |
| **危险/错误** | `bg-red-50 text-red-700 border-red-200` | `dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20` |

**关键**：徽章必须同时写浅色和深色两套样式，用 `dark:` 前缀切换。禁止只写 `bg-emerald-500/15 text-emerald-400`（浅色模式下背景过淡、文字过淡）。

#### 节点/标签统一中性化

审批节点、业务类型标签、序号圆圈等**不再按类型分配花哨颜色**（如蓝/绿/黄/紫/粉五色），统一用中性灰：
- 节点容器：`border border-border bg-bg-hover`
- 序号圆圈：`bg-bg-hover text-gray-700 dark:text-gray-300 border border-border`
- 业务类型标签：`bg-bg-hover text-gray-600 dark:text-gray-400`

颜色只用于**状态语义**（成功=绿、警告=黄、危险=红），不用于**类型区分**。

#### 操作按钮 hover 态

| 按钮 | 默认色 | hover 色 |
|---|---|---|
| 编辑 | `text-gray-400 dark:text-gray-500` | `hover:text-accent-blue hover:bg-accent-blue/10` |
| 删除 | `text-gray-400 dark:text-gray-500` | `hover:text-red-500 hover:bg-red-500/10` |
| 启停 | `text-gray-400 dark:text-gray-500` | `hover:text-gray-700 dark:hover:text-white hover:bg-bg-hover` |

**禁止**：hover 时切换到非主色（如 `hover:text-purple-300`、`hover:text-emerald-400`）。

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
- **【硬约束】任何功能模块的新增/变更/删除，只要涉及用户角色权限，必须同步修改 `backend/app/database.py` 的种子数据**，缺一不可：
  1. 在 `PERMISSION_DEFS` 中注册新权限码（格式 `(code, 名称, module, action)`）
  2. 在 `ROLE_PERMISSIONS` 角色映射中给对应角色授权（admin 默认全权，其他角色按业务定位赋权）
  3. 角色映射中用到的权限码必须与 `PERMISSION_DEFS` 一一对应，不得引用未定义的权限码
- **【永不遗漏】每次提交前自查**：本次改动是否新增/删除了权限码？如有，`PERMISSION_DEFS` 和 `ROLE_PERMISSIONS` 是否已同步？如未同步，视为未完成。
- **技术角色（tech）权限**：`project:read` + `project:follow_tech`，不含 `project:edit/create/delete`
- 现有权限码清单（截至 v2.8.0，含 OA 模块）：`project:*`、`customer:*`、`contract:*`、`meeting:*`、`approval:*`、`payment:*`、`seal:*`、`expense:*`、`leave:*`、`overtime:*`、`trip:*`、`purchase:*`、`asset:*`、`hire:*`、`ai:*`、`data:*`、`settings:*`、`user:*`、`dashboard:*` 等

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
| `v2.5.2` | 修复角色权限容器重启后回退（仅对本次新建权限码补默认授权，不再覆盖管理员手动增删）；修复 8 处 AI 功能未用各自任务模型（日报/会议/项目分析/公司信息/看板洞察/周报均误读 chat），并在解析器内置「专属 task_type→chat」回落；Agent 对话改用 resolve_chat_params（温度/参数配置生效）；修复看板洞察对 Vertex 供应商永远返回空 |
| `v2.6.0` | OA 落地增强：员工档案加「参加工作日期/入职日期」；年假按法定累计工龄档位（5/10/15 天）HR 一键批量生成草稿→确认发放；资产管理加完整流转履历（领用/归还/调拨/维修/报废，AssetRecord 留痕可追溯历任使用人）；新增迁移 r1h2r3o4a5s6 |
| `v2.7.0` | OA 审批与报销增强：审批流配置页浅色/深色双主题重构（去五颜六色、统一中性色、加深对比度）；报销申请优化（费用时间精确到分钟、个人欠款汇总显示、抵消借款逻辑修复含撤销重算、发票抬头/抵扣/关联单合并一行、移除账户余额暴露）；权限体系系统化更新（13 个角色权限映射补齐 OA view_all + asset:read 全员下放、权限矩阵补齐 OA 模块图标与 ACTION_LABELS）；系统配置白屏修复（EmailConfigSection 缺 useAuth）；下拉框样式标准与卡片配色规范写入 CLAUDE.md |
| `v2.8.0` | 数据管理模块重构：新增 BackupRecord 模型 + 迁移（b1a2c3k4u5p6）记录备份历史；新增 excel_export_service 服务（23 业务模块 / 271 字段 / 8 子表 / 4 业务域中文字段映射 + 导出引擎）；重构 data_export 路由 10 个 API（Excel 模块导出 / JSON 全量备份 / SQL dump / 历史下载 / dry-run 恢复）；重写 DataExportPage 三 Tab 布局（模块导出 / 全量备份 / 数据恢复）；备份文件持久化到 /app/data/backups/（worktrack_data volume）；导入策略仅 skip/insert_only + dry-run 预检查，避免数据覆盖；权限收敛仅 data:export/data:import（管理员可见，boss 无权限）；修复 BackupRecord 未显式声明 __tablename__ 导致 ORM 表名不匹配 |
| `v2.8.1` | OA 请假额度管控增强：所有法定假期（年假/调休/婚假/产假/陪产假/丧假）统一额度校验，超额直接阻断提交并告知原因；额度计算扣除"审批中"占用量，防止多个申请叠加超额；前端表单实时显示剩余/审批中/可用天数提示（双主题样式）；年假懒初始化（/my 接口按法定工龄自动发放）；HiresPage 字段标签修正（参加工作日期 vs 到岗日期）；固定 JWT_SECRET_KEY 到 .env 避免 reload 后 token 失效；全站 13 处 scope/tab 切换按钮白底白字修复（统一 bg-accent-blue/15 text-accent-blue）；DashboardPage 全面样式合规（去渐变/多色 tone，统一双主题中性色） |
| `v2.8.2` | 安全加固 17 项（请假余额 SELECT FOR UPDATE 防并发、比例退款、忘记密码限流+邮件配置前置、注册权限动态判断、Wiki 密码限流、数据导入错误计数修复）；管理员解锁被锁定账号（POST /users/{id}/unlock + 用户管理页解锁按钮）；后台页面全面响应式（运维监控/数据管理/日志/定时任务/控制台移动端抽屉侧边栏）；OACenterPage 全部原生 select 替换为 SearchableSelect；ProjectFormModal 样式合规 |
| `v2.8.3` (latest) | 协作分享功能修复：ShareDialog/MeetingsPage 所有裸 fetch() 改为 fetchWithAuth（之前因缺 Auth header 导致分享请求 401 静默失败）；新增 /api/v1/shares/sent 后端接口；DataShareOut 增加 shared_by_name 字段；SharedWithMePage 重构为双向切换（我发出的/收到的），支持撤销发出的分享、展示结构化内容摘要；MeetingsPage 分享成功后同步写入 data_share 使"我发出的"可见 |

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
