import { useState, useEffect, useMemo } from 'react'
import { Loader2, Calendar, ChevronDown, ChevronRight, FileText, Sparkles, X, Edit3, Save } from 'lucide-react'
import MarkdownRenderer from '../components/MarkdownRenderer'

interface ReportItem {
  id: number; date: string; title: string; snippet: string; ai_summary: string; has_summary: boolean
}

interface WeekData {
  week_start: string; week_end: string; year: number; report_count: number; reports: ReportItem[]; weekly_summary: string
}

interface ReportDetail {
  id: number; report_date: string; content_md: string; ai_summary: string | null
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const sm = s.getMonth() + 1
  const sd = s.getDate()
  const em = e.getMonth() + 1
  const ed = e.getDate()
  if (sm === em) return `${sm}/${sd} - ${ed}`
  return `${sm}/${sd} - ${em}/${ed}`
}

export default function WeeklyReportPage() {
  const [weeks, setWeeks] = useState<WeekData[]>([])
  const [totalWeeks, setTotalWeeks] = useState(0)
  const [loading, setLoading] = useState(true)

  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set())
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())
  const [modalDetail, setModalDetail] = useState<ReportDetail | null>(null)
  const [modalLoading, setModalLoading] = useState(false)

  const [aiSummarizing, setAiSummarizing] = useState<string | null>(null)
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set())
  // 周报编辑
  const [editingSummary, setEditingSummary] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [savingSummary, setSavingSummary] = useState(false)

  const startEditSummary = (weekStart: string, currentText: string) => {
    setEditingSummary(weekStart)
    setEditText(currentText)
  }

  const saveEditedSummary = async (weekStart: string, _weekEnd: string) => {
    setSavingSummary(true)
    try {
      const res = await fetch(`/api/v1/reports/weekly-summary/${weekStart}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary_text: editText }),
      })
      if (!res.ok) { const err = await res.json(); alert(err.detail || '保存失败'); return }
      setWeeks(prev => prev.map(w =>
        w.week_start === weekStart ? { ...w, weekly_summary: editText } : w
      ))
      setEditingSummary(null)
    } catch { alert('保存请求失败') }
    finally { setSavingSummary(false) }
  }

  const loadWeeks = () => {
    setLoading(true)
    fetch('/api/v1/reports/weekly')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setWeeks(data.weeks || [])
        setTotalWeeks(data.total_weeks || 0)
      })
      .catch((e) => { console.error('加载周报失败:', e) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadWeeks() }, [])

  // 加载完成后自动展开当前年份
  useEffect(() => {
    if (weeks.length === 0) return
    const currentYear = new Date().getFullYear()
    const years = [...new Set(weeks.map((w) => w.year || new Date(w.week_start).getFullYear()))]
    // 优先展开当前年，否则展开最新年
    const target = years.includes(currentYear) ? currentYear : Math.max(...years)
    setExpandedYears(new Set([target]))
  }, [weeks])

  const toggleWeek = (weekStart: string) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev)
      if (next.has(weekStart)) next.delete(weekStart)
      else next.add(weekStart)
      return next
    })
  }

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  // 按年份分组
  const yearGroups = useMemo(() => {
    const map = new Map<number, WeekData[]>()
    weeks.forEach((w) => {
      const y = w.year || new Date(w.week_start).getFullYear()
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(w)
    })
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0])
  }, [weeks])

  const openDetail = async (id: number) => {
    setModalDetail(null)
    setModalLoading(true)
    try {
      const res = await fetch(`/api/v1/reports/${id}`)
      const data = await res.json()
      setModalDetail(data as ReportDetail)
    } finally {
      setModalLoading(false)
    }
  }

  const closeDetail = () => setModalDetail(null)

  const handleAiWeeklySummary = async (weekStart: string, weekEnd: string) => {
    setAiSummarizing(weekStart)
    try {
      const res = await fetch('/api/v1/reports/weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: weekStart, week_end: weekEnd }),
      })
      const data = await res.json()
      const summary = data.summary_text || 'AI 总结生成失败，请检查 AI 服务配置。'
      setWeeks(prev => prev.map(w =>
        w.week_start === weekStart ? { ...w, weekly_summary: summary } : w
      ))
      setExpandedSummaries(prev => { const n = new Set(prev); n.add(weekStart); return n })
    } catch {
      setWeeks(prev => prev.map(w =>
        w.week_start === weekStart ? { ...w, weekly_summary: 'AI 总结请求失败，请检查网络连接和 AI 服务配置。' } : w
      ))
      setExpandedSummaries(prev => { const n = new Set(prev); n.add(weekStart); return n })
    } finally {
      setAiSummarizing(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">周报</h2>
          <p className="text-sm text-gray-500 mt-1">{totalWeeks} 周记录</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : weeks.length === 0 ? (
        <div className="text-center py-20">
          <Calendar size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-3">暂无周报数据</p>
          <p className="text-xs text-gray-600">先写几篇日报，这里会自动按周聚合展示</p>
        </div>
      ) : (
        <div className="space-y-6">
          {yearGroups.map(([year, yearWeeks]) => {
            const yearTotal = yearWeeks.reduce((s, w) => s + w.report_count, 0)
            return (
              <div key={year}>
                {/* 年份标题 */}
                <button
                  onClick={() => toggleYear(year)}
                  className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-bg-hover-secondary/50 transition-colors text-left group w-full"
                >
                  {expandedYears.has(year) ? <ChevronDown size={18} className="text-gray-500 group-hover:text-gray-300" /> : <ChevronRight size={18} className="text-gray-500 group-hover:text-gray-300" />}
                  <span className="text-lg font-bold text-white">{year}</span>
                  <span className="text-xs text-gray-600 bg-bg-hover px-2 py-0.5 rounded-full">
                    {yearWeeks.length} 周 · {yearTotal} 篇
                  </span>
                </button>

                {/* 展开后的周列表 */}
                {expandedYears.has(year) && (
                  <div className="ml-2 space-y-3 mt-2">
                    {yearWeeks.map((week) => {
            const isExpanded = expandedWeeks.has(week.week_start)
            const hasSummary = week.weekly_summary
            const isSummarizing = aiSummarizing === week.week_start
            const showBody = isExpanded || hasSummary || isSummarizing

            return (
              <div key={week.week_start} className="rounded-xl bg-bg-card border border-border overflow-hidden">
                {/* 周标题栏 */}
                <div className="flex items-center gap-3 px-5 py-4 hover:bg-bg-hover-secondary/50 transition-colors">
                  <button onClick={() => toggleWeek(week.week_start)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    {isExpanded ? <ChevronDown size={16} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />}
                    <Calendar size={15} className="text-gray-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">
                          {formatWeekRange(week.week_start, week.week_end)}
                        </span>
                        <span className="text-[10px] text-gray-600 bg-bg-hover px-1.5 py-0.5 rounded-full">
                          {week.report_count} 篇日报
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAiWeeklySummary(week.week_start, week.week_end) }}
                    disabled={isSummarizing}
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg bg-bg-hover text-gray-400 hover:text-[#8B5CF6] hover:bg-border transition-colors disabled:opacity-50 border border-border flex-shrink-0"
                  >
                    {isSummarizing ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    AI 周报总结
                  </button>
                </div>

                {/* 展开内容区 */}
                {showBody && (
                  <div className="border-t border-border">
                    {/* AI 周报总结 —— 内联展示 */}
                    {hasSummary && (
                      <div className="px-5 pt-4 pb-2">
                        <div className="rounded-xl bg-gradient-to-br from-[#8B5CF6]/10 via-bg-card to-[#3B82F6]/10 border border-[#8B5CF6]/20 overflow-hidden">
                          <div className="flex items-center">
                            <button
                              onClick={() => {
                                setExpandedSummaries(prev => {
                                  const n = new Set(prev)
                                  if (n.has(week.week_start)) n.delete(week.week_start)
                                  else n.add(week.week_start)
                                  return n
                                })
                              }}
                              className="flex items-center gap-2 px-4 py-2.5 hover:bg-[#8B5CF6]/5 transition-colors text-left flex-1 min-w-0"
                            >
                              <Sparkles size={13} className="text-[#8B5CF6]" />
                              <span className="text-xs font-medium text-[#A78BFA]">AI 周报总结</span>
                              <span className="flex-1" />
                              {expandedSummaries.has(week.week_start)
                                ? <ChevronDown size={14} className="text-gray-500" />
                                : <ChevronRight size={14} className="text-gray-500" />
                              }
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditSummary(week.week_start, week.weekly_summary) }}
                              className="px-2.5 py-1.5 mr-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border flex items-center gap-1"
                            >
                              <Edit3 size={11} />编辑
                            </button>
                          </div>
                          {expandedSummaries.has(week.week_start) && (
                            editingSummary === week.week_start ? (
                              <div className="px-4 py-3 border-t border-[#8B5CF6]/10">
                                <textarea
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  className="w-full h-40 p-3 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#8B5CF6] resize-none font-mono leading-relaxed"
                                />
                                <div className="flex items-center gap-2 mt-2">
                                  <button
                                    onClick={() => saveEditedSummary(week.week_start, week.week_end)}
                                    disabled={savingSummary}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6] text-white text-xs font-medium hover:bg-purple-600 disabled:opacity-50"
                                  >
                                    {savingSummary ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                    保存
                                  </button>
                                  <button
                                    onClick={() => setEditingSummary(null)}
                                    className="px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="px-4 py-3 border-t border-[#8B5CF6]/10 text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none">
                                <MarkdownRenderer content={week.weekly_summary} />
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* AI 生成中 */}
                    {isSummarizing && (
                      <div className="px-5 py-4">
                        <div className="flex items-center gap-3 rounded-xl bg-[#8B5CF6]/5 border border-[#8B5CF6]/10 px-4 py-3">
                          <Loader2 size={15} className="animate-spin text-[#8B5CF6]" />
                          <div>
                            <p className="text-sm text-[#A78BFA] font-medium">正在生成 AI 周报总结...</p>
                            <p className="text-xs text-gray-500 mt-0.5">正在分析本周日报内容，请稍候</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 日报条目列表 —— 仅展示 AI 摘要 */}
                    {isExpanded && week.reports.length > 0 && (
                      <div className={`px-5 ${(hasSummary || isSummarizing) ? 'pb-3' : 'py-3'} space-y-2`}>
                        {week.reports.map((r) => {
                          const d = new Date(r.date)
                          return (
                            <button
                              key={r.id}
                              onClick={() => openDetail(r.id)}
                              className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-hover-secondary transition-colors group text-left"
                            >
                              <FileText size={13} className="text-gray-600 flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-xs text-gray-400 flex-shrink-0">
                                    {d.getMonth() + 1}/{d.getDate()} {WEEKDAY_NAMES[d.getDay()]}
                                  </span>
                                  {r.has_summary && <Sparkles size={11} className="text-[#8B5CF6] flex-shrink-0" />}
                                </div>
                                {r.ai_summary ? (
                                  <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed">{r.ai_summary}</p>
                                ) : (
                                  <p className="text-xs text-gray-600 italic">暂无 AI 摘要，点击查看详情</p>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 单篇日报详情弹窗 */}
      {modalDetail && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[10vh] pb-10 overflow-y-auto" onClick={closeDetail}>
          <div className="w-full max-w-3xl mx-4 rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-bg-card/95 backdrop-blur-sm rounded-t-2xl">
              <h3 className="text-lg font-bold text-white">
                {new Date(modalDetail.report_date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
              </h3>
              <button onClick={closeDetail} className="p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              {modalLoading ? (
                <div className="text-center py-12"><Loader2 size={20} className="mx-auto animate-spin text-gray-500" /></div>
              ) : (
                <div className="text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none">
                  <MarkdownRenderer content={modalDetail.content_md} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
