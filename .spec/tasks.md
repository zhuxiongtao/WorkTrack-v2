# WorkTrack v2 RBAC 权限系统与代码质量优化 — 编码任务规划

## 文档元数据

| 属性 | 值 |
|------|------|
| 版本 | v1.0 |
| 创建日期 | 2026-05-22 |
| 关联需求规格 | spec.md v1.0 |
| 关联实现方案 | design.md v1.0 |
| 总任务数 | 25 |
| 总子任务数 | 56 |

---

# 阶段 0：前置准备（REQ-024, REQ-005）

> 阶段 0 是所有后续阶段的基础，必须最先完成。REQ-024 和 REQ-005 互不依赖，可并行执行。

---

## 1. RBAC 关联表唯一约束 [REQ-024]

- [ ] T0-1: 为 RolePermission、UserRole、DepartmentRole 表添加联合唯一约束
  - **任务ID**: T0-1
  - **关联需求**: REQ-024
  - **修改文件**: `backend/app/database.py`（`init_db()` 函数内添加幂等 ALTER TABLE 语句）
  - **修改内容概要**: 在 `init_db()` 中已有 wiki_space 动态字段迁移逻辑之后，添加三段 `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` 语句（使用 try/except 确保幂等）。约束名分别为 `uq_role_permission(role_id, permission_id)`、`uq_user_role(user_id, role_id)`、`uq_dept_role(department_id, role_id)`
  - **依赖**: 无
  - **风险**: 中 — 现有数据库若存在重复数据会导致约束添加失败，需先清理重复数据
  - **验证方式**: 启动应用后，检查数据库中三张表是否已创建对应唯一约束；尝试插入重复记录应报约束冲突错误

---

## 2. 补全后端权限码定义 [REQ-005]

- [ ] T0-2: 在 PERMISSION_DEFS 中追加缺失的权限码定义
  - **任务ID**: T0-2
  - **关联需求**: REQ-005
  - **修改文件**: `backend/app/database.py`（`PERMISSION_DEFS` 列表和 `ROLE_DEFS` 字典）
  - **修改内容概要**:
    1. 在 `PERMISSION_DEFS` 列表末尾追加 7 个权限码：`dashboard:read`、`task:read`、`task:create`、`task:edit`、`task:delete`、`log:read`、`settings:read`、`settings:edit`（后两个确认是否已存在，已有则跳过）
    2. 在 `ROLE_DEFS` 中为 `dept_leader`、`sales`、`tech`、`operations`、`business`、`boss`、`user` 角色补充新增权限码（如 `dashboard:read` 给所有业务角色，`task:read`/`log:read` 给 `boss` 和 `dept_leader`）
  - **依赖**: 无
  - **验证方式**: 重启应用后调用 `/api/v1/auth/me`，确认管理员用户的 permissions 列表中包含新增权限码；检查数据库 `rbac_permission` 表确认新权限已创建

---

# 阶段 1：RBAC 权限核心统一（REQ-001, REQ-002, REQ-004）

> 阶段 1 是 P0 级别的权限核心改造，必须完成后才能进入阶段 2。REQ-001 和 REQ-002 可并行，REQ-004 独立。

---

## 3. 统一 has_permission() 与 get_user_permissions() 的角色来源 [REQ-001]

- [ ] T1-1: 新增 `_get_all_role_ids()` 统一角色来源计算函数
  - **任务ID**: T1-1
  - **关联需求**: REQ-001
  - **修改文件**: `backend/app/auth.py`
  - **修改内容概要**: 在 `_check_rbac()` 函数之前新增 `_get_all_role_ids(user_id: int, db: Session) -> list[int]` 函数，该函数合并三种角色来源：(1) UserRole 直接分配角色；(2) DepartmentRole 用户所属部门的角色；(3) GroupRole 用户所在用户组的角色（通过 UserGroupMember JOIN）。返回去重后的角色 ID 列表
  - **依赖**: 无
  - **风险**: 低 — 新增函数不影响现有逻辑
  - **验证方式**: 在 Python REPL 或测试中调用 `_get_all_role_ids()` 验证三种角色来源合并正确

- [ ] T1-2: 重构 `_check_rbac()` 使用 `_get_all_role_ids()`
  - **任务ID**: T1-2
  - **关联需求**: REQ-001
  - **修改文件**: `backend/app/auth.py`（`_check_rbac()` 函数，第198-239行）
  - **修改内容概要**: 将 `_check_rbac()` 内部手动查询 UserRole + DepartmentRole 的逻辑替换为调用 `_get_all_role_ids(user_id, db)` 获取 `all_role_ids`，后续权限查询逻辑不变
  - **依赖**: T1-1
  - **风险**: 中 — GroupRole 被新增纳入，部分通过用户组获得角色的用户可能获得新权限（权限放大）
  - **验证方式**: 对比改造前后 `has_permission()` 对同一用户同一权限码的判定结果，确认一致性

- [ ] T1-3: 重构 `get_user_permissions()` 使用 `_get_all_role_ids()`
  - **任务ID**: T1-3
  - **关联需求**: REQ-001
  - **修改文件**: `backend/app/auth.py`（`get_user_permissions()` 函数，第242-285行）
  - **修改内容概要**: 将 `get_user_permissions()` 内部手动查询 UserRole + GroupRole 的逻辑替换为调用 `_get_all_role_ids(user.id, db)` 获取 `all_role_ids`，后续权限 ID 查询和 Legacy 补充逻辑不变
  - **依赖**: T1-1
  - **风险**: 中 — DepartmentRole 被新增纳入 `get_user_permissions()`，部分通过部门角色的用户权限列表会扩大
  - **验证方式**: 对比改造前后 `get_user_permissions()` 返回的权限列表，确认 `has_permission()` 返回 True 的权限都在列表中

---

## 4. 消除 check_data_access() 中的隐式 manager 权限 [REQ-002]

- [ ] T1-4: 移除 `check_data_access()` 中仅凭 Department.manager_id 放行的隐式权限逻辑
  - **任务ID**: T1-4
  - **关联需求**: REQ-002
  - **修改文件**: `backend/app/auth.py`（`check_data_access()` 函数，第345-350行）
  - **修改内容概要**: 删除第345-350行代码段（"部门负责人自动权限"逻辑：`managed = _get_managed_dept_tree(...)` → `if managed:` → `owner_user = ...` → `if owner_user and ... : return True`）。保留 `dept_leader` 角色显式判定路径不变
  - **依赖**: 无
  - **风险**: **高** — 依赖 `Department.manager_id` 获得数据访问权限的用户将被拒绝访问，**部署前需提前通知受影响用户并为其分配 `dept_leader` 角色**
  - **验证方式**: 测试场景：(1) 用户是部门 manager 但无 `dept_leader` 角色 → `check_data_access()` 返回 False；(2) 用户是部门 manager 且有 `dept_leader` 角色 → 返回 True

---

## 5. 修复删除用户函数中的代码重复 [REQ-004]

- [ ] T1-5: 删除 `delete_user()` 函数中 `db.commit()` 后的重复代码段
  - **任务ID**: T1-5
  - **关联需求**: REQ-004
  - **修改文件**: `backend/app/routers/users.py`（第745-786行）
  - **修改内容概要**: 删除第745-786行的全部重复代码（UserGroup清理、UserRole清理、聊天记录清理、日报/会议/周报/偏好/项目/客户/合同/模型/提示词删除、第二次 `db.delete(user)` 和 `db.commit()`）。仅保留第668-744行的一次完整清理逻辑
  - **依赖**: 无
  - **风险**: 低 — 仅去重，逻辑不变
  - **验证方式**: 管理员删除用户后，检查该用户的日报/项目/合同等关联数据是否均被清理，且每个关联表的 DELETE 仅执行一次

---

# 阶段 2：后端路由权限接入（REQ-003, REQ-007, REQ-008, REQ-009, REQ-010, REQ-025）

> 阶段 2 依赖阶段 1 完成（REQ-003 依赖 REQ-001 的 `_get_all_role_ids`）。其余任务相互独立，可并行。

---

## 6. 日报模块接入 RBAC 权限校验 [REQ-003]

- [ ] T2-1: 日报路由所有接口添加 `require_permission()` 依赖注入
  - **任务ID**: T2-1
  - **关联需求**: REQ-003
  - **修改文件**: `backend/app/routers/daily_reports.py`
  - **修改内容概要**:
    1. 修改导入：`from app.auth import get_current_user, require_permission`
    2. 为各接口替换/添加权限依赖注入：`list_weekly_reports` → `require_permission("report:read")`、`list_reports_grouped` → `require_permission("report:read")`、`list_reports` → `require_permission("report:read")`、`get_report` → `require_permission("report:read")`、`create_report` → `require_permission("report:create")`、`update_report` → `require_permission("report:edit")`、`delete_report` → `require_permission("report:delete")`、上传文件/语音转写 → `require_permission("report:create")`、AI总结 → `require_permission("report:edit")`、周报相关 → `report:read`/`report:create`/`report:edit`
  - **依赖**: T1-2（REQ-001 统一角色来源完成后，`require_permission` 才能正确判定权限）
  - **风险**: **高** — 未分配 `report:*` 角色的用户将被 403 拒绝，**需先确认所有用户已分配 `user` 基础角色**
  - **验证方式**: 无 `report:read` 权限的用户访问 GET /api/v1/reports → HTTP 403；有权限用户 → HTTP 200

---

## 7. 项目模块接入 RBAC 权限校验 [REQ-003]

- [ ] T2-2: 项目路由所有接口添加 `require_permission()` 依赖注入
  - **任务ID**: T2-2
  - **关联需求**: REQ-003
  - **修改文件**: `backend/app/routers/projects.py`
  - **修改内容概要**:
    1. 修改导入：`from app.auth import get_current_user, require_permission`
    2. 为各接口替换权限依赖注入：`list_projects` → `require_permission("project:read")`、`create_project` → `require_permission("project:create")`、`get_project` → `require_permission("project:read")`、`update_project` → `require_permission("project:edit")`、`delete_project` → `require_permission("project:delete")`、AI分析 → `require_permission("project:edit")`、获取项目会议 → `require_permission("project:read")`
  - **依赖**: T1-2
  - **风险**: **高** — 同 T2-1
  - **验证方式**: 无 `project:create` 权限的用户 POST /api/v1/projects → HTTP 403

---

## 8. 会议模块接入 RBAC 权限校验 [REQ-003]

- [ ] T2-3: 会议路由所有接口添加 `require_permission()` 依赖注入
  - **任务ID**: T2-3
  - **关联需求**: REQ-003
  - **修改文件**: `backend/app/routers/meetings.py`
  - **修改内容概要**:
    1. 修改导入：`from app.auth import get_current_user, require_permission`
    2. 为各接口替换权限依赖注入：`list_meetings` → `require_permission("meeting:read")`、`create_meeting` → `require_permission("meeting:create")`、`update_meeting` → `require_permission("meeting:edit")`、`delete_meeting` → `require_permission("meeting:delete")`、AI提取/上传音频/转写/转写整理 → `require_permission("meeting:edit")`
  - **依赖**: T1-2
  - **风险**: **高** — 同 T2-1
  - **验证方式**: 无 `meeting:read` 权限的用户 GET /api/v1/meetings → HTTP 403

---

## 9. 补全 get_optional_user() 的安全校验 [REQ-007]

- [ ] T2-4: 在 `get_optional_user()` 中添加 token_version 和账号状态校验
  - **任务ID**: T2-4
  - **关联需求**: REQ-007
  - **修改文件**: `backend/app/auth.py`（`get_optional_user()` 函数，第142-155行）
  - **修改内容概要**: 在 `user = db.get(User, int(user_id))` 之后、`return user` 之前，添加两段校验：(1) 校验 `token_version`：`token_tv = payload.get("tv", 0); if token_tv != user.token_version: return None`；(2) 校验账号状态：`if user.status in ("resigned", "disabled") or not user.is_active: return None`
  - **依赖**: 无
  - **风险**: 低 — 仅补全校验逻辑，`get_optional_user()` 用于公开接口的可选认证
  - **验证方式**: 使用已离职用户的 Token 调用使用 `get_optional_user` 的公开接口 → 返回 None（相当于未登录）

---

## 10. Wiki 模块接入 RBAC 前置权限 [REQ-008]

- [ ] T2-5: Wiki 路由所有非公开接口添加 `require_permission()` 前置权限校验
  - **任务ID**: T2-5
  - **关联需求**: REQ-008
  - **修改文件**: `backend/app/routers/wiki.py`
  - **修改内容概要**:
    1. 修改导入：`from app.auth import get_current_user, require_permission`
    2. 为各接口添加 RBAC 前置权限：查看空间/页面列表 → `require_permission("wiki:read")`、创建空间/页面 → `require_permission("wiki:create")`、编辑空间/页面 → `require_permission("wiki:edit")`、删除空间/页面 → `require_permission("wiki:delete")`、管理权限 → `require_permission("wiki:manage_space")`
    3. 公开外链接口（`/public/pages/{page_id}`、`/public/spaces/{space_id}/pages`）不做 RBAC 前置约束，保持原逻辑
  - **依赖**: T0-2（权限码 `wiki:*` 已定义）
  - **风险**: 中 — 无 `wiki:read` 权限的用户将无法访问 Wiki
  - **验证方式**: 无 `wiki:read` 权限的用户访问 GET /api/v1/wiki/spaces → HTTP 403；有权限但无空间授权 → 返回空列表（200）

---

## 11. 文件服务接口添加认证保护 [REQ-009]

- [ ] T2-6: 头像和音频文件服务接口添加 `get_current_user` 认证
  - **任务ID**: T2-6
  - **关联需求**: REQ-009
  - **修改文件**: `backend/app/routers/auth.py`（第220-226行 `serve_avatar`）、`backend/app/routers/meetings.py`（`serve_audio` 接口）
  - **修改内容概要**:
    1. `serve_avatar()`: 添加参数 `current_user: User = Depends(get_current_user)`，并添加导入 `from app.auth import get_current_user`
    2. `serve_audio()`: 添加参数 `current_user: User = Depends(get_current_user)`（已有 `get_current_user` 导入）
  - **依赖**: 无
  - **风险**: 低 — 仅添加认证，已认证用户无影响
  - **验证方式**: 未认证请求 GET /api/v1/auth/avatar-file/xxx → HTTP 401；已认证用户 → 200

---

## 12. 模型测试接口添加认证保护 [REQ-010]

- [ ] T2-7: 模型供应商测试和模型测试接口添加 `get_current_user` 认证
  - **任务ID**: T2-7
  - **关联需求**: REQ-010
  - **修改文件**: `backend/app/routers/settings.py`（第265行 `test_provider_model` 和第326行 `test_provider`）
  - **修改内容概要**: 为两个函数添加参数 `current_user: User = Depends(get_current_user)`，并确保已导入 `from app.auth import get_current_user`
  - **依赖**: 无
  - **风险**: 低 — 未认证用户将无法触发外部 API 调用，防止滥用
  - **验证方式**: 未认证请求 POST /api/v1/settings/providers/1/test → HTTP 401

---

## 13. 字段选项列表接口添加认证 [REQ-025]

- [ ] T2-8: `list_field_options()` 和 `list_field_categories()` 添加 `get_current_user` 认证
  - **任务ID**: T2-8
  - **关联需求**: REQ-025
  - **修改文件**: `backend/app/routers/settings.py`（第529行 `list_field_options` 和第588行 `list_field_categories`）
  - **修改内容概要**: 为两个函数添加参数 `current_user: User = Depends(get_current_user)`，确保导入
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: 未认证请求 GET /api/v1/settings/field-options → HTTP 401

---

# 阶段 3：前端权限对齐（REQ-006, REQ-012, REQ-013, REQ-014, REQ-022, REQ-023）

> 阶段 3 依赖阶段 2 完成（REQ-006 依赖后端权限接入完成，REQ-014 依赖 REQ-003）。其余任务相互独立。

---

## 14. 补全前端路由权限守卫 [REQ-006]

- [ ] T3-1: 为所有业务页面路由添加 `hasPermission` 守卫
  - **任务ID**: T3-1
  - **关联需求**: REQ-006
  - **修改文件**: `frontend/src/App.tsx`（第668-684行路由定义）
  - **修改内容概要**: 改造路由定义，为所有需要权限的页面添加守卫：
    - `/reports` → `hasPermission('report:read') ? <ReportHubPage /> : <Navigate to="/" replace />`
    - `/projects` → `hasPermission('project:read') ? ...`
    - `/meetings` → `hasPermission('meeting:read') ? ...`
    - `/ai` → `hasPermission('ai:use') ? ...`
    - `/tasks` → `hasPermission('task:read') ? ...`
    - `/logs` → `hasPermission('log:read') ? ...`
    - `/users` → `hasPermission('user:read') ? ...`（替代 `isAdmin`）
    - `/dashboard` → `hasPermission('dashboard:read') ? ...`
    - `/wiki` → `hasPermission('wiki:read') ? ...`
    - `/settings` 不做路由守卫（所有登录用户可访问）
  - **依赖**: T2-1, T2-2, T2-3（后端权限接入完成），T0-2（权限码已定义）
  - **风险**: 中 — 权限码不匹配会导致所有用户无法访问页面
  - **验证方式**: 无 `report:read` 权限的用户直接访问 `/reports` URL → 重定向到首页

- [ ] T3-2: 为侧边栏导航项添加权限条件渲染
  - **任务ID**: T3-2
  - **关联需求**: REQ-006
  - **修改文件**: `frontend/src/App.tsx`（侧边栏导航渲染逻辑）
  - **修改内容概要**: 为所有未做权限守卫的导航项添加 `hasPermission` 条件渲染：AI → `hasPermission('ai:use')`、Wiki → `hasPermission('wiki:read')`、Dashboard → `hasPermission('dashboard:read')`、Reports → `hasPermission('report:read')`、Projects → `hasPermission('project:read')`、Meetings → `hasPermission('meeting:read')`、Tasks → `hasPermission('task:read')`、Users → `hasPermission('user:read')`（替代 `isAdmin`）
  - **依赖**: T3-1
  - **风险**: 低
  - **验证方式**: 无权限用户在侧边栏看不到对应导航项

---

## 15. 前端 API 错误处理统一 [REQ-012]

- [ ] T3-3: 在全局 fetch 拦截器中统一处理 401 响应
  - **任务ID**: T3-3
  - **关联需求**: REQ-012
  - **修改文件**: `frontend/src/contexts/AuthContext.tsx`（第54-82行全局 fetch 拦截器）
  - **修改内容概要**: 在拦截器的 `originalFetch.current!(input, newInit)` 返回 response 后，检查 `response.status === 401`，若为 401 则清除登录状态（`localStorage.removeItem('auth_token')`、`setToken(null)`、`setUser(null)`）并跳转登录页（`window.location.href = '/login'`）
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: Token 过期后操作页面 → 自动跳转登录页

---

## 16. 修复全局 fetch 拦截器 Strict Mode 兼容性 [REQ-013]

- [ ] T3-4: 使用模块级变量确保拦截器仅设置一次
  - **任务ID**: T3-4
  - **关联需求**: REQ-013
  - **修改文件**: `frontend/src/contexts/AuthContext.tsx`
  - **修改内容概要**:
    1. 在模块顶层添加 `let _originalFetch: typeof fetch | null = null` 和 `let _interceptorInstalled = false`
    2. 在 `useEffect` 中检查 `_interceptorInstalled`，若已安装则直接返回
    3. 设置拦截器时标记 `_interceptorInstalled = true`
    4. 清理函数中恢复 `_interceptorInstalled = false` 并还原 `window.fetch`
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: React Strict Mode 下拦截器不重复设置，网络请求中 Authorization header 仅出现一次

---

## 17. 前端项目/会议/日报管理者操作支持 [REQ-014]

- [ ] T3-5: 项目页面编辑/删除操作改用权限码判定可见性
  - **任务ID**: T3-5
  - **关联需求**: REQ-014
  - **修改文件**: `frontend/src/pages/ProjectsPage.tsx`
  - **修改内容概要**: 将编辑/删除操作的显示条件从 `item.user_id === user.id` 改为 `hasPermission('project:edit')` 或 `hasPermission('project:delete')`。同时保留数据属主检查用于行级控制（即自己创建的项目始终可编辑）
  - **依赖**: T2-2（项目模块后端权限接入完成）
  - **风险**: 低
  - **验证方式**: 部门负责人可看到下属项目的编辑/删除按钮

- [ ] T3-6: 会议页面编辑/删除操作改用权限码判定可见性
  - **任务ID**: T3-6
  - **关联需求**: REQ-014
  - **修改文件**: `frontend/src/pages/MeetingsPage.tsx`
  - **修改内容概要**: 同 T3-5，将编辑/删除操作改为 `hasPermission('meeting:edit')`/`hasPermission('meeting:delete')`
  - **依赖**: T2-3
  - **风险**: 低
  - **验证方式**: 同 T3-5

- [ ] T3-7: 日报页面查看他人日报操作改用权限码判定可见性
  - **任务ID**: T3-7
  - **关联需求**: REQ-014
  - **修改文件**: `frontend/src/pages/ReportHubPage.tsx`
  - **修改内容概要**: 将"查看全部日报"入口的显示条件改为 `hasPermission('report:view_all')`，编辑/删除操作改为 `hasPermission('report:edit')`/`hasPermission('report:delete')`
  - **依赖**: T2-1
  - **风险**: 低
  - **验证方式**: 部门负责人可查看下属日报并显示编辑/删除入口

---

## 18. 前端 API 调用统一使用 fetchWithAuth [REQ-022]

- [ ] T3-8: 审计并替换前端中直接拼接 Authorization header 的 API 调用
  - **任务ID**: T3-8
  - **关联需求**: REQ-022
  - **修改文件**: `frontend/src/App.tsx` 及各页面文件（需全面审计）
  - **修改内容概要**:
    1. 将 `fetch(url, { headers: { Authorization: \`Bearer ${localStorage.getItem('auth_token')}\` } })` 改为 `fetch(url)`（依赖全局拦截器）
    2. 将 `fetch('/api/v1/auth/me', { headers: { Authorization: ... } })` 等调用改为直接 `fetch('/api/v1/auth/me')`
    3. 全面搜索 `localStorage.getItem('auth_token')` 在 fetch 调用中的直接使用并替换
  - **依赖**: 无
  - **风险**: 低 — 全局拦截器已自动添加 Authorization header
  - **验证方式**: 代码中不再存在 fetch 调用中手动拼接 Authorization header 的情况；所有 API 请求仍正常工作

---

## 19. 登录响应字段完整性 [REQ-023]

- [ ] T3-9: `/auth/login` 和 `/auth/register` 返回完整 user 对象
  - **任务ID**: T3-9
  - **关联需求**: REQ-023
  - **修改文件**: `backend/app/routers/auth.py`（第81-88行 register 和第113-120行 login 的返回值）
  - **修改内容概要**: 将 login 和 register 返回的 user 对象补全至与 `/auth/me` 一致：追加 `email`、`is_active`、`avatar`、`last_login_at`（ISO格式字符串）字段。当前缺失字段：`email`、`is_active`、`avatar`、`last_login_at`
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: 登录成功后检查返回的 user 对象包含 `email`、`is_active`、`avatar`、`last_login_at` 字段；登录后无需刷新即可显示头像

---

# 阶段 4：代码质量优化（REQ-011, REQ-015, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021）

> 阶段 4 的所有任务相互独立，可全部并行执行。

---

## 20. 合同后台解析改用 BackgroundTasks [REQ-011]

- [ ] T4-1: 将 `threading.Thread` 替换为 FastAPI `BackgroundTasks`
  - **任务ID**: T4-1
  - **关联需求**: REQ-011
  - **修改文件**: `backend/app/routers/contracts.py`
  - **修改内容概要**:
    1. 移除 `import threading`（第3行）
    2. 在 `create_contract()` 函数签名中添加 `background_tasks: BackgroundTasks` 参数，并添加 `from fastapi import BackgroundTasks` 导入
    3. 将第123行 `threading.Thread(target=_auto_parse_contract, args=(...), daemon=True).start()` 替换为 `background_tasks.add_task(_auto_parse_contract_safe, contract.id, current_user.id)`
    4. 新增 `_auto_parse_contract_safe(contract_id: int, user_id: int)` 包装函数：创建独立 Session、调用 `_auto_parse_contract`、异常处理并写日志
    5. 改造 `_auto_parse_contract()` 接受 `db: Session` 参数而非手动创建 Session
  - **依赖**: 无
  - **风险**: 低 — BackgroundTasks 是 FastAPI 标准方式，改造后行为一致
  - **验证方式**: 上传合同文件后，等待后台解析完成，检查合同 `raw_text` 非空；确认不再使用 `threading.Thread`

---

## 21. Dashboard 连续天数查询优化 [REQ-015]

- [ ] T4-2: 将循环逐日查询改为一次批量查询
  - **任务ID**: T4-2
  - **关联需求**: REQ-015
  - **修改文件**: `backend/app/routers/dashboard.py`（第210-227行 streak_days 计算逻辑）
  - **修改内容概要**: 将循环中每次 `db.exec(select(DailyReport).where(...))` 查询改为一次批量查询 `recent_reports = db.exec(select(DailyReport.report_date).where(DailyReport.user_id == current_user.id, DailyReport.report_date >= today - timedelta(days=90), DailyReport.report_date <= today)).all()`，然后转换为 `set` 在循环中用 `d in report_dates` 判断
  - **依赖**: 无
  - **风险**: 低 — 逻辑不变，仅优化性能
  - **验证方式**: 连续天数计算结果与优化前一致；接口响应时间 P95 < 500ms

---

## 22. Dashboard 统计接口数据库层过滤 [REQ-016]

- [ ] T4-3: 项目/客户统计使用 SQL WHERE 条件替代 Python 内存过滤
  - **任务ID**: T4-3
  - **关联需求**: REQ-016
  - **修改文件**: `backend/app/routers/dashboard.py`（第86-117行项目/客户统计逻辑）
  - **修改内容概要**:
    1. 项目统计：将 `db.exec(select(Project).where(Project.user_id == current_user.id)).all()` + Python 过滤改为使用 SQL WHERE 条件 `Project.created_at <= range_end_datetime` 和 `Project.created_at >= range_start_datetime` 进行日期范围过滤，新建项目数量使用 `func.count()` 查询
    2. 客户统计：同上改造
    3. 需要处理 `range_start`/`range_end`（date 类型）到 `datetime` 的转换，用于 `created_at`（datetime 类型）的比较
  - **依赖**: 无
  - **风险**: 低 — 逻辑不变，仅优化性能
  - **验证方式**: 统计结果与优化前一致；不再全量加载 projects/customers

---

## 23. AI 对话列表 N+1 查询优化 [REQ-017]

- [ ] T4-4: 使用子查询一次性获取每个对话的消息数量
  - **任务ID**: T4-4
  - **关联需求**: REQ-017
  - **修改文件**: `backend/app/routers/ai_agent.py`（第76-91行 `list_conversations` 函数）
  - **修改内容概要**: 将逐个查询消息数量改为使用子查询 JOIN：创建 `msg_count_subq = select(ChatMessage.conversation_id, func.count(ChatMessage.id).label("msg_count")).group_by(ChatMessage.conversation_id).subquery()`，然后 `select(ChatConversation, func.coalesce(msg_count_subq.c.msg_count, 0)).outerjoin(msg_count_subq, ...)` 一次查询获取所有对话及消息数量
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: 对话列表返回结果与优化前一致；仅使用1次 JOIN 查询

---

## 24. system-info 接口计数优化 [REQ-018]

- [ ] T4-5: 使用 `func.count()` 替代全量加载
  - **任务ID**: T4-5
  - **关联需求**: REQ-018
  - **修改文件**: `backend/app/routers/settings.py`（第1024-1031行 `system_info` 函数）
  - **修改内容概要**: 将 `db.exec(select(ModelProvider)).all()` 和 `db.exec(select(User)).all()` 替换为 `db.exec(select(func.count(ModelProvider.id))).one()` 和 `db.exec(select(func.count(User.id))).one()`。对于 `configured_count`、`active_count`、`admin_count` 等需要条件计数的，改用 `func.count()` + WHERE 条件，或使用单次全量查询的精简版（仅在需要多维度统计时）
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: system-info 接口返回的计数结果与优化前一致

---

## 25. 合同搜索改用 ilike 模糊匹配 [REQ-019]

- [ ] T4-6: 将 `contains` 改为 `ilike` 模糊匹配
  - **任务ID**: T4-6
  - **关联需求**: REQ-019
  - **修改文件**: `backend/app/routers/contracts.py`（第47-53行搜索逻辑）
  - **修改内容概要**: 将 `Contract.title.contains(keyword)` 等替换为 `Contract.title.ilike(f"%{keyword}%")`，同样应用于 `contract_no`、`summary`、`raw_text` 字段
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: 输入小写关键词可匹配到大写标题的合同

---

## 26. 清除 Wiki 调试代码 [REQ-020]

- [ ] T4-7: 删除 Wiki 路由中的 `print("DEBUG")` 调试语句
  - **任务ID**: T4-7
  - **关联需求**: REQ-020
  - **修改文件**: `backend/app/routers/wiki.py`（第252行）
  - **修改内容概要**: 删除 `print("DEBUG UPDATE SPACE: ", update_data)` 语句
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: 代码中搜索 `print("DEBUG` 无结果

---

## 27. 修复 DepartmentRoleSet 重复定义 [REQ-021]

- [ ] T4-8: 删除 `users.py` 中重复的 `DepartmentRoleSet` 类定义
  - **任务ID**: T4-8
  - **关联需求**: REQ-021
  - **修改文件**: `backend/app/routers/users.py`（第144行）
  - **修改内容概要**: 删除第144行的重复 `class DepartmentRoleSet(BaseModel): role_ids: List[int] = []` 定义，仅保留第86行的定义
  - **依赖**: 无
  - **风险**: 低
  - **验证方式**: `users.py` 中 `DepartmentRoleSet` 仅定义一次

---

# 验证与测试

## 28. 权限系统端到端验证

- [ ] T5-1: 权限一致性验证测试
  - **验证内容**:
    - `has_permission()` 与前端 `hasPermission()` 对同一用户同一权限码的判定结果一致
    - 部门角色/用户组角色均被 `has_permission()` 和 `get_user_permissions()` 正确识别
    - `check_data_access()` 中 manager 隐式权限已被移除
  - **依赖**: 阶段 1 + 阶段 2 + 阶段 3 全部完成

- [ ] T5-2: 安全性验证测试
  - **验证内容**:
    - 未认证请求访问受保护接口 → HTTP 401
    - 已离职/停用用户的 Token → 被拒绝
    - 无权限用户直接访问前端受限 URL → 重定向首页
  - **依赖**: 阶段 1 + 阶段 2 + 阶段 3 全部完成

- [ ] T5-3: 代码质量优化验证测试
  - **验证内容**:
    - Dashboard 接口响应时间 P95 < 500ms
    - 删除用户不重复执行关联数据清理
    - 合同搜索大小写不敏感
    - 代码中无 `print("DEBUG")` 和 `DepartmentRoleSet` 重复定义
  - **依赖**: 阶段 4 全部完成

---

# 任务依赖关系图

```
阶段0（可并行）:
  T0-1 ─┐
  T0-2 ─┤
        ↓
阶段1（T1-1先，T1-2/T1-3依赖T1-1，T1-4/T1-5独立）:
  T1-1 → T1-2
  T1-1 → T1-3
  T1-4 (独立)
  T1-5 (独立)
        ↓
阶段2（T2-1/T2-2/T2-3依赖T1-2，其余独立，可并行）:
  T1-2 → T2-1, T2-2, T2-3
  T0-2 → T2-5
  T2-4 (独立)
  T2-6 (独立)
  T2-7 (独立)
  T2-8 (独立)
        ↓
阶段3（T3-1依赖阶段2，其余多数独立）:
  T2-1,T2-2,T2-3,T0-2 → T3-1 → T3-2
  T3-3 (独立)
  T3-4 (独立)
  T2-2 → T3-5
  T2-3 → T3-6
  T2-1 → T3-7
  T3-8 (独立)
  T3-9 (独立)
        ↓
阶段4（全部独立，可并行）:
  T4-1 ~ T4-8 (全部独立)
```

---

# 风险汇总

| 风险等级 | 任务ID | 风险描述 | 缓解措施 |
|---------|--------|---------|---------|
| 🔴 高 | T1-4 | 消除 manager 隐式权限后，依赖 manager_id 的用户将失去数据访问权限 | **部署前**：为所有部门 manager 分配 `dept_leader` 角色；通知受影响用户 |
| 🔴 高 | T2-1 | 日报模块接入 RBAC 后，未分配角色的用户被 403 拒绝 | **部署前**：确认所有用户已分配 `user` 基础角色 |
| 🔴 高 | T2-2 | 项目模块接入 RBAC 后，同上 | 同 T2-1 |
| 🔴 高 | T2-3 | 会议模块接入 RBAC 后，同上 | 同 T2-1 |
| 🟡 中 | T1-2 | GroupRole 纳入 `_check_rbac()` 后，部分用户权限可能放大 | 回滚 `_check_rbac()` 至旧逻辑 |
| 🟡 中 | T1-3 | DepartmentRole 纳入 `get_user_permissions()` 后，部分用户权限列表扩大 | 回滚 `get_user_permissions()` 至旧逻辑 |
| 🟡 中 | T0-1 | 现有重复数据导致唯一约束添加失败 | 先清理重复数据再添加约束 |
| 🟡 中 | T2-5 | Wiki RBAC 前置权限导致无 `wiki:read` 用户无法访问 | 回滚 Wiki 路由移除 `require_permission` |
| 🟡 中 | T3-1 | 权限码不匹配导致所有用户无法访问页面 | 回滚 App.tsx 路由定义 |

---

# 并行执行建议

| 并行组 | 可并行任务 | 预计总耗时 |
|--------|-----------|-----------|
| 阶段0 | T0-1, T0-2 | 1h |
| 阶段1-独立 | T1-1, T1-4, T1-5 | 1.5h |
| 阶段1-依赖 | T1-2, T1-3 | 1h |
| 阶段2-权限接入 | T2-1, T2-2, T2-3 | 1.5h（可并行） |
| 阶段2-独立 | T2-4, T2-5, T2-6, T2-7, T2-8 | 1.5h（可并行） |
| 阶段3-路由守卫 | T3-1, T3-2 | 1h |
| 阶段3-独立 | T3-3, T3-4, T3-5, T3-6, T3-7, T3-8, T3-9 | 2h（可并行） |
| 阶段4 | T4-1 ~ T4-8 | 2h（全部可并行） |
| **总计** | | **约 11.5h**（串行约 25h） |
