import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Plus, ChevronLeft, AlertTriangle, CheckCircle2,
  Clock, User, MessageSquare, ChevronRight, Loader2,
  Search, Activity, Calendar, Building2, Check, XCircle,
  PlayCircle, Paperclip, Trash2,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal, ModalFooter, SectionLabel, Field } from '../components/design-system'
import SearchableSelect from '../components/SearchableSelect'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'

/* ──── 类型定义 ──── */

interface Stage {
  id: number
  event_id: number
  stage_type: string
  name: string
  order: number
  status: string
  assigned_to: number | null
  assigned_to_name: string | null
  assigned_by: number | null
  assigned_at: string | null
  started_at: string | null
  completed_at: string | null
  action_summary: string | null
  feedback: string | null
  attachments: string[]
  approval_required: boolean
  approver_id: number | null
  approver_name: string | null
  approved_at: string | null
  approval_note: string | null
  created_at: string
  updated_at: string
}

interface CustomerTask {
  id: number
  event_id: number
  stage_id: number
  customer_id: number
  customer_name: string | null
  project_id: number | null
  project_name: string | null
  assigned_to: number | null
  assigned_to_name: string | null
  status: string
  contact_method: string | null
  contacted_at: string | null
  customer_deadline: string | null
  confirmed_at: string | null
  customer_response: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface ModelChangeEvent {
  id: number
  title: string
  change_type: string
  supplier_id: number
  supplier_name: string | null
  channel_ids: number[]
  effective_date: string | null
  source: string
  description: string
  old_value: string | null
  new_value: string | null
  risk_level: string
  affected_projects: number[]
  status: string
  created_by: number
  created_by_name: string | null
  created_at: string
  updated_at: string
  stages: Stage[]
  customer_tasks: CustomerTask[]
}

interface EventListItem {
  id: number
  title: string
  change_type: string
  supplier_id: number
  supplier_name: string | null
  risk_level: string
  status: string
  effective_date: string | null
  created_by: number
  created_by_name: string | null
  created_at: string
  updated_at: string
  current_stage_order: number | null
  current_stage_name: string | null
  affected_count: number
}

interface Supplier { id: number; name: string }
interface UserBasic { id: number; name: string; username: string }

/* ──── 常量 ──── */

const CHANGE_TYPE_LABELS: Record<string, string> = {
  model_ga: '模型 GA 发布', model_update: '模型版本更新',
  model_deprecated: '模型下线', pricing_change: '价格调整',
  quota_change: '配额调整', endpoint_change: 'API 地址变更', other: '其他',
}

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-500 bg-green-500/10 border-green-500/20',
  medium: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20',
  high: 'text-red-500 bg-red-500/10 border-red-500/20',
}
const RISK_LABELS: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' }

const STATUS_COLORS: Record<string, string> = {
  draft: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
  active: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  completed: 'text-green-500 bg-green-500/10 border-green-500/20',
  cancelled: 'text-red-400 bg-red-400/10 border-red-400/20',
}
const STATUS_LABELS: Record<string, string> = {
  draft: '草稿', active: '进行中', completed: '已完成', cancelled: '已取消',
}

const STAGE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-400', in_progress: 'bg-blue-500/20 text-blue-400',
  awaiting_approval: 'bg-yellow-500/20 text-yellow-400', approved: 'bg-purple-500/20 text-purple-400',
  completed: 'bg-green-500/20 text-green-400',
}
const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: '待启动', in_progress: '执行中', awaiting_approval: '待审批',
  approved: '已批准', completed: '已完成',
}

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: '待联系', contacted: '已联系', confirmed: '已确认', no_response: '未回应',
}
const TASK_STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400 bg-gray-400/10', contacted: 'text-blue-400 bg-blue-400/10',
  confirmed: 'text-green-500 bg-green-500/10', no_response: 'text-red-400 bg-red-400/10',
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function fmtDatetime(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/* ──── 主页面 ──── */

export default function ModelChangePage() {
  const { toast: addToast } = useToast()
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('model:edit')

  const [view, setView] = useState<'list' | 'detail'>('list')
  const [events, setEvents] = useState<EventListItem[]>([])
  const [detail, setDetail] = useState<ModelChangeEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterRisk, setFilterRisk] = useState('')

  // 弹窗状态
  const [showCreate, setShowCreate] = useState(false)
  const [showAssign, setShowAssign] = useState<Stage | null>(null)
  const [showComplete, setShowComplete] = useState<Stage | null>(null)
  const [showApprove, setShowApprove] = useState<Stage | null>(null)
  const [showEditTask, setShowEditTask] = useState<CustomerTask | null>(null)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [users, setUsers] = useState<UserBasic[]>([])
  const [saving, setSaving] = useState(false)

  // 创建表单
  const [form, setForm] = useState({
    title: '', change_type: 'model_ga', supplier_id: '',
    effective_date: '', source: '', description: '',
    old_value: '', new_value: '', risk_level: 'medium',
  })

  // 阶段操作表单
  const [assignTo, setAssignTo] = useState('')
  const [completeForm, setCompleteForm] = useState({ action_summary: '', feedback: '' })
  const [approveForm, setApproveForm] = useState({ approved: true, note: '' })

  // 客户任务编辑表单
  const [taskForm, setTaskForm] = useState({
    status: 'pending', contact_method: '', customer_response: '', notes: '', customer_deadline: '',
  })

  /* ── 数据加载 ── */

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterRisk) params.set('risk_level', filterRisk)
      const res = await fetch(`/api/v1/model-changes?${params}`)
      const data = await res.json()
      setEvents(Array.isArray(data) ? data : [])
    } catch {
      addToast('加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterRisk, addToast])

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/v1/model-changes/${id}`)
      const data = await res.json()
      setDetail(data)
    } catch {
      addToast('加载详情失败', 'error')
    } finally {
      setDetailLoading(false)
    }
  }, [addToast])

  useEffect(() => { loadEvents() }, [loadEvents])

  useEffect(() => {
    fetch('/api/v1/suppliers').then(r => r.json()).then(d => setSuppliers(Array.isArray(d) ? d : []))
    fetch('/api/v1/users').then(r => r.json()).then(d => setUsers(Array.isArray(d) ? d : []))
  }, [])

  /* ── 创建事件 ── */

  async function handleCreate() {
    if (!form.title.trim() || !form.supplier_id) { addToast('请填写标题和供应商', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/v1/model-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, change_type: form.change_type,
          supplier_id: parseInt(form.supplier_id),
          effective_date: form.effective_date || null,
          source: form.source, description: form.description,
          old_value: form.old_value || null, new_value: form.new_value || null,
          risk_level: form.risk_level, channel_ids: [],
        }),
      })
      if (!res.ok) throw new Error()
      addToast('变更事件已创建', 'success')
      setShowCreate(false)
      setForm({ title: '', change_type: 'model_ga', supplier_id: '', effective_date: '', source: '', description: '', old_value: '', new_value: '', risk_level: 'medium' })
      loadEvents()
    } catch { addToast('创建失败', 'error') } finally { setSaving(false) }
  }

  /* ── 删除事件 ── */

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('确定要删除这条变更事件吗？此操作不可恢复。')) return
    try {
      const res = await fetch(`/api/v1/model-changes/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      addToast('已删除', 'success')
      loadEvents()
    } catch { addToast('删除失败', 'error') }
  }

  /* ── 影响分析 ── */

  async function handleAnalyze() {
    if (!detail) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/model-changes/${detail.id}/analyze`, { method: 'POST' })
      if (!res.ok) throw new Error()
      addToast('影响分析完成，已生成客户跟进任务', 'success')
      loadDetail(detail.id); loadEvents()
    } catch { addToast('分析失败', 'error') } finally { setSaving(false) }
  }

  /* ── 阶段：指派 ── */

  async function handleAssign() {
    if (!showAssign || !assignTo) { addToast('请选择执行人', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/model-changes/${showAssign.event_id}/stages/${showAssign.id}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: parseInt(assignTo) }),
      })
      if (!res.ok) throw new Error()
      addToast('指派成功', 'success')
      setShowAssign(null); setAssignTo('')
      if (detail) loadDetail(detail.id)
    } catch { addToast('指派失败', 'error') } finally { setSaving(false) }
  }

  /* ── 阶段：开始 ── */

  async function handleStart(stage: Stage) {
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/model-changes/${stage.event_id}/stages/${stage.id}/start`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); addToast(e.detail || '操作失败', 'error'); return }
      addToast('阶段已开始', 'success')
      if (detail) loadDetail(detail.id)
    } catch { addToast('操作失败', 'error') } finally { setSaving(false) }
  }

  /* ── 阶段：完成 ── */

  async function handleComplete() {
    if (!showComplete || !completeForm.action_summary.trim()) { addToast('请填写执行摘要', 'error'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/model-changes/${showComplete.event_id}/stages/${showComplete.id}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_summary: completeForm.action_summary, feedback: completeForm.feedback || null, attachments: [] }),
      })
      if (!res.ok) throw new Error()
      addToast('阶段已完成', 'success')
      setShowComplete(null); setCompleteForm({ action_summary: '', feedback: '' })
      if (detail) loadDetail(detail.id)
    } catch { addToast('操作失败', 'error') } finally { setSaving(false) }
  }

  /* ── 阶段：审批 ── */

  async function handleApprove() {
    if (!showApprove) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/model-changes/${showApprove.event_id}/stages/${showApprove.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: approveForm.approved, note: approveForm.note || null }),
      })
      if (!res.ok) throw new Error()
      addToast(approveForm.approved ? '审批通过' : '已驳回', 'success')
      setShowApprove(null); setApproveForm({ approved: true, note: '' })
      if (detail) { loadDetail(detail.id); loadEvents() }
    } catch { addToast('操作失败', 'error') } finally { setSaving(false) }
  }

  /* ── 客户任务：更新 ── */

  async function handleUpdateTask() {
    if (!showEditTask || !detail) return
    setSaving(true)
    try {
      const body: Record<string, string | null> = {}
      if (taskForm.status) body.status = taskForm.status
      if (taskForm.contact_method) body.contact_method = taskForm.contact_method
      if (taskForm.customer_response) body.customer_response = taskForm.customer_response
      if (taskForm.notes) body.notes = taskForm.notes
      if (taskForm.customer_deadline) body.customer_deadline = taskForm.customer_deadline
      const res = await fetch(`/api/v1/model-changes/${detail.id}/customer-tasks/${showEditTask.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      addToast('更新成功', 'success')
      setShowEditTask(null); loadDetail(detail.id)
    } catch { addToast('更新失败', 'error') } finally { setSaving(false) }
  }

  /* ── 进入详情 ── */

  function openDetail(item: EventListItem) {
    setView('detail')
    loadDetail(item.id)
  }

  /* ── 筛选 ── */

  const filteredEvents = events.filter(e => {
    const q = search.toLowerCase()
    return e.title.toLowerCase().includes(q) ||
      (e.supplier_name || '').toLowerCase().includes(q) ||
      (CHANGE_TYPE_LABELS[e.change_type] || '').toLowerCase().includes(q)
  })

  /* ──────────────────── 详情视图 ──────────────────── */

  if (view === 'detail') {
    if (detailLoading || !detail) {
      return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-accent-blue" /></div>
    }
    const stages = [...detail.stages].sort((a, b) => a.order - b.order)

    return (
      <div className="max-w-5xl mx-auto space-y-6">
        {/* 返回 + 基本信息 */}
        <div>
          <button onClick={() => { setView('list'); loadEvents() }} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-text-primary transition-colors mb-4">
            <ChevronLeft size={16} /> 返回列表
          </button>

          <div className="bg-bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <h1 className="text-lg font-bold text-text-primary">{detail.title}</h1>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${STATUS_COLORS[detail.status] || ''}`}>
                    {STATUS_LABELS[detail.status] || detail.status}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${RISK_COLORS[detail.risk_level] || ''}`}>
                    {RISK_LABELS[detail.risk_level] || detail.risk_level}
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                  <span><span className="text-gray-500">供应商：</span>{detail.supplier_name || `#${detail.supplier_id}`}</span>
                  <span><span className="text-gray-500">类型：</span>{CHANGE_TYPE_LABELS[detail.change_type] || detail.change_type}</span>
                  {detail.effective_date && <span><span className="text-gray-500">生效：</span>{fmtDate(detail.effective_date)}</span>}
                  {detail.source && <span><span className="text-gray-500">来源：</span>{detail.source}</span>}
                  <span><span className="text-gray-500">创建人：</span>{detail.created_by_name}</span>
                  <span><span className="text-gray-500">受影响项目：</span>{detail.affected_projects.length} 个</span>
                </div>
                {detail.description && <p className="mt-2 text-sm text-gray-400">{detail.description}</p>}
                {(detail.old_value || detail.new_value) && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {detail.old_value && (
                      <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2.5">
                        <p className="text-[11px] text-red-400 font-medium mb-1">变更前</p>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap">{detail.old_value}</p>
                      </div>
                    )}
                    {detail.new_value && (
                      <div className="bg-green-500/5 border border-green-500/15 rounded-lg p-2.5">
                        <p className="text-[11px] text-green-400 font-medium mb-1">变更后</p>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap">{detail.new_value}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {canEdit && detail.status !== 'cancelled' && (
                <button onClick={handleAnalyze} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors shrink-0">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
                  影响分析
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 4阶段时间轴 */}
        <div>
          <SectionLabel>流程进度</SectionLabel>
          <div className="space-y-3 mt-2">
            {stages.map((stage, idx) => (
              <StageCard key={stage.id} stage={stage} isLast={idx === stages.length - 1}
                canEdit={canEdit} saving={saving}
                onAssign={() => { setShowAssign(stage); setAssignTo('') }}
                onStart={() => handleStart(stage)}
                onComplete={() => { setShowComplete(stage); setCompleteForm({ action_summary: '', feedback: '' }) }}
                onApprove={() => { setShowApprove(stage); setApproveForm({ approved: true, note: '' }) }}
              />
            ))}
          </div>
        </div>

        {/* 客户跟进任务 */}
        {detail.customer_tasks.length > 0 && (
          <div>
            <SectionLabel>客户跟进任务（{detail.customer_tasks.length}）</SectionLabel>
            <div className="mt-2 bg-bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['客户', '项目', '负责人', '状态', '联系方式', '截止日期', '操作'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.customer_tasks.map(task => (
                    <tr key={task.id} className="border-b border-border/50 hover:bg-bg-hover/30">
                      <td className="px-4 py-2.5 text-text-primary font-medium">{task.customer_name || `#${task.customer_id}`}</td>
                      <td className="px-4 py-2.5 text-gray-400">{task.project_name || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400">{task.assigned_to_name || <span className="text-gray-600">未指派</span>}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${TASK_STATUS_COLORS[task.status] || ''}`}>
                          {TASK_STATUS_LABELS[task.status] || task.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">{task.contact_method || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400">{fmtDate(task.customer_deadline)}</td>
                      <td className="px-4 py-2.5">
                        {canEdit && (
                          <button onClick={() => {
                            setShowEditTask(task)
                            setTaskForm({ status: task.status, contact_method: task.contact_method || '', customer_response: task.customer_response || '', notes: task.notes || '', customer_deadline: task.customer_deadline ? task.customer_deadline.slice(0, 10) : '' })
                          }} className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors">
                            更新
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── 指派执行人 ─── */}
        {showAssign && (
          <Modal title={`指派执行人：${showAssign.name}`} onClose={() => setShowAssign(null)} size="sm">
            <div className="py-2">
              <Field label="选择执行人" required>
                <SearchableSelect
                  options={[{ id: '', label: '请选择' }, ...users.map(u => ({ id: String(u.id), label: u.name || u.username }))]}
                  value={assignTo}
                  onChange={(v) => setAssignTo(v === 0 ? '' : String(v))}
                  clearValue=""
                />
              </Field>
            </div>
            <ModalFooter onClose={() => setShowAssign(null)} onSave={handleAssign} saving={saving} saveText="确认指派" saveDisabled={!assignTo} />
          </Modal>
        )}

        {/* ─── 完成阶段 ─── */}
        {showComplete && (
          <Modal title={`完成阶段：${showComplete.name}`} onClose={() => setShowComplete(null)} size="lg">
            <div className="space-y-4 py-1">
              <Field label="执行摘要" required>
                <textarea value={completeForm.action_summary} onChange={e => setCompleteForm({ ...completeForm, action_summary: e.target.value })}
                  rows={4} placeholder="描述本阶段完成的具体工作..."
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
              </Field>
              <Field label="阶段反馈（可选）">
                <textarea value={completeForm.feedback} onChange={e => setCompleteForm({ ...completeForm, feedback: e.target.value })}
                  rows={3} placeholder="外部回复、测试结果、注意事项等..."
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
              </Field>
              {showComplete.approval_required && (
                <p className="text-xs text-yellow-400 flex items-center gap-1">
                  <AlertTriangle size={12} /> 完成后需要审批方可进入下一阶段
                </p>
              )}
            </div>
            <ModalFooter onClose={() => setShowComplete(null)} onSave={handleComplete} saving={saving} saveText="提交完成" saveDisabled={!completeForm.action_summary.trim()} />
          </Modal>
        )}

        {/* ─── 审批 ─── */}
        {showApprove && (
          <Modal title={`审批：${showApprove.name}`} onClose={() => setShowApprove(null)}>
            <div className="space-y-4 py-2">
              {showApprove.action_summary && (
                <div className="bg-bg-hover/50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500 mb-1">执行摘要</p>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{showApprove.action_summary}</p>
                </div>
              )}
              {showApprove.feedback && (
                <div className="bg-bg-hover/50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500 mb-1">阶段反馈</p>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{showApprove.feedback}</p>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setApproveForm({ ...approveForm, approved: true })}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${approveForm.approved ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-border text-gray-400 hover:text-green-400'}`}>
                  <Check size={15} /> 审批通过
                </button>
                <button onClick={() => setApproveForm({ ...approveForm, approved: false })}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${!approveForm.approved ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-border text-gray-400 hover:text-red-400'}`}>
                  <XCircle size={15} /> 驳回
                </button>
              </div>
              <Field label="审批意见（可选）">
                <textarea value={approveForm.note} onChange={e => setApproveForm({ ...approveForm, note: e.target.value })}
                  rows={3} placeholder="填写审批意见..."
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
              </Field>
            </div>
            <ModalFooter
              onClose={() => setShowApprove(null)}
              onSave={handleApprove}
              saving={saving}
              tone={approveForm.approved ? 'green' : 'red'}
              saveText={approveForm.approved ? '确认通过' : '确认驳回'}
            />
          </Modal>
        )}

        {/* ─── 客户任务更新 ─── */}
        {showEditTask && (
          <Modal title={`跟进任务：${showEditTask.customer_name}`} onClose={() => setShowEditTask(null)} size="lg">
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-3">
                <Field label="跟进状态">
                  <SearchableSelect
                    options={Object.entries(TASK_STATUS_LABELS).map(([v, l]) => ({ id: v, label: l }))}
                    value={taskForm.status}
                    onChange={(v) => setTaskForm({ ...taskForm, status: v === 0 ? '' : String(v) })}
                    clearValue=""
                  />
                </Field>
                <Field label="联系方式">
                  <SearchableSelect
                    options={[
                      { id: '', label: '未选择' },
                      { id: 'email', label: '邮件' },
                      { id: 'phone', label: '电话' },
                      { id: 'meeting', label: '会议' },
                      { id: 'platform_msg', label: '平台消息' },
                    ]}
                    value={taskForm.contact_method}
                    onChange={(v) => setTaskForm({ ...taskForm, contact_method: v === 0 ? '' : String(v) })}
                    clearValue=""
                  />
                </Field>
              </div>
              <Field label="客户承诺完成日期">
                <input type="date" value={taskForm.customer_deadline} onChange={e => setTaskForm({ ...taskForm, customer_deadline: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary focus:outline-none" />
              </Field>
              <Field label="客户反馈">
                <textarea value={taskForm.customer_response} onChange={e => setTaskForm({ ...taskForm, customer_response: e.target.value })}
                  rows={3} placeholder="记录客户的原始反馈..."
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
              </Field>
              <Field label="跟进备注">
                <textarea value={taskForm.notes} onChange={e => setTaskForm({ ...taskForm, notes: e.target.value })}
                  rows={2} placeholder="额外备注信息..."
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
              </Field>
            </div>
            <ModalFooter onClose={() => setShowEditTask(null)} onSave={handleUpdateTask} saving={saving} saveText="保存" />
          </Modal>
        )}
      </div>
    )
  }

  /* ──────────────────── 列表视图 ──────────────────── */

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader
        icon={RefreshCw}
        title="模型变更管理"
        description="供应商模型变更全流程追踪与审批"
        tone="blue"
        right={
          canEdit ? (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent-blue text-white text-xs font-bold hover:bg-accent-blue/80 transition-colors">
              <Plus size={14} /> 新建变更事件
            </button>
          ) : undefined
        }
      />

      {/* 筛选条 */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索标题、供应商..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-bg-card border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none focus:border-accent-blue/50" />
        </div>
        <SearchableSelect
          options={[{ id: '', label: '全部状态' }, ...Object.entries(STATUS_LABELS).map(([v, l]) => ({ id: v, label: l }))]}
          value={filterStatus}
          onChange={(v) => setFilterStatus(v === 0 ? '' : String(v))}
          clearValue=""
        />
        <SearchableSelect
          options={[{ id: '', label: '全部风险' }, ...Object.entries(RISK_LABELS).map(([v, l]) => ({ id: v, label: l }))]}
          value={filterRisk}
          onChange={(v) => setFilterRisk(v === 0 ? '' : String(v))}
          clearValue=""
        />
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-accent-blue" /></div>
      ) : filteredEvents.length === 0 ? (
        <EmptyState icon={RefreshCw} title="暂无变更事件" description="点击「新建变更事件」开始记录供应商模型变更" tone="blue" />
      ) : (
        <div className="space-y-2">
          {filteredEvents.map(event => (
            <div key={event.id}
              className="relative w-full text-left bg-bg-card border border-border rounded-xl p-4 hover:border-accent-blue/30 hover:bg-bg-hover/30 transition-all group cursor-pointer"
              onClick={() => openDetail(event)}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-1 h-10 rounded-full shrink-0 ${event.risk_level === 'high' ? 'bg-red-500' : event.risk_level === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-text-primary text-sm">{event.title}</span>
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${STATUS_COLORS[event.status] || ''}`}>
                      {STATUS_LABELS[event.status] || event.status}
                    </span>
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${RISK_COLORS[event.risk_level] || ''}`}>
                      {RISK_LABELS[event.risk_level] || event.risk_level}
                    </span>
                    <span className="text-[11px] text-gray-500 bg-gray-500/10 px-1.5 py-0.5 rounded">
                      {CHANGE_TYPE_LABELS[event.change_type] || event.change_type}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1"><Building2 size={11} /> {event.supplier_name || `供应商#${event.supplier_id}`}</span>
                    {event.effective_date && <span className="flex items-center gap-1"><Calendar size={11} /> 生效 {fmtDate(event.effective_date)}</span>}
                    <span className="flex items-center gap-1"><Activity size={11} /> 影响 {event.affected_count} 个项目</span>
                    {event.current_stage_name && (
                      <span className="flex items-center gap-1 text-blue-400">
                        <Clock size={11} /> 阶段{event.current_stage_order}: {event.current_stage_name}
                      </span>
                    )}
                  </div>
                </div>
                {/* 进度条 */}
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  {[1, 2, 3, 4].map(n => {
                    const active = event.current_stage_order
                    const color = active === null
                      ? (event.status === 'completed' ? 'bg-green-500' : 'bg-gray-600')
                      : n < (active || 0) ? 'bg-green-500' : n === (active || 0) ? 'bg-blue-500' : 'bg-gray-600'
                    return <div key={n} className={`w-6 h-1.5 rounded-full ${color}`} />
                  })}
                </div>
                <ChevronRight size={14} className="text-gray-500 group-hover:text-accent-blue transition-colors shrink-0 mt-3" />
              </div>
              {canEdit && (
                <button
                  onClick={(e) => handleDelete(event.id, e)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
                  title="删除"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── 新建对话框 ─── */}
      {showCreate && (
        <Modal icon={Plus} title="新建模型变更事件" subtitle="填写基本信息后自动创建四个执行阶段" tone="blue" size="lg" onClose={() => setShowCreate(false)}>
          <div className="space-y-4 py-1">
            <Field label="变更标题" required>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="如：Claude claude-opus-4-5 正式 GA 升级"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none focus:border-accent-blue/60" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="供应商" required>
                <SearchableSelect
                  options={[{ id: '', label: '请选择' }, ...suppliers.map(s => ({ id: String(s.id), label: s.name }))]}
                  value={form.supplier_id}
                  onChange={(v) => setForm(f => ({ ...f, supplier_id: v === 0 ? '' : String(v) }))}
                  clearValue=""
                />
              </Field>
              <Field label="变更类型">
                <SearchableSelect
                  options={Object.entries(CHANGE_TYPE_LABELS).map(([v, l]) => ({ id: v, label: l }))}
                  value={form.change_type}
                  onChange={(v) => setForm(f => ({ ...f, change_type: v === 0 ? '' : String(v) }))}
                  clearValue=""
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="风险等级">
                <SearchableSelect
                  options={[
                    { id: 'low', label: '低风险' },
                    { id: 'medium', label: '中风险' },
                    { id: 'high', label: '高风险' },
                  ]}
                  value={form.risk_level}
                  onChange={(v) => setForm(f => ({ ...f, risk_level: v === 0 ? '' : String(v) }))}
                  clearValue=""
                />
              </Field>
              <Field label="上游生效日期">
                <input type="date" value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary focus:outline-none" />
              </Field>
            </div>
            <Field label="消息来源">
              <input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                placeholder="如：供应商邮件通知 / 官网公告"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none" />
            </Field>
            <Field label="变更描述">
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="变更背景与详情"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="变更前配置">
                <textarea value={form.old_value} onChange={e => setForm(f => ({ ...f, old_value: e.target.value }))}
                  rows={2} placeholder="旧模型/配置信息"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
              </Field>
              <Field label="变更后配置">
                <textarea value={form.new_value} onChange={e => setForm(f => ({ ...f, new_value: e.target.value }))}
                  rows={2} placeholder="新模型/配置信息"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-text-primary placeholder-gray-500 focus:outline-none resize-none" />
              </Field>
            </div>
          </div>
          <ModalFooter onClose={() => setShowCreate(false)} onSave={handleCreate} saving={saving} saveText="创建" saveDisabled={!form.title.trim() || !form.supplier_id} />
        </Modal>
      )}
    </div>
  )
}

/* ──── 阶段卡片 ──── */

interface StageCardProps {
  stage: Stage
  isLast: boolean
  canEdit: boolean
  saving: boolean
  onAssign: () => void
  onStart: () => void
  onComplete: () => void
  onApprove: () => void
}

function StageCard({ stage, isLast, canEdit, saving, onAssign, onStart, onComplete, onApprove }: StageCardProps) {
  const isCompleted = stage.status === 'completed'
  const isActive = stage.status === 'in_progress' || stage.status === 'awaiting_approval'

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 shrink-0 ${
          isCompleted ? 'bg-green-500/20 border-green-500 text-green-400' :
          isActive ? 'bg-blue-500/20 border-blue-500 text-blue-400' :
          'bg-gray-600/20 border-gray-600 text-gray-500'
        }`}>
          {isCompleted ? <CheckCircle2 size={14} /> : isActive ? <PlayCircle size={14} /> : <span className="text-xs font-bold">{stage.order}</span>}
        </div>
        {!isLast && <div className={`w-0.5 flex-1 my-1 ${isCompleted ? 'bg-green-500/30' : 'bg-border'}`} />}
      </div>

      <div className={`flex-1 mb-3 bg-bg-card border rounded-xl p-4 ${isActive ? 'border-blue-500/30' : 'border-border'}`}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-text-primary text-sm">{stage.name}</span>
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${STAGE_STATUS_COLORS[stage.status] || ''}`}>
                {STAGE_STATUS_LABELS[stage.status] || stage.status}
              </span>
              {stage.approval_required && (
                <span className="text-[11px] text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">需审批</span>
              )}
            </div>
            <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-400">
              {stage.assigned_to_name
                ? <span className="flex items-center gap-1"><User size={11} /> {stage.assigned_to_name}</span>
                : <span className="text-gray-600">未指派执行人</span>
              }
              {stage.started_at && <span className="flex items-center gap-1"><Clock size={11} /> 开始 {fmtDatetime(stage.started_at)}</span>}
              {stage.completed_at && <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-green-400" /> 完成 {fmtDatetime(stage.completed_at)}</span>}
              {stage.approved_at && <span className="flex items-center gap-1"><Check size={11} className="text-green-400" /> 审批 {fmtDatetime(stage.approved_at)} by {stage.approver_name}</span>}
            </div>
          </div>

          {canEdit && (
            <div className="flex gap-1.5 flex-wrap shrink-0">
              {stage.status !== 'completed' && (
                <button onClick={onAssign} disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-border text-gray-400 hover:text-text-primary hover:border-accent-blue/40 transition-colors">
                  <User size={11} /> 指派
                </button>
              )}
              {stage.status === 'pending' && (
                <button onClick={onStart} disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-colors">
                  <PlayCircle size={11} /> 开始
                </button>
              )}
              {stage.status === 'in_progress' && (
                <button onClick={onComplete} disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors">
                  <CheckCircle2 size={11} /> 完成
                </button>
              )}
              {stage.status === 'awaiting_approval' && (
                <button onClick={onApprove} disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-colors">
                  <MessageSquare size={11} /> 审批
                </button>
              )}
            </div>
          )}
        </div>

        {stage.action_summary && (
          <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
            <div>
              <p className="text-[11px] text-gray-500 mb-0.5">执行摘要</p>
              <p className="text-xs text-text-secondary whitespace-pre-wrap">{stage.action_summary}</p>
            </div>
            {stage.feedback && (
              <div>
                <p className="text-[11px] text-gray-500 mb-0.5">阶段反馈</p>
                <p className="text-xs text-text-secondary whitespace-pre-wrap">{stage.feedback}</p>
              </div>
            )}
            {stage.approval_note && (
              <div className={`rounded-lg px-2.5 py-1.5 ${stage.status === 'completed' ? 'bg-green-500/5 border border-green-500/15' : 'bg-red-500/5 border border-red-500/15'}`}>
                <p className="text-[11px] text-gray-500 mb-0.5">审批意见</p>
                <p className="text-xs text-text-secondary">{stage.approval_note}</p>
              </div>
            )}
            {stage.attachments.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <Paperclip size={11} className="text-gray-500" />
                {stage.attachments.map((a, i) => <span key={i} className="text-[11px] text-blue-400">{a}</span>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
