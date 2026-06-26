"""
报销 V2 重构数据迁移验证脚本

检查项：
1. 新表是否全部创建（legal_entity / employee_loan / expense_item / expense_relation）
2. expense_request 新字段是否全部就位
3. 默认公司主体「杭州远石科技有限公司」是否已存在
4. 旧数据回填：
   - expense_item 是否成功从旧 expense_request.items JSON 解析得到
   - expense_relation 是否成功从旧 expense_request.trip_id 转换得到
5. 抽样对照原始数据，验证回填正确性

用法：
    cd /Users/zhuxiongtao/code/WorkTrack-v2/backend
    python3 -m scripts.verify_expense_v2
"""
import json
import os
import sys
from datetime import datetime, timezone, timedelta

# 北京时间
BJT = timezone(timedelta(hours=8))

# 允许脚本既可作为模块（python3 -m scripts.verify_expense_v2）也可直接执行
if __name__ == "__main__" and (__package__ is None or __package__ == ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.database import engine
    from app.models import (
        LegalEntity, EmployeeLoan, ExpenseItem, ExpenseRelation, ExpenseRequest,
    )
else:
    from app.database import engine
    from app.models import (
        LegalEntity, EmployeeLoan, ExpenseItem, ExpenseRelation, ExpenseRequest,
    )

from sqlmodel import Session, select, text


# 期望的新表清单
EXPECTED_NEW_TABLES = {
    "legal_entity": [
        "id", "name", "short_name", "tax_id", "balance",
        "is_default", "is_active", "sort_order",
        "created_at", "updated_at",
    ],
    "employee_loan": [
        "id", "user_id", "entity_id", "amount", "used_amount", "remaining",
        "loan_date", "reason", "status", "created_at", "updated_at",
    ],
    "expense_item": [
        "id", "expense_id", "name", "expense_type", "department_id", "city",
        "expense_date", "amount", "note", "remark", "attachments",
        "sort_order", "created_at", "updated_at",
    ],
    "expense_relation": [
        "id", "expense_id", "target_type", "target_id", "relation_note", "created_at",
    ],
}

# 期望的 expense_request 新字段
EXPECTED_NEW_FIELDS = [
    "invoice_entity_id",
    "priority_offset_loan",
    "offset_loan_amount",
    "account_balance",
    "company_should_pay",
    "actual_pay_amount",
    "company_owes_personal",
]


class Verifier:
    def __init__(self):
        self.passed = 0
        self.warnings = 0
        self.failed = 0
        self.messages = []

    def ok(self, msg):
        self.passed += 1
        self.messages.append(("✅", msg))

    def warn(self, msg):
        self.warnings += 1
        self.messages.append(("⚠️ ", msg))

    def fail(self, msg):
        self.failed += 1
        self.messages.append(("❌", msg))

    def section(self, title):
        line = "═" * 60
        self.messages.append(("", ""))
        self.messages.append(("", line))
        self.messages.append(("", f"  {title}"))
        self.messages.append(("", line))

    def render(self):
        print(f"\n执行时间：{datetime.now(BJT).strftime('%Y-%m-%d %H:%M:%S')} (北京时)")
        for icon, msg in self.messages:
            if icon == "" and msg == "":
                print()
            elif icon == "":
                print(msg)
            else:
                print(f"{icon} {msg}")
        print()
        print("=" * 60)
        print(f"通过：{self.passed}    警告：{self.warnings}    失败：{self.failed}")
        print("=" * 60)
        if self.failed == 0:
            print("🎉 验证通过！")
        else:
            print("⚠️  存在失败项，请检查上方 ❌ 详情。")
        print()


def check_tables_exist(v: Verifier):
    v.section("1. 新表是否创建")
    with engine.connect() as conn:
        existing = {
            r[0] for r in conn.execute(text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
            )).fetchall()
        }
    for t in EXPECTED_NEW_TABLES:
        if t in existing:
            v.ok(f"表 `{t}` 已创建")
        else:
            v.fail(f"表 `{t}` 缺失！请先执行 alembic upgrade head")


def check_columns_exist(v: Verifier):
    v.section("2. expense_request 新字段是否就位")
    with engine.connect() as conn:
        cols = {
            r[0] for r in conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'expense_request'"
            )).fetchall()
        }
    for c in EXPECTED_NEW_FIELDS:
        if c in cols:
            v.ok(f"字段 `expense_request.{c}` 已存在")
        else:
            v.fail(f"字段 `expense_request.{c}` 缺失！")


def check_default_legal_entity(v: Verifier):
    v.section("3. 默认公司主体是否就位")
    with Session(engine) as session:
        defaults = session.exec(select(LegalEntity).where(LegalEntity.is_default == True)).all()  # noqa: E712
        entities = session.exec(select(LegalEntity)).all()
        if not entities:
            v.fail("legal_entity 表为空！请确认 init_db 是否执行成功")
            return
        if not defaults:
            v.warn("未找到 is_default=true 的公司主体。请在系统设置→报销设置 中将某主体标记为默认")
        else:
            names = ", ".join([f"{e.name}(id={e.id})" for e in defaults])
            v.ok(f"默认公司主体：{names}")
        # 验证种子数据
        seed = session.exec(select(LegalEntity).where(LegalEntity.name == "杭州远石科技有限公司")).first()
        if seed:
            v.ok(f"种子主体「杭州远石科技有限公司」存在 (id={seed.id}, short_name={seed.short_name})")
        else:
            v.warn("种子主体「杭州远石科技有限公司」未找到")


def check_employee_loan_seed(v: Verifier):
    v.section("4. 员工借款台账初始化状态")
    with Session(engine) as session:
        loans = session.exec(select(EmployeeLoan)).all()
        v.ok(f"当前 employee_loan 表共 {len(loans)} 条记录")
        if not loans:
            v.warn("尚无员工借款记录。系统设置→报销设置→员工借款 可手动录入")
        else:
            by_status = {}
            for l in loans:
                by_status[l.status] = by_status.get(l.status, 0) + 1
            for s, c in by_status.items():
                v.ok(f"  状态「{s}」: {c} 条")
            # 校验 used_amount + remaining 守恒
            bad = []
            for l in loans:
                if abs((l.used_amount + l.remaining) - l.amount) > 0.01:
                    bad.append(l.id)
            if bad:
                v.fail(f"以下借款记录 used_amount + remaining ≠ amount: {bad}")
            else:
                v.ok("所有借款 used_amount + remaining = amount 守恒校验通过")


def check_expense_item_backfill(v: Verifier):
    v.section("5. 旧 items JSON → expense_item 回填校验")
    with engine.connect() as conn:
        # 查询旧数据：expense_request.items JSON 与 expense_item 数量
        expense_rows = conn.execute(text(
            "SELECT id, items, trip_id FROM expense_request"
        )).fetchall()
        item_counts = dict(conn.execute(text(
            "SELECT expense_id, COUNT(*) FROM expense_item GROUP BY expense_id"
        )).fetchall())

    if not expense_rows:
        v.ok("当前没有任何 expense_request（干净的库，跳过回填校验）")
        return

    parsed = 0
    unparsed = 0
    skipped = 0
    sample = []
    for eid, items_json, trip_id in expense_rows:
        if not items_json:
            skipped += 1
            continue
        try:
            items = json.loads(items_json)
        except Exception:
            unparsed += 1
            continue
        if not isinstance(items, list) or not items:
            skipped += 1
            continue
        expected = len(items)
        actual = item_counts.get(eid, 0)
        if actual >= expected:
            parsed += 1
            if len(sample) < 3:
                sample.append((eid, expected, actual))
        else:
            v.fail(f"expense_request.id={eid} 期望 {expected} 条明细，实际 {actual} 条")

    if unparsed:
        v.warn(f"旧 items JSON 解析失败的 expense_request 共 {unparsed} 条（可忽略）")
    if parsed:
        v.ok(f"回填一致：{parsed} 张报销单的明细行数正确")
        for eid, exp, act in sample:
            v.ok(f"  示例 expense_id={eid}: 期望 {exp} 条 → 实际 {act} 条")
    if skipped and not parsed and not unparsed:
        v.warn(f"全部 {skipped} 张报销单没有 items JSON 字段（旧库或未填写）")


def check_expense_relation_backfill(v: Verifier):
    v.section("6. 旧 trip_id → expense_relation 回填校验")
    with engine.connect() as conn:
        expense_rows = conn.execute(text(
            "SELECT id, trip_id FROM expense_request WHERE trip_id IS NOT NULL"
        )).fetchall()
        rel_counts = dict(conn.execute(text(
            "SELECT expense_id, COUNT(*) FROM expense_relation "
            "WHERE target_type = 'business_trip' GROUP BY expense_id"
        )).fetchall())
        rel_targets = dict(conn.execute(text(
            "SELECT expense_id, target_id FROM expense_relation WHERE target_type = 'business_trip'"
        )).fetchall())

    if not expense_rows:
        v.ok("没有需要回填的 trip_id")
        return

    ok_count = 0
    for eid, trip_id in expense_rows:
        if rel_targets.get(eid) == trip_id:
            ok_count += 1
        else:
            v.fail(f"expense_request.id={eid} trip_id={trip_id} 未在 expense_relation 中找到对应业务出差关联")
    if ok_count:
        v.ok(f"trip_id 全部正确迁移：{ok_count}/{len(expense_rows)} 张报销单")


def check_expense_request_new_fields_default(v: Verifier):
    v.section("7. expense_request 新字段默认值/类型校验")
    with engine.connect() as conn:
        sample = conn.execute(text(
            "SELECT id, priority_offset_loan, offset_loan_amount, account_balance, "
            "company_should_pay, actual_pay_amount, company_owes_personal, invoice_entity_id "
            "FROM expense_request ORDER BY id DESC LIMIT 5"
        )).fetchall()
        total = conn.execute(text("SELECT COUNT(*) FROM expense_request")).scalar()
    if total == 0:
        v.ok("当前没有任何 expense_request，跳过字段值抽样")
        return
    v.ok(f"最近 5 条 expense_request 新字段（应允许为 0/false/NULL）:")
    for row in sample:
        eid, pol, olam, ab, csp, apa, cop, iei = row
        v.ok(f"  id={eid} priority_offset_loan={pol} offset_loan_amount={olam} "
             f"account_balance={ab} company_should_pay={csp} actual_pay_amount={apa} "
             f"company_owes_personal={cop} invoice_entity_id={iei}")


def check_approvals_can_be_started(v: Verifier):
    v.section("8. 审批引擎 expense 业务类型是否注册")
    try:
        with Session(engine) as session:
            from app.models.approval import ApprovalFlow
            flows = session.exec(
                select(ApprovalFlow).where(ApprovalFlow.business_type == "expense")
            ).all()
            if not flows:
                v.fail("未找到 business_type=expense 的审批流模板！请确认 _init_approval_flows 是否被调用")
            else:
                for f in flows:
                    nodes = json.loads(f.nodes or "[]")
                    v.ok(f"审批流「{f.name}」(code={f.code}) 有 {len(nodes)} 个节点")
    except Exception as e:
        v.fail(f"审批流查询失败：{e}")


def main():
    v = Verifier()
    check_tables_exist(v)
    check_columns_exist(v)
    check_default_legal_entity(v)
    check_employee_loan_seed(v)
    check_expense_item_backfill(v)
    check_expense_relation_backfill(v)
    check_expense_request_new_fields_default(v)
    check_approvals_can_be_started(v)
    v.render()
    return 0 if v.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
