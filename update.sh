#!/bin/bash
# WorkTrack 一键更新部署脚本
# 用法: ./update.sh

set -e

echo "📦 拉取最新代码..."
git pull

echo "🔨 重新构建并启动..."
docker compose up --build -d

echo "🧹 清理旧镜像..."
docker image prune -f

echo "✅ 更新完成！"
docker compose ps
