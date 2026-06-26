import { useState, useEffect, useCallback } from 'react'
import {
  Plane, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X, CheckCircle2,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import SearchableSelect from '../components/SearchableSelect'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

interface BusinessTripItem {
  id: number
  user_id: number
  user_name: string | null
  title: string
  destination: string
  start_date: string
  end_date: string
  days: number
  purpose: string
  budget: number
  budget_unit: string
  currency: string
  transport: string
  attachments: string | null
  status: string  // 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已完成
  completed_at: string | null
  created_at: string
  updated_at: string
}

const DEFAULT_TRANSPORT_TYPES = ['飞机', '高铁', '火车', '汽车', '其他']

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:   { label: '草稿',   cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  审批中: { label: '审批中', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  已批准: { label: '已批准', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  已驳回: { label: '已驳回', cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  已撤回: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  已完成: { label: '已完成', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
}

function fmtAmount(n: number, c: string, unit = '元'): string {
  try { return `${c} ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}` }
  catch { return `${c} ${n} ${unit}` }
}
function fmtDate(s: string): string {
  try { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  catch { return s }
}
function fmtDateRange(s: string, e: string): string {
  return `${fmtDate(s)} - ${fmtDate(e)}`
}
function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

// datetime-local 值 "yyyy-MM-ddTHH:mm" → ISO 字符串（naive，不做时区转换，与后端北京时间 naive 约定一致）
function toISO(s: string): string {
  if (!s) return ''
  return s.length === 16 ? s + ':00' : s
}

// ISO 字符串 → datetime-local 值 "yyyy-MM-ddTHH:mm"
function toDatetimeLocal(s: string): string {
  if (!s) return ''
  return s.slice(0, 16)
}

// 根据起止日期计算天数（不足一天按一天算）
function calcDays(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start)
  const e = new Date(end)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0
  const diff = e.getTime() - s.getTime()
  if (diff < 0) return 0
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

const emptyForm = {
  title: '',
  destination: '',
  start_date: '',
  end_date: '',
  days: '',
  purpose: '',
  budget: '',
  budget_unit: '元',
  currency: 'CNY',
  transport: '飞机',
  attachments: null as string | null,
}

export default function BusinessTripsPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('trip:view_all')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<BusinessTripItem[]>([])
  const [loading, setLoading] = useState(true)
  const [transportTypes, setTransportTypes] = useState<string[]>(DEFAULT_TRANSPORT_TYPES)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<BusinessTripItem | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/business-trips?scope=${scope}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope])

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/business-trips/types')
      if (res.ok) {
        const data = await res.json()
        if (data.transport_types && Array.isArray(data.transport_types) && data.transport_types.length > 0) {
          setTransportTypes(data.transport_types)
        }
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTypes() }, [loadTypes])

  // 起止时间变化时自动计算天数
  const updateDates = (field: 'start_date' | 'end_date', value: string) => {
    const newForm = { ...form, [field]: value }
    const d = calcDays(newForm.start_date, newForm.end_date)
    newForm.days = d > 0 ? String(d) : ''
    setForm(newForm)
  }

  const openCreate = () => {
    setEditingId(null); setForm({ ...emptyForm }); setShowForm(true)
  }
  const openEdit = (p: BusinessTripItem) => {
    setEditingId(p.id)
    setForm({
      title: p.title,
      destination: p.destination,
      start_date: toDatetimeLocal(p.start_date),
      end_date: toDatetimeLocal(p.end_date),
      days: String(p.days || ''),
      purpose: p.purpose,
      budget: String(p.budget || ''),
      budget_unit: p.budget_unit || '元',
      currency: p.currency,
      transport: p.transport,
      attachments: p.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  const save = async () => {
    if (!form.title.trim()) { showToast('请填写出差标题', 'warning'); return }
    if (!form.destination.trim()) { showToast('请填写出差目的地', 'warning'); return }
    setSaving(true)
    try {
      const body = {
        title: form.title.trim(),
        destination: form.destination.trim(),
        start_date: toISO(form.start_date) || null,
        end_date: toISO(form.end_date) || null,
        days: parseInt(form.days) || 0,
        purpose: form.purpose.trim(),
        budget: parseFloat(form.budget) || 0,
        budget_unit: form.budget_unit,
        currency: form.currency,
        transport: form.transport,
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/business-trips/${editingId}` : '/api/v1/business-trips'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '出差申请已创建', 'success')
      setShowForm(false); load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  const submitApproval = async (p: BusinessTripItem) => {
    const ok = await showConfirm('提交后将进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/business-trips/${p.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setActing(false) }
  }

  const revoke = async (p: BusinessTripItem) => {
    const ok = await showConfirm('撤回后出差申请回到草稿，可重新编辑。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/business-trips/${p.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const complete = async (p: BusinessTripItem) => {
    const ok = await showConfirm('确认将此出差申请标记为已完成？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/business-trips/${p.id}/complete`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '操作失败') }
      showToast('已标记完成', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '操作失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (p: BusinessTripItem) => {
    const ok = await showConfirm(`确认删除出差申请「${p.title}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/business-trips/${p.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '删除失败') }
      showToast('已删除', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '删除失败', 'error') }
  }

  const stats = [
    { label: '总申请', value: list.length },
    { label: '审批中', value: list.filter(p => p.status === '审批中').length },
    { label: '已完成', value: list.filter(p => p.status === '已完成').length },
  ]

  return (
    <div>
      <PageHeader
        icon={Plane}
        title="出差申请"
        description="出差事项申请，提交后经审批流程，批准后可标记完成"
        tone="blue"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all"
          >
            <Plus size={16} /> 新建出差
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
        <EmptyState icon={Plane} title="暂无出差申请" description="点击右上角「新建出差」发起第一笔申请" tone="blue" />
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-400">{p.transport}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate">
                    目的地 {p.destination || '—'}
                    <span className="ml-1.5">· {p.days}天</span>
                    <span className="ml-1.5">· {fmtDateRange(p.start_date, p.end_date)}</span>
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 申请人 {p.user_name}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-blue-400">{fmtAmount(p.budget, p.currency, p.budget_unit)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <Modal
          icon={Plane}
          title={detail.title}
          subtitle={`${detail.destination} · ${detail.days}天`}
          tone="blue"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {statusBadge(detail.status)}
              {detail.completed_at && <span className="text-[11px] text-gray-500">完成于 {fmtDate(detail.completed_at)}</span>}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="目的地" value={detail.destination || '—'} />
              <Info label="交通方式" value={detail.transport || '—'} />
              <Info label="天数" value={`${detail.days} 天`} />
              <Info label="预算" value={fmtAmount(detail.budget, detail.currency, detail.budget_unit)} />
              <Info label="开始时间" value={fmtDate(detail.start_date)} />
              <Info label="结束时间" value={fmtDate(detail.end_date)} />
              <Info label="申请人" value={detail.user_name || '—'} />
              <Info label="创建时间" value={fmtDate(detail.created_at)} />
            </div>

            {detail.purpose && (
              <div>
                <p className="text-xs text-gray-400 mb-1">出差事由</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.purpose}</p>
              </div>
            )}

            {detail.attachments && JSON.parse(detail.attachments).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">附件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {/* 审批进度（提交后展示） */}
            {detail.status !== '草稿' && (
              <ApprovalTimeline targetType="business_trip" targetId={detail.id} onChanged={load} />
            )}

            {/* 操作区 */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {detail.status === '草稿' && (
                <>
                  <button
                    onClick={() => submitApproval(detail)}
                    disabled={acting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-50 transition-colors"
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
              {detail.status === '已批准' && (
                <button
                  onClick={() => complete(detail)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {acting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} 标记完成
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
          title={editingId ? '编辑出差申请' : '新建出差申请'}
          subtitle="填写出差信息，保存为草稿后可提交审批"
          tone="blue"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <Field label="出差标题" required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                placeholder="如「北京客户拜访」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-blue-500"
              />
            </Field>

            <Field label="目的地" required>
              <input
                value={form.destination}
                onChange={e => setForm({ ...form, destination: e.target.value })}
                maxLength={200}
                placeholder="如「北京·海淀区」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-blue-500"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">交通方式</label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {transportTypes.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, transport: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.transport === t
                        ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="开始时间">
                <input
                  type="datetime-local"
                  value={form.start_date}
                  onChange={e => updateDates('start_date', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-blue-500"
                />
              </Field>
              <Field label="结束时间">
                <input
                  type="datetime-local"
                  value={form.end_date}
                  onChange={e => updateDates('end_date', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-blue-500"
                />
              </Field>
            </div>

            <Field label="出差天数">
              <input
                type="number"
                value={form.days}
                onChange={e => setForm({ ...form, days: e.target.value })}
                min={0}
                placeholder="根据起止时间自动计算"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-blue-500"
              />
            </Field>

            <Field label="出差事由">
              <textarea
                value={form.purpose}
                onChange={e => setForm({ ...form, purpose: e.target.value })}
                rows={3}
                placeholder="说明出差目的、行程安排"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-blue-500 resize-none"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Field label="预算">
                  <div className="flex gap-2">
                    <input
                      type="number" value={form.budget}
                      onChange={e => setForm({ ...form, budget: e.target.value })}
                      placeholder="0.00"
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-blue-500"
                    />
                    <div className="flex rounded-lg overflow-hidden border border-border shrink-0 text-xs">
                      {(['元', '万元'] as const).map(u => (
                        <button key={u} type="button" onClick={() => setForm({ ...form, budget_unit: u })}
                          className={`px-2.5 py-2 transition-colors ${form.budget_unit === u ? 'bg-blue-600 text-white' : 'bg-bg-input text-gray-400 hover:bg-bg-hover'}`}>{u}</button>
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

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">附件（可选，可粘贴截图）</label>
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-50 transition-all"
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
