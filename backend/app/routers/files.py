import os
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session
from app.database import get_session
from app.models.user import User
from app.auth import get_current_user
from app.routers.logs import write_log

router = APIRouter(prefix="/api/v1/files", tags=["文件管理"])

# 文件存储根目录（Docker 部署时需挂载为持久化卷）
UPLOAD_ROOT = Path("data/files")
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp',  # 图片
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',         # 文档
    '.txt', '.csv', '.md', '.json', '.xml', '.yaml', '.yml',           # 文本
    '.zip', '.rar', '.7z', '.tar', '.gz',                              # 压缩
    '.mp3', '.wav', '.m4a', '.ogg',                                    # 音频
    '.mp4', '.mov', '.avi', '.webm',                                   # 视频
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

def _safe_filename(original: str) -> str:
    """生成唯一安全的文件名"""
    ext = Path(original).suffix.lower()
    name = Path(original).stem
    # 清理文件名中的危险字符
    safe_name = "".join(c for c in name if c.isalnum() or c in '._- ')[:50].strip()
    if not safe_name:
        safe_name = "file"
    return f"{uuid.uuid4().hex[:8]}_{safe_name}{ext}"


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    """
    通用文件上传接口。
    文件保存到 data/files/{user_id}/ 目录，返回文件元数据 JSON。
    Docker 部署时 data/ 目录需挂载为持久化卷。
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {ext}")

    # 检查文件大小
    content = await file.read()
    file_size = len(content)
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"文件过大（最大 {MAX_FILE_SIZE // 1024 // 1024}MB）")

    # 用户专属目录
    user_dir = UPLOAD_ROOT / str(current_user.id)
    user_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _safe_filename(file.filename)
    file_path = user_dir / safe_name

    # 写入文件
    try:
        with open(file_path, "wb") as f:
            f.write(content)
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"文件保存失败: {e}")

    # 相对路径（用于数据库存储和 URL 访问）
    relative_path = f"{current_user.id}/{safe_name}"

    write_log(level="INFO", category="文件上传", message=f"用户 {current_user.username} 上传文件 {safe_name} ({file_size} bytes)", db=db)

    return {
        "name": file.filename,
        "path": relative_path,
        "size": file_size,
        "type": file.content_type or "application/octet-stream",
        "url": f"/api/v1/files/{relative_path}",
    }


@router.get("/{user_id}/{filename:path}")
async def serve_file(user_id: str, filename: str):
    """
    公开访问已上传文件（无需认证，用于 <img> 标签等场景）。
    文件按用户隔离存储，URL 中包含 user_id 防止跨用户访问。
    """
    # 安全检查：防止路径遍历攻击
    safe_filename = os.path.basename(filename)
    file_path = UPLOAD_ROOT / user_id / safe_filename

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")

    # 根据扩展名设置 MIME 类型
    ext = file_path.suffix.lower()
    media_types = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon', '.bmp': 'image/bmp',
        '.pdf': 'application/pdf',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4', '.webm': 'video/webm',
    }
    media_type = media_types.get(ext, 'application/octet-stream')

    return FileResponse(str(file_path), media_type=media_type)
