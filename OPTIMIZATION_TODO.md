# WorkTrack-v2 待优化清单

> 基于代码实查整理（2026-06-22）；原 PROJECT_ANALYSIS.md（2026-05-26）已归档移除，本清单为最新权威版。
> 项目近一月规模：后端 ~11k → ~25.5k 行，前端 ~13.6k → ~37k 行；路由 18→33，模型 18→32，页面 16→35。

## 一、已修复（报告曾提，现已解决，无需再处理）

| 项 | 现状证据 |
|---|---|
| CORS 允许 credentials + 通配源 | `main.py:296-297` 已改为 `allow_credentials=not is_wildcard` |
| 文件接口无鉴权 | `files.py:95-102` serve_file 已加 `get_current_user` + `has_permission` |
| Wiki 分享密码明文 | `wiki.py:37,289` 已用 `hash_password`/`verify_password` |
| `/api/v1/meetings/audio` 公开 | 已移出 public_paths |
| `App.tsx` 763 行臃肿 | 已拆分至 214 行 |
| `schemas.py` 单文件 425 行 | 已拆分为 `schemas/` 目录（19 个子模块） |
| `week_range` 重复定义 | `daily_reports.py` 仅剩 1 处（line 24），已去重 |
| Tavily key 明文返回 | `settings.py:1265` 改为 `tavily-config` 接口，脱敏返回（masked） |
| `uploads/contracts` 入库 | `.gitignore:16` 已忽略 `backend/uploads/`，`git ls-files` 跟踪 0 个 |
| **存储型 XSS（富文本渲染无净化）** | `MarkdownRenderer.tsx:48` 已加 `DOMPurify.sanitize`；`SettingsPage` 公告预览改纯文本渲染（2026-06-22） |
| **B4 setup SSRF / 初始化后未关闭** | `setup.py` `test-db` 已初始化即 403 + 限 postgresql scheme + 5/min 限流；`initialize` 仍 400（2026-06-22） |
| **B11 datetime.utcnow naive 混用** | 16 处 `default_factory=datetime.utcnow` 全改 `lambda: datetime.now(timezone.utc)`（channel/reconcile/bill_reconcile，2026-06-22） |

---

## 二、后端待优化

### P0 安全（建议优先）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| B1 | ~~硬编码默认 DB 凭据~~ | `config.py` | **已缓解（2026-06-22）**：默认值保留供本地开发；`APP_ENV=production` 下使用 `worktrack:worktrack` 默认凭据直接拒绝启动 |
| B2 | ~~JWT 默认密钥~~ | `config.py` | **已缓解（2026-06-22）**：`APP_ENV=production` 下 JWT 未设置/为占位值直接拒绝启动；开发环境自动生成随机密钥 |
| B3 | ~~默认管理员密码~~ | `database.py:94` | **已修复**：`admin_password or token_urlsafe(12)` 随机生成 + 打印日志；并已加首登强制改密（须 ADMIN_PASSWORD 或随机） |
| B4 | ~~`/api/v1/setup` 公开~~ | `setup.py` | **已修复（2026-06-22）**：`test-db` 已初始化即 403 + 限 postgresql + 限流；`initialize` 仍 400 |
| B5 | ~~登录无速率限制~~ | `routers/auth.py:107` | **已修复**：登录与 setup 均加 `@limiter.limit("5/minute")`（slowapi，按 IP） |
| B6 | ~~MCP 工具无数据权限~~ | `mcp_server.py` | **已缓解（2026-06-22）**：共享密钥模型无单用户身份，无法行级隔离；已加密钥常量时间比较 + 6 个写工具审计日志（可追溯）。彻底隔离需把密钥绑定到服务用户，属后续 |

### P1 可靠性 / 架构

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| B7 | 大量裸 `except Exception` | 全后端 | 实查：`ai_service` 21、`contract_parser` 25、`scheduler` 13、`settings` 14、`contracts` 11…… 总数远超报告的 29，错误被静默吞掉 |
| B8 | `ai_service.py` 1861 行 | `services/ai_service.py` | 单文件承担 LLM/ASR/Vertex 编排，职责过重，应按能力拆分 + 抽公共 provider 解析 |
| B9 | AI 调用无重试 / 熔断 / 统一超时 | `ai_service.py` | 仅有基础超时，无重试与熔断，外部服务抖动直接传导给用户 |
| B10 | sync/async 端点混用 | 多路由 | `def` 同步端点阻塞事件循环，应统一 `async def` + 异步 DB/IO |
| B11 | ~~datetime 时区不一致~~ | 全后端 | **已修复（2026-06-22）**：16 处 `datetime.utcnow`（naive）全改 aware UTC，`utcnow` 已清零 |
| B12 | `create_all()` + Alembic 双 schema 管理 | `database.py` | 有迁移漂移风险，建议移除 `create_all()`，只靠 Alembic |
| B13 | AI 异常用通用 `RuntimeError` | `ai_service.py` | 缺自定义异常类型，调用方无法精确处理 |

### P2 代码质量 / 性能

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| B14 | RBAC 权限检查多次查询无缓存 | `auth.py:203 _get_all_role_ids` | 每次鉴权 3 次查询，热点路径无缓存 |
| B15 | monitor 全表 COUNT 无缓存 | `routers/monitor.py` | 每次请求 8+ COUNT |
| B16 | MCP overview 全表加载只为计数 | `mcp_server.py` | 应用 `select(func.count())` |
| B17 | 列表端点缺分页 | 多路由 | 部分列表无分页 |
| B18 | 文档创建同步触发向量索引+AI总结 | `routers/daily_reports.py` | 无队列，写请求被 AI 延迟拖住 |
| B19 | 路由缺返回类型注解 | 全路由 | 多数端点无返回类型 |
| B20 | 代码重复 | 多处 | `week_range`、默认字段选项等已去重；AI provider 解析模式重复待抽公共方法 |
| B21 | ~~Tavily key 明文返回~~ | `routers/settings.py` | **已修复**：改为 `tavily-config` 脱敏返回 |

---

## 三、前端待优化

### P1 架构一致性

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| F1 | 数据获取两套并存 | 全前端 | 原始 `fetch`+`useState` 与 TanStack React Query 混用；Query 仅用于 user-management、Dashboard、Monitor、Reconcile、ModelCatalog、ModelUsage、Settings 等，其余页面仍是裸 fetch |
| F2 | `fetchWithAuth` 与全局拦截器冗余 | `contexts/AuthContext.tsx` | 全局拦截器已自动加 Authorization，`fetchWithAuth` 手动再加一遍，应统一移除 |

### P2 代码质量

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| F3 | `any` 类型滥用 | `App.tsx` 等多处 | providers、搜索结果等用 `any[]` |
| F4 | `marked` 与 `react-markdown` 重复 | `package.json` | 两个 markdown 渲染库并存，留一个 |
| F5 | `App.tsx` 仍混合多职责 | `App.tsx`（214 行） | routing / search / branding / health check / layout 混在一起，可再拆 layout 与 search |

### P3 体验 / 工程

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| F6 | 无前端测试 | — | 0 业务测试 |
| F7 | PWA 配置偏简 | `vite.config.ts` | service worker 设置基础，离线能力有限 |

---

## 四、基础设施待优化

| # | 问题 | 优先级 | 说明 |
|---|---|---|---|
| I1 | 无 CI/CD 流水线 | P1 | 无 `.github/workflows`，仅手动 `build-and-push.sh` |
| I2 | 无自动化测试 | P1 | 前后端均无业务测试，回归全靠人工 |
| I3 | 后端无 lock 文件 | P2 | 无 `requirements.lock` / pip-tools，构建不可复现 |
| I4 | Nginx 缺安全头 | P2 | 无 `Content-Security-Policy`、`Strict-Transport-Security` |
| I5 | 无 HTTPS termination | P2 | Nginx / Docker 无 TLS |
| I6 | 依赖版本未锁上限 | P2 | `openai`/`fastapi`/`chromadb`/`google-genai` 仅 `>=`，主版本升级易炸 |
| I7 | ~~`uploads/contracts` 真实合同曾入库~~ | P2 | **已修复**：`.gitignore` 已忽略，git 未跟踪；本地 `backend/uploads/contracts/` 仍有 2 个运行时合同 PDF（属运行数据，非 git 问题） |

---

## 五、建议处理顺序

1. **先清安全债**：B1–B6（凭据/密钥/限流/MCP 权限）——影响线上安全
2. **补工程基建**：I1–I2（CI + 测试骨架）——为后续重构兜底
3. **治可靠性**：B7–B13（异常处理、AI 熔断、async 统一、schema 单源）——影响线上稳定
4. **统一前端**：F1–F2（全量切 React Query、移除 fetchWithAuth）——降低维护成本
5. **性能与收尾**：B14–B21、F3–F7、I3–I7

> 注：B20/B21/I7 经核实已修复（详见"一、已修复"）。剩余项均为当前代码实查确认存在。
