# ============================================
# WorkTrack v2 - 飞牛 NAS 环境变量配置
# ============================================
# 复制此文件为 .env.nas 并修改以下配置后启动

# ----- 访问端口 -----
# 在浏览器中通过 http://<NAS_IP>:8080 访问 WorkTrack
# 如果 8080 端口冲突，可以改为其他端口
APP_PORT=8080

# ----- 数据库配置 -----
DB_USER=worktrack
DB_PASSWORD=worktrack
DB_NAME=worktrack

# ----- AI 大语言模型配置 -----
# 必填：你的 LLM API Key（支持 DeepSeek / OpenAI / MiniMax 等 OpenAI 兼容 API）
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-your-key-here
LLM_MODEL_NAME=deepseek-chat

# ----- Embedding 向量模型配置（可选）-----
# 不填则自动复用上面的 LLM 配置
# EMBEDDING_BASE_URL=
# EMBEDDING_API_KEY=
# EMBEDDING_MODEL_NAME=text-embedding-3-small

# ----- 安全配置 -----
#!!! 生产环境务必修改为随机长字符串（可用 openssl rand -hex 32 生成）
JWT_SECRET_KEY=change-me-in-production

# 允许的跨域来源（NAS 部署用 * 即可）
CORS_ORIGINS=*

# 是否允许注册新用户（启动后建议先注册管理员账号，然后关闭）
# ALLOW_REGISTRATION=false

# ----- 联网搜索（可选）-----
# 如需 AI 联网搜索功能，填入 Tavily API Key https://tavily.com/
# TAVILY_API_KEY=
