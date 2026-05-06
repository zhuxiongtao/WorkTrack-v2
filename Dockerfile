# ===== Stage 1: 构建前端 =====
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY frontend/ ./
RUN npm run build


# ===== Stage 2: 最终镜像（后端 + Nginx + 前端静态文件）=====
FROM python:3.11-slim

WORKDIR /app

# 安装 Nginx 和 PostgreSQL 客户端（用于 pg_isready 健康检查）
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY backend/ ./

# 复制前端构建产物到 Nginx 静态目录
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# 删除 Nginx 默认站点配置，避免冲突
RUN rm -f /etc/nginx/sites-enabled/default

# 复制 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 复制启动脚本
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 创建数据目录（ChromaDB 等）
RUN mkdir -p /app/data

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
