# 智算 MaaS 业务全链路重构方案

> 项目：WorkTrack-v2 · MaaS 平台运营管理工具
> 日期：2026-06-13
> 状态：方案 + 部分实现中

---

## 1. 业务本质

**公司是 MaaS（Model-as-a-Service）聚合转售平台**：
- 接入上游模型供应商（OpenAI / Anthropic / AWS / Google / Azure 等 + 各种号池方）
- 通过「通道」（官网通道 / 号池 / 逆向）供给模型能力
- 加价 / 折扣后销售给下游客户
- 期末三方对账：客户应收（销售）− 通道应付（供应）= 毛利

## 2. 全链路四大环节

| 环节 | 关键动作 | 数据沉淀 |
|---|---|---|
| **一 · 上游：供应商管理** | 准入资格审核 → 功能测试（100 美元 voucher）→ 付费压测（TPM/RPM、Cache ≥ 70%）→ 分级入库 → 日常巡检（每 2 天） | supplier + channel + inventory |
| **二 · 中游：产品与运营** | 新模型上线 → 账号分级 → 智能路由调度 → 风险预警/限额 | channel（主表） + project 引用 |
| **三 · 下游：客户全生命周期** | 客户测试（常规 ≤ 100 / 非常规 ≤ 50，7 天）→ 报价（底价 + 加价率 / 折扣）→ 账号交付 → 客户报障（15 分钟响应） | project + quotation + delivery_account + incident |
| **四 · 期末：对账与核算** | 销售对账（月初，财务复核）→ 供应对账 → 客户/厂商对账反馈 → 每月 15 日大台账汇总（收入 - 支出 - 测试成本 = 毛利） | reconcile_sales / reconcile_supply / reconcile_summary / reconcile_diff |

## 3. 现状与目标差距

| 维度 | 现状 | 目标 |
|---|---|---|
| 供应商模型 | 单层（supplier） | 双层（supplier → channel） |
| 通道价格 | 项目手填字符串 | channel.cost_price + quotation.final_price |
| 库存/交付 | 无 | channel_inventory + delivery_account |
| 对账 | 无 | 销售 / 供应 / 总账 / 差异 四张报表 |
| 闭环 | 散落多个模块 | 端到端可追溯 |

## 4. 数据模型

```
supplier ─┬─ channel ─┬─ channel_inventory
          │           │
          │           └─ (N)─ project ─┬─ quotation
          │                            └─ delivery_account ─┐
          │                                                 │
          │            reconcile_sales (客户应收)           │
          │            reconcile_supply (通道应付)           │
          │            reconcile_summary (总账)              │
          │            reconcile_diff (差异)                │
          └─────────────────────────────────────────────────┘
```

## 5. 模块设计

### 5.1 供应商管理（增强）
- 详情页新增「通道」Tab
- 模型 / 折扣 / 商务条件等迁移到 channel

### 5.2 通道管理（新增 `channel`）
- 字段：supplier_id, model_type, name, kind(官网/号池/逆向/官方), cost_price, discount_rate, contract_period, sla(JSON: cache/TPM/RPM)
- 卡片视图：按 model_type 分组
- 关联：库存数、活跃项目数、当月成本

### 5.3 库存管理（新增 `channel_inventory`）
- 字段：channel_id, account_name, api_key(加密), expire_at, monthly_quota, used_amount, status
- 看板：在库/已交付/冻结/临期

### 5.4 项目管理（增强）
- 关联 channel_id（外键）
- 报价 Tab：基于 channel + 加价率生成 final_price
- 交付 Tab：列出 delivery_account

### 5.5 成本利润（数据源切换）
- 「按通道」Tab（替代「按供应商」）：按 channel 聚合成本
- 可选：成本条目自动从 channel.cost_price × call_volume 计提

### 5.6 对账模块（全新 `/reconcile`）
四个 Tab：
1. **销售对账** — 按 project × period，call_volume × final_price = 应收
2. **供应对账** — 按 channel × period，call_volume × cost_price = 应付
3. **财务总账** — 每月 15 日前出汇总：销售 - 供应 - 测试成本
4. **差异分析** — 销售 call_vol vs 供应 call_vol、客户报价 vs 实调

## 6. 设计原则

- 暗色玻璃拟态（`bg-bg-card` + `border-border/50` + 渐变光晕）
- 复用 `PageHeader` / `IconBox` / `EmptyState` / `KpiCard` / `TeamViewSwitcher` / `MetricBox`
- 图标语义：`Building2`(供应商) `Layers`(通道) `Box`(库存) `Briefcase`(项目) `Receipt`(对账)
- 关联即跳转：所有统计卡支持点击穿透
- 混合币种独立统计：避免误加和
- 折扣/加价颜色编码：绿色加价、琥珀折扣

## 7. 实施路径

### P0（本次实现）
- Channel 后端 + 前端骨架
- Reconcile 后端 4 表 + 前端 4 Tab
- Supplier 详情加 Channel Tab

### P1（下迭代）
- ChannelInventory 后端 + 前端
- DeliveryAccount 后端 + 前端

### P2（远期）
- Quotation 报价台账
- 智能路由调度
- 风险预警

## 8. 关键接口清单

```
GET    /api/v1/channels
POST   /api/v1/channels
PUT    /api/v1/channels/{id}
GET    /api/v1/channels/{id}/inventory
GET    /api/v1/suppliers/{id}/channels     # 供应商下的通道
GET    /api/v1/reconcile/sales?period=YYYY-MM
GET    /api/v1/reconcile/supply?period=YYYY-MM
GET    /api/v1/reconcile/summary?period=YYYY-MM
GET    /api/v1/reconcile/diff?period=YYYY-MM
POST   /api/v1/reconcile/{type}            # 创建对账明细
PUT    /api/v1/reconcile/{type}/{id}       # 更新对账明细
```
