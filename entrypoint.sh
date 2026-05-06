#!/bin/bash
set -e

echo "=========================================="
echo "  WorkTrack Container Startup"
echo "=========================================="

# ── 0. 解析数据库连接参数 ──
# 支持通过 DATABASE_URL 环境变量或拆分参数两种方式
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-worktrack}"
DB_PASSWORD="${DB_PASSWORD:-worktrack}"
DB_NAME="${DB_NAME:-worktrack}"

# 如果设置了 DATABASE_URL，优先使用
if [ -n "$DATABASE_URL" ]; then
    echo "[setup] 使用 DATABASE_URL 环境变量"
    # 从 URL 中提取连接信息用于健康检查
    # 格式: postgresql://user:pass@host:port/db
    DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    DB_PASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@[^:/]*:\([0-9]*\)/.*|\1|p')
    DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')
    DB_PORT="${DB_PORT:-5432}"
else
    export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    echo "[setup] 使用独立环境变量构建 DATABASE_URL"
fi

echo "[setup] DB_HOST=$DB_HOST DB_PORT=$DB_PORT DB_NAME=$DB_NAME"

# ── 1. 等待 PostgreSQL 就绪 ──
echo "[setup] 等待 PostgreSQL 就绪..."
MAX_RETRIES=30
RETRY_COUNT=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "[setup] ❌ PostgreSQL 连接超时，请检查数据库配置"
        exit 1
    fi
    echo "[setup] 等待数据库... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
done
echo "[setup] ✅ PostgreSQL 已就绪"

# ── 2. 运行数据库迁移 ──
echo "[setup] 运行数据库迁移..."
cd /app
python -m alembic upgrade head
echo "[setup] ✅ 数据库迁移完成"

# ── 3. 启动后端 (uvicorn) ──
echo "[setup] 启动后端服务 (uvicorn)..."
cd /app
uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
echo "[setup] 后端 PID: $BACKEND_PID"

# 等待后端就绪
echo "[setup] 等待后端就绪..."
for i in $(seq 1 15); do
    if curl -s http://127.0.0.1:8000/health > /dev/null 2>&1; then
        echo "[setup] ✅ 后端已就绪"
        break
    fi
    sleep 1
done

# ── 4. 启动 Nginx ──
echo "[setup] 启动 Nginx..."
nginx -g "daemon off;" &
NGINX_PID=$!
echo "[setup] Nginx PID: $NGINX_PID"

echo "=========================================="
echo "  WorkTrack 已启动"
echo "  后端: http://127.0.0.1:8000"
echo "  前端: http://0.0.0.0:80"
echo "=========================================="

# ── 5. 监听进程 ──
# 任一进程退出则终止容器
wait -n $BACKEND_PID $NGINX_PID
EXIT_CODE=$?
echo "[shutdown] 进程退出 (code=$EXIT_CODE)，正在停止所有服务..."
kill $BACKEND_PID $NGINX_PID 2>/dev/null || true
wait
exit $EXIT_CODE
