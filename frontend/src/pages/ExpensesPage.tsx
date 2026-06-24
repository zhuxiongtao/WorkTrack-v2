import { useState, useEffect, useCallback } from 'react'
import {
  Receipt, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X, CreditCard,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import SearchableSelect from '../components/SearchableSelect'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

interface ExpenseItem {
  id: number
  user_id: number
  user_name: string | null
  title: string
  expense_type: string
  amount: number
  amount_unit: string
  currency: string
  expense_date: string
  reason: string
  attachments: string | null
  status: string  // 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已付款
  paid_at: string | null
  paid_by: number | null
  paid_by_name: string | null
  created_at: string
  updated_at: string
}

const DEFAULT_EXPENSE_TYPES = ['差旅', '交通', '餐饮', '办公用品', '通讯', '培训', '其他']

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:   { label: '草稿',   cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  审批中: { label: '审批中', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  已批准: { label: '已批准', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  已驳回: { label: '已驳回', cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  已撤回: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  已付款: { label: '已付款', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
}

function fmtAmount(n: number, c: string, unit = '元'): string {
  try { return `${c} ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}` }
  catch { return `${c} ${n} ${unit}` }
}
function fmtDate(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}
function fmtExpenseDate(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}
/** ISO string -> "yyyy-MM-ddTHH:mm" 用于 datetime-local 输入框 */
function toDatetimeLocal(s: string): string {
  if (!s) return ''
  try {
    const d = new Date(s)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '' }
}
/** "yyyy-MM-ddTHH:mm" -> ISO string 提交时使用 */
function fromDatetimeLocal(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}
function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

const emptyForm = {
  expense_type: '差旅', title: '', amount: '', amount_unit: '元', currency: 'CNY',
  expense_date: '', reason: '', attachments: null as string | null,
}

export default function ExpensesPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('expense:view_all')
  const canPay = hasPermission('expense:pay')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<ExpenseItem[]>([])
  const [loading, setLoading] = useState(true)

  const [expenseTypes, setExpenseTypes] = useState<string[]>(DEFAULT_EXPENSE_TYPES)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<ExpenseItem | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/expenses?scope=${scope}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope])

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/expenses/types')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.types) && data.types.length > 0) setExpenseTypes(data.types)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTypes() }, [loadTypes])

  const openCreate = () => {
    setEditingId(null); setForm({ ...emptyForm }); setShowForm(true)
  }
  const openEdit = (p: ExpenseItem) => {
    setEditingId(p.id)
    setForm({
      expense_type: p.expense_type, title: p.title, amount: String(p.amount || ''),
      amount_unit: p.amount_unit || '元', currency: p.currency,
      expense_date: toDatetimeLocal(p.expense_date), reason: p.reason, attachments: p.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  const save = async () => {
    if (!form.title.trim()) { showToast('请填写报销摘要', 'warning'); return }
    setSaving(true)
    try {
      const body = {
        expense_type: form.expense_type,
        title: form.title.trim(),
        amount: parseFloat(form.amount) || 0,
        amount_unit: form.amount_unit,
        currency: form.currency,
        expense_date: fromDatetimeLocal(form.expense_date) || null,
        reason: form.reason.trim(),
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/expenses/${editingId}` : '/api/v1/expenses'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '报销申请已创建', 'success')
      setShowForm(false); load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  const submitApproval = async (p: ExpenseItem) => {
    const ok = await showConfirm('提交后将进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/expenses/${p.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setActing(false) }
  }

  const revoke = async (p: ExpenseItem) => {
    const ok = await showConfirm('撤回后报销申请回到草稿，可重新编辑。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/expenses/${p.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const pay = async (p: ExpenseItem) => {
    const ok = await showConfirm(`确认对报销「${p.title}」执行付款？付款后将标记为已付款。`)
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/expenses/${p.id}/pay`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '付款失败') }
      showToast('付款完成', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '付款失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (p: ExpenseItem) => {
    const ok = await showConfirm(`确认删除报销申请「${p.title}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/expenses/${p.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '删除失败') }
      showToast('已删除', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '删除失败', 'error') }
  }

  const stats = [
    { label: '总申请', value: list.length },
    { label: '审批中', value: list.filter(p => p.status === '审批中').length },
    { label: '已付款', value: list.filter(p => p.status === '已付款').length },
  ]

  return (
    <div>
      <PageHeader
        icon={Receipt}
        title="报销申请"
        description="差旅、交通、餐饮等费用报销，提交后经部门负责人、财务审批，最后由出纳付款"
        tone="green"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-green-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} /> 新建报销
          </button>
        }
      />

      {/* 范围切换 */}
      {canViewAll && (
        <div className="flex items-center gap-1 bg-bg-hover/60 border border-border rounded-lg p-0.5 w-fit mb-5">
          {([
            { key: 'mine' as const, label: '我发起的' },
            { key: 'all' as const, label: '全部申请' },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setScope(t.key)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                scope === t.key ? 'bg-bg-card text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
      ) : list.length === 0 ? (
        <EmptyState icon={Receipt} title="暂无报销申请" description="点击右上角「新建报销」发起第一笔申请" tone="green" />
      ) : (
        <div className="space-y-2">
          {list.map(p => (
            <button
              key={p.id}
              onClick={() => setDetail(p)}
              className="w-full text-left rounded-xl bg-bg-card border border-border/50 p-4 hover:border-border hover:bg-bg-hover/40 transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{p.title}</span>
                    {statusBadge(p.status)}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-400">{p.expense_type}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate">
                    费用日期 {p.expense_date ? fmtExpenseDate(p.expense_date) : '—'}
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 申请人 {p.user_name || '—'}</span>}
                    <span className="ml-1.5">· {fmtDate(p.created_at)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-emerald-400">{fmtAmount(p.amount, p.currency, p.amount_unit)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <Modal
          icon={Receipt}
          title={detail.title}
          subtitle={`${detail.expense_type} · ${fmtAmount(detail.amount, detail.currency, detail.amount_unit)}`}
          tone="green"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">{statusBadge(detail.status)}</div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="费用类型" value={detail.expense_type || '—'} />
              <Info label="费用日期" value={detail.expense_date ? fmtExpenseDate(detail.expense_date) : '—'} />
              <Info label="金额" value={fmtAmount(detail.amount, detail.currency, detail.amount_unit)} />
              <Info label="申请人" value={detail.user_name || '—'} />
              {detail.status === '已付款' && (
                <>
                  <Info label="付款时间" value={detail.paid_at ? fmtExpenseDate(detail.paid_at) : '—'} />
                  <Info label="付款人" value={detail.paid_by_name || '—'} />
                </>
              )}
            </div>

            {detail.reason && (
              <div>
                <p className="text-xs text-gray-400 mb-1">报销事由</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.reason}</p>
              </div>
            )}

            {detail.attachments && JSON.parse(detail.attachments).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">票据附件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {/* 审批进度（提交后展示） */}
            {detail.status !== '草稿' && (
              <ApprovalTimeline targetType="expense" targetId={detail.id} onChanged={load} />
            )}

            {/* 操作区 */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {detail.status === '草稿' && (
                <>
                  <button
                    onClick={() => submitApproval(detail)}
                    disabled={acting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                  >
                    {acting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 提交审批
                  </button>
                  <button
                    onClick={() => openEdit(detail)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white transition-colors"
                  >
                    <Pencil size={14} /> 编辑
                  </button>
                  <button
                    onClick={() => remove(detail)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 size={14} /> 删除
                  </button>
                </>
              )}
              {detail.status === '审批中' && (
                <button
                  onClick={() => revoke(detail)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white disabled:opacity-50 transition-colors"
                >
                  <RotateCcw size={14} /> 撤回申请
                </button>
              )}
              {detail.status === '已批准' && canPay && (
                <button
                  onClick={() => pay(detail)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-green-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {acting ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} 执行付款
                </button>
              )}
              {detail.status === '已驳回' && (
                <button
                  onClick={() => openEdit(detail)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white transition-colors"
                >
                  <Pencil size={14} /> 修改后重提
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* 创建/编辑弹窗 */}
      {showForm && (
        <Modal
          icon={editingId ? Pencil : Plus}
          title={editingId ? '编辑报销申请' : '新建报销申请'}
          subtitle="填写报销信息，保存为草稿后可提交审批"
          tone="green"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">费用类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {expenseTypes.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, expense_type: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.expense_type === t
                        ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <Field label="报销摘要" required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                placeholder="如「6月北京客户拜访差旅」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Field label="金额">
                  <div className="flex gap-2">
                    <input
                      type="number" value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      placeholder="0.00"
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500"
                    />
                    <div className="flex rounded-lg overflow-hidden border border-border shrink-0 text-xs">
                      {(['元', '万元'] as const).map(u => (
                        <button key={u} type="button" onClick={() => setForm({ ...form, amount_unit: u })}
                          className={`px-2.5 py-2 transition-colors ${form.amount_unit === u ? 'bg-emerald-600 text-white' : 'bg-bg-input text-gray-400 hover:bg-bg-hover'}`}>{u}</button>
                      ))}
                    </div>
                  </div>
                </Field>
              </div>
              <Field label="币种">
                <SearchableSelect
                  options={['CNY', 'USD', 'HKD', 'EUR'].map(c => ({ id: c, label: c }))}
                  value={form.currency}
                  onChange={(v) => setForm({ ...form, currency: v === 0 ? '' : String(v) })}
                  clearValue=""
                />
              </Field>
            </div>

            <Field label="费用日期">
              <input
                type="datetime-local"
                value={form.expense_date}
                onChange={e => setForm({ ...form, expense_date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500"
              />
            </Field>

            <Field label="报销事由">
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="说明费用发生背景、用途"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 resize-none"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">票据 / 发票（可选，可粘贴截图）</label>
              <FileUpload filesJson={form.attachments} onChange={v => setForm({ ...form, attachments: v })} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white transition-colors"
              >
                <X size={14} /> 取消
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-green-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {editingId ? '保存' : '创建草稿'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-input/50 px-3 py-2">
      <p className="text-gray-500 mb-0.5">{label}</p>
      <p className="text-gray-200 font-medium break-all">{value}</p>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
