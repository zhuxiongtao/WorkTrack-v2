import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Sparkles, Loader2, LayoutDashboard, Brain, RefreshCw,
  ArrowRight, TrendingUp, Briefcase, Calendar, BookOpen, FileText, Users,
  GitBranch, AlertTriangle, Clock, CheckCircle2, Zap, ChevronRight,
  Building2, Cpu, Activity, type LucideIcon,
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { MarqueeBanner } from '../components/MarqueeBanner'

/* ──── 类型 ──── */

interface InsightData {
  items: string[]
  updatedAt: string | null
  sources: Record<string, string> | null
}

interface Overview {
  approvals: { pending_for_me: number; my_pending_submissions: number }
  contracts: { total: number; status: Record<string, number>; expiring_soon: number; total_active_amount: number }
  projects: { total: number; status: Record<string, number> }
  customers: { total: number; new_this_month: number }
  suppliers: { total: number; active: number }
  channels: { total: number; active: number }
  model_changes: Array<{
    id: number; title: string; risk_level: string; effective_date: string | null
    current_stage_name: string | null; current_stage_order: number | null; current_stage_status: string | null
  }>
  personal: { report_streak: number; meetings_this_month: number }
}

type PresetKey = 'week' | 'month' | 'quarter' | 'half_year' | 'year'

/* ──── 洞察缓存 ──── */

const STORAGE_PREFIX = 'wt_insights_'

function loadCachedInsights(): Record<string, InsightData> {
  const out: Record<string, InsightData> = {}
  for (const key of ['week', 'month', 'quarter']) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key)
      if (raw) out[key] = JSON.parse(raw)
    } catch { /* noop */ }
  }
  return out
}

function isCachedToday(insight: InsightData): boolean {
  if (!insight?.updatedAt) return false
  return insight.updatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)
}

/* ──── 小工具 ──── */

function fmtAmount(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return n.toFixed(0)
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/* ──── 风险色 ──── */
const RISK_COLOR: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-amber-400',
  high: 'text-red-400',
}
const RISK_DOT: Record<string, string> = {
  low: 'bg-green-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
}

/* ──── 合同状态配色 ──── */
const CONTRACT_STATUS_STYLE: Record<string, { bar: string; text: string; bg: string }> = {
  '草稿':   { bar: 'bg-gray-500',   text: 'text-gray-400',   bg: 'bg-gray-500/10' },
  '审批中': { bar: 'bg-amber-500',  text: 'text-amber-400',  bg: 'bg-amber-500/10' },
  '生效中': { bar: 'bg-green-500',  text: 'text-green-400',  bg: 'bg-green-500/10' },
  '已驳回': { bar: 'bg-red-500',    text: 'text-red-400',    bg: 'bg-red-500/10' },
  '已终止': { bar: 'bg-gray-600',   text: 'text-gray-500',   bg: 'bg-gray-600/10' },
}

/* ──── 项目状态 ──── */
const PROJECT_STATUS_STYLE: Record<string, { color: string }> = {
  '待立项': { color: '#6B7280' },
  '进行中': { color: '#3B82F6' },
  '已暂停': { color: '#F59E0B' },
  '已完成': { color: '#10B981' },
  '已驳回': { color: '#EF4444' },
}

/* ══════════════════════════════ 主页面 ══════════════════════════════ */

export default function DashboardPage() {
  const { toast: showToast } = useToast()
  const { user, fetchWithAuth } = useAuth()
  const navigate = useNavigate()

  const [preset, setPreset] = useState<PresetKey>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  const [insights, setInsights] = useState<Record<string, InsightData>>(() => loadCachedInsights())
  const [insightLoading, setInsightLoading] = useState<Record<string, boolean>>({ week: false, month: false, quarter: false })
  const [aiTab, setAiTab] = useState('month')
  const initialAutoRefreshDone = useRef(false)
  const startDateRef = useRef<HTMLInputElement>(null)
  const endDateRef = useRef<HTMLInputElement>(null)

  /* ── 数据加载 ── */

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth('/api/v1/dashboard/overview')
      if (res.ok) setOverview(await res.json())
    } catch { showToast('数据加载失败', 'error') }
    finally { setLoading(false) }
  }, [fetchWithAuth, showToast])

  useEffect(() => { loadOverview() }, [loadOverview])

  /* ── AI 洞察 ── */

  const loadInsights = useCallback(async (period: string) => {
    setInsightLoading(prev => ({ ...prev, [period]: true }))
    try {
      const res = await fetchWithAuth(`/api/v1/dashboard/ai-insights?period=${period}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const entry: InsightData = { items: data.insights || [], updatedAt: data.updated_at || null, sources: data.sources || null }
        setInsights(prev => ({ ...prev, [period]: entry }))
        try { localStorage.setItem(STORAGE_PREFIX + period, JSON.stringify(entry)) } catch { /* noop */ }
      }
    } catch { showToast('AI 洞察生成失败', 'error') }
    finally { setInsightLoading(prev => ({ ...prev, [period]: false })) }
  }, [fetchWithAuth, showToast])

  useEffect(() => {
    if (!overview || initialAutoRefreshDone.current) return
    initialAutoRefreshDone.current = true
    const today = new Date().getDay()
    if (today === 0 && !isCachedToday(insights['week'])) loadInsights('week')
  }, [overview])

  const formatUpdatedAt = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  /* ── 日期范围文本 ── */

  const queryParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('preset', preset)
    if (customStart) p.set('start_date', customStart)
    if (customEnd) p.set('end_date', customEnd)
    return p.toString()
  }, [preset, customStart, customEnd])

  const dateRangeText = useMemo(() => {
    if (customStart && customEnd) return `${customStart} — ${customEnd}`
    const now = new Date()
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
    let start: Date
    switch (preset) {
      case 'week': { const dow = now.getDay() || 7; start = new Date(y, m, d - (dow - 1)); break }
      case 'month': start = new Date(y, m, 1); break
      case 'quarter': start = new Date(y, Math.floor(m / 3) * 3, 1); break
      case 'half_year': start = new Date(y, m - 6, d); break
      default: start = new Date(y - 1, m, d)
    }
    const fmt = (dt: Date) => dt.getFullYear() !== y
      ? `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`
      : `${dt.getMonth() + 1}/${dt.getDate()}`
    return `${fmt(start)} — ${fmt(now)}`
  }, [preset, customStart, customEnd])

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 9) return '早上好'
    if (h < 12) return '上午好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    return '晚上好'
  }

  const getSubGreeting = (): { text: string; accent: boolean } => {
    const pending = overview?.approvals?.pending_for_me ?? 0
    const expiring = overview?.contracts?.expiring_soon ?? 0
    const streak = overview?.personal?.report_streak ?? 0

    if (pending > 0 && expiring > 0)
      return { text: `${pending} 条审批待处理，另有 ${expiring} 份合同即将到期，请注意跟进`, accent: true }
    if (pending > 0)
      return { text: `有 ${pending} 条审批事项在等你，记得及时处理`, accent: true }
    if (expiring > 0)
      return { text: `${expiring} 份合同即将到期，留意续签时间`, accent: true }

    const dow = new Date().getDay()
    const dayLines: Record<number, string> = {
      1: '新的一周开始了，把本周最重要的事列出来',
      2: '周二，保持节奏，一件一件做扎实',
      3: '周中关键节点，看看本周目标完成得如何',
      4: '再坚持一天，周五就在前面了',
      5: `周五了，收好今天的工作，轻松进入周末${streak > 1 ? `，日报已连续打卡 ${streak} 天` : ''}`,
      6: '周末也在，辛苦了，注意休息',
      0: '周日，养精蓄锐，明天又是新的开始',
    }
    return { text: dayLines[dow] ?? '今天也加油！', accent: false }
  }

  const INSIGHT_PERIODS = [
    { key: 'week',    label: '周度', icon: Brain,     color: '#8B5CF6' },
    { key: 'month',   label: '月度', icon: TrendingUp, color: '#3B82F6' },
    { key: 'quarter', label: '季度', icon: Briefcase,  color: '#10B981' },
  ] as const

  const presets: { key: PresetKey; label: string }[] = [
    { key: 'week', label: '本周' }, { key: 'month', label: '本月' },
    { key: 'quarter', label: '本季度' }, { key: 'half_year', label: '半年' }, { key: 'year', label: '一年' },
  ]

  /* ════════════════════════ 渲染 ════════════════════════ */

  return (
    <div className="mx-auto space-y-4">

      {/* ── 头部：问候 + MarqueeBanner ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-pink-500/10 border border-border/50 p-3 md:p-4">
        <div className="absolute top-0 right-0 w-48 h-48 -translate-y-12 translate-x-12 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-40 h-40 translate-y-8 -translate-x-8 bg-purple-500/5 rounded-full blur-3xl" />
        <div className="relative flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
          <div className="flex flex-col shrink-0 min-w-0 flex-1">
            <div className="flex-1 flex items-center px-1">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles size={15} className="text-amber-500 shrink-0" />
                  <h2 className="text-lg font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {getGreeting()}，{user?.name || user?.username}
                  </h2>
                  <span className="text-[11px] text-gray-500">· {dateRangeText}</span>
                </div>
                {(() => {
                  const sub = getSubGreeting()
                  return (
                    <p className={`text-xs mt-0.5 pl-[23px] ${sub.accent ? 'text-amber-400 dark:text-amber-400' : 'text-gray-500 dark:text-gray-500'}`}>
                      {sub.accent && <span className="mr-1">⚠</span>}{sub.text}
                    </p>
                  )
                })()}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <div className="flex flex-wrap items-center gap-0.5 bg-gray-100 dark:bg-white/5 rounded-lg border border-gray-300 dark:border-border/40 p-0.5">
                {presets.map(p => (
                  <button key={p.key} onClick={() => { setPreset(p.key); setCustomStart(''); setCustomEnd('') }}
                    className={`px-2.5 py-0.5 text-[11px] rounded-md transition-all ${preset === p.key && !customStart ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-600 hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-300'}`}>
                    {p.label}
                  </button>
                ))}
                <div className="w-px h-3.5 bg-gray-300 dark:bg-border/50 mx-0.5" />
                <input ref={startDateRef} type="date" value={customStart}
                  onChange={e => { setCustomStart(e.target.value); if (e.target.value) setPreset('week') }}
                  className="sr-only" />
                <button onClick={() => startDateRef.current?.showPicker()}
                  className="text-[11px] text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 px-1 transition-colors">
                  {customStart || '开始'}
                </button>
                <span className="text-gray-400 text-[11px]">—</span>
                <input ref={endDateRef} type="date" value={customEnd}
                  onChange={e => { setCustomEnd(e.target.value); if (e.target.value) setPreset('week') }}
                  className="sr-only" />
                <button onClick={() => endDateRef.current?.showPicker()}
                  className="text-[11px] text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 px-1 transition-colors">
                  {customEnd || '结束'}
                </button>
              </div>
            </div>
          </div>
          <MarqueeBanner fetchWithAuth={fetchWithAuth} />
        </div>
      </div>

      {/* ── 加载态 ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-500">
          <Loader2 size={24} className="animate-spin mr-2" />加载数据中…
        </div>
      ) : !overview ? (
        <div className="text-center py-20">
          <LayoutDashboard size={40} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-500 text-sm mb-2">数据加载失败</p>
          <button onClick={loadOverview} className="text-sm text-blue-400 hover:underline">点击重试</button>
        </div>
      ) : (
        <>
          {/* ══ 行动区 ══ */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ActionAlertCard
              icon={GitBranch}
              label="待我审批"
              count={overview.approvals.pending_for_me}
              emptyText="暂无待审批"
              tone="amber"
              onClick={() => navigate('/approvals')}
            />
            <ActionAlertCard
              icon={Clock}
              label="我发起的审批进行中"
              count={overview.approvals.my_pending_submissions}
              emptyText="无进行中申请"
              tone="blue"
              onClick={() => navigate('/approvals')}
            />
            <ActionAlertCard
              icon={AlertTriangle}
              label="合同即将到期（30天内）"
              count={overview.contracts.expiring_soon}
              emptyText="无即将到期合同"
              tone="red"
              onClick={() => navigate('/contracts')}
            />
          </div>

          {/* ══ 业务总览 ══ */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            <BizCard
              icon={FileText} label="合同" tone="indigo"
              main={`${overview.contracts.status['生效中'] ?? 0}`} mainSub="生效中"
              sub={`共 ${overview.contracts.total} 份${overview.contracts.total_active_amount > 0 ? ' · 在效 ¥' + overview.contracts.total_active_amount.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' 万' : ''}`}
              onClick={() => navigate('/contracts')}
            />
            <BizCard
              icon={Briefcase} label="项目" tone="blue"
              main={`${overview.projects.status['进行中'] ?? 0}`} mainSub="进行中"
              sub={`共 ${overview.projects.total} 个`}
              onClick={() => navigate('/projects')}
            />
            <BizCard
              icon={Users} label="客户" tone="green"
              main={`${overview.customers.total}`} mainSub="总客户"
              sub={`本月新增 +${overview.customers.new_this_month}`}
              onClick={() => navigate('/customers')}
            />
            <BizCard
              icon={Building2} label="供应商" tone="purple"
              main={`${overview.suppliers.active}`} mainSub="合作中"
              sub={`共 ${overview.suppliers.total} 家`}
              onClick={() => navigate('/suppliers')}
            />
            <BizCard
              icon={Cpu} label="通道" tone="cyan"
              main={`${overview.channels.active}`} mainSub="合作中"
              sub={`共 ${overview.channels.total} 条`}
              onClick={() => navigate('/channels')}
            />
          </div>

          {/* ══ 主内容网格 ══ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* 左：合同状态 + 模型变更 */}
            <div className="lg:col-span-2 space-y-4">

              {/* 合同状态分布 */}
              <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center">
                      <FileText size={14} className="text-indigo-400" />
                    </div>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>合同状态分布</span>
                  </div>
                  <button onClick={() => navigate('/contracts')}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-200 transition-colors">
                    查看全部 <ChevronRight size={12} />
                  </button>
                </div>
                {overview.contracts.total === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-4">暂无合同数据</p>
                ) : (
                  <>
                    {/* 进度条 */}
                    <div className="flex h-2 rounded-full overflow-hidden mb-4 gap-0.5">
                      {Object.entries(overview.contracts.status).map(([status, count]) => {
                        const style = CONTRACT_STATUS_STYLE[status] || { bar: 'bg-gray-500', text: 'text-gray-400', bg: 'bg-gray-500/10' }
                        const pct = (count / overview.contracts.total) * 100
                        return <div key={status} className={`${style.bar} rounded-full`} style={{ width: `${pct}%` }} title={`${status}: ${count}`} />
                      })}
                    </div>
                    {/* 图例 */}
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {Object.entries(overview.contracts.status).map(([status, count]) => {
                        const style = CONTRACT_STATUS_STYLE[status] || { bar: 'bg-gray-500', text: 'text-gray-400', bg: 'bg-gray-500/10' }
                        return (
                          <div key={status} className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${style.bar}`} />
                            <span className={`text-[11px] font-medium ${style.text}`}>{status}</span>
                            <span className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                            <span className="text-[11px] text-gray-600">({Math.round(count / overview.contracts.total * 100)}%)</span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* 进行中的模型变更 */}
              <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
                      <Activity size={14} className="text-amber-400" />
                    </div>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>进行中的模型变更</span>
                    {overview.model_changes.length > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold">
                        {overview.model_changes.length}
                      </span>
                    )}
                  </div>
                  <button onClick={() => navigate('/model-changes')}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-200 transition-colors">
                    查看全部 <ChevronRight size={12} />
                  </button>
                </div>
                {overview.model_changes.length === 0 ? (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <CheckCircle2 size={16} className="text-green-500" />
                    <span className="text-xs text-gray-500">当前没有进行中的模型变更事件</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {overview.model_changes.map(ev => (
                      <button key={ev.id} onClick={() => navigate('/model-changes')}
                        className="w-full flex items-center gap-3 p-3 rounded-xl bg-bg-hover/30 hover:bg-bg-hover/60 border border-border/30 hover:border-border/60 transition-all text-left">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${RISK_DOT[ev.risk_level] || 'bg-gray-500'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{ev.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {ev.current_stage_name && (
                              <span className="text-[11px] text-blue-400">
                                阶段 {ev.current_stage_order}：{ev.current_stage_name}
                                {ev.current_stage_status === 'awaiting_approval' && <span className="ml-1 text-amber-400">（待审批）</span>}
                              </span>
                            )}
                            {ev.effective_date && (
                              <span className="text-[11px] text-gray-500">生效 {fmtDate(ev.effective_date)}</span>
                            )}
                          </div>
                        </div>
                        <span className={`text-[11px] font-medium shrink-0 ${RISK_COLOR[ev.risk_level]}`}>
                          {ev.risk_level === 'high' ? '高风险' : ev.risk_level === 'medium' ? '中风险' : '低风险'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 右：个人统计 + 项目状态 */}
            <div className="space-y-4">

              {/* 个人统计 */}
              <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
                    <Zap size={14} className="text-blue-400" />
                  </div>
                  <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>个人统计</span>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-bg-hover/30">
                    <div className="flex items-center gap-2">
                      <FileText size={13} className="text-amber-400" />
                      <span className="text-xs text-gray-400">日报连续打卡</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-amber-400">{overview.personal.report_streak}</span>
                      <span className="text-[11px] text-gray-500">天</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-bg-hover/30">
                    <div className="flex items-center gap-2">
                      <Calendar size={13} className="text-green-400" />
                      <span className="text-xs text-gray-400">本月会议</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-green-400">{overview.personal.meetings_this_month}</span>
                      <span className="text-[11px] text-gray-500">次</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-bg-hover/30">
                    <div className="flex items-center gap-2">
                      <Users size={13} className="text-purple-400" />
                      <span className="text-xs text-gray-400">本月新增客户</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-purple-400">{overview.customers.new_this_month}</span>
                      <span className="text-[11px] text-gray-500">家</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 项目状态 */}
              <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <Briefcase size={14} className="text-blue-400" />
                    </div>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>项目状态</span>
                  </div>
                  <button onClick={() => navigate('/projects')}
                    className="text-[11px] text-gray-500 hover:text-gray-200 transition-colors flex items-center gap-1">
                    查看 <ChevronRight size={12} />
                  </button>
                </div>
                {overview.projects.total === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-3">暂无项目数据</p>
                ) : (
                  <div className="space-y-2.5">
                    {Object.entries(overview.projects.status).sort((a, b) => b[1] - a[1]).map(([status, count]) => {
                      const pct = Math.round(count / overview.projects.total * 100)
                      const color = PROJECT_STATUS_STYLE[status]?.color || '#6B7280'
                      return (
                        <div key={status}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-gray-400">{status}</span>
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{count} <span className="text-[11px] text-gray-600 font-normal">({pct}%)</span></span>
                          </div>
                          <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ══ AI 智能洞察 ══ */}
          <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg blur-md opacity-60 animate-pulse" />
                  <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <Brain size={15} className="text-white" strokeWidth={2.5} />
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                    AI 智能洞察
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white">AI</span>
                  </h4>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {insights[aiTab]?.updatedAt
                      ? `更新于 ${formatUpdatedAt(insights[aiTab]!.updatedAt!)}`
                      : '基于项目/客户/会议/日报数据自动生成'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 bg-bg-hover/50 rounded-lg p-0.5 ring-1 ring-white/5">
                {INSIGHT_PERIODS.map(({ key, label, color }) => (
                  <button key={key} onClick={() => setAiTab(key)}
                    className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-all ${aiTab === key ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
                    style={aiTab === key ? { background: `${color}25`, color } : {}}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const period = INSIGHT_PERIODS.find(p => p.key === aiTab)!
              const { key, label, color } = period
              const data = insights[key]
              const isLoading = insightLoading[key]
              return isLoading ? (
                <div className="space-y-3 py-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-xl bg-bg-hover animate-pulse" style={{ animationDelay: `${i * 0.1}s` }} />)}
                </div>
              ) : !data?.items.length ? (
                <div className="relative overflow-hidden py-8 px-4 text-center rounded-2xl border border-dashed border-purple-500/20 bg-gradient-to-br from-purple-500/[0.03] via-transparent to-pink-500/[0.03]">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/15 to-pink-500/15 border border-purple-500/20 flex items-center justify-center mx-auto mb-3">
                    <Brain size={20} className="text-purple-400" strokeWidth={1.8} />
                  </div>
                  <p className="text-sm font-bold text-gray-300 mb-1">暂无{label}洞察</p>
                  <p className="text-[11px] text-gray-500 mb-3">让 AI 深度分析当前周期的工作数据</p>
                  <button onClick={() => loadInsights(key)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold hover:shadow-lg hover:shadow-purple-500/30 transition-all">
                    <Sparkles size={12} strokeWidth={2.5} />生成{label}洞察
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {data.items.map((line, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border/30 hover:border-purple-500/30 bg-gradient-to-r from-white/[0.02] to-transparent hover:from-purple-500/5 transition-all">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                        style={{ background: `${color}25`, color }}>
                        {i + 1}
                      </span>
                      <p className="text-xs text-gray-300 leading-relaxed">{line}</p>
                    </div>
                  ))}
                  <div className="flex justify-end pt-1 md:col-span-3">
                    <button onClick={() => loadInsights(key)} disabled={isLoading}
                      className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-white transition-colors">
                      <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />重新生成
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </>
      )}
    </div>
  )
}

/* ══════════════════════════════ 子组件 ══════════════════════════════ */

const TONE_STYLES = {
  amber:  { icon: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500/30',  badge: 'bg-amber-500/15 text-amber-400',  glow: 'hover:border-amber-500/40' },
  blue:   { icon: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/20',   badge: 'bg-blue-500/15 text-blue-400',   glow: 'hover:border-blue-500/40' },
  red:    { icon: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/20',    badge: 'bg-red-500/15 text-red-400',    glow: 'hover:border-red-500/40' },
  green:  { icon: 'bg-green-500/15',  text: 'text-green-400',  border: 'border-green-500/20',  badge: 'bg-green-500/15 text-green-400',  glow: 'hover:border-green-500/40' },
  purple: { icon: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/20', badge: 'bg-purple-500/15 text-purple-400', glow: 'hover:border-purple-500/40' },
  indigo: { icon: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-indigo-500/20', badge: 'bg-indigo-500/15 text-indigo-400', glow: 'hover:border-indigo-500/40' },
  cyan:   { icon: 'bg-cyan-500/15',   text: 'text-cyan-400',   border: 'border-cyan-500/20',   badge: 'bg-cyan-500/15 text-cyan-400',   glow: 'hover:border-cyan-500/40' },
}

function ActionAlertCard({
  icon: Icon, label, count, emptyText, tone, onClick,
}: {
  icon: LucideIcon; label: string; count: number; emptyText: string
  tone: keyof typeof TONE_STYLES; onClick: () => void
}) {
  const s = TONE_STYLES[tone]
  const hasItems = count > 0
  return (
    <button onClick={onClick}
      className={`w-full text-left flex items-center gap-3 p-4 rounded-xl bg-bg-card border transition-all group ${hasItems ? `${s.border} ${s.glow}` : 'border-border/30 hover:border-border/60'}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${hasItems ? s.icon : 'bg-gray-500/10'}`}>
        <Icon size={16} className={hasItems ? s.text : 'text-gray-500'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-400 leading-tight">{label}</p>
        {hasItems ? (
          <p className={`text-lg font-bold leading-tight ${s.text}`}>{count} <span className="text-xs font-normal text-gray-500">条</span></p>
        ) : (
          <p className="text-xs text-gray-600 leading-tight">{emptyText}</p>
        )}
      </div>
      {hasItems && (
        <ArrowRight size={14} className={`${s.text} opacity-0 group-hover:opacity-100 transition-opacity shrink-0`} />
      )}
    </button>
  )
}

function BizCard({
  icon: Icon, label, tone, main, mainSub, sub, onClick,
}: {
  icon: LucideIcon; label: string; tone: keyof typeof TONE_STYLES
  main: string; mainSub: string; sub: string; onClick: () => void
}) {
  const s = TONE_STYLES[tone]
  return (
    <button onClick={onClick}
      className="w-full text-left p-4 rounded-xl bg-bg-card border border-border/50 hover:border-border/80 transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${s.icon}`}>
          <Icon size={14} className={s.text} />
        </div>
        <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className={`text-2xl font-bold ${s.text}`}>{main}</span>
        <span className="text-[11px] text-gray-500">{mainSub}</span>
      </div>
      <p className="text-[11px] text-gray-600 truncate">{sub}</p>
    </button>
  )
}
