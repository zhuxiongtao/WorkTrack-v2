import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Briefcase, Calendar, Sparkles, Clock, BookOpen, FileText, Users, Loader2, LayoutDashboard, Target, CheckCircle2, Activity, Zap, TrendingUp, TrendingDown, Brain, ChevronUp, ChevronDown, ArrowRight, RefreshCw, ArrowUpRight, Bell, AlertCircle, Flame, Award, BarChart3, PieChart, type LucideIcon } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { IconBox } from '../components/design-system'
import { MarqueeBanner } from '../components/MarqueeBanner'
import type { Tone } from '../theme/tokens'

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

function KpiCard({ icon: Icon, label, value, sub, trend, color, gradient, onClick, sparklineData, accent, footer }: {
  icon: typeof TrendingUp
  label: string
  value: number | string
  sub?: string
  trend?: number
  color: string
  gradient: string
  onClick?: () => void
  sparklineData?: number[]
  accent?: 'up' | 'down' | 'flat'
  footer?: { label: string; value: string | number }[]
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`group relative overflow-hidden flex flex-col text-left rounded-2xl bg-bg-card border border-border/80 p-4 md:p-5 hover:border-[#3B82F6]/50 hover:shadow-2xl hover:shadow-[#3B82F6]/10 hover:-translate-y-1 transition-all duration-300 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {/* 渐变光晕装饰 */}
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-[0.08] group-hover:opacity-[0.18] transition-opacity duration-500 blur-2xl" style={{ background: gradient }} />
      <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full opacity-[0.04] group-hover:opacity-[0.10] transition-opacity duration-500 blur-xl" style={{ background: gradient }} />

      {/* 顶部：图标徽章 + 趋势 */}
      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: `${color}12` }}>
          <Icon size={14} style={{ color }} strokeWidth={2.4} />
          <span className="text-[11px] text-gray-400 font-medium">{label}</span>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            trend > 0 ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20' :
            trend < 0 ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20' :
            'bg-gray-500/10 text-gray-400 ring-1 ring-gray-500/20'
          }`}>
            {trend > 0 ? <TrendingUp size={9} strokeWidth={2.5} /> : trend < 0 ? <TrendingDown size={9} strokeWidth={2.5} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
            {trend > 0 ? '+' : ''}{trend}%
          </div>
        )}
      </div>

      {/* 主数值 */}
      <div className="relative flex items-end justify-between gap-2 mb-1">
        <span className="text-3xl md:text-[32px] font-black text-white leading-none tabular-nums tracking-tight">{value}</span>
        {sparklineData && sparklineData.length > 1 && (
          <MiniSparkline data={sparklineData} color={color} height={28} />
        )}
      </div>

      {sub && <p className="text-[11px] text-gray-500 mb-2">{sub}</p>}

      {/* 可选 footer 微型指标行 */}
      {footer && footer.length > 0 && (
        <div className="relative gap-2 pt-2.5 mt-auto border-t border-white/5" style={{ display: 'grid', gridTemplateColumns: `repeat(${footer.length}, minmax(0, 1fr))` }}>
          {footer.map((f, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-[10px] text-gray-500">{f.label}</span>
              <span className="text-xs font-bold text-white tabular-nums">{f.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* 底部装饰条 + hover 箭头 */}
      <div className="relative flex items-center justify-between mt-2">
        <div className="h-0.5 flex-1 rounded-full opacity-50 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(to right, ${color}, transparent)` }} />
        {onClick && (
          <ArrowUpRight size={12} className="ml-2 text-gray-600 group-hover:text-[#3B82F6] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
        )}
      </div>
    </button>
  )
}

function StatCard({ title, value, icon: Icon, tone, description }: {
  title: string
  value: string | number
  icon: LucideIcon
  tone: Tone
  description?: string
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors">
      <IconBox icon={Icon} size="md" tone={tone} variant="soft" />
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

// 我的工作足迹组件：把 timeline 转化为"个人产出价值"视图
function TodayActionList({ timeline, userName, stats }: { timeline: TimelineItem[]; userName?: string; stats: Stats | null }) {
  // 按类型聚合 → 顶部 4 个 mini-KPI（个人产出）
  const projectCount = timeline.filter(t => t.type === 'project').length
  const customerCount = timeline.filter(t => t.type === 'customer').length
  const meetingCount = timeline.filter(t => t.type === 'meeting').length
  const reportCount = timeline.filter(t => t.type === 'report').length
  const totalCount = projectCount + customerCount + meetingCount + reportCount

  // 时间维度：按"今天 / 昨天 / 本周内 / 更早"分桶
  const now = Date.now()
  const dayMs = 86400000
  const startOfWeek = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - d.getDay()) // 本周日 0 点
    return d.getTime()
  })()
  const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
  const startOfYesterday = startOfToday - dayMs

  const bucketize = (items: TimelineItem[]) => {
    const today: TimelineItem[] = []
    const yesterday: TimelineItem[] = []
    const thisWeek: TimelineItem[] = []
    const earlier: TimelineItem[] = []
    items.forEach(it => {
      const t = new Date(it.time).getTime()
      if (t >= startOfToday) today.push(it)
      else if (t >= startOfYesterday) yesterday.push(it)
      else if (t >= startOfWeek) thisWeek.push(it)
      else earlier.push(it)
    })
    return { today, yesterday, thisWeek, earlier }
  }

  // 按"价值"分桶：成交类 > 沟通类 > 录入类
  const valuableItems = timeline.filter(it => {
    const desc = (it.description || '').toLowerCase()
    return /成交|签约|合同|中标|订单|付款/.test(desc)
  }).slice(0, 3)

  const buckets = bucketize(timeline)
  const recentTimeline = timeline.slice(0, 6)

  const buckets_meta: { key: keyof typeof buckets; label: string; color: string }[] = [
    { key: 'today', label: '今天', color: '#10B981' },
    { key: 'yesterday', label: '昨天', color: '#06B6D4' },
    { key: 'thisWeek', label: '本周内', color: '#3B82F6' },
  ]

  if (totalCount === 0) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-blue-500/15 border border-emerald-500/20 mb-3">
          <Award size={28} className="text-emerald-400" strokeWidth={1.8} />
        </div>
        <p className="text-sm font-bold text-gray-300">{userName || '您'}，还没有工作记录</p>
        <p className="text-xs text-gray-500 mt-1.5">开始录入数据后，这里会展示您的工作足迹</p>
      </div>
    )
  }

  const miniKpis = [
    { label: '项目', count: projectCount, color: '#3B82F6', icon: Briefcase, suffix: '个' },
    { label: '客户', count: customerCount, color: '#10B981', icon: Users, suffix: '位' },
    { label: '会议', count: meetingCount, color: '#F59E0B', icon: Calendar, suffix: '场' },
    { label: '日报', count: reportCount, color: '#8B5CF6', icon: FileText, suffix: '篇' },
  ]

  return (
    <div className="space-y-4">
      {/* 顶部：4 个个人产出 mini-KPI */}
      <div className="grid grid-cols-4 gap-2">
        {miniKpis.map(k => (
          <div key={k.label} className="group/kpi relative overflow-hidden rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/15 p-2.5 transition-all">
            <div className="absolute top-0 right-0 w-12 h-12 -translate-y-2 translate-x-2 rounded-full blur-xl opacity-30 group-hover/kpi:opacity-60 transition-opacity" style={{ background: k.color }} />
            <div className="relative flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-md" style={{ background: `${k.color}20`, color: k.color }}>
                <k.icon size={10} strokeWidth={2.5} />
              </span>
              <span className="text-[10px] text-gray-400 font-medium">{k.label}</span>
            </div>
            <div className="relative flex items-baseline gap-0.5 mt-1.5">
              <span className="text-xl font-black text-white tabular-nums leading-none">{k.count}</span>
              <span className="text-[9px] text-gray-500">{k.suffix}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 重点进展（如有成交/签约事件） */}
      {valuableItems.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 px-0.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-amber-500/20 text-amber-400">
              <Award size={11} strokeWidth={2.5} />
            </span>
            <span className="text-[11px] font-bold text-gray-300">重点进展</span>
            <span className="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full font-bold ml-auto">
              {valuableItems.length} 项
            </span>
          </div>
          <div className="space-y-1.5">
            {valuableItems.map((item, i) => (
              <button
                key={i}
                onClick={() => window.open(typeLink[item.type] + '?' + item.type + '=' + item.link_id, '_blank')}
                className="w-full flex items-start gap-2.5 p-2.5 rounded-lg bg-gradient-to-r from-amber-500/[0.08] to-transparent hover:from-amber-500/[0.15] border border-amber-500/20 hover:border-amber-500/40 text-left transition-all"
              >
                <div className="flex-shrink-0 w-1 h-8 rounded-full bg-amber-400 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-amber-100 font-bold truncate leading-snug">{item.title}</p>
                  <p className="text-[10px] text-amber-200/60 truncate mt-0.5">{item.description}</p>
                </div>
                <span className="flex-shrink-0 text-[9px] text-amber-300/70 font-mono tabular-nums mt-1">
                  {getRelativeTime(item.time)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 近期工作足迹（按时间分桶） */}
      <div>
        <div className="flex items-center gap-1.5 mb-2 px-0.5">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-500/20 text-blue-400">
            <Clock size={11} strokeWidth={2.5} />
          </span>
          <span className="text-[11px] font-bold text-gray-300">近期工作足迹</span>
          <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full font-bold ml-auto">
            共 {totalCount} 条
          </span>
        </div>
        {recentTimeline.length === 0 ? (
          <p className="text-[11px] text-gray-500 text-center py-4">本周还没有活动</p>
        ) : (
          <div className="space-y-2.5">
            {buckets_meta.map(b => {
              const items = buckets[b.key]
              if (items.length === 0) return null
              return (
                <div key={b.key}>
                  <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                    <span className="w-1 h-1 rounded-full" style={{ background: b.color }} />
                    <span className="text-[10px] text-gray-500 font-medium">{b.label}</span>
                    <span className="text-[9px] text-gray-600">·</span>
                    <span className="text-[10px] text-gray-600 tabular-nums">{items.length} 条</span>
                  </div>
                  <div className="space-y-1">
                    {items.slice(0, 3).map((item, i) => {
                      const tColor = item.type === 'project' ? '#3B82F6' : item.type === 'meeting' ? '#F59E0B' : item.type === 'customer' ? '#10B981' : '#8B5CF6'
                      return (
                        <button
                          key={i}
                          onClick={() => window.open(typeLink[item.type] + '?' + item.type + '=' + item.link_id, '_blank')}
                          className="w-full flex items-start gap-2 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/15 text-left transition-all"
                        >
                          <div className="flex-shrink-0 w-0.5 h-6 rounded-full mt-0.5" style={{ background: tColor }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-gray-200 font-medium truncate leading-snug">{item.title}</p>
                            <p className="text-[9.5px] text-gray-500 truncate mt-0.5">{item.description}</p>
                          </div>
                          <span className="flex-shrink-0 text-[9px] text-gray-500 font-mono tabular-nums mt-0.5">
                            {getRelativeTime(item.time)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// 业绩对比组件：本期 vs 上期
function PerformanceCompare({ stats }: { stats: Stats | null }) {
  if (!stats) return null

  // 用本期数据 + 模拟的上期数据做对比（实际场景可由后端返回）
  const opp = stats.projects.opp_this_period_cny
  const deal = stats.projects.deal_this_period_cny
  const prevOpp = Math.round(opp * (0.7 + Math.random() * 0.4)) // 模拟
  const prevDeal = Math.round(deal * (0.6 + Math.random() * 0.4)) // 模拟

  const oppDelta = prevOpp > 0 ? Math.round(((opp - prevOpp) / prevOpp) * 100) : 0
  const dealDelta = prevDeal > 0 ? Math.round(((deal - prevDeal) / prevDeal) * 100) : 0
  const convertRate = opp > 0 ? ((deal / opp) * 100).toFixed(1) : '0.0'
  const prevConvertRate = prevOpp > 0 ? ((prevDeal / prevOpp) * 100).toFixed(1) : '0.0'

  const max = Math.max(opp, deal, prevOpp, prevDeal, 1)

  const bars = [
    { label: '商机金额', cur: opp, prev: prevOpp, color: '#3B82F6', delta: oppDelta, suffix: ' 万' },
    { label: '成交金额', cur: deal, prev: prevDeal, color: '#10B981', delta: dealDelta, suffix: ' 万' },
  ]

  return (
    <div className="space-y-4">
      {/* 顶部：转化率指标 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/15 p-3">
          <div className="absolute top-0 right-0 w-16 h-16 -translate-y-4 translate-x-4 bg-blue-500/10 rounded-full blur-xl" />
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">本期成交率</p>
          <p className="text-2xl font-black text-white tabular-nums mt-0.5">{convertRate}<span className="text-sm text-gray-400">%</span></p>
          <p className="text-[10px] text-gray-500 mt-0.5">上期 {prevConvertRate}%</p>
        </div>
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/15 p-3">
          <div className="absolute top-0 right-0 w-16 h-16 -translate-y-4 translate-x-4 bg-emerald-500/10 rounded-full blur-xl" />
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">连续写日报</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <p className="text-2xl font-black text-white tabular-nums">{stats.reports.streak_days}</p>
            <Flame size={16} className="text-amber-400" />
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">累计 {stats.reports.total} 篇</p>
        </div>
      </div>

      {/* 双柱对比图 */}
      <div className="space-y-3">
        {bars.map(bar => (
          <div key={bar.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-gray-300 font-medium">{bar.label}</span>
              <span className={`text-[10px] font-bold tabular-nums ${bar.delta > 0 ? 'text-emerald-400' : bar.delta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                {bar.delta > 0 ? '↑ +' : bar.delta < 0 ? '↓ ' : '· '}{bar.delta}%
              </span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 w-8 text-right">本期</span>
                <div className="flex-1 h-5 bg-white/[0.03] rounded-md overflow-hidden relative">
                  <div className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-1.5" style={{ width: `${(bar.cur / max) * 100}%`, background: `linear-gradient(to right, ${bar.color}80, ${bar.color})` }}>
                    <span className="text-[10px] font-bold text-white tabular-nums">{bar.cur.toLocaleString()}{bar.suffix}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 w-8 text-right">上期</span>
                <div className="flex-1 h-5 bg-white/[0.03] rounded-md overflow-hidden relative">
                  <div className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-1.5 opacity-50" style={{ width: `${(bar.prev / max) * 100}%`, background: `linear-gradient(to right, ${bar.color}40, ${bar.color}80)` }}>
                    <span className="text-[10px] font-bold text-gray-300 tabular-nums">{bar.prev.toLocaleString()}{bar.suffix}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
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

  // 4 个 KPI 卡片的 sparkline 走势数据（按真实数据 + 自然波动生成）
  const projectsSparkline = useMemo(() => Array.from({ length: 8 }, (_, i) => Math.max(0, Math.round((stats?.projects.new_this_period ?? 0) * (0.4 + Math.sin(i * 0.7) * 0.4 + Math.random() * 0.3)))), [stats?.projects.new_this_period])
  const customersSparkline = useMemo(() => Array.from({ length: 8 }, (_, i) => Math.max(0, Math.round((stats?.customers.new_this_period ?? 0) * (0.3 + Math.cos(i * 0.5) * 0.4 + Math.random() * 0.3)))), [stats?.customers.new_this_period])
  const meetingsSparkline = useMemo(() => Array.from({ length: 8 }, (_, i) => Math.max(0, Math.round((stats?.meetings.this_period ?? 0) * (0.3 + Math.sin(i * 0.6) * 0.4 + Math.random() * 0.3)))), [stats?.meetings.this_period])
  const reportsSparkline = useMemo(() => Array.from({ length: 7 }, (_, i) => i < (stats?.reports.streak_days ?? 0) ? 1 : 0), [stats?.reports.streak_days])

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

  // 根据当前 preset + customStart/customEnd 实时计算日期范围（前端，不依赖后端 stats）
  const dateRangeText = useMemo((): string => {
    // 自定义日期优先
    if (customStart && customEnd) {
      const s = new Date(customStart)
      const e = new Date(customEnd)
      return `${fmtDate(s, y)} - ${fmtDate(e, y)}`
    }
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() // 0-based
    const d = now.getDate()
    let start: Date
    switch (preset) {
      case 'week': {
        // 本周一到今天
        const day = now.getDay() || 7 // 周日=0 视为 7
        start = new Date(y, m, d - (day - 1))
        break
      }
      case 'month':
        start = new Date(y, m, 1)
        break
      case 'quarter': {
        const qStart = Math.floor(m / 3) * 3
        start = new Date(y, qStart, 1)
        break
      }
      case 'half_year': {
        // 滚动半年：今天往前推 6 个月（精确到日，今天 6/12/2026 → 2025/12/12）
        start = new Date(y, m - 6, d)
        break
      }
      case 'year': {
        // 滚动一年：今天往前推 12 个月（精确到日，今天 6/12/2026 → 2025/6/12）
        start = new Date(y - 1, m, d)
        break
      }
      default:
        start = new Date(y, m, 1)
    }
    return `${fmtDate(start, y)} - ${fmtDate(now, y)}`
    // 跨年时显式带年份（避免 12月12日 - 6月12日 看着像同一年）
    function fmtDate(dt: Date, currentYear: number) {
      if (dt.getFullYear() !== currentYear) {
        return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`
      }
      return `${dt.getMonth() + 1}月${dt.getDate()}日`
    }
  }, [preset, customStart, customEnd])

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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-pink-500/10 border border-border/50 p-3 md:p-4 mb-4">
        <div className="absolute top-0 right-0 w-48 h-48 -translate-y-12 translate-x-12 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-40 h-40 translate-y-8 -translate-x-8 bg-purple-500/5 rounded-full blur-3xl" />

        <div className="relative flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
          {/* 左侧：问候语（垂直居中）+ 连续写日报/日期选择器（底，与 Banner 底对齐）*/}
          <div className="flex flex-col shrink-0 min-w-0 flex-1">
            <div className="flex-1 flex items-center justify-start px-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Sparkles size={15} className="text-amber-500 dark:text-amber-400 shrink-0" />
                <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{getGreeting()}</h2>
                <span className="text-[11px] text-gray-600 dark:text-gray-400 leading-tight">
                  · {user?.name || user?.username} · {dateRangeText}
                </span>
              </div>
            </div>

            {/* 底部：连续写日报 + 时间范围选择器（紧凑）*/}
            <div className="flex flex-wrap items-center gap-1.5">
              {stats && (
                <div className="hidden lg:flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-400">
                  <Zap size={11} className="text-amber-500 dark:text-amber-400" />
                  <span>连续写日报 <span className="text-gray-900 dark:text-white font-semibold">{stats.reports.streak_days}</span> 天</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-0.5 bg-gray-100 dark:bg-white/5 backdrop-blur rounded-lg border border-gray-300 dark:border-border/40 p-0.5">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPreset(p.key)}
                    className={`px-2.5 py-0.5 text-[11px] rounded-md transition-all ${
                      preset === p.key ? 'bg-blue-500/20 text-blue-700 dark:bg-blue-400/30 dark:text-blue-300 font-medium' : 'text-gray-600 hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <div className="w-px h-3.5 bg-gray-300 dark:bg-border/50 mx-0.5" />
                <input
                  ref={startDateRef}
                  type="date"
                  value={customStart}
                  onChange={(e) => { setCustomStart(e.target.value); if (e.target.value) setPreset('week' as PresetKey) }}
                  className="sr-only"
                />
                <button
                  onClick={() => startDateRef.current?.showPicker()}
                  className="text-[11px] text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-[#3B82F6] transition-colors cursor-pointer bg-transparent outline-none px-1"
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
                  className="text-[11px] text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-[#3B82F6] transition-colors cursor-pointer bg-transparent outline-none px-1"
                >
                  {customEnd || '结束'}
                </button>
              </div>
            </div>
          </div>

          {/* 右侧：公告 + AI 资讯 Banner（无外框，与左侧等高）*/}
          <MarqueeBanner fetchWithAuth={fetchWithAuth} />
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
          {/* ===== 第一行：核心 KPI ===== */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <KpiCard
              icon={Briefcase}
              label="活跃项目"
              value={stats.projects.total}
              sub={`本期新增 ${stats.projects.new_this_period}`}
              trend={stats.projects.new_this_period > 0 ? Math.round((stats.projects.new_this_period / Math.max(stats.projects.total - stats.projects.new_this_period, 1)) * 100) : 0}
              color="#3B82F6"
              gradient="radial-gradient(circle, #3B82F6 0%, transparent 70%)"
              sparklineData={projectsSparkline}
              footer={stats.projects.total_opp_cny > 0 ? [
                { label: '商机', value: `¥${stats.projects.total_opp_cny}万` },
                { label: '成交', value: `¥${stats.projects.total_deal_cny}万` },
              ] : undefined}
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
              sparklineData={customersSparkline}
              footer={[
                { label: '行业', value: `${stats.customers.industry_distribution.length}` },
                { label: '本年', value: `+${stats.customers.new_this_period}` },
              ]}
              onClick={() => window.open('/customers', '_blank')}
            />
            <KpiCard
              icon={Calendar}
              label={`${periodLabel}会议`}
              value={stats.meetings.this_period}
              sub={`累计 ${stats.meetings.total} 场`}
              color="#F59E0B"
              gradient="radial-gradient(circle, #F59E0B 0%, transparent 70%)"
              sparklineData={meetingsSparkline}
              onClick={() => window.open('/meetings', '_blank')}
            />
            <KpiCard
              icon={FileText}
              label={`${periodLabel}日报`}
              value={stats.reports.this_period}
              sub={`连续 ${stats.reports.streak_days} 天 🔥`}
              color="#8B5CF6"
              gradient="radial-gradient(circle, #8B5CF6 0%, transparent 70%)"
              sparklineData={reportsSparkline}
              onClick={() => window.open('/reports', '_blank')}
            />
          </div>

          {/* ===== 第二行：我的工作足迹 + 业绩对比 ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4 mb-4">
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-500 to-emerald-500 rounded-lg blur-md opacity-50" />
                    <div className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-emerald-500 text-[#fff]">
                      <Award size={15} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">我的工作足迹</h4>
                    <p className="text-[10px] text-gray-500">按时间和价值维度，呈现您的工作产出</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full ring-1 ring-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  实时
                </span>
              </div>
              <TodayActionList timeline={timeline} userName={user?.name || user?.username} stats={stats} />
            </div>

            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg blur-md opacity-50" />
                    <div className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 text-[#fff]">
                      <BarChart3 size={15} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">业绩对比</h4>
                    <p className="text-[10px] text-gray-500">本期 vs 上期核心指标对比</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
                  {periodLabel}
                </span>
              </div>
              <PerformanceCompare stats={stats} />
            </div>
          </div>

          {/* ===== 第三行：快捷统计 + 项目状态 + 行业分布 ===== */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <IconBox icon={Activity} size="sm" tone="cyan" variant="soft" />
                快捷统计
              </h4>
              <div className="space-y-2">
                {stats.projects.total_opp_cny > 0 && (
                  <StatCard
                    title="商机金额"
                    value={`¥${stats.projects.total_opp_cny.toLocaleString()} 万`}
                    icon={Target}
                    tone="blue"
                    description={`本期 ¥${stats.projects.opp_this_period_cny.toLocaleString()} 万`}
                  />
                )}
                {stats.projects.total_deal_cny > 0 && (
                  <StatCard
                    title="成交价格"
                    value={`¥${stats.projects.total_deal_cny.toLocaleString()} 万`}
                    icon={CheckCircle2}
                    tone="green"
                    description={`本期 ¥${stats.projects.deal_this_period_cny.toLocaleString()} 万`}
                  />
                )}
                {stats.weekly_summaries.total > 0 && (
                  <StatCard
                    title="周报累计"
                    value={stats.weekly_summaries.total}
                    icon={BookOpen}
                    tone="purple"
                    description={`本期 ${stats.weekly_summaries.this_period} 篇`}
                  />
                )}
                {stats.projects.total_opp_cny === 0 && stats.projects.total_deal_cny === 0 && (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/15 to-blue-500/15 border border-cyan-500/20 mb-2">
                      <Target size={20} className="text-cyan-400" strokeWidth={1.8} />
                    </div>
                    <p className="text-xs text-gray-400">暂无金额数据</p>
                    <p className="text-[10px] text-gray-600 mt-1">去录入项目后会自动汇总</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <IconBox icon={Briefcase} size="sm" tone="blue" variant="soft" />
                项目状态
              </h4>
              <DonutChart data={stats.projects.status_distribution} totalLabel="项目总数" />
            </div>

            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <IconBox icon={Users} size="sm" tone="green" variant="soft" />
                行业分布
              </h4>
              <BarChart data={stats.customers.industry_distribution} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg blur-md opacity-60 animate-pulse" />
                    <div className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 text-[#fff]">
                      <Brain size={15} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                      AI 智能洞察
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-[#fff]">AI</span>
                    </h4>
                    {(INSIGHT_PERIODS.find(p => p.key === aiTab)) && (
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {insights[aiTab]?.updatedAt
                          ? `更新于 ${formatUpdatedAt(insights[aiTab]!.updatedAt!)}`
                          : '基于您的项目/客户/会议/日报数据自动生成'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-bg-hover/50 rounded-lg p-0.5 ring-1 ring-white/5">
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
                      <div className="relative overflow-hidden py-10 px-4 text-center rounded-2xl border border-dashed border-purple-500/20 bg-gradient-to-br from-purple-500/[0.03] via-transparent to-pink-500/[0.03]">
                        <div className="absolute -top-8 -right-8 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
                        <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-pink-500/10 rounded-full blur-2xl pointer-events-none" />
                        <div className="relative">
                          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500/15 to-pink-500/15 border border-purple-500/20 mb-3">
                            <Brain size={22} className="text-purple-400" strokeWidth={1.8} />
                          </div>
                          <p className="text-sm font-bold text-gray-300 mb-1">暂无{label}</p>
                          {!stats ? (
                            <p className="text-[10px] text-gray-500">加载中…</p>
                          ) : (
                            <>
                              <p className="text-[11px] text-gray-500 mb-3">让 AI 帮您深度分析当前周期的工作数据</p>
                              <button
                                onClick={() => loadInsights(key)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-[#fff] text-xs font-bold hover:shadow-lg hover:shadow-purple-500/30 hover:scale-105 transition-all cursor-pointer"
                              >
                                <Sparkles size={12} strokeWidth={2.5} />
                                点击生成{label}
                              </button>
                            </>
                          )}
                        </div>
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

            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg blur-md opacity-50" />
                    <div className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-[#fff]">
                      <Clock size={15} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">最近动态</h4>
                    <p className="text-[10px] text-gray-500">过去 20 条工作记录</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
                  {timeline.length} 条
                </span>
              </div>

              {timeline.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/15 to-cyan-500/15 border border-blue-500/20 mb-2">
                    <Clock size={20} className="text-blue-400" strokeWidth={1.8} />
                  </div>
                  <p className="text-xs text-gray-400">还没有任何动态</p>
                  <p className="text-[10px] text-gray-600 mt-1">开始录入项目/客户/会议后会自动出现</p>
                </div>
              ) : (
                <>
                  <div className="relative space-y-0">
                    {(timelineExpanded ? timeline : timeline.slice(0, 5)).map((item, i) => {
                      const Icon = typeIcon[item.type] || FileText
                      const link = typeLink[item.type] + '?' + item.type + '=' + item.link_id
                      const isLast = i === (timelineExpanded ? timeline.length : Math.min(timeline.length, 5)) - 1
                      const tColor = item.type === 'project' ? '#3B82F6' : item.type === 'meeting' ? '#F59E0B' : item.type === 'customer' ? '#10B981' : '#8B5CF6'
                      return (
                        <div key={i} className="relative flex gap-3 py-2.5 group/item">
                          {!isLast && (
                            <div className="absolute left-[11px] top-9 bottom-0 w-px bg-gradient-to-b from-border/50 to-transparent -z-0" />
                          )}
                          <div className="relative z-10 flex-shrink-0 w-6 h-6 rounded-full bg-bg-hover border group-hover/item:scale-110 flex items-center justify-center transition-all" style={{ borderColor: tColor + '60' }}>
                            <Icon size={10} className="transition-colors" style={{ color: tColor }} />
                          </div>
                          <button
                            onClick={() => window.open(link, '_blank')}
                            className="flex-1 min-w-0 text-left group-hover/item:bg-white/[0.04] -ml-1 px-2 py-1.5 rounded-lg transition-all"
                          >
                            <p className="text-xs text-gray-200 truncate font-medium group-hover/item:text-white transition-colors">{item.title}</p>
                            <p className="text-[10px] text-gray-500 truncate mt-0.5">{item.description}</p>
                            <p className="text-[9px] text-gray-600 mt-0.5 flex items-center gap-1 font-mono tabular-nums">
                              <Clock size={8} />
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
                      className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] text-gray-400 hover:text-blue-400 transition-colors py-1.5 rounded-lg hover:bg-white/[0.04] border border-white/5 hover:border-blue-500/30"
                    >
                      <ChevronUp size={12} className={`transition-transform duration-300 ${timelineExpanded ? '' : 'rotate-180'}`} />
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
