# OA 办公模块实施方案（20 人体量）

> 范围：请假、加班、报销、出差、采购、企业资产管理（6 个模块）
> 目标：可落地、低改造、复用现有审批引擎与组织架构
> 状态：**方案待评审**（文末决策点确认后进入 P1 实施）
> 最后更新：2026-06-24

---

## 1. 背景与目标

为公司（≤20 人）补齐 OA 核心办公能力。这些模块本质都是**审批驱动的申请单**，
而系统已具备一套成熟的**统一审批引擎**（`app/services/approval_engine.py`），
当前已接入 8 种业务：合同、付款、盖章、项目、供应商、渠道、对账、账单核对。

**核心原则：复用引擎，不为每个模块重造审批流、通知、留痕、附件。**
付款模块（`PaymentRequest` + 出纳打款执行节点）即本批模块最直接的参照样板。

---

## 2. 核心设计原则

### 2.1 接入审批引擎的标准 8 步（每个模块照做）

| 步骤 | 产物 | 参照 |
|---|---|---|
| 1. 数据模型 `XxxRequest` | `models/xxx.py` | `models/payment.py` |
| 2. 数据库迁移 | `alembic/versions/xxx.py` | 现有迁移模板 |
| 3. Schema（Create/Update/Out） | `schemas/xxx.py` | `schemas/payment.py` |
| 4. 路由（CRUD + submit-approval + revoke + approval-preview） | `routers/xxx.py` | `routers/payments.py` |
| 5. 状态回写分支 | `approval_engine._on_finished` 加 `elif target_type=="xxx"` | 现有 payment/seal 分支 |
| 6. 种子审批流模板 | `database.py` 加 `ApprovalFlow` | 现有合同/付款流 |
| 7. RBAC 权限 + 角色映射 | `database.py` 种子 | 现有 contract/payment 权限 |
| 8. 前端页面 + 菜单 + 嵌 `ApprovalTimeline` | `pages/XxxPage.tsx` | `pages/PaymentsPage.tsx` |

### 2.2 审批引擎关键机制（已具备，无需改造）

- **节点审批人类型** `approver_type`：`user`（指定人）/ `leader`（直属上级）/ `dept_manager`（部门负责人）/ `dept_or_leader`（部门负责人或分管领导，或签）/ `role`（按角色）
- **节点类型** `node_kind`：`approval`（审批意见：同意/驳回）/ `execution`（执行确认：出纳打款、盖章、发放等线下动作）
- **审批人解析** `resolve_approvers()`：解析为真实 user_id，过滤停用账号；是否允许自审由模板配置决定（不强制排除发起人）
- **快照机制**：发起时把节点+审批人固化到 `nodes_snapshot`，审批中组织架构变动不影响进行中的流程
- **状态回写** `_on_finished()`：审批结束后按 `target_type` 回写业务实体状态——**新模块的唯一引擎侧改动点**

### 2.3 「待我审批」与审批时间线零改动

`ApprovalsPage`（待我审批）和 `ApprovalTimeline` 组件已按 `target_type` 通用渲染，
新模块发起的审批会**自动**出现在待办列表和时间线里。
唯一需扩展的是**审批详情面板的业务详情卡**（目前仅为 contract 写了 detail loader），
建议改为通用渲染或为每个新 `target_type` 补一段详情加载。

---

## 3. 公共基础设施（先建，6 模块共用）

### 3.1 申请单统一字段约定

每张申请单表都包含以下基础字段，便于「我的申请」聚合与通用渲染：

```
id, user_id(申请人), dept_id(部门快照,可选), status,
attachments(JSON), reason(说明), created_at, updated_at
```

**统一状态机**：`草稿 → 审批中 → 已通过/已完成 → 已驳回 / 已撤回`
（资产报修等执行类用 `已完成`，资金类用 `已打款`，与现有 payment `已付款` 风格一致）

### 3.2 额度账户（唯一全新基建，仅请假/加班依赖）

```
LeaveBalance:    user_id, year, leave_type(年假|调休), total, used
                 -- remaining = total - used 计算得出
LeaveBalanceLog: user_id, leave_type, change(±), balance_after,
                 source(年度发放|加班调休|请假扣减|手动调整),
                 source_id, operator_id, note, created_at
```

- **入账**：加班审批通过（补偿=调休）→ 调休 `+ hours`
- **扣减**：请假审批通过（年假/调休）→ `- 天数`
- **时机**：全部发生在 `_on_finished` 的 `approved` 分支；驳回/撤回不动余额
- **预校验**：提交请假时校验余额（年假/调休余额不足则拦截，见决策点 2）

### 3.3 附件

直接复用现有 `FileUpload` 组件 + `attachments` JSON 字段（与付款单发票一致），不另造上传通道。

### 3.4 「我的申请」聚合入口

新增 `GET /oa/my-requests`，跨各模块表汇总当前用户的申请（20 人低频，性能无压力），
返回统一卡片结构（类型、标题、状态、时间、审批进度）。

---

## 4. 模块详细设计

### 4.1 请假 leave

- **字段**：`leave_type(年假/事假/病假/调休/婚假/产假/陪产假/丧假), start_at, end_at, duration(天，支持 0.5 半天), handover(交接人，可选), attachments(病假条等)`
- **审批流**：申请人 → 直属上级`leader`；长假（病假>3天 / 产假等）→ + 老板`role:boss`
- **联动**：年假/调休类型，审批通过扣 `LeaveBalance`；提交时余额预校验
- **回写**：approved→`已通过`，rejected→`已驳回`，cancelled→`已撤回`

### 4.2 加班 overtime

- **字段**：`overtime_date, start_time, end_time, hours, overtime_type(工作日/休息日/法定节假日), compensation(调休/加班费/不补偿), reason`
- **审批流**：申请人 → 直属上级`leader`
- **联动**：approved 且 compensation=调休 → `LeaveBalance(调休) += hours`（供请假消费，形成闭环）

### 4.3 报销 reimbursement

- **主单字段**：`expense_type, total_amount, currency, travel_id(关联出差，可选), reason`
- **明细子表 `ReimbursementItem`**：`date, category(交通/餐饮/住宿/办公/招待/其他), amount, invoice_no, attachment`
- **审批流**：申请人 → 直属上级`leader` → 财务审核`role:finance` → **出纳打款`role:cashier`（execution 执行节点）**
- **回写**：approved→`已打款`（含出纳执行节点，全部通过即结算完成）
- **样板**：末端打款完全复刻付款单的出纳执行节点逻辑

### 4.4 出差 travel

- **字段**：`destination, purpose, start_date, end_date, days, transport(飞机/高铁/汽车/自驾), companions(同行人), estimated_cost, advance_amount(预支/借款，可选)`
- **审批流**：申请人 → 直属上级`leader`；大额或有预支 → + 财务/老板
- **联动**：行前审批；行后报销时 `travel_id` 关联，带出目的地/日期，预支金额冲抵报销

### 4.5 采购 procurement

- **主单字段**：`category, supplier_id(关联现有 Supplier，可选), total_amount, purpose, expected_date, urgency(普通/紧急)`
- **明细子表 `ProcurementItem`**：`item_name, spec, qty, unit, unit_price, amount`
- **审批流**：申请人 → 部门负责人`dept_manager` →（金额阈值）财务 → 老板 → **采购执行/验收（execution 执行节点）**
- **联动**：审批通过后**手动**发起付款申请（不自动，避免误付）；验收完成可一键登记为资产（见 4.6）

### 4.6 企业资产管理 asset

> **架构区别**：资产管理不是纯申请单，而是「**台账（主数据 CRUD）+ 流转申请（上引擎）**」混合体。

| 部分 | 性质 | 是否上审批引擎 |
|---|---|---|
| 资产台账（电脑/显示器/插板…） | 主数据 CRUD，长期存在 | ❌ 资产管理员直接维护 |
| 领用 / 借用 / 归还 / 报修 / 报废 / 调拨 | 流转申请 | ✅ 上引擎（轻量，多为 1 级） |

**台账模型 `Asset`**
```
asset_no(资产编号,自动生成), name, category(电脑/显示器/外设/办公设备/家具/耗材/其他),
brand_model, sn(序列号), purchase_date, purchase_price,
supplier_id(关联供应商), procurement_id(关联采购单,可选),
status(在库/在用/借出/维修中/报废), holder_id(当前使用人), location,
warranty_until(保修到期), attachments(照片/发票), remarks
```

**履历模型 `AssetRecord`**（每次流转落一条，构成全生命周期审计）
```
asset_id, action(入库/领用/归还/借用/调拨/报修/报废),
from_holder, to_holder, operator_id, related_request_id, note, created_at
```

- 分类用现有 `FieldOption` 机制配置（插板等耗材也能扩），不写死枚举
- 资产编号规则：`类别前缀-年份-流水`，如 `PC-2026-001`、`MON-2026-014`

**流转申请类型（20 人体量建议轻量）**

| 单据 target_type | 默认审批 | 通过后台账动作 |
|---|---|---|
| 领用 asset_claim | 资产管理员 1 级 → 发放(execution) | status=在用, holder=申请人 |
| 借用/归还 asset_borrow | 资产管理员 1 级 | status=借出 / 回到在库 |
| 报修 asset_repair | 可免审批，直接派单 IT/行政 | status=维修中 → 恢复在用 |
| 调拨 asset_transfer | 资产管理员 1 级 | holder 变更 |
| **报废 asset_scrap** | 资产管理员 + 财务（涉账面核销） | status=报废 |

> 建议：仅**报废**两级审批，领用/借用/调拨 1 级确认，报修免审批（避免换个插板也走流程）。

---

## 5. 模块联动关系

```
加班(调休) ──入账──▶ 额度账户(调休) ──扣减──▶ 请假(调休)        [考勤闭环]
出差 ──关联/预支冲抵──▶ 报销 ──▶ 出纳打款                      [费用闭环]
采购 ──验收──▶ 付款申请                                       [采购付款]
采购 ──验收──▶ 一键入库──▶ 资产台账                            [资产入口]
资产 holder ──关联──▶ User（员工离职时列出名下未归还资产）       [离职归还]
资产报修 ──可选──▶ 报销/付款（维修费）                          [维修费用]
```

- **采购 → 资产入库**是资产数据的主要来源，避免重复录入，是最大价值联动点。
- **加班 → 调休 → 请假**形成考勤自洽闭环。

---

## 6. RBAC 权限与角色

**新增权限**（每模块 × 动作）：
```
leave / overtime / reimbursement / travel / procurement / asset
  × { read, create, approve, manage }
```

**角色**：
- 复用：**出纳 cashier**（报销/采购打款）、**老板 boss**（大额终审）、部门负责人（`dept_manager` 解析）
- 新增：**HR**（请假/加班管理 + 额度配置）、**财务 finance**（报销/采购审核）、**资产管理员 asset_admin**（台账维护 + 流转审批，通常落在行政或 IT）
- 普通员工：各模块 `create + read(本人)`；资产额外 `领用/报修 create`

按现有规范，上线前在 `database.py` 种子数据中注册权限和角色映射。

---

## 7. 前端规划

**新增菜单组「OA 办公」**：
请假 / 加班 / 报销 / 出差 / 采购 / 资产台账 / 我的申请 /（HR）额度管理

- 每个申请模块页 = 列表 + 新建弹窗 + 详情（嵌 `ApprovalTimeline` 组件）
- **复用**：`ApprovalsPage`（待我审批，自动聚合新类型）、`FileUpload`、`SearchableSelect`、`DateField`
- 资产台账页仿 `SuppliersPage`（卡片/表格，按类别·状态·使用人筛选）；另设「我的资产」给员工看名下设备
- **统计视图**（后置）：请假日历、加班工时月报、报销月度汇总、资产分类统计
- 遵循 `feedback_color_contrast` 与 CLAUDE.md 的浅色对比度规范

---

## 8. 分期实施路线图

| 阶段 | 内容 | 理由 | 估时 |
|---|---|---|---|
| **P1 考勤基线** | 请假 + 加班 + 额度账户 | 员工最高频、无资金流、审批最简单；额度是唯一新基建，先打牢 | ~5–6 天 |
| **P2 费用报销** | 报销（多明细 + 发票 + 出纳打款） | 复刻付款/出纳模式，风险低 | ~3–4 天 |
| **P3 业务申请** | 出差 + 采购 | 出差关联报销(P2)、采购关联供应商+付款 | ~4–5 天 |
| **P4 资产管理** | 台账 + 履历 + 流转单 + 采购→入库联动 | 核心数据入口依赖 P3 | ~4–5 天 |

- 总计约 **3–4 周**（含种子流程配置、联调、测试）。每模块后端 ~1–1.5 天、前端 ~1–1.5 天。
- **可解耦**：资产台账 CRUD 不依赖采购，若想先把存量电脑/显示器录入系统，可随时单独提前做，流转单与联动再跟上。

---

## 9. 决策点清单（含推荐默认，待确认）

| # | 决策 | 推荐默认 |
|---|---|---|
| 1 | 审批层级 | 默认两级（申请人→直属上级）+ 金额/时长阈值升级到财务/老板 |
| 2 | 请假额度管控 | 年假/调休强管控（余额不足禁止提交）；事假/病假仅记录不限额 |
| 3 | 报销结算方式 | 走出纳打款执行节点（与付款一致，留痕闭环） |
| 4 | 报销 vs 付款是否合并 | 独立模块（报销有多明细+发票需求），仅末端打款复用出纳角色 |
| 5 | 采购→付款 | 不自动生成付款，验收后手动发起（避免误付） |
| 6 | 年假发放规则 | P1 手动配置；按工龄自动算的规则引擎后置 |
| 7 | 工作日历/半天 | P1 先支持 0.5 半天；法定节假日日历后置（小公司手填天数可接受） |
| 8 | 资产流转审批粒度 | 仅报废两级审批；领用/借用/调拨 1 级；报修免审批 |
| 9 | 资产来源 | 采购验收→一键入库为主，辅以手工录入存量资产 |
| 10 | 资产折旧/估值 | 20 人体量不做自动折旧，只记录采购价；财务折旧后置 |

---

## 10. 接入新模块标准步骤（实施期 Cookbook）

以新增模块 `xxx` 为例，逐项照做即可：

1. `models/xxx.py`：定义 `XxxRequest`（遵守 §3.1 字段约定）；如有明细另建 `XxxItem`
2. `alembic/versions/`：新建迁移脚本，命名 `migrate_vX.X.X_add_xxx.py`
3. `schemas/xxx.py`：`XxxCreate / XxxUpdate / XxxOut`
4. `routers/xxx.py`：`GET 列表 / GET 详情 / POST 创建 / PUT 编辑 / DELETE / POST submit-approval / POST revoke-approval / GET approval-preview`
5. `approval_engine._on_finished`：加 `elif instance.target_type == "xxx":` 回写状态分支
6. `database.py`：种子 `ApprovalFlow(business_type="xxx", nodes=[...])`
7. `database.py`：种子权限 `xxx:{read,create,approve,manage}` + 角色映射
8. `pages/XxxPage.tsx` + 菜单项 + 嵌 `ApprovalTimeline`
9. 扩展 `ApprovalsPage` 详情面板加载 `xxx` 业务详情（或改通用渲染）
10. `main.py` 注册路由；`models/__init__.py` 导出新模型

---

## 11. 风险与注意事项

- **额度并发**：请假扣减与加班入账需保证在 `_on_finished` 内与状态回写同事务提交，避免余额漂移。
- **审批人为空**：发起前用 `approval-preview` 校验各节点有解析到审批人（参照合同模块已修复的「无审批人」问题）。
- **删除级联**：申请单删除需级联清理 `ApprovalInstance` + `ApprovalRecord`（先删 Record 再 flush 再删 Instance，参照合同删除修复）。
- **时间字段**：统一用 `app/utils/time.now()`（北京时间 naive），禁止 `datetime.utcnow()`（CLAUDE.md 规范）。
- **金额单位**：报销/采购金额遵循 `amount_unit`（元/万元）约定，前端 `formatAmount` 显式传 unit。
- **资产台账权限**：员工只能读本人名下资产，台账写操作限资产管理员。
