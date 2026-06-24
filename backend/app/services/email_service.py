"""邮件服务：SMTP 发送 + 配置管理 + HTML 模板

配置通过 SystemPreference 表存储（全局，user_id=None），key 前缀 "email."。
支持通用 SMTP、Gmail App Password、QQ邮箱、163邮箱等预设。
发送通过 FastAPI BackgroundTasks 异步化，主业务不阻塞。
"""
import logging
import smtplib
import ssl
import uuid
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger("worktrack.email")


def _ssl_context() -> ssl.SSLContext:
    """构造带 CA 根证书的 SSL 上下文。

    python.org 版 Python（尤其 macOS）和精简容器镜像默认可能没有根证书库，
    直接用 ssl.create_default_context() 会在 TLS 握手时抛
    CERTIFICATE_VERIFY_FAILED（unable to get local issuer certificate）。
    优先使用 certifi 提供的 CA 包，缺失时再退回系统默认。
    """
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()

# ── 邮件服务商预设 ──
PROVIDER_PRESETS = {
    "gmail": {
        "label": "Gmail（App Password）",
        "host": "smtp.gmail.com",
        "port": 587,
        "use_tls": True,
        "note": "需先在 Google 账号开启「两步验证」并生成「应用专用密码」",
    },
    "qq": {
        "label": "QQ邮箱",
        "host": "smtp.qq.com",
        "port": 587,
        "use_tls": True,
        "note": "需在 QQ 邮箱「设置→账户」开启 SMTP 服务并获取授权码",
    },
    "163": {
        "label": "163邮箱",
        "host": "smtp.163.com",
        "port": 465,
        "use_tls": False,  # 163 用 SSL，不是 STARTTLS
        "use_ssl": True,
        "note": "需在 163「设置→POP3/SMTP/IMAP」开启并设置客户端授权码",
    },
    "outlook": {
        "label": "Outlook / Office 365",
        "host": "smtp.office365.com",
        "port": 587,
        "use_tls": True,
        "note": "使用 Microsoft 账号密码或应用密码",
    },
    "smtp": {
        "label": "自定义 SMTP（企业邮箱等）",
        "host": "",
        "port": 587,
        "use_tls": True,
        "note": "适用于公司自建邮箱服务器或其他 SMTP 服务商",
    },
}


def _load_email_config() -> dict:
    """从 SystemPreference 读取邮件配置"""
    try:
        from sqlmodel import Session, select
        from app.database import engine
        from app.models.system_preference import SystemPreference
        with Session(engine) as db:
            rows = db.exec(
                select(SystemPreference).where(
                    SystemPreference.user_id == None,
                    SystemPreference.key.startswith("email."),
                )
            ).all()
            cfg = {r.key[len("email."):]: r.value for r in rows}
            return cfg
    except Exception as e:
        logger.warning("加载邮件配置失败: %s", e)
        return {}


def is_email_configured() -> bool:
    cfg = _load_email_config()
    return bool(
        cfg.get("enabled") == "true"
        and cfg.get("host")
        and cfg.get("username")
        and cfg.get("password")
    )


def _get_frontend_url() -> str:
    """从品牌配置读取前端地址"""
    try:
        from sqlmodel import Session, select
        from app.database import engine
        from app.models.system_preference import SystemPreference
        with Session(engine) as db:
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == "brand_frontend_url",
                    SystemPreference.user_id == None,
                )
            ).first()
            return (row.value or "").strip() if row else ""
    except Exception:
        return ""


def _send_smtp(to: list[str], subject: str, html_body: str, cfg: dict) -> None:
    host = cfg.get("host", "")
    port = int(cfg.get("port", 587))
    username = cfg.get("username", "")
    password = cfg.get("password", "")
    from_name = cfg.get("from_name", "WorkTrack")
    use_tls = cfg.get("use_tls", "true") == "true"
    use_ssl = cfg.get("use_ssl", "false") == "true"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{username}>"
    msg["To"] = ", ".join(to)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    if use_ssl:
        context = _ssl_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=10) as server:
            server.login(username, password)
            server.sendmail(username, to, msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=10) as server:
            if use_tls:
                context = _ssl_context()
                server.starttls(context=context)
            server.login(username, password)
            server.sendmail(username, to, msg.as_string())


def send_email(to: list[str], subject: str, html_body: str) -> bool:
    """发送邮件，返回是否成功。内部吞异常，失败只记日志。"""
    if not to:
        return False
    cfg = _load_email_config()
    if not cfg.get("enabled") == "true":
        logger.debug("邮件服务未启用，跳过发送: %s", subject)
        return False
    try:
        _send_smtp(to, subject, html_body, cfg)
        logger.info("邮件已发送 to=%s subject=%s", to, subject)
        return True
    except Exception as e:
        logger.error("邮件发送失败 to=%s: %s", to, e, exc_info=True)
        return False


def test_send(to: str) -> dict:
    """测试发送（同步，用于配置验证接口）"""
    cfg = _load_email_config()
    try:
        _send_smtp([to], "WorkTrack 邮件服务测试", _tpl_test(to), cfg)
        return {"ok": True, "message": f"测试邮件已发送至 {to}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


# ── 用户邮箱查找工具 ──

def _get_user_emails(user_ids: list[int]) -> dict[int, Optional[str]]:
    """批量查 user_id → email，过滤掉空邮箱"""
    if not user_ids:
        return {}
    try:
        from sqlmodel import Session, select
        from app.database import engine
        from app.models.user import User
        with Session(engine) as db:
            users = db.exec(select(User).where(User.id.in_(user_ids))).all()
            return {u.id: (u.email or None) for u in users}
    except Exception as e:
        logger.warning("查询用户邮箱失败: %s", e)
        return {}


# ── 审批通知 ──

def notify_approval_pending(instance, approver_ids: list[int]) -> None:
    """通知审批人：有待审批的事项"""
    email_map = _get_user_emails(approver_ids)
    to = [e for e in email_map.values() if e]
    if not to:
        return
    html = _tpl_approval_pending(instance)
    send_email(to, f"【待审批】{instance.title}", html)


def notify_approval_finished(instance, submitter_email: Optional[str]) -> None:
    """通知发起人：审批结果"""
    if not submitter_email:
        return
    status_label = {"approved": "✅ 审批通过", "rejected": "❌ 已驳回", "cancelled": "撤回"}.get(
        instance.status, instance.status
    )
    html = _tpl_approval_finished(instance, status_label)
    send_email([submitter_email], f"【审批结果】{instance.title} — {status_label}", html)


# ── 新用户欢迎邮件 ──

def send_welcome_email(to: str, username: str, password: str, name: str = "", login_url: str = "") -> bool:
    """新建账号后发送欢迎邮件，告知用户名 + 初始密码 + 首登需改密"""
    html = _tpl_welcome(username, password, name, login_url)
    return send_email([to], "【WorkTrack】您的账号已创建，请尽快登录", html)


# ── 密码重置 ──

PWR_KEY_PREFIX = "pwr:"
PWR_EXPIRY_SECONDS = 3600  # 1 小时


def create_password_reset_token(user_id: int) -> str:
    """生成密码重置 token，存入 SystemPreference"""
    token = str(uuid.uuid4())
    expiry = int(time.time()) + PWR_EXPIRY_SECONDS
    _save_pref(f"{PWR_KEY_PREFIX}{token}", f"{user_id}:{expiry}")
    return token


def verify_password_reset_token(token: str) -> Optional[int]:
    """校验 token，有效则返回 user_id，无效/过期返回 None"""
    value = _get_pref(f"{PWR_KEY_PREFIX}{token}")
    if not value:
        return None
    try:
        uid, expiry = value.split(":", 1)
        if int(expiry) < int(time.time()):
            _delete_pref(f"{PWR_KEY_PREFIX}{token}")
            return None
        return int(uid)
    except Exception:
        return None


def consume_password_reset_token(token: str) -> Optional[int]:
    """校验并删除 token（一次性使用）"""
    uid = verify_password_reset_token(token)
    if uid:
        _delete_pref(f"{PWR_KEY_PREFIX}{token}")
    return uid


def send_password_reset_email(to: str, token: str, frontend_base_url: str = "") -> bool:
    reset_url = f"{frontend_base_url}/reset-password?token={token}"
    html = _tpl_password_reset(to, reset_url)
    return send_email([to], "【WorkTrack】密码重置", html)


# ── SystemPreference 辅助 ──

def _save_pref(key: str, value: str) -> None:
    try:
        from sqlmodel import Session, select
        from app.database import engine
        from app.models.system_preference import SystemPreference
        with Session(engine) as db:
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == key, SystemPreference.user_id == None
                )
            ).first()
            if row:
                row.value = value
                db.add(row)
            else:
                db.add(SystemPreference(key=key, value=value, user_id=None))
            db.commit()
    except Exception as e:
        logger.warning("保存 pref 失败 key=%s: %s", key, e)


def _get_pref(key: str) -> Optional[str]:
    try:
        from sqlmodel import Session, select
        from app.database import engine
        from app.models.system_preference import SystemPreference
        with Session(engine) as db:
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == key, SystemPreference.user_id == None
                )
            ).first()
            return row.value if row else None
    except Exception:
        return None


def _delete_pref(key: str) -> None:
    try:
        from sqlmodel import Session, select
        from app.database import engine
        from app.models.system_preference import SystemPreference
        with Session(engine) as db:
            row = db.exec(
                select(SystemPreference).where(
                    SystemPreference.key == key, SystemPreference.user_id == None
                )
            ).first()
            if row:
                db.delete(row)
                db.commit()
    except Exception:
        pass


# ── HTML 邮件模板 ──

def _base_html(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#0f0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:40px auto;background:#1a1a24;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
  <div style="background:linear-gradient(135deg,#7C3AED,#4F46E5);padding:28px 32px;">
    <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">WorkTrack</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">智能工作台</div>
  </div>
  <div style="padding:28px 32px;">
    {body}
  </div>
  <div style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:#4B5563;">
    此邮件由 WorkTrack 系统自动发送，请勿直接回复。
  </div>
</div>
</body>
</html>"""


def _tpl_test(to: str) -> str:
    body = f"""
<p style="color:#E5E7EB;font-size:15px;font-weight:600;margin:0 0 12px;">邮件服务测试成功 ✅</p>
<p style="color:#9CA3AF;font-size:13px;line-height:1.7;margin:0;">
  收件人：<span style="color:#A78BFA;">{to}</span><br>
  您的 WorkTrack 邮件服务已正确配置并可以正常发送邮件。
</p>"""
    return _base_html("邮件服务测试", body)


def _tpl_approval_pending(instance) -> str:
    body = f"""
<p style="color:#E5E7EB;font-size:15px;font-weight:600;margin:0 0 12px;">您有一条待审批事项</p>
<div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:10px;padding:16px;margin:0 0 16px;">
  <div style="color:#A78BFA;font-size:13px;font-weight:600;margin-bottom:6px;">{instance.title}</div>
  <div style="color:#6B7280;font-size:12px;">业务类型: {instance.target_type} · ID: {instance.target_id}</div>
</div>
<p style="color:#9CA3AF;font-size:13px;line-height:1.7;margin:0 0 16px;">
  请登录 WorkTrack 系统，在「我的待办」中处理此审批事项。
</p>
<a href="#" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;">前往审批</a>"""
    return _base_html(f"待审批: {instance.title}", body)


def _tpl_approval_finished(instance, status_label: str) -> str:
    color = "#34D399" if instance.status == "approved" else "#F87171"
    body = f"""
<p style="color:#E5E7EB;font-size:15px;font-weight:600;margin:0 0 12px;">您发起的审批已有结果</p>
<div style="background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px;margin:0 0 16px;">
  <div style="color:#E5E7EB;font-size:13px;font-weight:600;margin-bottom:8px;">{instance.title}</div>
  <div style="font-size:15px;font-weight:700;color:{color};">{status_label}</div>
</div>
<p style="color:#9CA3AF;font-size:13px;line-height:1.7;margin:0;">
  登录 WorkTrack 查看详细审批记录。
</p>"""
    return _base_html(f"审批结果: {instance.title}", body)


def _tpl_welcome(username: str, password: str, name: str = "", login_url: str = "") -> str:
    greeting = f"{name}，您好" if name else "您好"
    login_btn = (
        f'<a href="{login_url}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:600;margin-top:4px;">立即登录</a>'
        if login_url else ""
    )
    body = f"""
<p style="color:#E5E7EB;font-size:15px;font-weight:600;margin:0 0 12px;">{greeting} 👋</p>
<p style="color:#9CA3AF;font-size:13px;line-height:1.7;margin:0 0 16px;">
  管理员已为您创建 WorkTrack 账号，以下是您的登录凭据：
</p>
<div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:10px;padding:16px;margin:0 0 16px;">
  <div style="color:#9CA3AF;font-size:12px;margin-bottom:4px;">登录用户名</div>
  <div style="color:#A78BFA;font-size:15px;font-weight:700;margin-bottom:12px;font-family:monospace;">{username}</div>
  <div style="color:#9CA3AF;font-size:12px;margin-bottom:4px;">初始密码</div>
  <div style="color:#A78BFA;font-size:15px;font-weight:700;font-family:monospace;letter-spacing:0.5px;">{password}</div>
</div>
<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:12px 16px;margin:0 0 16px;">
  <div style="color:#FBBF24;font-size:12px;line-height:1.6;">
    🔒 为保障账号安全，<b>首次登录后系统将要求您立即修改密码</b>。请勿将初始密码告知他人。
  </div>
</div>
{login_btn}"""
    return _base_html("欢迎加入 WorkTrack", body)


def _tpl_password_reset(to: str, reset_url: str) -> str:
    body = f"""
<p style="color:#E5E7EB;font-size:15px;font-weight:600;margin:0 0 12px;">重置您的密码</p>
<p style="color:#9CA3AF;font-size:13px;line-height:1.7;margin:0 0 20px;">
  我们收到了针对账号 <span style="color:#A78BFA;">{to}</span> 的密码重置请求。<br>
  如果这不是您的操作，请忽略此邮件。
</p>
<a href="{reset_url}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:600;">重置密码</a>
<p style="color:#4B5563;font-size:11px;margin-top:20px;">此链接 1 小时内有效。如无法点击，请复制以下地址到浏览器：<br>
<span style="color:#6B7280;word-break:break-all;">{reset_url}</span></p>"""
    return _base_html("密码重置", body)
