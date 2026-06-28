import { useState, useEffect, useCallback, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  UserPlus, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X, Clock,
  Mail, Phone, Briefcase, Building2, Calendar, User, DollarSign, Shield, Cpu,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal, Field } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'
import SearchableSelect from '../components/SearchableSelect'

interface HireItem {
  id: number
  user_id: number
  user_name: string | null
  candidate_name: string
  candidate_username: string
  candidate_email: string
  candidate_phone: string | null
  job_title: string | null
  department_id: number | null
  department_name: string | null
  leader_id: number | null
  leader_name: string | null
  first_work_date: string | null
  hire_date: string
  is_admin: boolean
  use_shared_models: boolean
  salary: string | null
  reason: string
  attachments: string | null
  status: string  // 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已入职
  created_user_id: number | null
  created_user_name: string | null
  onboarded_at: string | null
  created_at: string
  updated_at: string
}

interface DepartmentOption { id: number; name: string }
interface UserOption { id: number; username: string; name: string | null }

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:   { label: '草稿',   cls: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/20' },
  审批中: { label: '审批中', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' },
  已批准: { label: '已批准', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' },
  已驳回: { label: '已驳回', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' },
  已撤回: { label: '已撤回', cls: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/20' },
  已入职: { label: '已入职', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20' },
}

const emptyForm = {
  candidate_name: '',
  candidate_username: '',
  candidate_email: '',
  candidate_phone: '',
  job_title: '',
  department_id: null as number | null,
  leader_id: null as number | null,
  first_work_date: '',
  hire_date: '',
  is_admin: false,
  use_shared_models: false,
  salary: '',
  reason: '',
  attachments: null as string | null,
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  } catch { return s }
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-500/10 dark:text-gray-400 dark:border-gray-500/20' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

export default function HiresPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('hire:view_all')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [keyword, setKeyword] = useState('')
  const keywordRef = useRef('')
  keywordRef.current = keyword
  const [list, setList] = useState<HireItem[]>([])
  const [loading, setLoading] = useState(true)

  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [users, setUsers] = useState<UserOption[]>([])

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<HireItem | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('scope', scope)
      if (statusFilter) params.set('status', statusFilter)
      if (keywordRef.current.trim()) params.set('keyword', keywordRef.current.trim())
      const res = await fetch(`/api/v1/hires?${params.toString()}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope, statusFilter])

  const loadDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users/departments')
      if (res.ok) setDepartments(await res.json())
    } catch { /* ignore */ }
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users/simple?scope=all')
      if (res.ok) setUsers(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadDepartments() }, [loadDepartments])
  useEffect(() => { loadUsers() }, [loadUsers])

  const openCreate = () => {
    setEditingId(null); setForm({ ...emptyForm }); setShowForm(true)
  }
  const openEdit = (p: HireItem) => {
    setEditingId(p.id)
    setForm({
      candidate_name: p.candidate_name,
      candidate_username: p.candidate_username,
      candidate_email: p.candidate_email,
      candidate_phone: p.candidate_phone || '',
      job_title: p.job_title || '',
      department_id: p.department_id,
      leader_id: p.leader_id,
      first_work_date: p.first_work_date ? p.first_work_date.slice(0, 10) : '',
      hire_date: p.hire_date ? p.hire_date.slice(0, 10) : '',
      is_admin: p.is_admin,
      use_shared_models: p.use_shared_models,
      salary: p.salary || '',
      reason: p.reason,
      attachments: p.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  const save = async () => {
    if (!form.candidate_name.trim()) { showToast('请填写候选人姓名', 'warning'); return }
    if (!form.candidate_username.trim()) { showToast('请填写登录名', 'warning'); return }
    if (!form.candidate_email.trim()) { showToast('请填写邮箱', 'warning'); return }
    if (!form.hire_date) { showToast('请选择入职日期', 'warning'); return }
    if (!form.reason.trim()) { showToast('请填写入职事由', 'warning'); return }
    setSaving(true)
    try {
      const body = {
        candidate_name: form.candidate_name.trim(),
        candidate_username: form.candidate_username.trim(),
        candidate_email: form.candidate_email.trim(),
        candidate_phone: form.candidate_phone.trim() || null,
        job_title: form.job_title.trim() || null,
        department_id: form.department_id,
        leader_id: form.leader_id,
        first_work_date: form.first_work_date || null,
        hire_date: form.hire_date,
        is_admin: form.is_admin,
        use_shared_models: form.use_shared_models,
        salary: form.salary.trim() || null,
        reason: form.reason.trim(),
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/hires/${editingId}` : '/api/v1/hires'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '入职申请已创建', 'success')
      setShowForm(false); load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  const submitApproval = async (p: HireItem) => {
    const ok = await showConfirm('提交后将进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/hires/${p.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setActing(false) }
  }

  const revoke = async (p: HireItem) => {
    const ok = await showConfirm('撤回后入职申请回到草稿，可重新编辑。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/hires/${p.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (p: HireItem) => {
    const ok = await showConfirm(`确认删除入职申请「${p.candidate_name}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/hires/${p.id}`, { method: 'DELETE' })
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

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-900 dark:text-gray-200 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15'

  return (
    <div>
      <PageHeader
        icon={UserPlus}
        title="员工入职"
        description="新建员工入职申请，提交后经审批人审核，批准后自动开通账号"
        tone="blue"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all"
          >
            <Plus size={16} /> 新建入职申请
          </button>
        }
      />

      {/* 筛选区 */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {canViewAll && (
          <div className="flex items-center gap-1 bg-bg-hover/60 border border-border rounded-lg p-0.5">
            {([
              { key: 'mine' as const, label: '我发起的' },
              { key: 'all' as const, label: '全部申请' },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setScope(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  scope === t.key
                    ? 'bg-accent-blue text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <SearchableSelect
          options={[
            { value: '', label: '全部状态' },
            ...Object.keys(STATUS_META).map(s => ({ value: s, label: s })),
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter((v as string) || '')}
          placeholder="全部状态"
          size="sm"
          className="w-32"
        />
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load() }}
          placeholder="搜索候选人/职位…"
          className="px-3 py-1.5 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-xs text-gray-900 dark:text-gray-200 outline-none focus:border-accent-blue w-56"
        />
        <button
          onClick={load}
          className="border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg px-3 py-1.5 text-xs hover:border-accent-blue/50 hover:text-accent-blue transition-colors"
        >
          刷新
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
      ) : list.length === 0 ? (
        <EmptyState icon={UserPlus} title="暂无入职申请" description="点击右上角「新建入职申请」发起第一笔申请" tone="blue" />
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
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.candidate_name}</span>
                    {statusBadge(p.status)}
                    {p.job_title && <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-500 dark:text-gray-400">{p.job_title}</span>}
                    {p.department_name && <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-500 dark:text-gray-400">{p.department_name}</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate flex items-center gap-1.5 flex-wrap">
                    <Clock size={11} className="shrink-0" />
                    <span>入职 {fmtDate(p.hire_date)}</span>
                    {p.first_work_date && <span className="ml-1.5">· 参加工作 {fmtDate(p.first_work_date)}</span>}
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 发起人 {p.created_user_name || p.user_name || '—'}</span>}
                    <span className="ml-1.5">· {fmtDateTime(p.created_at)}</span>
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
          icon={UserPlus}
          title={detail.candidate_name}
          subtitle={detail.job_title || detail.department_name || '入职申请'}
          tone="blue"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">{statusBadge(detail.status)}</div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <Info icon={User} label="姓名" value={detail.candidate_name} />
              <Info icon={Mail} label="邮箱" value={detail.candidate_email} />
              <Info icon={Phone} label="电话" value={detail.candidate_phone || '—'} />
              <Info icon={Briefcase} label="职位" value={detail.job_title || '—'} />
              <Info icon={Building2} label="部门" value={detail.department_name || '—'} />
              <Info icon={User} label="汇报上级" value={detail.leader_name || '—'} />
              <Info icon={Calendar} label="入职日期" value={fmtDate(detail.hire_date)} />
              <Info icon={Calendar} label="参加工作日期" value={detail.first_work_date ? `${fmtDate(detail.first_work_date)}（用于年假工龄）` : '—'} />
              <Info icon={DollarSign} label="薪资" value={detail.salary || '—'} />
              <Info icon={Shield} label="管理员" value={detail.is_admin ? '是' : '否'} />
              <Info icon={Cpu} label="共享模型" value={detail.use_shared_models ? '是' : '否'} />
              <Info icon={User} label="发起人" value={detail.created_user_name || detail.user_name || '—'} />
              {detail.onboarded_at && <Info icon={Calendar} label="入职完成" value={fmtDateTime(detail.onboarded_at)} />}
              <Info icon={Clock} label="创建时间" value={fmtDateTime(detail.created_at)} />
            </div>

            {detail.reason && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">入职事由</p>
                <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.reason}</p>
              </div>
            )}

            {detail.attachments && (() => {
              try { return JSON.parse(detail.attachments).length > 0 } catch { return false }
            })() && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">附件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {detail.status !== '草稿' && (
              <ApprovalTimeline targetType="hire" targetId={detail.id} onChanged={load} />
            )}

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {(detail.status === '草稿' || detail.status === '已驳回' || detail.status === '已撤回') && (
                <>
                  <button
                    onClick={() => submitApproval(detail)}
                    disabled={acting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 transition-colors"
                  >
                    {acting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 提交审批
                  </button>
                  <button
                    onClick={() => openEdit(detail)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-300 text-xs font-medium hover:border-accent-blue/50 hover:text-accent-blue transition-colors"
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-300 text-xs font-medium hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-50 transition-colors"
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
          title={editingId ? '编辑入职申请' : '新建入职申请'}
          subtitle="填写候选人信息，保存为草稿后可提交审批"
          tone="blue"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="候选人姓名" required>
                <input value={form.candidate_name} onChange={e => setForm({ ...form, candidate_name: e.target.value })} maxLength={50} placeholder="如「张三」" className={inputCls} />
              </Field>
              <Field label="登录名" required hint="用作账号">
                <input value={form.candidate_username} onChange={e => setForm({ ...form, candidate_username: e.target.value })} maxLength={50} placeholder="如「zhangsan」" className={inputCls} />
              </Field>
              <Field label="邮箱" required>
                <input type="email" value={form.candidate_email} onChange={e => setForm({ ...form, candidate_email: e.target.value })} maxLength={100} placeholder="如「zhangsan@example.com」" className={inputCls} />
              </Field>
              <Field label="电话" hint="可选">
                <input value={form.candidate_phone} onChange={e => setForm({ ...form, candidate_phone: e.target.value })} maxLength={20} placeholder="如「13800000000」" className={inputCls} />
              </Field>
              <Field label="职位" hint="可选">
                <input value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })} maxLength={100} placeholder="如「前端工程师」" className={inputCls} />
              </Field>
              <Field label="薪资" hint="可选">
                <input value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} maxLength={50} placeholder="如「15K/月」" className={inputCls} />
              </Field>
              <Field label="入职部门">
                <SearchableSelect
                  options={departments.map(d => ({ value: d.id, label: d.name }))}
                  value={form.department_id}
                  onChange={(v) => setForm({ ...form, department_id: (v as number) || null })}
                  placeholder="选择入职部门..."
                  emptyText="无匹配部门"
                />
              </Field>
              <Field label="汇报上级">
                <SearchableSelect
                  options={[{ value: 0, label: '不指定' }, ...users.map(u => ({ value: u.id, label: u.name || u.username }))]}
                  value={form.leader_id || 0}
                  onChange={(v) => setForm({ ...form, leader_id: (v as number) || null })}
                  placeholder="选择汇报上级..."
                  emptyText="无匹配人员"
                />
              </Field>
              <Field label="入职日期" required hint="本公司入职日期">
                <input type="date" value={form.hire_date} onChange={e => setForm({ ...form, hire_date: e.target.value })} className={inputCls} />
              </Field>
              <Field label="参加工作日期" hint="首次参加工作，用于法定年假工龄计算">
                <input type="date" value={form.first_work_date} onChange={e => setForm({ ...form, first_work_date: e.target.value })} className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="管理员权限">
                <Toggle checked={form.is_admin} onChange={(v) => setForm({ ...form, is_admin: v })} />
              </Field>
              <Field label="使用共享模型">
                <Toggle checked={form.use_shared_models} onChange={(v) => setForm({ ...form, use_shared_models: v })} />
              </Field>
            </div>

            <Field label="入职事由" required>
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="补充入职原因、岗位需求等"
                className={`${inputCls} resize-none`}
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">附件（可选，简历/offer 等）</label>
              <FileUpload filesJson={form.attachments} onChange={v => setForm({ ...form, attachments: v })} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-300 text-xs font-medium hover:border-accent-blue/50 hover:text-accent-blue transition-colors"
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

function Info({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <Icon size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" />
      <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 w-[4em]">{label}</span>
      <span className="text-xs text-gray-700 dark:text-gray-200 break-words min-w-0 flex-1">{value}</span>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-accent-blue' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-4' : 'translate-x-0.5'
      }`} />
    </button>
  )
}
