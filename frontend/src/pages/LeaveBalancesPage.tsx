import { useState, useEffect, useCallback } from 'react'
import {
  Database, Loader2, Plus, X, SlidersHorizontal, History, CalendarClock, AlertTriangle, Check,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import SearchableSelect from '../components/SearchableSelect'

interface LeaveBalanceItem {
  id: number
  user_id: number
  user_name: string
  leave_type: string
  year: number
  total_hours: number
  used_hours: number
  remaining_hours: number
}

interface LeaveBalanceLogItem {
  id: number
  user_id: number
  user_name: string
  leave_type: string
  year: number
  change_type: string  // adjust | grant | leave_used | leave_cancelled
  change_hours: number
  reason: string
  operator_id: number | null
  operator_name: string
  related_request_id: number | null
  created_at: string
}

interface SimpleUser {
  id: number
  name: string
  username: string
  department?: string
}

interface AnnualPreviewRow {
  user_id: number
  user_name: string
  first_work_date: string | null
  hire_date: string | null
  tenure_years: number
  statutory_days: number
  current_total_days: number
  current_used_days: number
  missing_first_work_date: boolean
  apply_days: number   // 前端可编辑的拟发放天数
}

const DEFAULT_LEAVE_TYPES = ['年假', '事假', '病假', '调休', '婚假', '产假', '陪产假', '丧假']

const CHANGE_TYPE_META: Record<string, { label: string; cls: string }> = {
  adjust:          { label: '管理员调整', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  grant:           { label: '授予',       cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  leave_used:      { label: '扣减',       cls: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  leave_cancelled: { label: '返还',       cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
}

const CURRENT_YEAR = new Date().getFullYear()

function fmtHours(n: number): string {
  if (n == null || isNaN(n)) return '—'
  return `${n.toFixed(2)}h`
}

function fmtChange(n: number): string {
  if (n == null || isNaN(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}h`
}

function fmtDateTime(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

function changeTypeBadge(type: string) {
  const m = CHANGE_TYPE_META[type] || { label: type, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

const emptyAdjustForm = {
  user_id: '',
  leave_type: '年假',
  year: CURRENT_YEAR,
  change_hours: '',
  reason: '',
}

export default function LeaveBalancesPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast } = useToast()
  const canManage = hasPermission('leave:manage')

  const [tab, setTab] = useState<'balances' | 'logs'>('balances')

  // 用户列表 & 假期类型
  const [users, setUsers] = useState<SimpleUser[]>([])
  const [leaveTypes, setLeaveTypes] = useState<string[]>(DEFAULT_LEAVE_TYPES)

  // 额度列表
  const [balances, setBalances] = useState<LeaveBalanceItem[]>([])
  const [balancesLoading, setBalancesLoading] = useState(true)
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR)
  const [filterLeaveType, setFilterLeaveType] = useState('')
  const [filterUserId, setFilterUserId] = useState('')

  // 变动日志
  const [logs, setLogs] = useState<LeaveBalanceLogItem[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logFilterUserId, setLogFilterUserId] = useState('')
  const [logFilterLeaveType, setLogFilterLeaveType] = useState('')

  // 调整弹窗
  const [showAdjust, setShowAdjust] = useState(false)
  const [adjustForm, setAdjustForm] = useState({ ...emptyAdjustForm })
  const [saving, setSaving] = useState(false)

  // 按工龄批量发放年假
  const [showGenerate, setShowGenerate] = useState(false)
  const [genYear, setGenYear] = useState(CURRENT_YEAR)
  const [genRows, setGenRows] = useState<AnnualPreviewRow[]>([])
  const [genLoading, setGenLoading] = useState(false)
  const [genApplying, setGenApplying] = useState(false)

  // 加载用户列表
  useEffect(() => {
    fetch('/api/v1/users/simple')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setUsers(d) })
      .catch(() => {})
  }, [])

  // 加载假期类型
  useEffect(() => {
    fetch('/api/v1/leaves/types')
      .then(r => r.json())
      .then(d => {
        if (d.types && Array.isArray(d.types) && d.types.length > 0) setLeaveTypes(d.types)
      })
      .catch(() => {})
  }, [])

  // 加载额度列表
  const loadBalances = useCallback(async () => {
    if (!canManage) return
    setBalancesLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('year', String(filterYear))
      if (filterLeaveType) params.set('leave_type', filterLeaveType)
      if (filterUserId) params.set('user_id', filterUserId)
      const res = await fetch(`/api/v1/leave-balances?${params}`)
      if (res.ok) setBalances(await res.json())
    } catch { /* ignore */ }
    finally { setBalancesLoading(false) }
  }, [canManage, filterYear, filterLeaveType, filterUserId])

  // 加载变动日志
  const loadLogs = useCallback(async () => {
    if (!canManage) return
    setLogsLoading(true)
    try {
      const params = new URLSearchParams()
      if (logFilterUserId) params.set('user_id', logFilterUserId)
      if (logFilterLeaveType) params.set('leave_type', logFilterLeaveType)
      params.set('limit', '200')
      const res = await fetch(`/api/v1/leave-balances/logs?${params}`)
      if (res.ok) setLogs(await res.json())
    } catch { /* ignore */ }
    finally { setLogsLoading(false) }
  }, [canManage, logFilterUserId, logFilterLeaveType])

  useEffect(() => { if (canManage) loadBalances() }, [loadBalances])
  useEffect(() => { if (canManage && tab === 'logs') loadLogs() }, [loadLogs, tab, canManage])

  const openAdjust = (item?: LeaveBalanceItem) => {
    if (item) {
      setAdjustForm({
        user_id: String(item.user_id),
        leave_type: item.leave_type,
        year: item.year,
        change_hours: '',
        reason: '',
      })
    } else {
      setAdjustForm({ ...emptyAdjustForm })
    }
    setShowAdjust(true)
  }

  const submitAdjust = async () => {
    if (!adjustForm.user_id) { showToast('请选择员工', 'warning'); return }
    const hours = parseFloat(adjustForm.change_hours)
    if (isNaN(hours) || hours === 0) { showToast('请填写非零调整时长', 'warning'); return }
    if (!adjustForm.reason.trim()) { showToast('请填写调整原因', 'warning'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/v1/leave-balances/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(adjustForm.user_id),
          leave_type: adjustForm.leave_type,
          year: adjustForm.year,
          change_hours: hours,
          reason: adjustForm.reason.trim(),
        }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '调整失败') }
      showToast('额度已调整', 'success')
      setShowAdjust(false)
      loadBalances()
      if (tab === 'logs') loadLogs()
    } catch (e: any) { showToast(e.message || '调整失败', 'error') }
    finally { setSaving(false) }
  }

  // 打开「按工龄发放年假」并加载预览
  const openGenerate = async (year: number = CURRENT_YEAR) => {
    setGenYear(year)
    setShowGenerate(true)
    setGenLoading(true)
    setGenRows([])
    try {
      const res = await fetch('/api/v1/leave-balances/generate-annual/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      })
      if (!res.ok) throw new Error('预览失败')
      const data = await res.json()
      setGenRows((data.items || []).map((r: any) => ({ ...r, apply_days: r.statutory_days })))
    } catch (e: any) {
      showToast(e.message || '加载预览失败', 'error')
    } finally {
      setGenLoading(false)
    }
  }

  const submitGenerate = async () => {
    const items = genRows
      .filter(r => !r.missing_first_work_date)
      .map(r => ({ user_id: r.user_id, days: r.apply_days }))
    if (items.length === 0) { showToast('没有可发放的员工（请先补全参加工作日期）', 'warning'); return }
    setGenApplying(true)
    try {
      const res = await fetch('/api/v1/leave-balances/generate-annual/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: genYear, items }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '发放失败') }
      const data = await res.json()
      showToast(`已为 ${data.applied} 名员工发放 ${genYear} 年度年假`, 'success')
      setShowGenerate(false)
      setFilterYear(genYear)
      setFilterLeaveType('年假')
      loadBalances()
    } catch (e: any) {
      showToast(e.message || '发放失败', 'error')
    } finally {
      setGenApplying(false)
    }
  }

  // 下拉选项
  const userFilterOptions = [
    { id: '', label: '全部用户' },
    ...users.map(u => ({ id: String(u.id), label: u.name || u.username, sub: u.department })),
  ]
  const userSelectOptions = users.map(u => ({ id: String(u.id), label: u.name || u.username, sub: u.department }))
  const leaveTypeFilterOptions = [{ id: '', label: '全部类型' }, ...leaveTypes.map(t => ({ id: t, label: t }))]

  // 无权限
  if (!canManage) {
    return (
      <div>
        <PageHeader
          icon={Database}
          title="假期额度"
          description="管理员工假期额度，查看变动记录"
          tone="purple"
        />
        <EmptyState
          icon={Database}
          title="无访问权限"
          description="您没有假期额度管理权限（leave:manage），请联系管理员开通"
          tone="purple"
        />
      </div>
    )
  }

  const stats = [
    { label: '记录', value: balances.length },
    { label: '负余额', value: balances.filter(b => b.remaining_hours < 0).length },
  ]

  return (
    <div>
      <PageHeader
        icon={Database}
        title="假期额度"
        description="管理员工假期额度，查看变动记录"
        tone="purple"
        stats={stats}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => openGenerate(CURRENT_YEAR)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-sm font-medium hover:bg-emerald-500/10 transition-colors"
            >
              <CalendarClock size={16} /> 按工龄发放年假
            </button>
            <button
              onClick={() => openAdjust()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={16} /> 调整额度
            </button>
          </div>
        }
      />

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 bg-bg-hover/60 border border-border rounded-lg p-0.5 w-fit mb-5">
        {([
          { key: 'balances' as const, label: '额度列表', icon: SlidersHorizontal },
          { key: 'logs' as const, label: '变动日志', icon: History },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === t.key ? 'bg-bg-card text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* 额度列表 Tab */}
      {tab === 'balances' && (
        <div>
          {/* 筛选 */}
          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <div className="w-32">
              <Field label="年度">
                <input
                  type="number"
                  value={filterYear}
                  onChange={e => setFilterYear(parseInt(e.target.value) || CURRENT_YEAR)}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-indigo-500"
                />
              </Field>
            </div>
            <div className="w-44">
              <Field label="假期类型">
                <SearchableSelect
                  options={leaveTypeFilterOptions}
                  value={filterLeaveType}
                  onChange={(v) => setFilterLeaveType(v === 0 ? '' : String(v))}
                  clearValue=""
                />
              </Field>
            </div>
            <div className="w-52">
              <Field label="用户">
                <SearchableSelect
                  options={userFilterOptions}
                  value={filterUserId}
                  onChange={(v) => setFilterUserId(v === 0 ? '' : String(v))}
                  clearValue=""
                />
              </Field>
            </div>
          </div>

          {balancesLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
          ) : balances.length === 0 ? (
            <EmptyState icon={Database} title="暂无额度数据" description="当前筛选条件下没有额度记录，可点击右上角「调整额度」为员工初始化" tone="purple" />
          ) : (
            <div className="rounded-xl bg-bg-card border border-border/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">用户</th>
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">假期类型</th>
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">年度</th>
                      <th className="text-right text-[11px] text-gray-400 uppercase font-medium px-4 py-3">总额度</th>
                      <th className="text-right text-[11px] text-gray-400 uppercase font-medium px-4 py-3">已用</th>
                      <th className="text-right text-[11px] text-gray-400 uppercase font-medium px-4 py-3">剩余</th>
                      <th className="text-right text-[11px] text-gray-400 uppercase font-medium px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {balances.map(b => (
                      <tr key={b.id} className="hover:bg-bg-hover/40 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-200 font-medium whitespace-nowrap">{b.user_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">{b.leave_type}</td>
                        <td className="px-4 py-3 text-sm text-gray-400 tabular-nums">{b.year}</td>
                        <td className="px-4 py-3 text-sm text-gray-300 text-right tabular-nums">{fmtHours(b.total_hours)}</td>
                        <td className="px-4 py-3 text-sm text-gray-300 text-right tabular-nums">{fmtHours(b.used_hours)}</td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums font-medium ${b.remaining_hours < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                          {fmtHours(b.remaining_hours)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openAdjust(b)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover border border-border text-gray-300 text-[11px] font-medium hover:text-indigo-400 hover:border-indigo-500/50 transition-colors"
                          >
                            <SlidersHorizontal size={11} /> 调整
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 变动日志 Tab */}
      {tab === 'logs' && (
        <div>
          {/* 筛选 */}
          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <div className="w-52">
              <Field label="用户">
                <SearchableSelect
                  options={userFilterOptions}
                  value={logFilterUserId}
                  onChange={(v) => setLogFilterUserId(v === 0 ? '' : String(v))}
                  clearValue=""
                />
              </Field>
            </div>
            <div className="w-44">
              <Field label="假期类型">
                <SearchableSelect
                  options={leaveTypeFilterOptions}
                  value={logFilterLeaveType}
                  onChange={(v) => setLogFilterLeaveType(v === 0 ? '' : String(v))}
                  clearValue=""
                />
              </Field>
            </div>
          </div>

          {logsLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
          ) : logs.length === 0 ? (
            <EmptyState icon={History} title="暂无变动记录" description="还没有额度调整或请假扣减的记录" tone="purple" />
          ) : (
            <div className="rounded-xl bg-bg-card border border-border/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">时间</th>
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">用户</th>
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">假期类型</th>
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">变动类型</th>
                      <th className="text-right text-[11px] text-gray-400 uppercase font-medium px-4 py-3">变动时长</th>
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">原因</th>
                      <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">操作人</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {logs.map(l => (
                      <tr key={l.id} className="hover:bg-bg-hover/40 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap tabular-nums">{fmtDateTime(l.created_at)}</td>
                        <td className="px-4 py-3 text-sm text-gray-200 font-medium whitespace-nowrap">{l.user_name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">{l.leave_type}</td>
                        <td className="px-4 py-3">{changeTypeBadge(l.change_type)}</td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums font-medium whitespace-nowrap ${l.change_hours > 0 ? 'text-green-400' : l.change_hours < 0 ? 'text-red-400' : 'text-gray-300'}`}>
                          {fmtChange(l.change_hours)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 max-w-xs">{l.reason || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{l.operator_name || '系统'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 调整额度弹窗 */}
      {showAdjust && (
        <Modal
          icon={SlidersHorizontal}
          title="调整假期额度"
          subtitle="正数增加总额度，负数减少总额度"
          tone="purple"
          size="lg"
          onClose={() => setShowAdjust(false)}
        >
          <div className="space-y-4">
            <Field label="员工" required>
              <SearchableSelect
                options={userSelectOptions}
                value={adjustForm.user_id}
                onChange={(v) => setAdjustForm({ ...adjustForm, user_id: v === 0 ? '' : String(v) })}
                placeholder="选择员工"
                clearValue=""
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">假期类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {leaveTypes.map(t => (
                  <button
                    key={t}
                    onClick={() => setAdjustForm({ ...adjustForm, leave_type: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      adjustForm.leave_type === t
                        ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="年度" required>
                <input
                  type="number"
                  value={adjustForm.year}
                  onChange={e => setAdjustForm({ ...adjustForm, year: parseInt(e.target.value) || CURRENT_YEAR })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-indigo-500"
                />
              </Field>
              <Field label="调整时长（小时）" required hint="正数增加，负数减少">
                <input
                  type="number"
                  step="0.5"
                  value={adjustForm.change_hours}
                  onChange={e => setAdjustForm({ ...adjustForm, change_hours: e.target.value })}
                  placeholder="如 8 或 -4"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-indigo-500"
                />
              </Field>
            </div>

            <Field label="调整原因" required>
              <textarea
                value={adjustForm.reason}
                onChange={e => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                rows={3}
                placeholder="说明调整背景，如「年度初始授予」「补录历史额度」「调休返还」等"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-indigo-500 resize-none"
              />
            </Field>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAdjust(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-700 dark:text-gray-300 text-xs font-medium hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <X size={14} /> 取消
              </button>
              <button
                onClick={submitAdjust}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                确认调整
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 按工龄批量发放年假弹窗 */}
      {showGenerate && (
        <Modal
          icon={CalendarClock}
          title="按工龄发放年假"
          subtitle="依据《职工带薪年休假条例》，按参加工作日期核算累计工龄→年假天数，可逐人微调后确认"
          tone="purple"
          size="xl"
          onClose={() => setShowGenerate(false)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Field label="发放年度" required>
                <input
                  type="number"
                  value={genYear}
                  onChange={e => openGenerate(parseInt(e.target.value) || CURRENT_YEAR)}
                  className="w-32 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-indigo-500"
                />
              </Field>
              <div className="flex-1 text-[11px] text-gray-500 dark:text-gray-400 pt-5 leading-relaxed">
                档位：满 1 年不满 10 年 = 5 天；满 10 年不满 20 年 = 10 天；满 20 年 = 15 天。<br />
                发放将把每人年假「总额」设为下方天数（1 天 = 8 小时），已用部分保留。
              </div>
            </div>

            {genLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-gray-400" size={26} /></div>
            ) : genRows.length === 0 ? (
              <EmptyState icon={Database} title="暂无在职员工" description="没有可发放年假的在职员工" tone="purple" />
            ) : (
              <div className="rounded-xl bg-bg-card border border-border/50 overflow-hidden max-h-[48vh] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-bg-card z-10">
                    <tr className="border-b border-border">
                      <th className="text-left text-[11px] text-gray-600 dark:text-gray-400 uppercase font-medium px-3 py-2.5">员工</th>
                      <th className="text-left text-[11px] text-gray-600 dark:text-gray-400 uppercase font-medium px-3 py-2.5">参加工作</th>
                      <th className="text-right text-[11px] text-gray-600 dark:text-gray-400 uppercase font-medium px-3 py-2.5">工龄</th>
                      <th className="text-right text-[11px] text-gray-600 dark:text-gray-400 uppercase font-medium px-3 py-2.5">法定</th>
                      <th className="text-right text-[11px] text-gray-600 dark:text-gray-400 uppercase font-medium px-3 py-2.5">当前/已用</th>
                      <th className="text-right text-[11px] text-gray-600 dark:text-gray-400 uppercase font-medium px-3 py-2.5">拟发放(天)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {genRows.map((r, i) => (
                      <tr key={r.user_id} className={`transition-colors ${r.missing_first_work_date ? 'bg-amber-500/5' : 'hover:bg-bg-hover/40'}`}>
                        <td className="px-3 py-2 text-sm text-gray-800 dark:text-gray-200 font-medium whitespace-nowrap">{r.user_name}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {r.first_work_date
                            ? <span className="text-gray-600 dark:text-gray-400 tabular-nums">{r.first_work_date}</span>
                            : <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle size={11} /> 未录入</span>}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 text-right tabular-nums">{r.missing_first_work_date ? '—' : `${r.tenure_years}年`}</td>
                        <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 text-right tabular-nums">{r.missing_first_work_date ? '—' : `${r.statutory_days}天`}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-500 text-right tabular-nums whitespace-nowrap">{r.current_total_days}/{r.current_used_days}天</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={r.apply_days}
                            disabled={r.missing_first_work_date}
                            onChange={e => {
                              const v = parseFloat(e.target.value)
                              setGenRows(rows => rows.map((x, j) => j === i ? { ...x, apply_days: isNaN(v) ? 0 : v } : x))
                            }}
                            className="w-20 px-2 py-1 rounded-md bg-bg-input border border-border text-sm text-right outline-none focus:border-indigo-500 disabled:opacity-40 tabular-nums"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {genRows.some(r => r.missing_first_work_date) && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <span className="text-[11px] text-amber-700 dark:text-amber-300/90 leading-relaxed">
                  有 {genRows.filter(r => r.missing_first_work_date).length} 名员工未录入「参加工作日期」，将跳过。请到「用户管理」补全后再发放。
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowGenerate(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-700 dark:text-gray-300 text-xs font-medium hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <X size={14} /> 取消
              </button>
              <button
                onClick={submitGenerate}
                disabled={genApplying || genLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {genApplying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                确认发放 {genRows.filter(r => !r.missing_first_work_date).length} 人
              </button>
            </div>
          </div>
        </Modal>
      )}
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
