import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Briefcase, Calendar, Sparkles, Clock, BookOpen, FileText, Users, Loader2, LayoutDashboard, Target, CheckCircle2, Activity, Zap, TrendingUp, TrendingDown, Brain, ChevronUp, ArrowRight, RefreshCw } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'

interface DateRange {
  start: string
  end: string
}

interface Stats {
  range: DateRange
  projects: {
    total: number
    new_this_period: number
    status_distribution: { name: string; count: number }[]
    total_opp_cny: number
    total_opp_usd: number
    total_deal_cny: number
    total_deal_usd: number
    opp_this_period_cny: number
    opp_this_period_usd: number
    deal_this_period_cny: number
    deal_this_period_usd: number
  }
  customers: {
    total: number
    new_this_period: number
    industry_distribution: { name: string; count: number }[]
  }
  meetings: { total: number; this_period: number }
  reports: { total: number; this_period: number; streak_days: number }
  weekly_summaries: { total: number; this_period: number }
}

interface TimelineItem {
  type: 'project' | 'meeting' | 'customer' | 'report'
  title: string
  description: string
  time: string
  link_id: number
}

type PresetKey = 'week' | 'month' | 'quarter' | 'half_year' | 'year'

const TOP_BAR_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316', '#EC4899', '#14B8A6', '#6366F1']

function hashColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0 }
  return TOP_BAR_COLORS[Math.abs(hash) % TOP_BAR_COLORS.length]
}

function getRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

const typeIcon: Record<string, typeof Briefcase> = {
  project: Briefcase,
  meeting: Calendar,
  customer: Users,
  report: FileText,
}

const typeLink: Record<string, string> = {
  project: '/projects',
  meeting: '/meetings',
  customer: '/customers',
  report: '/reports',
}

function DonutChart({ data, totalLabel }: { data: { name: string; count: number }[]; totalLabel?: string }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return <p className="text-xs text-gray-600 text-center py-8">暂无数据</p>

  const size = 140
  const radius = 56
  const stroke = 14
  const cx = size / 2
  const cy = size / 2
  const circum = 2 * Math.PI * radius

  const slices = data.map((d, i) => {
    const dash = Math.max(1, (d.count / total) * circum)
    const off = -data.slice(0, i).reduce((s, x) => s + (x.count / total) * circum, 0)
    return { ...d, dash, offset: off }
  })

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--bg-hover, #1c1c1e)" strokeWidth={stroke} />
        {slices.map((s, i) => {
          const c = hashColor(s.name)
          return (
            <circle
              key={i}
              cx={cx} cy={cy} r={radius} fill="none"
              stroke={c} strokeWidth={stroke}
              strokeDasharray={`${s.dash} ${circum - s.dash}`}
              strokeDashoffset={s.offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
          )
        })}
        <text x={cx} y={cy - 3} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="bold">{total}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fill="#6b7280" fontSize="9">{totalLabel || '总计'}</text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3">
        {data.map((d) => (
          <span key={d.name} className="inline-flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="w-2 h-2 rounded-full" style={{ background: hashColor(d.name) }} />
            {d.name} ({d.count})
          </span>
        ))}
      </div>
    </div>
  )
}

function BarChart({ data }: { data: { name: string; count: number }[] }) {
  if (data.length === 0) return <p className="text-xs text-gray-600 text-center py-8">暂无数据</p>
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 w-16 truncate text-right flex-shrink-0">{d.name}</span>
          <div className="flex-1 h-4 bg-bg-hover rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${(d.count / max) * 100}%`, background: hashColor(d.name) }}
            />
          </div>
          <span className="text-[10px] text-gray-500 w-5 flex-shrink-0">{d.count}</span>
        </div>
      ))}
    </div>
  )
}

function MiniSparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  if (data.length === 0) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const width = 80
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} className="opacity-60">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function KpiCard({ icon: Icon, label, value, sub, trend, color, gradient, onClick, sparklineData }: {
  icon: typeof TrendingUp
  label: string
  value: number | string
  sub?: string
  trend?: number
  color: string
  gradient: string
  onClick?: () => void
  sparklineData?: number[]
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`group relative overflow-hidden flex flex-col text-left rounded-2xl bg-bg-card border border-border/80 p-5 hover:border-[#3B82F6]/50 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="absolute top-0 right-0 w-32 h-32 -translate-y-8 translate-x-8 opacity-10" style={{ background: gradient, borderRadius: '50%' }} />
      <div className="absolute -bottom-4 -left-4 w-20 h-20 opacity-5" style={{ background: gradient, borderRadius: '50%' }} />
      
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: `${color}15` }}>
          <Icon size={14} style={{ color }} />
          <span className="text-[11px] text-gray-400">{label}</span>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${trend > 0 ? 'bg-emerald-500/10 text-emerald-400' : trend < 0 ? 'bg-red-500/10 text-red-400' : 'bg-gray-500/10 text-gray-400'}`}>
            {trend > 0 ? <TrendingUp size={10} /> : trend < 0 ? <TrendingDown size={10} /> : null}
            {trend > 0 ? '+' : ''}{trend}%
          </div>
        )}
      </div>

      <span className="text-3xl font-bold text-white mb-1">{value}</span>
      
      {sub && (
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-[10px] text-gray-500">{sub}</span>
          {sparklineData && sparklineData.length > 0 && (
            <MiniSparkline data={sparklineData} color={color} height={24} />
          )}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 h-0.5 opacity-60" style={{ background: `linear-gradient(to right, ${color}, transparent)` }} />
    </button>
  )
}

function StatCard({ title, value, icon: Icon, color, description }: {
  title: string
  value: string | number
  icon: typeof Activity
  color: string
  description?: string
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors">
      <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}20` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-lg font-semibold text-white">{value}</div>
        <div className="text-[11px] text-gray-400">{title}</div>
      </div>
      {description && (
        <div className="text-[10px] text-gray-500">{description}</div>
      )}
    </div>
  )
}

type InsightData = { items: string[]; updatedAt: string | null; sources: Record<string, string> | null }

const STORAGE_PREFIX = 'wt_insights_'

function loadCachedInsights(): Record<string, InsightData> {
  try {
    const cached: Record<string, InsightData> = { week: { items: [], updatedAt: null, sources: null }, month: { items: [], updatedAt: null, sources: null }, quarter: { items: [], updatedAt: null, sources: null } };
    for (const period of ['week', 'month', 'quarter']) {
      const raw = localStorage.getItem(STORAGE_PREFIX + period);
      if (raw) { cached[period] = JSON.parse(raw); }
    }
    return cached;
  } catch (_e) {
    const fallback: InsightData = { items: [], updatedAt: null, sources: null };
    return { week: fallback, month: fallback, quarter: fallback };
  }
}

function isCachedToday(insight: InsightData): boolean {
  if (!insight.updatedAt) return false
  const cachedDate = insight.updatedAt.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return cachedDate === today
}

export default function DashboardPage() {
  const { toast: showToast } = useToast()
  const { user, fetchWithAuth } = useAuth()
  const [preset, setPreset] = useState<PresetKey>('quarter')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [insights, setInsights] = useState<Record<string, InsightData>>(() => loadCachedInsights())
  const [insightLoading, setInsightLoading] = useState<{[key: string]: boolean}>({ week: false, month: false, quarter: false })
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [aiTab, setAiTab] = useState<string>('quarter')
  const initialAutoRefreshDone = useRef(false)
  const startDateRef = useRef<HTMLInputElement>(null)
  const endDateRef = useRef<HTMLInputElement>(null)

  const queryParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('preset', preset)
    if (customStart) p.set('start_date', customStart)
    if (customEnd) p.set('end_date', customEnd)
    return p.toString()
  }, [preset, customStart, customEnd])

  const loadStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth(`/api/v1/dashboard/stats?${queryParams}`)
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      } else {
        showToast('数据加载失败，请检查网络或刷新页面', 'error')
      }
    } catch {
      showToast('数据请求异常', 'error')
    }
    finally { setLoading(false) }
  }, [queryParams, showToast])

  const loadTimeline = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/v1/dashboard/timeline?limit=20')
      if (res.ok) setTimeline(await res.json())
    } catch { /* noop */ }
  }, [])

  const isPeriodEnd = useCallback((period: string): boolean => {
    const today = new Date()
    if (period === 'week') return today.getDay() === 0
    if (period === 'month') {
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return today.getDate() === lastDay.getDate()
    }
    if (period === 'quarter') {
      const m = today.getMonth()
      const lastMonthOfQ = Math.floor(m / 3) * 3 + 2
      if (m !== lastMonthOfQ) return false
      const lastDay = new Date(today.getFullYear(), m + 1, 0)
      return today.getDate() === lastDay.getDate()
    }
    return false
  }, [])

  const loadInsights = useCallback(async (period: string) => {
    if (!stats) return
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
  }, [stats, showToast])

  useEffect(() => {
    loadStats()
    loadTimeline()
  }, [queryParams])

  useEffect(() => {
    if (!stats || initialAutoRefreshDone.current) return
    initialAutoRefreshDone.current = true
    ;(['week', 'month', 'quarter'] as const).forEach(period => {
      if (!isPeriodEnd(period)) return
      if (isCachedToday(insights[period])) return
      loadInsights(period)
    })
  }, [stats])

  const formatUpdatedAt = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const getGreeting = (): string => {
    const hour = new Date().getHours()
    if (hour < 6) return '夜深了，注意休息'
    if (hour < 9) return '早上好，新的一天开始了'
    if (hour < 12) return '上午好，高效工作从现在始'
    if (hour < 14) return '中午好，记得休息一下'
    if (hour < 18) return '下午好，保持专注'
    if (hour < 22) return '晚上好，今天辛苦了'
    return '夜深了，注意休息'
  }

  const formatDateRange = (): string => {
    if (!stats) return ''
    const start = new Date(stats.range.start)
    const end = new Date(stats.range.end)
    const startStr = `${start.getMonth() + 1}月${start.getDate()}日`
    const endStr = `${end.getMonth() + 1}月${end.getDate()}日`
    return `${startStr} - ${endStr}`
  }

  const INSIGHT_PERIODS = [
    { key: 'week', label: '周度洞察', icon: Brain, color: '#8B5CF6' },
    { key: 'month', label: '月度洞察', icon: TrendingUp, color: '#3B82F6' },
    { key: 'quarter', label: '季度洞察', icon: Briefcase, color: '#10B981' },
  ] as const

  const presets: { key: PresetKey; label: string }[] = [
    { key: 'week', label: '本周' },
    { key: 'month', label: '本月' },
    { key: 'quarter', label: '本季度' },
    { key: 'half_year', label: '半年' },
    { key: 'year', label: '一年' },
  ]

  const periodLabel = (presets.find(p => p.key === preset)?.label || '本周期').replace('度', '')

  return (
    <div className="mx-auto">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-pink-500/10 border border-border/50 p-6 mb-6">
        <div className="absolute top-0 right-0 w-64 h-64 -translate-y-16 translate-x-16 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 translate-y-12 -translate-x-12 bg-purple-500/5 rounded-full blur-3xl" />
        
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={18} className="text-amber-400" />
              <h2 className="text-xl font-bold text-white">{getGreeting()}</h2>
            </div>
            <p className="text-sm text-gray-400">
              {user?.name || user?.username} · {formatDateRange() || '选择时间范围查看数据'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {stats && (
              <div className="hidden lg:flex items-center gap-4 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                  <Zap size={12} className="text-amber-400" />
                  <span>连续写日报 <span className="text-white font-semibold">{stats.reports.streak_days}</span> 天</span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1 bg-white/5 backdrop-blur rounded-xl border border-border/40 p-1">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    preset === p.key ? 'bg-blue-400/20 dark:bg-blue-400/30 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <div className="w-px h-4 bg-border/50 mx-0.5" />
              <input
                ref={startDateRef}
                type="date"
                value={customStart}
                onChange={(e) => { setCustomStart(e.target.value); if (e.target.value) setPreset('week' as PresetKey) }}
                className="sr-only"
              />
              <button
                onClick={() => startDateRef.current?.showPicker()}
                className="text-[11px] text-gray-400 hover:text-[#3B82F6] transition-colors cursor-pointer bg-transparent outline-none"
              >
                {customStart || '开始'}
              </button>
              <span className="text-gray-500 text-[11px]">—</span>
              <input
                ref={endDateRef}
                type="date"
                value={customEnd}
                onChange={(e) => { setCustomEnd(e.target.value); if (e.target.value) setPreset('week' as PresetKey) }}
                className="sr-only"
              />
              <button
                onClick={() => endDateRef.current?.showPicker()}
                className="text-[11px] text-gray-400 hover:text-[#3B82F6] transition-colors cursor-pointer bg-transparent outline-none"
              >
                {customEnd || '结束'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500">
          <Loader2 size={28} className="mx-auto animate-spin mb-3" />
          <p>加载数据中...</p>
        </div>
      ) : !stats ? (
        <div className="text-center py-20">
          <LayoutDashboard size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-2">数据加载失败</p>
          <p className="text-xs text-gray-600 mb-4">请检查网络连接或确认已登录</p>
          <button onClick={() => { loadStats(); loadTimeline() }} className="text-sm text-[#3B82F6] hover:underline">
            点击重试
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard
              icon={Briefcase} 
              label="活跃项目" 
              value={stats.projects.total}
              sub={`本期新增 ${stats.projects.new_this_period}`}
              trend={stats.projects.new_this_period > 0 ? Math.round((stats.projects.new_this_period / Math.max(stats.projects.total - stats.projects.new_this_period, 1)) * 100) : 0}
              color="#3B82F6"
              gradient="radial-gradient(circle, #3B82F6 0%, transparent 70%)"
              onClick={() => window.open('/projects', '_blank')}
            />
            <KpiCard
              icon={Users} 
              label="客户总数" 
              value={stats.customers.total}
              sub={`本期新增 ${stats.customers.new_this_period}`}
              trend={stats.customers.new_this_period > 0 ? Math.round((stats.customers.new_this_period / Math.max(stats.customers.total - stats.customers.new_this_period, 1)) * 100) : 0}
              color="#10B981"
              gradient="radial-gradient(circle, #10B981 0%, transparent 70%)"
              onClick={() => window.open('/customers', '_blank')}
            />
            <KpiCard
              icon={Calendar} 
              label={`${periodLabel}会议`} 
              value={stats.meetings.this_period}
              sub={`累计 ${stats.meetings.total} 场`}
              color="#F59E0B"
              gradient="radial-gradient(circle, #F59E0B 0%, transparent 70%)"
              onClick={() => window.open('/meetings', '_blank')}
            />
            <KpiCard
              icon={FileText} 
              label={`${periodLabel}日报`} 
              value={stats.reports.this_period}
              sub={`连续 ${stats.reports.streak_days} 天`}
              color="#8B5CF6"
              gradient="radial-gradient(circle, #8B5CF6 0%, transparent 70%)"
              onClick={() => window.open('/reports', '_blank')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity size={14} className="text-[#06B6D4]" />
                快捷统计
              </h4>
              <div className="space-y-2">
                {stats.projects.total_opp_cny > 0 && (
                  <StatCard
                    title="商机金额"
                    value={`¥${stats.projects.total_opp_cny.toLocaleString()} 万`}
                    icon={Target}
                    color="#3B82F6"
                    description={`本期 ¥${stats.projects.opp_this_period_cny.toLocaleString()} 万`}
                  />
                )}
                {stats.projects.total_deal_cny > 0 && (
                  <StatCard
                    title="成交价格"
                    value={`¥${stats.projects.total_deal_cny.toLocaleString()} 万`}
                    icon={CheckCircle2}
                    color="#10B981"
                    description={`本期 ¥${stats.projects.deal_this_period_cny.toLocaleString()} 万`}
                  />
                )}
                {stats.projects.total_opp_cny === 0 && stats.projects.total_deal_cny === 0 && (
                  <StatCard
                    title="项目金额"
                    value="— 暂无数据"
                    icon={Target}
                    color="#6B7280"
                  />
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Briefcase size={14} className="text-[#3B82F6]" />
                项目状态
              </h4>
              <DonutChart data={stats.projects.status_distribution} totalLabel="项目总数" />
            </div>

            <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Users size={14} className="text-[#10B981]" />
                行业分布
              </h4>
              <BarChart data={stats.customers.industry_distribution} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-purple-500/15">
                    <Brain size={14} className="text-[#8B5CF6]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">AI 智能洞察</h4>
                    {(INSIGHT_PERIODS.find(p => p.key === aiTab)) && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: (INSIGHT_PERIODS.find(p => p.key === aiTab)!.color) + '20', color: INSIGHT_PERIODS.find(p => p.key === aiTab)!.color }}>AI</span>
                        {insights[aiTab]?.updatedAt && (
                          <span className="text-[9px] text-gray-500">更新于 {formatUpdatedAt(insights[aiTab].updatedAt)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-bg-hover/50 rounded-lg p-0.5">
                  {INSIGHT_PERIODS.map(({ key, label, color }) => (
                    <button
                      key={key}
                      onClick={() => setAiTab(key)}
                      className={`px-2.5 py-1 text-[10px] rounded-md font-medium transition-all ${
                        aiTab === key ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
                      }`}
                      style={aiTab === key ? { background: `${color}25`, color } : {}}
                    >
                      {label.replace('洞察', '')}
                    </button>
                  ))}
                </div>
              </div>

              {(() => {
                const period = INSIGHT_PERIODS.find(p => p.key === aiTab)
                if (!period) return null
                const { key, label, icon: Icon, color } = period
                const data = insights[key]
                const loading = insightLoading[key]
                const hasSources = data.sources && Object.values(data.sources).some(v => v)

                return (
                  <>
                    {loading ? (
                      <div className="space-y-3 py-2">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="h-10 rounded-xl bg-bg-hover animate-pulse" style={{ animationDelay: `${i * 0.1}s` }} />
                        ))}
                      </div>
                    ) : data.items.length === 0 ? (
                      <div className="py-8 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gray-500/10 mb-3">
                          <Icon size={20} className="text-gray-500" />
                        </div>
                        <p className="text-xs text-gray-500 mb-2">暂无{label}数据</p>
                        {!stats ? (
                          <p className="text-[10px] text-gray-600">加载中…</p>
                        ) : (
                          <button 
                            onClick={() => loadInsights(key)} 
                            className="inline-flex items-center gap-1.5 text-xs text-[#3B82F6] hover:text-blue-400 hover:underline"
                          >
                            <Sparkles size={12} />
                            点击生成{label}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {data.items.map((line, i) => (
                          <div
                            key={i}
                            className="group/insight relative flex items-start gap-3 p-3 rounded-xl border border-border/30 hover:border-purple-500/30 bg-gradient-to-r from-white/2 to-transparent hover:from-purple-500/5 transition-all"
                          >
                            <span 
                              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" 
                              style={{ background: `${color}25`, color }}
                            >
                              {i + 1}
                            </span>
                            <p className="text-xs text-gray-300 leading-relaxed flex-1">{line}</p>
                            <ArrowRight size={12} className="flex-shrink-0 text-gray-600 opacity-0 group-hover/insight:opacity-100 transition-opacity mt-0.5" />
                          </div>
                        ))}
                        {hasSources && (
                          <div className="mt-4 pt-3 border-t border-border/30">
                            <p className="text-[9px] text-gray-500 mb-2 flex items-center gap-1">
                              <Sparkles size={10} className="text-amber-400" />
                              基于以下数据生成
                            </p>
                            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                              {data.sources!.projects && (
                                <span className="inline-flex items-center text-[10px] text-gray-400">
                                  <Briefcase size={10} className="mr-1 flex-shrink-0" style={{ color }} />
                                  <span className="text-gray-500 mr-0.5">项目</span>
                                  {data.sources!.projects}
                                </span>
                              )}
                              {data.sources!.customers && (
                                <span className="inline-flex items-center text-[10px] text-gray-400">
                                  <Users size={10} className="mr-1 flex-shrink-0" style={{ color }} />
                                  <span className="text-gray-500 mr-0.5">客户</span>
                                  {data.sources!.customers}
                                </span>
                              )}
                              {data.sources!.meetings && (
                                <span className="inline-flex items-center text-[10px] text-gray-400">
                                  <Calendar size={10} className="mr-1 flex-shrink-0" style={{ color }} />
                                  <span className="text-gray-500 mr-0.5">会议</span>
                                  {data.sources!.meetings}
                                </span>
                              )}
                              {data.sources!.reports && (
                                <span className="inline-flex items-center text-[10px] text-gray-400">
                                  <FileText size={10} className="mr-1 flex-shrink-0" style={{ color }} />
                                  <span className="text-gray-500 mr-0.5">日报</span>
                                  {data.sources!.reports}
                                </span>
                              )}
                              {data.sources!.weeklies && (
                                <span className="inline-flex items-center text-[10px] text-gray-400">
                                  <BookOpen size={10} className="mr-1 flex-shrink-0" style={{ color }} />
                                  <span className="text-gray-500 mr-0.5">周报</span>
                                  {data.sources!.weeklies}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => loadInsights(key)}
                            disabled={loading}
                            className="p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10">
                    <Clock size={14} className="text-[#3B82F6]" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">最近动态</h4>
                    <p className="text-[10px] text-gray-500">{timeline.length} 条记录</p>
                  </div>
                </div>
              </div>

              {timeline.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gray-500/10 mb-3">
                    <Clock size={20} className="text-gray-500" />
                  </div>
                  <p className="text-xs text-gray-500">暂无最近动态</p>
                </div>
              ) : (
                <>
                  <div className="relative space-y-0">
                    {(timelineExpanded ? timeline : timeline.slice(0, 5)).map((item, i) => {
                      const Icon = typeIcon[item.type] || FileText
                      const link = typeLink[item.type] + '?' + item.type + '=' + item.link_id
                      const isLast = i === (timelineExpanded ? timeline.length : Math.min(timeline.length, 5)) - 1
                      return (
                        <div key={i} className="relative flex gap-3 py-2.5 group/item">
                          {!isLast && (
                            <div className="absolute left-[11px] top-8 bottom-0 w-px bg-border/50 -z-0" />
                          )}
                          <div className="relative z-10 flex-shrink-0 w-6 h-6 rounded-full bg-bg-hover border border-border group-hover/item:border-blue-500/50 flex items-center justify-center transition-colors">
                            <Icon size={10} className="text-gray-400 group-hover/item:text-blue-400 transition-colors" />
                          </div>
                          <button
                            onClick={() => window.open(link, '_blank')}
                            className="flex-1 min-w-0 text-left group-hover/item:bg-bg-hover -ml-1 px-2 py-1 rounded-lg transition-all"
                          >
                            <p className="text-xs text-gray-300 truncate font-medium">{item.title}</p>
                            <p className="text-[10px] text-gray-500 truncate">{item.description}</p>
                            <p className="text-[9px] text-gray-600 mt-1 flex items-center gap-1">
                              <Clock size={9} />
                              {getRelativeTime(item.time)}
                            </p>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {timeline.length > 5 && (
                    <button
                      onClick={() => setTimelineExpanded(!timelineExpanded)}
                      className="mt-3 w-full flex items-center justify-center gap-1 text-[11px] text-gray-500 hover:text-blue-400 transition-colors py-1.5 rounded-lg hover:bg-bg-hover/50"
                    >
                      <ChevronUp size={12} className={`transition-transform ${timelineExpanded ? '' : 'rotate-180'}`} />
                      {timelineExpanded ? '收起' : `展开全部 (${timeline.length})`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
