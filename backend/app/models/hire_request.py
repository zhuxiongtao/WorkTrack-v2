"""员工入职申请模型

走统一审批引擎，business_type="hire"。审批通过后由 approval_engine._on_finished
调用建账号逻辑创建 User（密码自动生成、首登强制改密、按部门继承角色）。
"""
from typing import Optional
from datetime import date, datetime
from app.utils.time import now
from sqlmodel import SQLModel, Field


class HireRequest(SQLModel, table=True):
    """员工入职申请单

    business_type="hire"，审批流：用人部门负责人 → 人事复核 → 总经理审批 → HR 执行入职
    最后一个节点为 execution 类型，HR 点击"确认入职"后触发建账号。
    """
    __tablename__ = "hire_request"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)  # 申请人（HR）

    # 候选人信息（前置 UserCreate 必填项）
    candidate_name: str = Field(max_length=100)              # 候选人姓名 → User.name
    candidate_username: str = Field(max_length=50, index=True)  # 登录名 → User.username
    candidate_email: str = Field(max_length=120)             # 邮箱 → User.email
    candidate_phone: Optional[str] = Field(default=None, max_length=20)  # 手机号（可选）

    # 职位与组织归属
    job_title: Optional[str] = Field(default=None, max_length=100)  # 职位 → User.job_title
    department_id: Optional[int] = Field(default=None, foreign_key="department.id", index=True)  # 入职部门 → User.department_id
    leader_id: Optional[int] = Field(default=None, foreign_key="user.id")  # 汇报上级 → User.leader_id

    # 日期
    first_work_date: Optional[date] = Field(default=None)    # 参加工作日期（年假工龄）→ User.first_work_date
    hire_date: date                                           # 拟入职日期 → User.hire_date

    # 账号权限
    is_admin: bool = Field(default=False)                    # 是否管理员
    use_shared_models: bool = Field(default=False)           # 共享模型权限

    # 业务扩展
    salary: Optional[str] = Field(default=None, max_length=50)  # 薪资（脱敏）
    reason: str = Field(default="", max_length=2000)         # 入职理由/背景
    attachments: Optional[str] = Field(default=None)         # 附件 JSON（简历等）

    # 状态机：草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已入职
    status: str = Field(default="草稿", index=True, max_length=20)

    # 入职回写
    created_user_id: Optional[int] = Field(default=None, foreign_key="user.id")  # 入职后创建的 user.id
    onboarded_at: Optional[datetime] = Field(default=None)   # 入职完成时间

    created_at: datetime = Field(default_factory=lambda: now())
    updated_at: datetime = Field(default_factory=lambda: now())
