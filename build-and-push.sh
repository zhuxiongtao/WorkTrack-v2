#!/bin/bash
# ===== WorkTrack Docker 构建 & 推送脚本 =====
# 用法:
#   ./build-and-push.sh           # 构建并推送 latest
#   ./build-and-push.sh v1.0.1    # 构建并推送指定版本号
#   ./build-and-push.sh --load    # 仅构建到本地（不推送）

set -e

DOCKER_USER="zxt815"
IMAGE_NAME="${DOCKER_USER}/worktrack"
VERSION="${1:-latest}"
LOAD_ONLY=false

if [ "$1" = "--load" ]; then
    LOAD_ONLY=true
    VERSION="latest"
fi

echo "=========================================="
echo "  WorkTrack Docker 构建"
echo "  平台: linux/amd64"
echo "  镜像: ${IMAGE_NAME}:${VERSION}"
echo "=========================================="

if $LOAD_ONLY; then
    echo "[1/1] 构建镜像到本地..."
    docker buildx build --platform linux/amd64 --load \
        -t "${IMAGE_NAME}:latest" \
        .
    echo ""
    echo "✅ 完成！本地镜像:"
    docker images "${IMAGE_NAME}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Architecture}}\t{{.Size}}"
else
    echo "[1/2] 构建镜像..."
    docker buildx build --platform linux/amd64 --load \
        -t "${IMAGE_NAME}:latest" \
        .

    if [ "$VERSION" != "latest" ]; then
        docker tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:${VERSION}"
        echo "      标签: ${IMAGE_NAME}:${VERSION}"
    fi

    echo "[2/2] 推送到 Docker Hub..."
    docker push "${IMAGE_NAME}:latest"

    if [ "$VERSION" != "latest" ]; then
        docker push "${IMAGE_NAME}:${VERSION}"
    fi

    echo ""
    echo "✅ 推送完成！"
    echo "   docker pull ${IMAGE_NAME}:latest"
    echo ""
    echo "🖥️  服务器更新命令:"
    echo "   docker compose pull && docker compose up -d"
fi
