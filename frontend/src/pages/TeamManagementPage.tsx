import { useState, useEffect, useCallback, useMemo } from 'react'
import { UsersRound, Loader2, FileText, Calendar, ChevronDown, ChevronRight, X, Sparkles, Edit3, Send, Save, Check } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useUnsavedGuard } from '../hooks/useUnsavedGuard'
import MarkdownRenderer from '../components/MarkdownRenderer'
import RichTextEditor from '../components/RichTextEditor'
import { PageHeader, EmptyState } from '../components/design-system'

interface Member {
  id: number
  name: string
  username: string
  department?: string
}

interface ReportItem {
  id: number
  date: string
  title: string
  snippet: string
  user_id?: number
  user_name?: string
}

interface WeekData {
  week_start: string
  week_end: string
  year: number
  report_count: number
  reports: ReportItem[]
  weekly_summary: string
  weekly_summary_status?: string
  member_names?: string[]
}

interface ReportDetail {
  id: number
  report_date: string
  content_md: string
  user_id?: number
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const sm = s.getMonth() + 1, sd = s.getDate()
  const em = e.getMonth() + 1, ed = e.getDate()
  if (sm === em) return `${sm}/${sd} - ${ed}`
  return `${sm}/${sd} - ${em}/${ed}`
}

export default function TeamManagementPage() {
  const { user: currentUser } = useAuth()
  const { toast: showToast } = useToast()

  const [tab, setTab] = useState<'daily' | 'weekly'>('daily')
  const [memberList, setMemberList] = useState<Member[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [memberOpen, setMemberOpen] = useState(false)

  // 日报 tab state
  const [weeks, setWeeks] = useState<WeekData[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set())
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())
  const [modalDetail, setModalDetail] = useState<ReportDetail | null>(null)
  const [modalLoading, setModalLoading] = useState(false)

  // 周报 tab state
  const [weeklyMember, setWeeklyMember] = useState<number | null>(null)
  const [weeklyData, setWeeklyData] = useState<WeekData[]>([])
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [expandedWeeklyYears, setExpandedWeeklyYears] = useState<Set<number>>(new Set())
  const [expandedWeeklySummaries, setExpandedWeeklySummaries] = useState<Set<string>>(new Set())

  // 周报编辑（主管可以补充周报总结）
  const [editingSummary, setEditingSummary] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editInitial, setEditInitial] = useState('')
  const [savingSummary, setSavingSummary] = useState(false)
  const [aiSummarizing, setAiSummarizing] = useState<string | null>(null)

  const isEditDirty = !!editingSummary && editText !== editInitial
  const { requestClose: requestCancelEdit, Dialog: EditUnsavedDialog } = useUnsavedGuard(isEditDirty)

  const cancelEdit = async () => {
    if (await requestCancelEdit()) {
      setEditingSummary(null)
      setEditText('')
      setEditInitial('')
    }
  }

  // 加载团队成员列表（只含有可见下属）
  useEffect(() => {
    fetch('/api/v1/users/simple')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) {
          // 过滤掉自己
          const others = d.filter((m: Member) => m.id !== currentUser?.id)
          setMemberList(others)
        }
      })
      .catch(() => {})
  }, [currentUser?.id])

  // 选中成员的 user_ids 字符串
  const userIdsParam = useMemo(() => {
    if (selectedIds.length > 0) return selectedIds.join(',')
    if (memberList.length > 0) return memberList.map(m => m.id).join(',')
    return ''
  }, [selectedIds, memberList])

  // 加载日报数据（team mode → submitted only）
  const loadDailyData = useCallback(() => {
    if (!userIdsParam) { setWeeks([]); return }
    setLoading(true)
    fetch(`/api/v1/reports/weekly?user_ids=${userIdsParam}`)
      .then(r => r.json())
      .then(data => {
        const w: WeekData[] = data.weeks || []
        setWeeks(w)
        // 自动展开当前年
        const currentYear = new Date().getFullYear()
        const years = [...new Set(w.map(x => x.year || new Date(x.week_start).getFullYear()))]
        const target = years.includes(currentYear) ? currentYear : (years[0] ?? currentYear)
        setExpandedYears(new Set([target]))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [userIdsParam])

  useEffect(() => { if (tab === 'daily') loadDailyData() }, [tab, loadDailyData])

  // 加载周报数据（单成员视图）
  const loadWeeklyData = useCallback(() => {
    if (!weeklyMember) { setWeeklyData([]); return }
    setWeeklyLoading(true)
    fetch(`/api/v1/reports/weekly?user_ids=${weeklyMember}`)
      .then(r => r.json())
      .then(data => {
        const w: WeekData[] = data.weeks || []
        setWeeklyData(w)
        const currentYear = new Date().getFullYear()
        const years = [...new Set(w.map(x => x.year || new Date(x.week_start).getFullYear()))]
        const target = years.includes(currentYear) ? currentYear : (years[0] ?? currentYear)
        setExpandedWeeklyYears(new Set([target]))
      })
      .catch(() => {})
      .finally(() => setWeeklyLoading(false))
  }, [weeklyMember])

  // 切换到周报 tab 时自动选第一个成员
  useEffect(() => {
    if (tab === 'weekly') {
      if (!weeklyMember && memberList.length > 0) setWeeklyMember(memberList[0].id)
      else loadWeeklyData()
    }
  }, [tab, memberList]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (tab === 'weekly' && weeklyMember) loadWeeklyData() }, [weeklyMember]) // eslint-disable-line react-hooks/exhaustive-deps

  // 年份分组
  const yearGroups = useMemo(() => {
    const map = new Map<number, WeekData[]>()
    weeks.forEach(w => {
      const y = w.year || new Date(w.week_start).getFullYear()
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(w)
    })
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0])
  }, [weeks])

  const weeklyYearGroups = useMemo(() => {
    const map = new Map<number, WeekData[]>()
    weeklyData.forEach(w => {
      const y = w.year || new Date(w.week_start).getFullYear()
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(w)
    })
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0])
  }, [weeklyData])

  const openDetail = async (id: number) => {
    setModalDetail(null)
    setModalLoading(true)
    try {
      const res = await fetch(`/api/v1/reports/${id}`)
      const data = await res.json()
      setModalDetail(data as ReportDetail)
    } finally { setModalLoading(false) }
  }

  const toggleMember = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const saveEditedSummary = async (weekStart: string, status: 'draft' | 'submitted' = 'draft') => {
    setSavingSummary(true)
    try {
      const res = await fetch(`/api/v1/reports/weekly-summary/${weekStart}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary_text: editText, status }),
      })
      if (!res.ok) { const e = await res.json(); showToast(e.detail || '保存失败', 'error'); return }
      setWeeklyData(prev => prev.map(w =>
        w.week_start === weekStart ? { ...w, weekly_summary: editText, weekly_summary_status: status } : w
      ))
      setEditingSummary(null)
      setEditText('')
      setEditInitial('')
      showToast(status === 'submitted' ? '周报已提交' : '草稿已保存', 'success')
    } catch { showToast('保存失败', 'error') }
    finally { setSavingSummary(false) }
  }

  const handleAiWeeklySummary = async (weekStart: string, weekEnd: string) => {
    setAiSummarizing(weekStart)
    try {
      const res = await fetch('/api/v1/reports/weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: weekStart, week_end: weekEnd, user_id: weeklyMember }),
      })
      const data = await res.json()
      const summary = data.summary_text || 'AI 总结生成失败'
      setWeeklyData(prev => prev.map(w =>
        w.week_start === weekStart ? { ...w, weekly_summary: summary } : w
      ))
      setExpandedWeeklySummaries(prev => { const n = new Set(prev); n.add(weekStart); return n })
    } catch {
      showToast('AI 总结失败', 'error')
    } finally { setAiSummarizing(null) }
  }

  const selectedMember = memberList.find(m => m.id === weeklyMember)

  return (
    <div>
      <PageHeader
        icon={UsersRound}
        title="团队管理"
        description="查看团队成员已提交的日报与周报"
        tone="purple"
        stats={[{ label: '团队成员', value: memberList.length }]}
        right={
          <div className="flex items-center gap-2">
            {/* Tab 切换 */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-hover border border-border">
              <button
                onClick={() => setTab('daily')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'daily' ? 'bg-bg-card text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >日报</button>
              <button
                onClick={() => setTab('weekly')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'weekly' ? 'bg-bg-card text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >周报</button>
            </div>
          </div>
        }
      />

      {memberList.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="暂无下属团队成员"
          description="您目前没有可查看的下属成员，请联系管理员设置部门与人员层级"
          tone="purple"
        />
      ) : (
        <>
          {/* 日报 Tab */}
          {tab === 'daily' && (
            <div>
              {/* 成员筛选 */}
              <div className="mb-5 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">查看成员：</span>
                <div className="relative">
                  <button
                    onClick={() => setMemberOpen(p => !p)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card border border-border text-xs text-gray-300 hover:border-[#8B5CF6]/50 transition-colors"
                  >
                    {selectedIds.length === 0
                      ? '全部成员'
                      : `已选 ${selectedIds.length} 人`}
                    <ChevronDown size={12} className="text-gray-500" />
                  </button>
                  {memberOpen && (
                    <div className="absolute top-full left-0 mt-1 z-20 w-48 rounded-xl bg-bg-card border border-border shadow-xl overflow-hidden">
                      <div className="p-1.5 max-h-60 overflow-y-auto">
                        <button
                          onClick={() => { setSelectedIds([]); setMemberOpen(false) }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-bg-hover text-xs text-gray-300 transition-colors"
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selectedIds.length === 0 ? 'bg-[#8B5CF6] border-[#8B5CF6]' : 'border-gray-600'}`}>
                            {selectedIds.length === 0 && <Check size={9} className="text-white" />}
                          </span>
                          全部成员
                        </button>
                        {memberList.map(m => (
                          <button
                            key={m.id}
                            onClick={() => toggleMember(m.id)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-bg-hover text-xs text-gray-300 transition-colors"
                          >
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selectedIds.includes(m.id) ? 'bg-[#8B5CF6] border-[#8B5CF6]' : 'border-gray-600'}`}>
                              {selectedIds.includes(m.id) && <Check size={9} className="text-white" />}
                            </span>
                            <span className="truncate">{m.name || m.username}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {selectedIds.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {selectedIds.map(id => {
                      const m = memberList.find(x => x.id === id)
                      return m ? (
                        <span key={id} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#A78BFA] text-[11px] border border-[#8B5CF6]/20">
                          {m.name || m.username}
                          <button onClick={() => toggleMember(id)} className="hover:text-white"><X size={9} /></button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}
              </div>

              {loading ? (
                <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
              ) : weeks.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="暂无已提交日报"
                  description="成员尚未提交日报，或您无权查看该成员的数据"
                  tone="purple"
                />
              ) : (
                <div className="space-y-4">
                  {yearGroups.map(([year, yearWeeks]) => {
                    const total = yearWeeks.reduce((s, w) => s + w.report_count, 0)
                    return (
                      <div key={year}>
                        <button
                          onClick={() => setExpandedYears(prev => { const n = new Set(prev); n.has(year) ? n.delete(year) : n.add(year); return n })}
                          className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-bg-hover-secondary/50 transition-colors text-left group w-full"
                        >
                          {expandedYears.has(year) ? <ChevronDown size={18} className="text-gray-500" /> : <ChevronRight size={18} className="text-gray-500" />}
                          <span className="text-lg font-bold text-white">{year}</span>
                          <span className="text-xs text-gray-600 bg-bg-hover px-2 py-0.5 rounded-full">{yearWeeks.length} 周 · {total} 篇</span>
                        </button>

                        {expandedYears.has(year) && (
                          <div className="ml-2 space-y-3 mt-1">
                            {yearWeeks.map(week => {
                              const isExp = expandedWeeks.has(week.week_start)
                              return (
                                <div key={week.week_start} className="rounded-xl bg-bg-card border border-border overflow-hidden">
                                  <button
                                    onClick={() => setExpandedWeeks(prev => { const n = new Set(prev); n.has(week.week_start) ? n.delete(week.week_start) : n.add(week.week_start); return n })}
                                    className="w-full flex items-center gap-3 px-5 max-md:px-3 py-3.5 hover:bg-bg-hover-secondary/50 transition-colors text-left"
                                  >
                                    {isExp ? <ChevronDown size={15} className="text-gray-500 shrink-0" /> : <ChevronRight size={15} className="text-gray-500 shrink-0" />}
                                    <Calendar size={14} className="text-gray-500 shrink-0" />
                                    <span className="text-sm font-medium text-white flex-1">{formatWeekRange(week.week_start, week.week_end)}</span>
                                    <span className="text-[11px] text-gray-500 bg-bg-hover px-1.5 py-0.5 rounded-full shrink-0">{week.report_count} 篇</span>
                                    {week.member_names && week.member_names.length > 0 && (
                                      <span className="text-[11px] text-gray-500 shrink-0">
                                        {week.member_names.slice(0, 3).join('、')}{week.member_names.length > 3 ? ' 等' : ''}
                                      </span>
                                    )}
                                  </button>

                                  {isExp && week.reports.length > 0 && (
                                    <div className="border-t border-border divide-y divide-border/40">
                                      {week.reports.map(r => {
                                        const d = new Date(r.date)
                                        return (
                                          <button
                                            key={r.id}
                                            onClick={() => openDetail(r.id)}
                                            className="w-full flex items-center gap-3 px-5 max-md:px-3 py-2.5 hover:bg-bg-hover-secondary/50 transition-colors text-left"
                                          >
                                            <FileText size={12} className="text-gray-600 shrink-0" />
                                            <div className="flex flex-col items-center w-10 shrink-0">
                                              <span className="text-sm font-bold text-gray-300">{d.getDate()}</span>
                                              <span className="text-[11px] text-gray-500">{WEEKDAY_NAMES[d.getDay()]}</span>
                                            </div>
                                            <span className="w-px self-stretch bg-border/60 shrink-0" />
                                            {r.user_name && (
                                              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#A78BFA] border border-[#8B5CF6]/15 shrink-0 font-medium">{r.user_name}</span>
                                            )}
                                            <p className="flex-1 min-w-0 text-xs text-gray-400 line-clamp-1 leading-relaxed">
                                              {r.snippet || r.title || '日报记录'}
                                            </p>
                                            <ChevronRight size={13} className="text-gray-600 shrink-0" />
                                          </button>
                                        )
                                      })}
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
            </div>
          )}

          {/* 周报 Tab */}
          {tab === 'weekly' && (
            <div>
              {/* 成员选择（单选） */}
              <div className="mb-5 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">查看成员：</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {memberList.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setWeeklyMember(m.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                        weeklyMember === m.id
                          ? 'bg-[#8B5CF6]/15 text-[#A78BFA] border-[#8B5CF6]/30'
                          : 'bg-bg-hover text-gray-500 border-border hover:text-gray-300'
                      }`}
                    >
                      {m.name || m.username}
                    </button>
                  ))}
                </div>
              </div>

              {weeklyLoading ? (
                <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
              ) : weeklyData.length === 0 ? (
                <EmptyState
                  icon={Calendar}
                  title="暂无周报数据"
                  description={selectedMember ? `${selectedMember.name || selectedMember.username} 尚未提交周报` : '请选择成员查看周报'}
                  tone="purple"
                />
              ) : (
                <div className="space-y-4">
                  {weeklyYearGroups.map(([year, yearWeeks]) => (
                    <div key={year}>
                      <button
                        onClick={() => setExpandedWeeklyYears(prev => { const n = new Set(prev); n.has(year) ? n.delete(year) : n.add(year); return n })}
                        className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-bg-hover-secondary/50 transition-colors text-left group w-full"
                      >
                        {expandedWeeklyYears.has(year) ? <ChevronDown size={18} className="text-gray-500" /> : <ChevronRight size={18} className="text-gray-500" />}
                        <span className="text-lg font-bold text-white">{year}</span>
                        <span className="text-xs text-gray-600 bg-bg-hover px-2 py-0.5 rounded-full">{yearWeeks.length} 周</span>
                      </button>

                      {expandedWeeklyYears.has(year) && (
                        <div className="ml-2 space-y-3 mt-1">
                          {yearWeeks.map(week => {
                            const hasSummary = !!week.weekly_summary
                            const isSubmitted = week.weekly_summary_status === 'submitted'
                            const isSummarizing = aiSummarizing === week.week_start
                            const isExpSummary = expandedWeeklySummaries.has(week.week_start)

                            return (
                              <div key={week.week_start} className="rounded-xl bg-bg-card border border-border overflow-hidden">
                                {/* 周标题 */}
                                <div className="flex items-center gap-3 px-5 max-md:px-3 py-3.5">
                                  <Calendar size={14} className="text-gray-500 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-medium text-white">{formatWeekRange(week.week_start, week.week_end)}</span>
                                      <span className="text-[11px] text-gray-500 bg-bg-hover px-1.5 py-0.5 rounded-full">{week.report_count} 篇日报</span>
                                      {isSubmitted ? (
                                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/15">已提交</span>
                                      ) : hasSummary ? (
                                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-bold border border-amber-500/15">草稿</span>
                                      ) : (
                                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-500/10 text-gray-400 border border-gray-500/15">待总结</span>
                                      )}
                                    </div>
                                  </div>
                                  {/* 操作按钮 */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {!isSubmitted && !hasSummary && (
                                      <button
                                        onClick={() => { setEditingSummary(week.week_start); setEditText(''); setEditInitial(''); setExpandedWeeklySummaries(prev => { const n = new Set(prev); n.add(week.week_start); return n }) }}
                                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-bg-hover text-gray-400 hover:text-white border border-border transition-colors"
                                      >
                                        <Edit3 size={10} />写周报
                                      </button>
                                    )}
                                    {!isSubmitted && (
                                      <button
                                        onClick={() => handleAiWeeklySummary(week.week_start, week.week_end)}
                                        disabled={isSummarizing}
                                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-bg-hover text-gray-400 hover:text-[#8B5CF6] border border-border transition-colors disabled:opacity-50"
                                      >
                                        {isSummarizing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                        AI 总结
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* 周报总结内容 */}
                                {(hasSummary || isSummarizing) && (
                                  <div className="border-t border-border px-5 max-md:px-3 pt-3 pb-3">
                                    <div className="rounded-xl bg-gradient-to-br from-[#8B5CF6]/10 via-bg-card to-[#3B82F6]/10 border border-[#8B5CF6]/20 overflow-hidden">
                                      <div className="flex items-center">
                                        <button
                                          onClick={() => setExpandedWeeklySummaries(prev => { const n = new Set(prev); n.has(week.week_start) ? n.delete(week.week_start) : n.add(week.week_start); return n })}
                                          className="flex items-center gap-2 px-4 py-2.5 hover:bg-[#8B5CF6]/5 transition-colors text-left flex-1 min-w-0"
                                        >
                                          <Sparkles size={13} className="text-[#8B5CF6]" />
                                          <span className="text-xs font-medium text-[#A78BFA]">周报总结</span>
                                          <span className="flex-1" />
                                          {isExpSummary ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                                        </button>
                                        {!isSubmitted && hasSummary && (
                                          <button
                                            onClick={() => { setEditingSummary(week.week_start); setEditText(week.weekly_summary); setEditInitial(week.weekly_summary); setExpandedWeeklySummaries(prev => { const n = new Set(prev); n.add(week.week_start); return n }) }}
                                            className="px-2.5 py-1.5 mr-1 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border flex items-center gap-1"
                                          >
                                            <Edit3 size={11} />编辑
                                          </button>
                                        )}
                                        {hasSummary && !isSubmitted && (
                                          <button
                                            onClick={async () => {
                                              const res = await fetch(`/api/v1/reports/weekly-summary/${week.week_start}`, {
                                                method: 'PUT',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ status: 'submitted' }),
                                              })
                                              if (res.ok) { showToast('周报已提交', 'success'); loadWeeklyData() }
                                              else { const e = await res.json().catch(() => ({})); showToast(e.detail || '提交失败', 'error') }
                                            }}
                                            className="px-2.5 py-1.5 mr-2 rounded-lg bg-accent-blue text-[#fff] text-xs font-medium hover:bg-blue-600 flex items-center gap-1"
                                          >
                                            <Send size={11} />提交
                                          </button>
                                        )}
                                      </div>

                                      {isExpSummary && (
                                        editingSummary === week.week_start ? (
                                          <div className="px-4 py-3 border-t border-[#8B5CF6]/10">
                                            <RichTextEditor
                                              value={editText}
                                              onChange={setEditText}
                                              placeholder="编写周报总结…"
                                              className="min-h-[180px]"
                                            />
                                            <div className="flex items-center gap-2 mt-2">
                                              <button
                                                onClick={() => saveEditedSummary(week.week_start, 'draft')}
                                                disabled={savingSummary}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border disabled:opacity-50"
                                              >
                                                {savingSummary ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                                保存草稿
                                              </button>
                                              <button
                                                onClick={() => saveEditedSummary(week.week_start, 'submitted')}
                                                disabled={savingSummary}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-[#fff] text-xs font-medium hover:bg-blue-600 disabled:opacity-50"
                                              >
                                                {savingSummary ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                                提交
                                              </button>
                                              <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">取消</button>
                                            </div>
                                          </div>
                                        ) : (
                                          isSummarizing ? (
                                            <div className="px-4 py-3 border-t border-[#8B5CF6]/10 flex items-center gap-2">
                                              <Loader2 size={13} className="animate-spin text-[#8B5CF6]" />
                                              <span className="text-sm text-[#A78BFA]">正在生成 AI 总结…</span>
                                            </div>
                                          ) : (
                                            <div className="px-4 py-3 border-t border-[#8B5CF6]/10 text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none">
                                              <MarkdownRenderer content={week.weekly_summary} />
                                            </div>
                                          )
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 日报详情弹窗（只读） */}
      {modalDetail && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[10vh] pb-10 overflow-y-auto" onClick={() => setModalDetail(null)}>
          <div className="w-full max-w-3xl mx-4 rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-bg-card/95 backdrop-blur-sm rounded-t-2xl">
              <h3 className="text-lg font-bold text-white">
                {new Date(modalDetail.report_date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
              </h3>
              <button onClick={() => setModalDetail(null)} className="p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors">
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

      {EditUnsavedDialog}
    </div>
  )
}
