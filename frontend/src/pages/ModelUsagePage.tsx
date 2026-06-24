import { useState, useEffect, useCallback, useMemo } from 'react'
import { BarChart2, Users, Zap, TrendingUp, RefreshCw, Activity } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

interface SummaryData {
  days: number
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_tokens: number
  active_users: number
}

interface ModelRow {
  provider_id: number | null
  provider_name: string
  model_name: string
  task_type: string
  calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
}

interface UserModelRow {
  user_id: number | null
  user_name: string
  provider_id: number | null
  provider_name: string
  model_name: string
  calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  total_tokens: number
}

interface UserGroup {
  user_id: number | null
  user_name: string
  total_calls: number
  total_input: number
  total_output: number
  total_cache: number
  total_tokens: number
  models: UserModelRow[]
}

interface TrendRow {
  day: string
  calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  total_tokens: number
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

const RANGE_OPTIONS = [
  { label: '最近 7 天', days: 7 },
  { label: '最近 30 天', days: 30 },
  { label: '最近 90 天', days: 90 },
]

export default function ModelUsagePage() {
  const { fetchWithAuth } = useAuth()
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'model' | 'user'>('model')

  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [byModel, setByModel] = useState<ModelRow[]>([])
  const [userGroups, setUserGroups] = useState<UserGroup[]>([])
  const [trend, setTrend] = useState<TrendRow[]>([])
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())

  const toggleUser = (key: string) =>
    setExpandedUsers(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, m, u, t] = await Promise.all([
        fetchWithAuth(`/api/v1/admin/model-usage/summary?days=${days}`).then(r => r.json()),
        fetchWithAuth(`/api/v1/admin/model-usage/by-model?days=${days}`).then(r => r.json()),
        fetchWithAuth(`/api/v1/admin/model-usage/by-user?days=${days}`).then(r => r.json()),
        fetchWithAuth(`/api/v1/admin/model-usage/daily-trend?days=${days}`).then(r => r.json()),
      ])
      setSummary(s)
      setByModel(Array.isArray(m) ? m : [])

      // 将按 (user, model) 的平铺列表聚合成用户分组
      const rows: UserModelRow[] = Array.isArray(u) ? u : []
      const groupMap = new Map<string, UserGroup>()
      rows.forEach(row => {
        const key = String(row.user_id ?? 'null')
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            user_id: row.user_id,
            user_name: row.user_name,
            total_calls: 0, total_input: 0, total_output: 0, total_cache: 0, total_tokens: 0,
            models: [],
          })
        }
        const g = groupMap.get(key)!
        g.total_calls += row.calls
        g.total_input += row.input_tokens
        g.total_output += row.output_tokens
        g.total_cache += row.cache_read_tokens
        g.total_tokens += row.total_tokens
        g.models.push(row)
      })
      // 按总 token 降序排列
      setUserGroups([...groupMap.values()].sort((a, b) => b.total_tokens - a.total_tokens))

      setTrend(Array.isArray(t) ? t : [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [days, fetchWithAuth])

  useEffect(() => { load() }, [load])

  // 填充完整日期范围（缺失日期补 0），保证 x 轴与周期选择器对齐
  const filledTrend = useMemo<TrendRow[]>(() => {
    const map = new Map(trend.map(r => [r.day, r]))
    const result: TrendRow[] = []
    const now = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      result.push(map.get(key) ?? { day: key, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, total_tokens: 0 })
    }
    return result
  }, [trend, days])

  const maxTotal = Math.max(...filledTrend.map(r => r.total_tokens), 1)
  const CHART_BAR_H = 100
  const BAR_MIN_W = days <= 7 ? 20 : days <= 31 ? 8 : 5
  const BAR_GAP = 3
  const labelStep = days <= 7 ? 1 : days <= 31 ? 5 : 10
  const [hoveredRow, setHoveredRow] = useState<TrendRow | null>(null)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart2 size={22} className="text-blue-500" />
            模型用量统计
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">平台 LLM 调用的 token 消耗明细</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                className={`px-3 py-1.5 transition-colors ${days === opt.days ? 'bg-accent-blue text-white' : 'text-gray-500 hover:bg-bg-hover'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-bg-hover transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Activity, label: '总调用次数', value: fmt(summary?.total_calls ?? 0), color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { icon: Zap, label: '总 Token 消耗', value: fmt(summary?.total_tokens ?? 0), color: 'text-purple-500', bg: 'bg-purple-500/10' },
          { icon: TrendingUp, label: '输入 Token', value: fmt(summary?.total_input_tokens ?? 0), color: 'text-green-500', bg: 'bg-green-500/10' },
          { icon: Users, label: '活跃用户数', value: String(summary?.active_users ?? 0), color: 'text-orange-500', bg: 'bg-orange-500/10' },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-border bg-bg-card p-4">
            <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center mb-3`}>
              <card.icon size={16} className={card.color} />
            </div>
            <p className="text-xs text-gray-500 mb-0.5">{card.label}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{loading ? '—' : card.value}</p>
          </div>
        ))}
      </div>

      {/* Trend Chart */}
      <div className="rounded-xl border border-border bg-bg-card p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">每日 Token 趋势</h2>
        {loading ? (
          <div className="flex items-center justify-center h-24 text-sm text-gray-400">加载中…</div>
        ) : maxTotal === 1 ? (
          <div className="flex items-center justify-center h-24 text-sm text-gray-400">暂无数据</div>
        ) : (
          <>
            {/* 悬停信息行 */}
            <div className="h-7 mb-3 flex items-center">
              {hoveredRow && hoveredRow.total_tokens > 0 && (
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-400 font-medium tabular-nums">{hoveredRow.day}</span>
                  <span className="text-blue-400">总计 <span className="font-semibold text-blue-300">{fmt(hoveredRow.total_tokens)}</span></span>
                  <span className="text-green-400">输入 <span className="font-semibold">{fmt(hoveredRow.input_tokens)}</span></span>
                  <span className="text-orange-400">输出 <span className="font-semibold">{fmt(hoveredRow.output_tokens)}</span></span>
                  {hoveredRow.cache_read_tokens > 0 && (
                    <span className="text-purple-400">缓存命中 <span className="font-semibold">{fmt(hoveredRow.cache_read_tokens)}</span></span>
                  )}
                  <span className="text-gray-500">{hoveredRow.calls} 次调用</span>
                </div>
              )}
            </div>
            <div className="overflow-hidden">
              {/* 柱区：flex 铺满容器，minWidth 防止过窄，无 maxWidth 保证撑满 */}
              <div
                className="flex items-end w-full"
                style={{ height: `${CHART_BAR_H}px`, gap: `${BAR_GAP}px` }}
              >
                {filledTrend.map((row) => {
                  const barH = row.total_tokens > 0
                    ? Math.max(Math.round((row.total_tokens / maxTotal) * CHART_BAR_H), 4)
                    : 0
                  const isHovered = hoveredRow?.day === row.day
                  return (
                    <div
                      key={row.day}
                      className="flex flex-col justify-end h-full cursor-default"
                      style={{ flex: 1, minWidth: `${BAR_MIN_W}px` }}
                      onMouseEnter={() => setHoveredRow(row)}
                      onMouseLeave={() => setHoveredRow(null)}
                    >
                      {barH > 0 ? (
                        <div
                          className={`w-full rounded-t transition-colors ${isHovered ? 'bg-blue-400' : 'bg-blue-400/60'}`}
                          style={{ height: `${barH}px` }}
                        />
                      ) : (
                        <div
                          className={`w-full rounded transition-opacity ${isHovered ? 'opacity-40' : 'opacity-0'} bg-gray-600`}
                          style={{ height: '2px' }}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              {/* x 轴标签：与柱区相同 flex，overflow-visible 让文字不被裁剪 */}
              <div
                className="flex mt-1 w-full"
                style={{ gap: `${BAR_GAP}px` }}
              >
                {filledTrend.map((row, i) => (
                  <div
                    key={row.day}
                    className="flex justify-center h-4 overflow-visible"
                    style={{ flex: 1, minWidth: `${BAR_MIN_W}px` }}
                  >
                    {(i % labelStep === 0 || i === filledTrend.length - 1) ? (
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">{row.day.slice(5)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      <div>
        <div className="flex gap-1 border-b border-border mb-4">
          {(['model', 'user'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t ? 'border-accent-blue text-accent-blue' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'model' ? '按模型' : '按用户'}
            </button>
          ))}
        </div>

        {/* By Model Table */}
        {tab === 'model' && (
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-hover">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">供应商 / 模型</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">类型</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">调用次数</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">输入</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">输出</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">缓存命中</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">合计</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">加载中...</td></tr>
                ) : byModel.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">暂无数据</td></tr>
                ) : byModel.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900 dark:text-white text-xs truncate max-w-[200px]">{row.model_name}</p>
                      <p className="text-[11px] text-gray-400">{row.provider_name}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-500">{row.task_type}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-700 dark:text-gray-300 font-mono">{row.calls.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-700 dark:text-gray-300 font-mono">{fmt(row.input_tokens)}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-700 dark:text-gray-300 font-mono">{fmt(row.output_tokens)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono">
                      <span className={row.cache_read_tokens > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                        {fmt(row.cache_read_tokens)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-900 dark:text-white font-mono">{fmt(row.total_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* By User Table */}
        {tab === 'user' && (
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-hover">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">用户 / 模型</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">调用次数</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">输入</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">输出</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">缓存命中</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">合计</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">加载中...</td></tr>
                ) : userGroups.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">暂无数据</td></tr>
                ) : userGroups.map(group => {
                  const key = String(group.user_id)
                  const expanded = expandedUsers.has(key)
                  return (
                    <>
                      {/* 用户汇总行 */}
                      <tr
                        key={`user-${key}`}
                        className="border-b border-border bg-bg-hover/60 cursor-pointer hover:bg-bg-hover transition-colors"
                        onClick={() => toggleUser(key)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-400 w-3">{expanded ? '▾' : '▸'}</span>
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-[11px] text-blue-500 font-bold shrink-0">
                              {(group.user_name || '?')[0].toUpperCase()}
                            </div>
                            <span className="text-xs font-semibold text-gray-900 dark:text-white">{group.user_name}</span>
                            <span className="text-[11px] text-gray-400 ml-1">{group.models.length} 个模型</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 font-mono">{group.total_calls.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 font-mono">{fmt(group.total_input)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 font-mono">{fmt(group.total_output)}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold font-mono">
                          <span className={group.total_cache > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                            {fmt(group.total_cache)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-gray-900 dark:text-white font-mono">{fmt(group.total_tokens)}</td>
                      </tr>
                      {/* 展开的模型明细行 */}
                      {expanded && group.models.map((m, mi) => (
                        <tr key={`model-${key}-${mi}`} className="border-b border-border last:border-0 hover:bg-bg-hover/40 transition-colors">
                          <td className="pl-10 pr-4 py-2">
                            <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate max-w-[200px]">{m.model_name}</p>
                            <p className="text-[11px] text-gray-400">{m.provider_name}</p>
                          </td>
                          <td className="px-4 py-2 text-right text-[11px] text-gray-500 font-mono">{m.calls.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-[11px] text-gray-500 font-mono">{fmt(m.input_tokens)}</td>
                          <td className="px-4 py-2 text-right text-[11px] text-gray-500 font-mono">{fmt(m.output_tokens)}</td>
                          <td className="px-4 py-2 text-right text-[11px] font-mono">
                            <span className={m.cache_read_tokens > 0 ? 'text-green-500 dark:text-green-400' : 'text-gray-400'}>
                              {fmt(m.cache_read_tokens)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-[11px] font-semibold text-gray-700 dark:text-gray-300 font-mono">{fmt(m.total_tokens)}</td>
                        </tr>
                      ))}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
