"""
合同原件预览辅助：DOC/DOCX → PDF（LibreOffice headless 实时转换）
按源文件 mtime 缓存到 data/contracts/preview_cache/
"""
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger("worktrack.preview")

# ===== 探测 LibreOffice 安装位置 =====
# 常见安装路径（按优先级探测）
# 注意：必须是 LibreOffice 自带安装的 soffice.exe，避免误用其他工具链里的
_SOFFICE_CANDIDATES = [
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
]
# PATH 兜底：仅当可执行文件名严格为 "soffice" 或 "libreoffice" 时才用
# 避免误中 IDE 沙箱 / 工具链自带的同名 exe
for _p in ("soffice", "libreoffice"):
    _found = shutil.which(_p)
    if _found:
        _name = os.path.basename(_found).lower()
        if _name in ("soffice", "soffice.exe", "libreoffice", "libreoffice.exe"):
            _SOFFICE_CANDIDATES.append(_found)


def find_soffice() -> str | None:
    """探测系统是否装了 LibreOffice（返回可执行文件路径）

    策略：先按已知安装路径找；找不到再从 PATH 兜底；
    每找到一个候选都用 --version 跑一次确认能正常工作（剔除 IDE 沙箱里的坏 exe）。
    """
    candidates = list(_SOFFICE_CANDIDATES)
    for path in candidates:
        if not path or not os.path.isfile(path):
            continue
        if _probe_soffice(path):
            return path
    return None


def _probe_soffice(soffice: str, timeout: int = 5) -> bool:
    """用 --version 探测 soffice 是否能正常启动（DLL 完整、不是损坏的占位）"""
    try:
        r = subprocess.run(
            [soffice, "--version"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        # LibreOffice --version 总是返回 0，stdout 含 "LibreOffice X.Y"
        if r.returncode == 0 and "libreoffice" in (r.stdout or "").lower():
            return True
        return False
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def is_office_doc(file_type: str) -> bool:
    return (file_type or "").lower() in (".doc", ".docx")


def get_cache_path(contracts_dir: str, contract_id: int, src_path: str) -> str:
    """
    缓存 PDF 路径：<contracts_dir>/../preview_cache/<contract_id>.pdf
    按源文件 mtime 校验：mtime 变了就重新转
    """
    cache_dir = Path(contracts_dir).parent / "preview_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return str(cache_dir / f"{contract_id}.pdf")


def convert_office_to_pdf(src_path: str, dst_pdf: str, soffice: str, timeout: int = 60) -> tuple[bool, str]:
    """
    用 LibreOffice 把 DOC/DOCX 转 PDF
    返回 (success, error_msg)
    """
    if not os.path.isfile(src_path):
        return False, f"源文件不存在: {src_path}"

    # 准备临时输出目录（LibreOffice 会保留原文件名）
    with tempfile.TemporaryDirectory(prefix="lo_convert_") as tmpdir:
        try:
            # --headless：无 GUI 启动
            # --convert-to pdf：转 PDF
            # --outdir：输出目录
            # 避免 LibreOffice 在 Windows 上 "profile is in use" 报错，加 --user-profile
            user_profile = os.path.join(tmpdir, "lo_profile")
            result = subprocess.run(
                [
                    soffice,
                    "--headless",
                    "--norestore",
                    "--nologo",
                    "--nolockcheck",
                    f"-env:UserInstallation=file:///{user_profile}",
                    "--convert-to", "pdf",
                    "--outdir", tmpdir,
                    src_path,
                ],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return False, f"LibreOffice 转换超时（>{timeout}秒）"
        except FileNotFoundError as e:
            return False, f"LibreOffice 可执行文件未找到: {e}"
        except Exception as e:
            return False, f"启动 LibreOffice 失败: {e}"

        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip()
            return False, f"LibreOffice 转换失败（returncode={result.returncode}）: {err[:500]}"

        # 找转换后的 PDF（与源同名）
        src_basename = os.path.splitext(os.path.basename(src_path))[0]
        produced_pdf = os.path.join(tmpdir, f"{src_basename}.pdf")
        if not os.path.isfile(produced_pdf):
            return False, f"LibreOffice 未生成 PDF（期望: {produced_pdf}）"

        try:
            os.makedirs(os.path.dirname(dst_pdf), exist_ok=True)
            shutil.move(produced_pdf, dst_pdf)
        except Exception as e:
            return False, f"移动 PDF 到缓存目录失败: {e}"

        return True, ""


def ensure_pdf_preview(contract_id: int, src_path: str, file_type: str, contracts_dir: str) -> tuple[str | None, str | None]:
    """
    确保拿到合同 PDF 预览路径（DOC/DOCX 才走转换）
    返回 (pdf_path, error_msg)
    - pdf_path 非空 = 成功
    - error_msg 非空 = 失败（一般是 LibreOffice 没装）
    """
    if not is_office_doc(file_type):
        return None, f"非 Office 文档无需转换: {file_type}"

    soffice = find_soffice()
    if not soffice:
        return None, (
            "未检测到 LibreOffice，无法在网页内预览 DOC/DOCX 原件。"
            "请安装 LibreOffice：https://www.libreoffice.org/download/download-libreoffice/"
            "（典型安装约 300MB，装完重启后端服务即可）。"
            "临时方案：可下载文件到本地用 WPS/Word 打开查看。"
        )

    dst_pdf = get_cache_path(contracts_dir, contract_id, src_path)

    # 缓存命中：源文件 mtime 没变就用缓存
    if os.path.isfile(dst_pdf):
        try:
            src_mtime = os.path.getmtime(src_path)
            pdf_mtime = os.path.getmtime(dst_pdf)
            if pdf_mtime >= src_mtime:
                return dst_pdf, None
        except OSError:
            pass

    # 重新转换
    logger.info("转换合同 #%d 原件为 PDF: %s → %s", contract_id, src_path, dst_pdf)
    ok, err = convert_office_to_pdf(src_path, dst_pdf, soffice)
    if not ok:
        return None, err
    return dst_pdf, None
