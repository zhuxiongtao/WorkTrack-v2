# WorkTrack v2 — 智能工作管理平台

WorkTrack 是一个面向个人与小团队的工作管理平台，集成 **日报/周报、项目管理、客户管理、会议纪要、AI 助手、联网搜索** 等功能，支持用户自行配置 AI 模型供应商（OpenAI 兼容接口）。

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

### 👥 客户管理
- 客户信息全维度记录（行业、产品、规模、官网等）
- **AI 智能搜索公司**：联网搜索 + LLM 提取公司信息
- **AI 自动采集**：获取行业、产品、Logo、最新动态
- 公司 Logo 多源智能加载，失败回退首字母占位

### 🎙️ 会议纪要
- 支持 Markdown 富文本编辑
- **录音转写**：上传音频 → ASR → AI 结构化整理
- **AI 结构化提取**：从纪要中提取决议、待办、结论

### 🤖 AI 中心（Agent）
- 对话式 AI 助手，支持多轮对话 + 工具调用
- 可搜索日报、项目、客户、会议等内部数据
- 联网搜索新公司信息并一键录入客户库

### 🔧 模型管理 & 多用户权限
- **用户自管模型**：每用户可配置自己的模型供应商和 API Key
- **共享模型**：管理员配置公共模型，授权用户使用
- **任务模型映射**：按任务类型（对话/嵌入/ASR/视觉/搜索）绑定不同模型
- **Tavily 联网搜索**：每用户可配置自己的搜索 API Key
- **AI 提示词自定义**：系统预设 + 用户自定义 + AI 自动生成

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **后端框架** | FastAPI (Python 3.10+) |
| **ORM** | SQLModel + SQLAlchemy |
| **数据库** | PostgreSQL 16 |
| **向量数据库** | ChromaDB（语义搜索） |
| **前端** | React 18 + TypeScript + Vite |
| **UI** | Tailwind CSS v4 + Lucide Icons |
| **富文本** | TipTap |
| **容器化** | Docker + Docker Compose |
| **AI 接口** | OpenAI 兼容 API（DeepSeek / MiniMax / OpenAI / 自定义） |

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/YOUR_USERNAME/WorkTrack-v2.git
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
│   │   ├── models/         # SQLModel 数据模型（13 张表）
│   │   ├── routers/        # API 路由（14 个模块）
│   │   ├── services/       # 业务逻辑 & AI 服务
│   │   ├── auth.py         # JWT 认证 + 密码管理
│   │   ├── config.py       # 配置管理（pydantic-settings）
│   │   └── main.py         # FastAPI 应用入口
│   ├── alembic/            # 数据库迁移
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/               # React 前端
│   ├── src/
│   │   ├── pages/          # 14 个页面组件
│   │   ├── components/     # 通用组件
│   │   ├── contexts/       # Auth / Theme / Toast
│   │   └── App.tsx         # 根组件 & 路由
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml      # 生产部署编排
├── docker-compose.dev.yml  # 开发环境（PostgreSQL 独立）
└── README.md
```

---

## API 概览

| 模块 | 前缀 | 主要功能 |
|------|------|---------|
| 认证 | `/api/v1/auth` | 登录/注册/改密/头像上传 |
| 日报 | `/api/v1/reports` | CRUD / AI 总结 / 语音转写 |
| 周报 | `/api/v1/weekly` | 周报列表 / AI 生成 |
| 项目 | `/api/v1/projects` | CRUD / AI 分析 |
| 客户 | `/api/v1/customers` | CRUD / 公司搜索 / 信息采集 |
| 会议 | `/api/v1/meetings` | CRUD / 录音转写 / AI 纪要 |
| AI 对话 | `/api/v1/ai` | Agent 对话 / 模型信息 |
| 搜索 | `/api/v1/search` | 全量语义搜索 |
| 设置 | `/api/v1/settings` | 模型管理 / 提示词 / 字段选项 / 系统配置 |
| 用户 | `/api/v1/users` | 用户管理（管理员） |
| 看板 | `/api/v1/dashboard` | 数据看板 / AI 洞察 |
| 文件 | `/api/v1/files` | 文件上传 / 下载 |
| 初始化 | `/api/v1/setup` | 首次初始化向导 |

---

## AI 模型隔离机制

WorkTrack 支持多用户各自使用自己的 AI 模型：

- **管理员**：配置共享模型供应商，通过「任务模型配置」为每个任务类型绑定模型
- **自管模型用户**（`can_manage_models=true`）：可在设置页配置自己的模型供应商和 API Key
- **共享模型用户**（`use_shared_models=true`）：直接使用管理员配置的共享模型，无需自己配置
- **AI 隔离**：未配置模型 / 未授权共享的用户无法调用任何 AI 功能，前端有全局提醒引导配置

---

## License

MIT

---

## 截图

<details>
<summary>点击展开更多截图</summary>

### 日报页面
<img src="screenshot_reports.png" alt="日报" width="80%">

### 项目管理
<img src="screenshot_projects.png" alt="项目" width="80%">

### 登录
<img src="screenshot_login.png" alt="登录" width="40%">

</details>
