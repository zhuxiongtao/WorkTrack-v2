import { useState, useEffect, useCallback } from 'react'
import {
  Wallet, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import SearchableSelect from '../components/SearchableSelect'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

interface PaymentItem {
  id: number
  user_id: number
  user_name: string | null
  payment_type: string
  title: string
  amount: number
  amount_unit: string
  currency: string
  payee: string
  payee_account: string | null
  reason: string
  contract_id: number | null
  contract_title: string | null
  attachments: string | null
  status: string
  created_at: string
  updated_at: string
}

const PAYMENT_TYPES = ['供应商付款', '员工报销', '工资', '其他']

const STATUS_META: Record<string, { label: string; cls: string }> = {
  待完善: { label: '待完善', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  审批中: { label: '审批中', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' },
  已付款: { label: '已付款', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  已驳回: { label: '已驳回', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' },
  已撤回: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
}
// 可编辑并重新提交审批的状态：已驳回/已撤回（用户重提）、待完善（系统生成存根，如加班费待填金额）
const EDITABLE_STATUSES = new Set(['已驳回', '已撤回', '待完善'])

function fmtAmount(n: number, c: string, unit = '元'): string {
  try { return `${c} ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}` }
  catch { return `${c} ${n} ${unit}` }
}
function fmtDate(s: string): string {
  try { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  catch { return s }
}
function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

const emptyForm = {
  payment_type: '供应商付款', title: '', amount: '', amount_unit: '元', currency: 'CNY',
  payee: '', payee_account: '', reason: '', contract_id: null as number | null,
  attachments: null as string | null,
}

interface ContractBrief { id: number; title: string; contract_no: string }

export default function PaymentsPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('payment:view_all')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<PaymentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<ContractBrief[]>([])

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<PaymentItem | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/payments?scope=${scope}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/v1/contracts')
      .then(res => res.ok ? res.json() : [])
      .then(data => setContracts(Array.isArray(data) ? data : []))
      .catch(() => setContracts([]))
  }, [])

  const openCreate = () => {
    setEditingId(null); setForm({ ...emptyForm }); setShowForm(true)
  }
  const openEdit = (p: PaymentItem) => {
    setEditingId(p.id)
    setForm({
      payment_type: p.payment_type, title: p.title, amount: String(p.amount || ''),
      amount_unit: p.amount_unit || '元', currency: p.currency, payee: p.payee, payee_account: p.payee_account || '',
      reason: p.reason, contract_id: p.contract_id, attachments: p.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  const save = async () => {
    if (!form.title.trim()) { showToast('请填写付款摘要', 'warning'); return }
    if (form.payment_type === '供应商付款') {
      if (!form.contract_id) { showToast('供应商付款必须关联相关合同', 'warning'); return }
      const attCount = (() => { try { return form.attachments ? JSON.parse(form.attachments).length : 0 } catch { return 0 } })()
      if (attCount === 0) { showToast('供应商付款必须上传账单明细', 'warning'); return }
    }
    const ok = await showConfirm('提交后将立即进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setSaving(true)
    try {
      const body = {
        payment_type: form.payment_type,
        title: form.title.trim(),
        amount: parseFloat(form.amount) || 0,
        amount_unit: form.amount_unit,
        currency: form.currency,
        payee: form.payee.trim(),
        payee_account: form.payee_account.trim() || null,
        reason: form.reason.trim(),
        contract_id: form.contract_id,
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/payments/${editingId}` : '/api/v1/payments'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setShowForm(false); setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setSaving(false) }
  }

  const revoke = async (p: PaymentItem) => {
    const ok = await showConfirm('撤回后可编辑修改，重新提交审批。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/payments/${p.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (p: PaymentItem) => {
    const ok = await showConfirm(`确认删除付款申请「${p.title}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/payments/${p.id}`, { method: 'DELETE' })
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
        icon={Wallet}
        title="付款申请"
        description="供应商付款、员工报销、工资发放等付款事项，提交后经部门负责人、财务、总经理审批，最后由出纳付款"
        tone="green"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-opacity"
          >
            <Plus size={16} /> 新建付款
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
                scope === t.key ? 'bg-accent-blue/15 text-accent-blue' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
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
        <EmptyState icon={Wallet} title="暂无付款申请" description="点击右上角「新建付款」发起第一笔申请" tone="green" />
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-400">{p.payment_type}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate">
                    收款方 {p.payee || '—'}
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 申请人 {p.user_name}</span>}
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
          icon={Wallet}
          title={detail.title}
          subtitle={`${detail.payment_type} · ${fmtAmount(detail.amount, detail.currency)}`}
          tone="green"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">{statusBadge(detail.status)}</div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="收款方" value={detail.payee || '—'} />
              <Info label="收款账号" value={detail.payee_account || '—'} />
              <Info label="金额" value={fmtAmount(detail.amount, detail.currency)} />
              <Info label="申请人" value={detail.user_name || '—'} />
              {detail.payment_type === '供应商付款' && (
                <Info label="关联合同" value={detail.contract_title || '未关联'} />
              )}
            </div>

            {detail.reason && (
              <div>
                <p className="text-xs text-gray-400 mb-1">付款事由</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.reason}</p>
              </div>
            )}

            {detail.attachments && JSON.parse(detail.attachments).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">票据附件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {/* 审批进度（待完善的系统存根尚未提交，无审批实例，组件自身会静默不渲染） */}
            <ApprovalTimeline targetType="payment" targetId={detail.id} onChanged={load} />

            {/* 操作区 */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {EDITABLE_STATUSES.has(detail.status) && (
                <>
                  <button
                    onClick={() => openEdit(detail)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-colors"
                  >
                    <Send size={14} /> {detail.status === '待完善' ? '填写并提交审批' : '修改后重新提交'}
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
            </div>
          </div>
        </Modal>
      )}

      {/* 创建/编辑弹窗 */}
      {showForm && (
        <Modal
          icon={editingId ? Pencil : Plus}
          title={editingId ? '编辑付款申请' : '新建付款申请'}
          subtitle="填写完整付款信息后提交审批，无草稿保存"
          tone="green"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">付款类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PAYMENT_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, payment_type: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.payment_type === t
                        ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <Field label="付款摘要" required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                placeholder="如「7月阿里云服务器费用」"
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
                  options={['CNY', 'USD', 'HKD', 'EUR'].map(c => ({ value: c, label: c }))}
                  value={form.currency}
                  onChange={(v) => setForm({ ...form, currency: v === null ? '' : String(v) })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="收款方">
                <input
                  value={form.payee}
                  onChange={e => setForm({ ...form, payee: e.target.value })}
                  placeholder="收款单位 / 个人"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="收款账号（可选）">
                <input
                  value={form.payee_account}
                  onChange={e => setForm({ ...form, payee_account: e.target.value })}
                  placeholder="银行账号 / 支付宝等"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500"
                />
              </Field>
            </div>

            {form.payment_type === '供应商付款' && (
              <Field label="关联合同" required>
                <SearchableSelect
                  options={contracts.map(c => ({ value: c.id, label: c.contract_no ? `${c.title}（${c.contract_no}）` : c.title }))}
                  value={form.contract_id}
                  onChange={(v) => setForm({ ...form, contract_id: v === null ? null : Number(v) })}
                  placeholder="选择关联合同"
                  emptyText="无匹配合同"
                />
              </Field>
            )}

            <Field label="付款事由">
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="说明付款用途、背景"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 resize-none"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                票据 / 发票{form.payment_type === '供应商付款' ? '（账单明细，提交审批前必传，可粘贴截图）' : '（可选，可粘贴截图）'}
                {form.payment_type === '供应商付款' && <span className="text-red-400 ml-0.5">*</span>}
              </label>
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 transition-opacity"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                提交审批
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
