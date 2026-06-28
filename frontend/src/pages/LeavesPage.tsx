import { useState, useEffect, useCallback } from 'react'
import {
  CalendarDays, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X, Clock, CalendarCheck,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

interface LeaveItem {
  id: number
  user_id: number
  user_name: string | null
  leave_type: string
  title: string
  start_at: string
  end_at: string
  hours: number
  reason: string
  attachments: string | null
  status: string  // 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已销假
  actual_end_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

const DEFAULT_LEAVE_TYPES = ['年假', '事假', '病假', '调休', '婚假', '产假', '陪产假', '丧假']

// 需要额度管控的假期类型（年假/调休按余额，法定假期按 HR 核准额度）
const BALANCE_CONTROLLED_TYPES = ['年假', '调休', '婚假', '产假', '陪产假', '丧假']

// 法定天数映射（婚假/产假/陪产假/丧假；因地区差异取常见值，仅作前端提示，以 HR 核准为准）
const STATUTORY_DAYS: Record<string, number> = {
  '婚假': 3,
  '产假': 158,
  '陪产假': 15,
  '丧假': 3,
}

// 假期余额接口返回项
interface LeaveBalanceItem {
  leave_type: string
  total_hours: number
  used_hours: number
  remaining_hours: number
  year: number
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:   { label: '草稿',   cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  审批中: { label: '审批中', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' },
  已批准: { label: '已批准', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  已驳回: { label: '已驳回', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' },
  已撤回: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  已销假: { label: '已销假', cls: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20' },
}

function fmtDateTime(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

function fmtHours(n: number): string {
  if (n == null) return '—'
  return `${n} 小时`
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

// 当前本地时间 naive ISO 字符串
function nowLocalISO(): string {
  const d = new Date()
  const tzoffset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzoffset).toISOString().slice(0, 19)
}

// 根据起止时间计算小时数
function calcHours(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start)
  const e = new Date(end)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0
  const diff = (e.getTime() - s.getTime()) / (1000 * 60 * 60)
  return diff > 0 ? Math.round(diff * 100) / 100 : 0
}

const emptyForm = {
  leave_type: '年假',
  title: '',
  start_at: '',
  end_at: '',
  hours: '',
  reason: '',
  attachments: null as string | null,
}

export default function LeavesPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('leave:view_all')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<LeaveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [leaveTypes, setLeaveTypes] = useState<string[]>(DEFAULT_LEAVE_TYPES)
  const [balances, setBalances] = useState<LeaveBalanceItem[]>([])

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<LeaveItem | null>(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/leaves?scope=${scope}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope])

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/leaves/types')
      if (res.ok) {
        const data = await res.json()
        if (data.types && Array.isArray(data.types) && data.types.length > 0) {
          setLeaveTypes(data.types)
        }
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTypes() }, [loadTypes])

  // 加载当前用户假期余额（用于表单中选择类型后提示可休时间）
  const loadBalances = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leave-balances/my?year=${new Date().getFullYear()}`)
      if (res.ok) {
        const data = await res.json()
        setBalances(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadBalances() }, [loadBalances])

  // 根据请假类型返回可休时间提示
  const getLeaveHint = (type: string): { text: string; tone: 'info' | 'warn' | 'danger' } | null => {
    const bal = balances.find(b => b.leave_type === type)
    const HOURS_PER_DAY = 8

    // 事假、病假：无额度限制
    if (type === '事假' || type === '病假') {
      return { text: '无额度限制，按需申请（病假建议附医院证明）', tone: 'info' }
    }

    // 额度管控类型（年假/调休/婚假/产假/陪产假/丧假）：显示剩余天数（含审批中占用量）
    if (BALANCE_CONTROLLED_TYPES.includes(type)) {
      const statutory = STATUTORY_DAYS[type]
      if (!bal || bal.total_hours === 0) {
        const tip = statutory
          ? `法定 ${statutory} 天，需 HR 核准后发放额度`
          : `无可用${type}额度，请联系 HR 确认`
        return { text: tip, tone: statutory ? 'info' : 'danger' }
      }
      const year = new Date().getFullYear()
      const pendingHours = getPendingHours(type, year, editingId || undefined)
      const available = bal.remaining_hours - pendingHours
      const remainingDays = Math.round((bal.remaining_hours / HOURS_PER_DAY) * 10) / 10
      const usedDays = Math.round((bal.used_hours / HOURS_PER_DAY) * 10) / 10
      const totalDays = Math.round((bal.total_hours / HOURS_PER_DAY) * 10) / 10
      const availableDays = Math.round((available / HOURS_PER_DAY) * 10) / 10
      const pendingDays = Math.round((pendingHours / HOURS_PER_DAY) * 10) / 10
      // 若表单已填时长，检查是否超额
      const formHours = parseFloat(form.hours) || 0
      if (formHours > 0 && formHours > available) {
        const requestDays = Math.round((formHours / HOURS_PER_DAY) * 10) / 10
        if (pendingHours > 0) {
          return { text: `剩余 ${remainingDays} 天，其中 ${pendingDays} 天审批中，可用 ${availableDays} 天，本次申请 ${requestDays} 天将超额`, tone: 'danger' }
        }
        return { text: `剩余 ${remainingDays} 天，本次申请 ${requestDays} 天将超额`, tone: 'danger' }
      }
      let text = statutory
        ? `法定 ${statutory} 天，剩余 ${remainingDays} 天 / 总额 ${totalDays} 天（已用 ${usedDays} 天）`
        : `剩余 ${remainingDays} 天 / 总额 ${totalDays} 天（已用 ${usedDays} 天）`
      if (pendingHours > 0) text += `，审批中 ${pendingDays} 天，可用 ${availableDays} 天`
      return { text, tone: available > 0 ? 'info' : 'warn' }
    }

    return null
  }

  const openCreate = () => {
    setEditingId(null); setForm({ ...emptyForm }); setShowForm(true)
  }
  const openEdit = (p: LeaveItem) => {
    setEditingId(p.id)
    setForm({
      leave_type: p.leave_type,
      title: p.title,
      start_at: toDatetimeLocal(p.start_at),
      end_at: toDatetimeLocal(p.end_at),
      hours: String(p.hours ?? ''),
      reason: p.reason,
      attachments: p.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  // 起止时间变更时自动计算时长
  const onDateChange = (field: 'start_at' | 'end_at', value: string) => {
    const next = { ...form, [field]: value }
    const h = calcHours(next.start_at, next.end_at)
    if (h > 0) next.hours = String(h)
    setForm(next)
  }

  const save = async () => {
    if (!form.title.trim()) { showToast('请填写请假事由', 'warning'); return }
    if (!form.start_at || !form.end_at) { showToast('请选择起止时间', 'warning'); return }
    const hours = parseFloat(form.hours) || 0
    if (hours <= 0) { showToast('请假时长必须大于 0', 'warning'); return }
    // 额度校验：年假/调休超额时直接阻止保存并告知原因
    const balanceWarn = checkBalanceExceed(form.leave_type, hours, editingId || undefined)
    if (balanceWarn) {
      showToast(balanceWarn + '，无法保存', 'error')
      return
    }
    setSaving(true)
    try {
      const body = {
        leave_type: form.leave_type,
        title: form.title.trim(),
        start_at: toISO(form.start_at),
        end_at: toISO(form.end_at),
        hours,
        reason: form.reason.trim(),
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/leaves/${editingId}` : '/api/v1/leaves'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '请假申请已创建', 'success')
      setShowForm(false); load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  // 计算同类型、同年度、审批中的请假占用量（排除指定 id）
  const getPendingHours = (leaveType: string, year: number, excludeId?: number): number => {
    return list
      .filter(lv => lv.leave_type === leaveType && lv.status === '审批中' && lv.id !== excludeId)
      .filter(lv => new Date(lv.start_at).getFullYear() === year)
      .reduce((sum, lv) => sum + lv.hours, 0)
  }

  // 检查请假时长是否超过可用额度（所有额度管控类型，扣除审批中的占用量）
  const checkBalanceExceed = (leaveType: string, hours: number, excludeId?: number): string | null => {
    if (!BALANCE_CONTROLLED_TYPES.includes(leaveType)) return null
    const bal = balances.find(b => b.leave_type === leaveType)
    if (!bal || bal.total_hours === 0) {
      return `无可用${leaveType}额度，请联系 HR 确认`
    }
    const year = new Date().getFullYear()
    const pendingHours = getPendingHours(leaveType, year, excludeId)
    const available = bal.remaining_hours - pendingHours
    if (hours > available) {
      const HOURS_PER_DAY = 8
      const remainingDays = Math.round((bal.remaining_hours / HOURS_PER_DAY) * 10) / 10
      const availableDays = Math.round((available / HOURS_PER_DAY) * 10) / 10
      const requestDays = Math.round((hours / HOURS_PER_DAY) * 10) / 10
      if (pendingHours > 0) {
        const pendingDays = Math.round((pendingHours / HOURS_PER_DAY) * 10) / 10
        return `${leaveType}剩余 ${remainingDays} 天，其中 ${pendingDays} 天正在审批中，实际可用 ${availableDays} 天，本次申请 ${requestDays} 天，超出可用余额`
      }
      return `${leaveType}剩余 ${remainingDays} 天，本次申请 ${requestDays} 天，超出余额`
    }
    return null
  }

  const submitApproval = async (p: LeaveItem) => {
    // 提交前再次校验额度（年假/调休，排除自己已占用的）
    const balanceWarn = checkBalanceExceed(p.leave_type, p.hours, p.id)
    if (balanceWarn) {
      showToast(balanceWarn + '，无法提交审批', 'error')
      return
    }
    const ok = await showConfirm('提交后将进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/leaves/${p.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setActing(false) }
  }

  const revoke = async (p: LeaveItem) => {
    const ok = await showConfirm('撤回后请假申请回到草稿，可重新编辑。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/leaves/${p.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const cancelLeave = async (p: LeaveItem) => {
    const ok = await showConfirm('确认销假？将记录实际结束时间并结束本次请假。')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/leaves/${p.id}/cancel-leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual_end_at: nowLocalISO() }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '销假失败') }
      showToast('已销假', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '销假失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (p: LeaveItem) => {
    const ok = await showConfirm(`确认删除请假申请「${p.title}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/leaves/${p.id}`, { method: 'DELETE' })
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
        icon={CalendarDays}
        title="请假申请"
        description="年假、事假、病假等请假事项，提交后经审批人审核，批准后可销假登记实际结束时间"
        tone="purple"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all"
          >
            <Plus size={16} /> 新建请假
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
        <EmptyState icon={CalendarDays} title="暂无请假申请" description="点击右上角「新建请假」发起第一笔申请" tone="purple" />
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-400">{p.leave_type}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate flex items-center gap-1.5">
                    <Clock size={11} className="shrink-0" />
                    <span>{fmtDateTime(p.start_at)} — {fmtDateTime(p.end_at)}</span>
                    <span className="ml-1.5">· {fmtHours(p.hours)}</span>
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 申请人 {p.user_name}</span>}
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
          icon={CalendarDays}
          title={detail.title}
          subtitle={`${detail.leave_type} · ${fmtHours(detail.hours)}`}
          tone="purple"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">{statusBadge(detail.status)}</div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <Info label="请假类型" value={detail.leave_type} />
              <Info label="时长" value={fmtHours(detail.hours)} />
              <Info label="开始时间" value={fmtDateTime(detail.start_at)} />
              <Info label="结束时间" value={fmtDateTime(detail.end_at)} />
              <Info label="申请人" value={detail.user_name || '—'} />
              {detail.actual_end_at && <Info label="实际结束" value={fmtDateTime(detail.actual_end_at)} />}
              {detail.cancelled_at && <Info label="销假时间" value={fmtDateTime(detail.cancelled_at)} />}
              <Info label="创建时间" value={fmtDateTime(detail.created_at)} />
            </div>

            {detail.reason && (
              <div>
                <p className="text-xs text-gray-400 mb-1">请假事由</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.reason}</p>
              </div>
            )}

            {detail.attachments && JSON.parse(detail.attachments).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">证明附件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {/* 审批进度（提交后展示） */}
            {detail.status !== '草稿' && (
              <ApprovalTimeline targetType="leave" targetId={detail.id} onChanged={load} />
            )}

            {/* 操作区 */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {detail.status === '草稿' && (
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
                  onClick={() => cancelLeave(detail)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 transition-colors"
                >
                  {acting ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />} 销假
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
          title={editingId ? '编辑请假申请' : '新建请假申请'}
          subtitle="填写请假信息，保存为草稿后可提交审批"
          tone="purple"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">请假类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {leaveTypes.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, leave_type: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.leave_type === t
                        ? 'border-purple-500 text-purple-400 bg-purple-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {/* 可休时间提示 */}
              {(() => {
                const hint = getLeaveHint(form.leave_type)
                if (!hint) return null
                const toneCls = {
                  info: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20',
                  warn: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
                  danger: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20',
                }[hint.tone]
                return (
                  <div className={`mt-2 px-3 py-2 rounded-lg border text-[11px] ${toneCls}`}>
                    {hint.text}
                  </div>
                )
              })()}
            </div>

            <Field label="请假事由" required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                placeholder="如「家中有事需请假一天」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="开始时间" required>
                <input
                  type="datetime-local"
                  value={form.start_at}
                  onChange={e => onDateChange('start_at', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
                />
              </Field>
              <Field label="结束时间" required>
                <input
                  type="datetime-local"
                  value={form.end_at}
                  onChange={e => onDateChange('end_at', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
                />
              </Field>
            </div>

            <Field label="请假时长（小时）" hint="根据起止时间自动计算，可手动调整">
              <input
                type="number"
                step="0.5"
                value={form.hours}
                onChange={e => setForm({ ...form, hours: e.target.value })}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
              />
            </Field>

            <Field label="详细说明">
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="补充请假原因、工作交接安排等"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500 resize-none"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">证明附件（可选，病假条等可粘贴截图）</label>
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
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 w-[4em]">{label}</span>
      <span className="text-xs text-gray-700 dark:text-gray-200 break-words min-w-0 flex-1">{value}</span>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        {hint && <span className="ml-1.5 text-[11px] font-normal text-gray-500">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
