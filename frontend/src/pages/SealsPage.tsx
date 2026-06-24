import { useState, useEffect, useCallback } from 'react'
import {
  Stamp, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

interface SealItem {
  id: number
  user_id: number
  user_name: string | null
  seal_type: string
  title: string
  reason: string
  copies: number
  is_contract_related: boolean
  contract_id: number | null
  contract_title: string | null
  attachments: string | null
  status: string
  created_at: string
  updated_at: string
}

const SEAL_TYPES = ['公章', '财务章', '法人章']

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:   { label: '草稿',   cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  审批中: { label: '审批中', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  已盖章: { label: '已盖章', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  已驳回: { label: '已驳回', cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  已撤回: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
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
  seal_type: '公章', title: '', reason: '', copies: '1',
  is_contract_related: false, attachments: null as string | null,
}

export default function SealsPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('seal:view_all')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<SealItem[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<SealItem | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/seals?scope=${scope}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditingId(null); setForm({ ...emptyForm }); setShowForm(true) }
  const openEdit = (s: SealItem) => {
    setEditingId(s.id)
    setForm({
      seal_type: s.seal_type, title: s.title, reason: s.reason,
      copies: String(s.copies || 1), is_contract_related: s.is_contract_related,
      attachments: s.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  const save = async () => {
    if (!form.title.trim()) { showToast('请填写用印文件 / 摘要', 'warning'); return }
    setSaving(true)
    try {
      const body = {
        seal_type: form.seal_type,
        title: form.title.trim(),
        reason: form.reason.trim(),
        copies: parseInt(form.copies) || 1,
        is_contract_related: form.is_contract_related,
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/seals/${editingId}` : '/api/v1/seals'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '盖章申请已创建', 'success')
      setShowForm(false); load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  const submitApproval = async (s: SealItem) => {
    const ok = await showConfirm('提交后将进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/seals/${s.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setActing(false) }
  }

  const revoke = async (s: SealItem) => {
    const ok = await showConfirm('撤回后盖章申请回到草稿，可重新编辑。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/seals/${s.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (s: SealItem) => {
    const ok = await showConfirm(`确认删除盖章申请「${s.title}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/seals/${s.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '删除失败') }
      showToast('已删除', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '删除失败', 'error') }
  }

  const stats = [
    { label: '总申请', value: list.length },
    { label: '审批中', value: list.filter(s => s.status === '审批中').length },
    { label: '已盖章', value: list.filter(s => s.status === '已盖章').length },
  ]

  return (
    <div>
      <PageHeader
        icon={Stamp}
        title="盖章申请"
        description="公章、财务章、法人章用印申请，提交后经部门负责人、法务/财务、总经理审批，最后由印章管理员盖章"
        tone="red"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} /> 新建用印
          </button>
        }
      />

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
        <EmptyState icon={Stamp} title="暂无盖章申请" description="点击右上角「新建用印」发起第一笔申请" tone="red" />
      ) : (
        <div className="space-y-2">
          {list.map(s => (
            <button
              key={s.id}
              onClick={() => setDetail(s)}
              className="w-full text-left rounded-xl bg-bg-card border border-border/50 p-4 hover:border-border hover:bg-bg-hover/40 transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{s.title}</span>
                    {statusBadge(s.status)}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-400">{s.seal_type}</span>
                    {s.is_contract_related && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">涉合同</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate">
                    用印 {s.copies} 份
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 申请人 {s.user_name}</span>}
                    <span className="ml-1.5">· {fmtDate(s.created_at)}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <Modal
          icon={Stamp}
          title={detail.title}
          subtitle={`${detail.seal_type} · 用印 ${detail.copies} 份`}
          tone="red"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {statusBadge(detail.status)}
              {detail.is_contract_related && <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400">涉及合同</span>}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="印章类型" value={detail.seal_type} />
              <Info label="用印份数" value={`${detail.copies} 份`} />
              <Info label="申请人" value={detail.user_name || '—'} />
              <Info label="是否涉合同" value={detail.is_contract_related ? '是' : '否'} />
            </div>

            {detail.reason && (
              <div>
                <p className="text-xs text-gray-400 mb-1">用印事由</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.reason}</p>
              </div>
            )}

            {detail.attachments && JSON.parse(detail.attachments).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">用印文件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {detail.status !== '草稿' && (
              <ApprovalTimeline targetType="seal" targetId={detail.id} onChanged={load} />
            )}

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {detail.status === '草稿' && (
                <>
                  <button
                    onClick={() => submitApproval(detail)}
                    disabled={acting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
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
          title={editingId ? '编辑盖章申请' : '新建盖章申请'}
          subtitle="填写用印信息，保存为草稿后可提交审批"
          tone="red"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">印章类型</label>
              <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
                {SEAL_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, seal_type: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.seal_type === t
                        ? 'border-red-500 text-red-400 bg-red-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <Field label="用印文件 / 摘要" required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                placeholder="如「与XX公司采购合同」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-red-500"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="用印份数">
                <input
                  type="number" min={1} value={form.copies}
                  onChange={e => setForm({ ...form, copies: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-red-500"
                />
              </Field>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_contract_related}
                    onChange={e => setForm({ ...form, is_contract_related: e.target.checked })}
                    className="w-4 h-4 rounded accent-red-500"
                  />
                  涉及合同（需法务/财务初审）
                </label>
              </div>
            </div>

            <Field label="用印事由">
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="说明用印用途、背景"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-red-500 resize-none"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">用印文件（可选，可粘贴截图）</label>
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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
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
