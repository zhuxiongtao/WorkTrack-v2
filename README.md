# WorkTrack v2 — 智能工作管理平台

WorkTrack 是一个面向中小团队的一体化工作管理平台，集成 **日报/周报、项目管理、客户管理、会议纪要、OA 办公、财务审批、审批引擎、数据管理、AI 助手、联网搜索** 等功能，支持用户自行配置 AI 模型供应商（OpenAI 兼容接口）。

<p align="center">
  <img src="screenshot_page.png" alt="WorkTrack 首页" width="80%">
</p>

---

## 核心功能

### 📋 日报 & 周报
- **日报撰写**：支持富文本编辑器 + 文件附件
- **语音录入**：WebM 录音上传 → ASR 自动转文字
- **AI 总结**：单篇日报 AI 精炼总结，可自定义提示词
- **周报汇总**：自动聚合本周日报，AI 生成结构化周报
- **语义搜索**：基于 ChromaDB 的全文 + 向量混合搜索

### 📊 项目管理
- 项目全生命周期管理（阶段、状态、金额、云平台等）
- **AI 项目分析**：基于项目数据生成风险评估与行动建议
- 关联会议记录和客户信息
- **成本利润**：多明细条目（通道费 / 人力 / 硬件 / 软件），自动汇总毛利率
- **跟进记录**：销售/技术双线跟进留痕，关联客户与项目

### 👥 客户管理
- 客户信息全维度记录（行业、产品、规模、官网等）
- **AI 智能搜索公司**：联网搜索 + LLM 提取公司信息
- **AI 自动采集**：获取行业、产品、Logo、最新动态、AI 动向
- 公司 Logo 多源智能加载，失败回退首字母占位
- 支持联系人台账管理

### 🎙️ 会议纪要
- 支持 Markdown 富文本编辑
- **录音转写**：上传音频 → ASR → AI 结构化整理
- **AI 结构化提取**：从纪要中提取决议、待办、结论
- **多人协作**：关联客户/项目、权限分级、评论互动

### 🏢 OA 办公（7 大模块）
- **请假申请**：年假/事假/调休，自动关联假期余额、按工龄档位发放
- **加班申请**：加班时长统计，支持调休折算
- **出差申请**：行程/预算/起止时间，自动计算天数（半天粒度）
- **报销申请**：多主体（公司抬头）、发票明细、Excel 导入、借款抵消、关联出差/采购单
- **采购申请**：采购清单 + 采购供应商台账
- **资产管理**：领用/归还/调拨/维修/报废全流转履历，历任使用人可追溯
- **假期余额**：法定年假按工龄档位（5/10/15 天）HR 一键批量发放，变更日志留痕

### 💰 财务管理
- **付款申请**：供应商付款全流程
- **盖章申请**：合同/文件盖章审批
- **供应商台账**：分类管理（通道/采购/通用），银行/税号信息
- **通道管理**：通讯通道成本核算
- **公司主体**：多法人实体管理
- **员工借款**：借款台账 + 报销抵消

### ✅ 审批引擎
- **动态流程配置**：12 个预设系统审批流，支持审批/执行节点
- **5 种审批人解析**：指定人 / 角色 / 部门负责人 / 上级 / 部门负责人或签
- **条件路由**：按金额、类型等动态分支
- **业务接入**：请假/加班/出差/报销/采购/付款/盖章 7 大业务已接入
- **可视化管理**：流程配置页（浅色/深色双主题）

### 🗄️ 数据管理（管理员专属）
- **Excel 模块导出**：23 个业务模块 / 271 字段中文化映射，支持子表分 Sheet、FK 展开、时间范围筛选
- **全量备份**：JSON 结构化备份（55+ 模型拓扑排序）/ SQL dump（pg_dump custom 格式）
- **数据恢复**：dry-run 预检查 + skip/insert_only 稳妥策略，避免数据覆盖
- **备份历史**：每次备份自动留痕，支持重新下载
- **持久化**：备份文件存于 `/app/data/backups/`（Docker volume 映射）

### 🤖 AI 中心（Agent）
- 对话式 AI 助手，支持多轮对话 + 工具调用
- 可搜索日报、项目、客户、会议、审批等内部数据
- 联网搜索新公司信息并一键录入客户库
- **发票识别**：上传发票图片自动 OCR 回填报销明细
- **专属任务模型**：日报/会议/项目分析/周报/公司信息/看板洞察/发票识别各自独立配置

### 📚 知识库（Wiki）
- Markdown 文档层级管理
- AI 摘要 + 智能补全
- 全文 + 语义搜索

### 📈 数据看板
- 业务数据可视化统计
- AI 洞察：自动分析趋势与异常
- 权限分级展示

### 🔧 模型管理 & 多用户权限
- **用户自管模型**：每用户可配置自己的模型供应商和 API Key
- **共享模型**：管理员配置公共模型，授权用户使用
- **任务模型映射**：按任务类型（对话/嵌入/ASR/视觉/搜索/发票识别）绑定不同模型
- **Tavily 联网搜索**：每用户可配置自己的搜索 API Key
- **AI 提示词自定义**：系统预设 + 用户自定义 + AI 自动生成
- **模型变更管理**：模型上下线事件追踪、客户任务关联

### 🔐 权限体系
- **67 个权限码**覆盖 29 个模块（含 7 个 OA 模块）
- **13 个系统预置角色**：管理员/老板/部门负责人/销售/技术/财务/出纳/HR/印章管理员等
- **权限矩阵**：可视化按模块分组，支持自定义角色
- **数据隔离**：view_all 权限控制跨用户数据可见性

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **后端框架** | FastAPI (Python 3.11+) |
| **ORM** | SQLModel + SQLAlchemy + Alembic 迁移 |
| **数据库** | PostgreSQL 16 |
| **向量数据库** | ChromaDB（语义搜索） |
| **前端** | React 18 + TypeScript + Vite |
| **UI** | Tailwind CSS v4 + Lucide Icons（浅色/深色双主题） |
| **富文本** | TipTap |
| **Excel** | openpyxl（导出/导入） |
| **容器化** | Docker + Docker Compose |
| **AI 接口** | OpenAI 兼容 API（DeepSeek / MiniMax / OpenAI / Gemini / Vertex / Claude / Qwen 等） |

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/zhuxiongtao/WorkTrack-v2.git
cd WorkTrack-v2
```

### 2. 配置环境变量

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`：

```env
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_USER=worktrack
DB_PASSWORD=worktrack
DB_NAME=worktrack

# AI 模型（OpenAI 兼容接口）
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL_NAME=deepseek-chat

# JWT
JWT_SECRET_KEY=your-secret-key-change-me

# Tavily 搜索（可选，用于联网搜索）
TAVILY_API_KEY=your-tavily-key
```

### 3. 启动开发环境

#### Docker（推荐，一键启动）

```bash
docker compose up -d
```

访问 http://localhost

#### 本地开发

```bash
# 后端
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python3 -m alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 前端（新终端）
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

### 4. 初始化管理员

首次启动后访问 http://localhost:5173/setup ，创建管理员账号。

---

## 项目结构

```
WorkTrack-v2/
├── backend/                # FastAPI 后端
│   ├── app/
│   │   ├── models/         # SQLModel 数据模型（55+ 张表）
│   │   ├── routers/        # API 路由（20+ 个模块）
│   │   ├── services/       # 业务逻辑 & AI 服务 & Excel 导出
│   │   ├── auth.py         # JWT 认证 + 密码管理 + 权限装饰器
│   │   ├── config.py       # 配置管理（pydantic-settings）
│   │   └── main.py         # FastAPI 应用入口
│   ├── alembic/            # 数据库迁移（按版本链式管理）
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/               # React 前端
│   ├── src/
│   │   ├── pages/          # 30+ 个页面组件
│   │   ├── components/     # 通用组件（含 SearchableSelect / Modal 等）
│   │   ├── contexts/       # Auth / Theme / Toast
│   │   └── App.tsx         # 根组件 & 路由
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml      # 生产部署编排
├── docker-compose.dev.yml  # 开发环境（PostgreSQL 独立）
├── build-and-push.sh       # Docker 构建推送脚本
└── README.md
```

---

## API 概览

| 模块 | 前缀 | 主要功能 |
|------|------|---------|
| 认证 | `/api/v1/auth` | 登录/注册/改密/头像上传 |
| 日报 | `/api/v1/reports` | CRUD / AI 总结 / 语音转写 |
| 周报 | `/api/v1/weekly` | 周报列表 / AI 生成 |
| 项目 | `/api/v1/projects` | CRUD / AI 分析 / 成本 / 跟进 |
| 客户 | `/api/v1/customers` | CRUD / 公司搜索 / 信息采集 / 联系人 |
| 会议 | `/api/v1/meetings` | CRUD / 录音转写 / AI 纪要 / 协作 |
| 合同 | `/api/v1/contracts` | CRUD / 模板 / 签章 / 审批 |
| OA - 请假 | `/api/v1/leaves` | 申请 / 审批 / 余额扣减 |
| OA - 加班 | `/api/v1/overtimes` | 申请 / 审批 / 调休折算 |
| OA - 出差 | `/api/v1/business-trips` | 申请 / 审批 / 天数计算 |
| OA - 报销 | `/api/v1/expenses` | 申请 / 明细 / 发票识别 / 借款抵消 / Excel 导入 |
| OA - 采购 | `/api/v1/purchases` | 申请 / 审批 / 采购供应商 |
| OA - 资产 | `/api/v1/assets` | CRUD / 领用归还 / 流转履历 |
| OA - 假期 | `/api/v1/leave-balances` | 余额管理 / 工龄档位发放 / 变更日志 |
| 财务 - 付款 | `/api/v1/payments` | 付款申请 / 审批 |
| 财务 - 盖章 | `/api/v1/seals` | 盖章申请 / 审批 |
| 财务 - 供应商 | `/api/v1/suppliers` | 供应商台账 |
| 财务 - 通道 | `/api/v1/channels` | 通道成本管理 |
| 财务 - 公司主体 | `/api/v1/legal-entities` | 多法人实体 |
| 财务 - 员工借款 | `/api/v1/employee-loans` | 借款台账 / 抵消 |
| 审批 | `/api/v1/approvals` | 流程配置 / 实例 / 记录 |
| 数据管理 | `/api/v1/data` | Excel 导出 / JSON 备份 / SQL dump / 恢复 |
| AI 对话 | `/api/v1/ai` | Agent 对话 / 模型信息 / 发票 OCR |
| 搜索 | `/api/v1/search` | 全量语义搜索 |
| 知识库 | `/api/v1/wiki` | 文档 CRUD / AI 摘要 |
| 看板 | `/api/v1/dashboard` | 数据看板 / AI 洞察 |
| 设置 | `/api/v1/settings` | 模型管理 / 提示词 / 字段选项 / 系统配置 / 任务模型 |
| 用户 | `/api/v1/users` | 用户管理 / 角色权限（管理员） |
| 文件 | `/api/v1/files` | 文件上传 / 下载 |
| 初始化 | `/api/v1/setup` | 首次初始化向导 |

---

## AI 模型隔离机制

WorkTrack 支持多用户各自使用自己的 AI 模型：

- **管理员**：配置共享模型供应商，通过「任务模型配置」为每个任务类型绑定模型
- **自管模型用户**（`can_manage_models=true`）：可在设置页配置自己的模型供应商和 API Key
- **共享模型用户**（`use_shared_models=true`）：直接使用管理员配置的共享模型，无需自己配置
- **AI 隔离**：未配置模型 / 未授权共享的用户无法调用任何 AI 功能，前端有全局提醒引导配置
- **任务模型**：每个 AI 任务（对话/日报/会议/项目分析/发票识别等）可独立配置模型，支持视觉模型识别发票

---

## 数据安全

- **数据管理仅管理员可见**：`data:export` / `data:import` 权限独立控制，boss 默认无权限
- **备份文件持久化**：存于 Docker volume `worktrack_data`，容器重建不丢失
- **恢复策略稳妥**：仅支持 `skip` / `insert_only`，不提供 `overwrite`，配合 dry-run 预检查避免数据丢失
- **文件访问控制**：文件下载接口严格限制为管理员权限
- **系统时间统一**：全站时间显示为北京时间（UTC+8），无时区转换

---

## License

MIT
