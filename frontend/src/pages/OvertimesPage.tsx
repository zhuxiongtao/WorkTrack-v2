import { useState, useEffect, useCallback } from 'react'
import {
  Clock, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

interface OvertimeItem {
  id: number
  user_id: number
  user_name: string | null
  title: string
  start_at: string
  end_at: string
  hours: number
  reason: string
  compensate_type: string
  attachments: string | null
  status: string
  created_at: string
  updated_at: string
}

const DEFAULT_COMPENSATE_TYPES = ['调休', '加班费']

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:   { label: '草稿',   cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  审批中: { label: '审批中', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  已批准: { label: '已批准', cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  已驳回: { label: '已驳回', cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  已撤回: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
}

function fmtDateTime(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

function fmtTimeRange(start: string, end: string): string {
  return `${fmtDateTime(start)} - ${fmtDateTime(end)}`
}

function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

/** ISO string -> "yyyy-MM-ddTHH:mm" for datetime-local input */
function toDatetimeLocal(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return '' }
}

/** "yyyy-MM-ddTHH:mm" -> ISO string */
function fromDatetimeLocal(value: string): string {
  if (!value) return ''
  try { return new Date(value).toISOString() } catch { return '' }
}

/** 根据起止时间计算小时数（保留 1 位小数） */
function computeHours(start: string, end: string): number {
  if (!start || !end) return 0
  try {
    const s = new Date(start).getTime()
    const e = new Date(end).getTime()
    if (e <= s) return 0
    return Math.round((e - s) / (1000 * 60 * 60) * 10) / 10
  } catch { return 0 }
}

const emptyForm = {
  title: '',
  start_at: '',
  end_at: '',
  hours: '',
  reason: '',
  compensate_type: '调休',
  attachments: null as string | null,
}

export default function OvertimesPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('overtime:view_all')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<OvertimeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [compensateTypes, setCompensateTypes] = useState<string[]>(DEFAULT_COMPENSATE_TYPES)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<OvertimeItem | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/overtimes?scope=${scope}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope])

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/overtimes/types')
      if (res.ok) {
        const data = await res.json()
        if (data.compensate_types && data.compensate_types.length > 0) {
          setCompensateTypes(data.compensate_types)
        }
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTypes() }, [loadTypes])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm, compensate_type: compensateTypes[0] || '调休' })
    setShowForm(true)
  }
  const openEdit = (p: OvertimeItem) => {
    setEditingId(p.id)
    setForm({
      title: p.title,
      start_at: toDatetimeLocal(p.start_at),
      end_at: toDatetimeLocal(p.end_at),
      hours: String(p.hours || ''),
      reason: p.reason,
      compensate_type: p.compensate_type,
      attachments: p.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  /** 更新字段，起止时间变化时自动计算时长 */
  const updateField = (field: keyof typeof form, value: string) => {
    const next = { ...form, [field]: value }
    if ((field === 'start_at' || field === 'end_at') && next.start_at && next.end_at) {
      const h = computeHours(next.start_at, next.end_at)
      if (h > 0) next.hours = String(h)
    }
    setForm(next)
  }

  const save = async () => {
    if (!form.title.trim()) { showToast('请填写加班标题', 'warning'); return }
    if (!form.start_at || !form.end_at) { showToast('请选择加班起止时间', 'warning'); return }
    setSaving(true)
    try {
      const body = {
        title: form.title.trim(),
        start_at: fromDatetimeLocal(form.start_at),
        end_at: fromDatetimeLocal(form.end_at),
        hours: parseFloat(form.hours) || 0,
        reason: form.reason.trim(),
        compensate_type: form.compensate_type,
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/overtimes/${editingId}` : '/api/v1/overtimes'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '加班申请已创建', 'success')
      setShowForm(false); load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  const submitApproval = async (p: OvertimeItem) => {
    const ok = await showConfirm('提交后将进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/overtimes/${p.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setActing(false) }
  }

  const revoke = async (p: OvertimeItem) => {
    const ok = await showConfirm('撤回后加班申请回到草稿，可重新编辑。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/overtimes/${p.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (p: OvertimeItem) => {
    const ok = await showConfirm(`确认删除加班申请「${p.title}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/overtimes/${p.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '删除失败') }
      showToast('已删除', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '删除失败', 'error') }
  }

  const stats = [
    { label: '总申请', value: list.length },
    { label: '审批中', value: list.filter(p => p.status === '审批中').length },
    { label: '已批准', value: list.filter(p => p.status === '已批准').length },
  ]

  return (
    <div>
      <PageHeader
        icon={Clock}
        title="加班申请"
        description="记录加班时长与事由，选择调休或加班费补偿，提交后经审批生效"
        tone="cyan"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} /> 新建加班
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
        <EmptyState icon={Clock} title="暂无加班申请" description="点击右上角「新建加班」发起第一笔申请" tone="cyan" />
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-400">{p.compensate_type}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate">
                    {fmtTimeRange(p.start_at, p.end_at)}
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 申请人 {p.user_name}</span>}
                    <span className="ml-1.5">· {fmtDateTime(p.created_at)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-cyan-400">{p.hours} 小时</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <Modal
          icon={Clock}
          title={detail.title}
          subtitle={`${detail.compensate_type} · ${detail.hours} 小时`}
          tone="cyan"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">{statusBadge(detail.status)}</div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="开始时间" value={fmtDateTime(detail.start_at)} />
              <Info label="结束时间" value={fmtDateTime(detail.end_at)} />
              <Info label="加班时长" value={`${detail.hours} 小时`} />
              <Info label="补偿方式" value={detail.compensate_type} />
              <Info label="申请人" value={detail.user_name || '—'} />
            </div>

            {detail.reason && (
              <div>
                <p className="text-xs text-gray-400 mb-1">加班事由</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.reason}</p>
              </div>
            )}

            {detail.attachments && JSON.parse(detail.attachments).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">相关附件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {/* 审批进度（提交后展示） */}
            {detail.status !== '草稿' && (
              <ApprovalTimeline targetType="overtime" targetId={detail.id} onChanged={load} />
            )}

            {/* 操作区 */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {detail.status === '草稿' && (
                <>
                  <button
                    onClick={() => submitApproval(detail)}
                    disabled={acting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 text-white text-xs font-bold hover:bg-cyan-600 disabled:opacity-50 transition-colors"
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
          title={editingId ? '编辑加班申请' : '新建加班申请'}
          subtitle="填写加班信息，保存为草稿后可提交审批"
          tone="cyan"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">补偿方式</label>
              <div className="grid grid-cols-2 gap-2">
                {compensateTypes.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, compensate_type: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.compensate_type === t
                        ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <Field label="加班标题" required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                placeholder="如「周末上线保障加班」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-cyan-500"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="开始时间" required>
                <input
                  type="datetime-local"
                  value={form.start_at}
                  onChange={e => updateField('start_at', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-cyan-500"
                />
              </Field>
              <Field label="结束时间" required>
                <input
                  type="datetime-local"
                  value={form.end_at}
                  onChange={e => updateField('end_at', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-cyan-500"
                />
              </Field>
            </div>

            <Field label="加班时长（小时）">
              <input
                type="number"
                step="0.1"
                value={form.hours}
                onChange={e => setForm({ ...form, hours: e.target.value })}
                placeholder="根据起止时间自动计算，可手动调整"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-cyan-500"
              />
            </Field>

            <Field label="加班事由">
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="说明加班背景、工作内容"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-cyan-500 resize-none"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">相关附件（可选，可粘贴截图）</label>
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
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
