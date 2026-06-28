import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, X, Trash2, Loader2, ChevronDown, ChevronRight, Upload, Mic, MicOff, Maximize2, Minimize2, Send, FileText, List, LayoutGrid } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useUnsavedGuard } from '../hooks/useUnsavedGuard'
import SearchableSelect from '../components/SearchableSelect'
import MarkdownRenderer from '../components/MarkdownRenderer'
import FileUpload from '../components/FileUpload'
import RichTextEditor from '../components/RichTextEditor'
import { PageHeader, EmptyState } from '../components/design-system'

interface ReportCard {
  id: number; date: string; title: string; snippet: string; status?: string
}

interface WeekGroup {
  week_start: string; reports: ReportCard[]
}

interface MonthGroup {
  month: number; weeks: WeekGroup[]
}

interface YearGroup {
  year: number; months: MonthGroup[]
}

interface ReportDetail {
  id: number; user_id: number; report_date: string; content_md: string
  files_json?: string | null
  status: string
}

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export default function ReportsPage() {
  const { hasPermission, user: currentUser } = useAuth()
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [grouped, setGrouped] = useState<YearGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [layout, setLayout] = useState<'list' | 'grid'>(() => (localStorage.getItem('worktrack_reports_layout') as 'list' | 'grid') || 'list')

  const setLayoutPref = (mode: 'list' | 'grid') => {
    setLayout(mode)
    try { localStorage.setItem('worktrack_reports_layout', mode) } catch { /* noop */ }
  }
  
  const [editingReport, setEditingReport] = useState<ReportDetail | null>(null)
  const [formContent, setFormContent] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formFiles, setFormFiles] = useState<string | null>(null)
  // 表单初始快照
  const [formInitial, setFormInitial] = useState<string>('')
  const isDirty = showForm && JSON.stringify({ c: formContent, d: formDate, f: formFiles }) !== formInitial
  const { requestClose, Dialog: UnsavedDialog } = useUnsavedGuard(isDirty)
  const [saving, setSaving] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  // 文件上传
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 语音录制
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')

  // 恢复上次选择的麦克风
  useEffect(() => {
    const saved = localStorage.getItem('worktrack_preferred_mic')
    if (saved) setSelectedDeviceId(saved)
  }, [])

  const enumerateAudioDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId)
      setAudioDevices(inputs)
      if (inputs.length > 0 && !selectedDeviceId) {
        const hasLabels = inputs.some(d => d.label !== '')
        if (hasLabels) {
          const builtIn = inputs.find(d => d.label.includes('MacBook') || d.label.includes('Mac'))
          const notPhone = inputs.find(d => !d.label.toLowerCase().includes('iphone'))
          const preferred = builtIn || notPhone || inputs[0]
          updateDevicePreference(preferred.deviceId)
        } else {
          updateDevicePreference(inputs[0].deviceId)
        }
      }
    } catch { /* 静默 */ }
  }

  const updateDevicePreference = (deviceId: string) => {
    setSelectedDeviceId(deviceId)
    try { localStorage.setItem('worktrack_preferred_mic', deviceId) } catch { /* noop */ }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/v1/reports/upload-file', { method: 'POST', body: fd })
      if (!res.ok) { const err = await res.json(); showToast(err.detail || '上传失败', 'error'); return }
      const data = await res.json()
      const prefix = formContent ? formContent + '\n\n' : ''
      setFormContent(prefix + data.text)
      showToast('文件内容已提取', 'success')
    } catch { showToast('上传失败', 'error') }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop()
      setRecording(false)
      return
    }
    try {
      // 先枚举设备（不触发 getUserMedia，避免唤醒 iPhone）
      await enumerateAudioDevices()
      let deviceId = selectedDeviceId
      if (!deviceId && audioDevices.length > 0) {
        deviceId = audioDevices[0].deviceId
        updateDevicePreference(deviceId)
      }
      // 始终指定具体设备，绝不使用无约束的 { audio: true }
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      // 获取流后刷新设备标签
      if (deviceId) {
        try { localStorage.setItem('worktrack_preferred_mic', deviceId) } catch { /* noop */ }
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const fd = new FormData(); fd.append('file', blob, 'recording.webm')
        try {
          const res = await fetch('/api/v1/reports/transcribe-audio', { method: 'POST', body: fd })
          if (!res.ok) { const err = await res.json(); showToast(err.detail || '转写失败', 'error'); return }
          const data = await res.json()
          if (data.success && data.text) {
            const prefix = formContent ? formContent + '\n\n' : ''
            setFormContent(prefix + data.text)
            showToast('语音已转写为文字', 'success')
          } else { showToast(data.message || '转写失败', 'error') }
        } catch { showToast('转写请求失败', 'error') }
      }
      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setRecording(true)
    } catch { showToast('无法访问麦克风，请检查浏览器权限', 'error') }
  }

  // 折叠：year
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set())
  // 弹窗详情
  const [modalDetail, setModalDetail] = useState<ReportDetail | null>(null)
  const [modalLoading, setModalLoading] = useState(false)

  const loadReports = useCallback(() => {
    setLoading(true)
    fetch('/api/v1/reports/grouped')
      .then((res) => res.json())
      .then((data) => {
        setGrouped(data.grouped || [])
        setTotal(data.total || 0)
        setLoading(false)
        // 自动展开当前年份
        if (data.grouped?.length > 0) {
          const currentYear = new Date().getFullYear()
          const years = data.grouped.map((g: { year: number }) => g.year)
          const target = years.includes(currentYear) ? currentYear : data.grouped[0].year
          setExpandedYears(new Set([target]))
        }
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadReports() }, [loadReports])

  const openDetail = async (id: number) => {
    setModalLoading(true)
    try {
      const res = await fetch(`/api/v1/reports/${id}`)
      const data = await res.json()
      setModalDetail(data)
    } catch { /* ignore */ }
    finally { setModalLoading(false) }
  }

  const closeDetail = () => setModalDetail(null)

  const openCreate = () => {
    setEditingReport(null)
    setFormContent('')
    setFormFiles(null)
    setFormDate(new Date().toISOString().slice(0, 10))
    setFormInitial(JSON.stringify({ c: '', d: new Date().toISOString().slice(0, 10), f: null }))
    setShowForm(true)
  }

  const openEdit = (report: ReportDetail) => {
    setEditingReport(report)
    setFormContent(report.content_md)
    setFormFiles(report.files_json || null)
    setFormDate(report.report_date?.slice(0, 10) || '')
    setFormInitial(JSON.stringify({ c: report.content_md, d: report.report_date?.slice(0, 10) || '', f: report.files_json || null }))
    setShowForm(true)
  }

  // === 安全关闭 ===
  const safeClose = async () => {
    if (await requestClose()) {
      setShowForm(false)
      setIsMaximized(false)
    }
  }

  const handleSave = async (statusVal: 'draft' | 'submitted') => {
    if (!formContent.trim()) return
    setSaving(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const base = { content_md: formContent, report_date: formDate || undefined, files_json: formFiles || undefined, status: statusVal }
      let res: Response
      if (editingReport) {
        res = await fetch(`/api/v1/reports/${editingReport.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(base),
        })
      } else {
        res = await fetch('/api/v1/reports', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...base, status: statusVal, report_date: formDate || today }),
        })
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '保存失败', 'error')
        return
      }
      setShowForm(false)
      loadReports()
      if (modalDetail) openDetail(modalDetail.id)
      showToast(statusVal === 'submitted' ? '日报已提交发布给上级领导' : '日报草稿已保存', 'success')
    } catch {
      showToast('保存请求失败，请检查网络', 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!await showConfirm('确定删除这条日报？')) return
    await fetch(`/api/v1/reports/${id}`, { method: 'DELETE' })
    if (modalDetail?.id === id) setModalDetail(null)
    loadReports()
    showToast('日报已删除', 'success')
  }

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year); else next.add(year)
      return next
    })
  }

  return (
    <div>
      {/* 头部 */}
      <PageHeader
        icon={FileText}
        title="日报"
        description="记录每日工作、回顾成长轨迹"
        tone="cyan"
        stats={[{ label: '记录', value: total }]}
        right={
          <>
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-hover border border-border shrink-0">
              <button
                onClick={() => setLayoutPref('list')}
                title="列表视图"
                className={`p-1.5 rounded-md transition-colors ${layout === 'list' ? 'bg-bg-card text-[#3B82F6] shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <List size={15} strokeWidth={2.2} />
              </button>
              <button
                onClick={() => setLayoutPref('grid')}
                title="卡片视图"
                className={`p-1.5 rounded-md transition-colors ${layout === 'grid' ? 'bg-bg-card text-[#3B82F6] shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <LayoutGrid size={15} strokeWidth={2.2} />
              </button>
            </div>
            {hasPermission('report:create') && (
              <button onClick={openCreate} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent-blue text-[#fff] text-xs font-bold hover:bg-accent-blue/85 hover:shadow-lg hover:shadow-accent-blue/30 transition-all cursor-pointer shrink-0">
                <Plus size={14} strokeWidth={2.5} /><span>写日报</span>
              </button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="暂无日报记录"
          description="写下第一篇日报，开启你的成长轨迹记录"
          actionLabel="写第一篇日报"
          onAction={openCreate}
          tone="cyan"
          className="mb-8"
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((yearGroup) => (
            <div key={yearGroup.year}>
              {/* 年份标题 */}
              <button
                onClick={() => toggleYear(yearGroup.year)}
                className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-bg-hover-secondary/50 transition-colors text-left group w-full"
              >
                {expandedYears.has(yearGroup.year) ? <ChevronDown size={18} className="text-gray-500 group-hover:text-gray-300" /> : <ChevronRight size={18} className="text-gray-500 group-hover:text-gray-300" />}
                <span className="text-lg font-bold text-white">{yearGroup.year}</span>
                <span className="text-xs text-gray-600 bg-bg-hover px-2 py-0.5 rounded-full">
                  {yearGroup.months.reduce((s, m) => s + m.weeks.reduce((ws, w) => ws + w.reports.length, 0), 0)} 条
                </span>
              </button>

              {expandedYears.has(yearGroup.year) && (
                <div className="ml-2 space-y-5 mt-2">
                  {yearGroup.months.map((monthGroup) => {
                    const allCards = monthGroup.weeks.flatMap((w) => w.reports)
                    const monthTotal = allCards.length
                    const keyPrefix = `${yearGroup.year}-${monthGroup.month}`
                    return (
                      <div key={keyPrefix}>
                        <div className="flex items-center gap-3 px-2 mb-3">
                          <span className="w-1.5 h-5 rounded-full bg-gradient-to-b from-[#3B82F6] to-[#8B5CF6]" />
                          <h3 className="text-base font-semibold text-gray-300">{MONTH_NAMES[monthGroup.month - 1]}</h3>
                          <span className="text-xs text-gray-600">{monthTotal} 条</span>
                        </div>
                        {/* 统一大小卡片网格 */}
                        {layout === 'grid' ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {allCards.map((r) => {
                            const d = new Date(r.date)
                            return (
                              <button
                                key={r.id}
                                onClick={() => openDetail(r.id)}
                                className="group/card relative w-full text-left rounded-xl bg-bg-card border border-border/60 hover:border-[#3B82F6]/50 hover:shadow-md hover:shadow-[#3B82F6]/5 transition-all duration-200 flex flex-col overflow-hidden min-h-[120px]"
                                style={{ borderTopWidth: '3px', borderTopColor: '#3B82F660' }}
                              >
                                <div className="p-3 flex-1 flex flex-col">
                                  <div className="flex items-center justify-between mb-1.5 shrink-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] font-medium text-gray-500 tracking-wide">
                                        {d.getMonth() + 1}/{d.getDate()} · {WEEKDAY_NAMES[d.getDay()]}
                                      </span>
                                      {r.status === 'draft' ? (
                                        <span className="text-[11px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-500 font-bold border border-amber-500/15">草稿</span>
                                      ) : (
                                        <span className="text-[11px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/15">已提交</span>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-[11px] text-gray-400 dark:text-gray-300 line-clamp-3 leading-relaxed flex-1">
                                    {r.snippet || r.title || '点击查看详情'}
                                  </p>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                        ) : (
                        <div className="rounded-xl bg-bg-card border border-border/60 overflow-hidden divide-y divide-border/50">
                          {allCards.map((r) => {
                            const d = new Date(r.date)
                            return (
                              <button
                                key={r.id}
                                onClick={() => openDetail(r.id)}
                                className="group/row w-full text-left flex items-center gap-3 px-3 md:px-4 py-2.5 hover:bg-bg-hover-secondary/60 transition-colors"
                              >
                                <div className="flex flex-col items-center justify-center w-11 shrink-0 leading-none">
                                  <span className="text-base font-bold text-gray-300 tabular-nums">{d.getDate()}</span>
                                  <span className="text-[11px] text-gray-500 mt-0.5">{WEEKDAY_NAMES[d.getDay()]}</span>
                                </div>
                                <span className="w-px self-stretch bg-border/60 shrink-0" />
                                <p className="flex-1 min-w-0 text-xs leading-relaxed line-clamp-1 text-gray-400 dark:text-gray-300">
                                  {r.snippet || r.title || '点击查看详情'}
                                </p>
                                {r.status === 'draft' ? (
                                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-bold border border-amber-500/15 shrink-0">草稿</span>
                                ) : (
                                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/15 shrink-0">已提交</span>
                                )}
                                <ChevronRight size={14} className="text-gray-600 group-hover/row:text-gray-400 shrink-0 transition-colors" />
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
          ))}
        </div>
      )}

      {/* 全屏详情弹窗 */}
      {modalDetail && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center md:pt-[10vh] md:pb-10 overflow-y-auto" onClick={closeDetail}>
          <div className="w-full max-w-3xl md:mx-4 md:rounded-2xl bg-bg-card border border-border shadow-2xl min-h-screen md:min-h-0" onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 md:px-6 py-3 md:py-4 border-b border-border bg-bg-card/95 backdrop-blur-sm md:rounded-t-2xl">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {new Date(modalDetail.report_date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {modalDetail.status === 'draft' && modalDetail.user_id === currentUser?.id && (
                  <button
                    onClick={async () => {
                      if (!await showConfirm('确认将该篇日报提交发布给上级领导吗？')) return
                      const res = await fetch(`/api/v1/reports/${modalDetail.id}`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'submitted' }),
                      })
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}))
                        showToast(err.detail || '提交失败', 'error')
                        return
                      }
                      showToast('日报已成功提交给主管审查！', 'success')
                      closeDetail()
                      loadReports()
                    }}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent-blue text-[#fff] hover:bg-blue-600 transition-colors border border-transparent shadow-sm font-bold cursor-pointer"
                  >
                    <Send size={11} /> 提交上级
                  </button>
                )}
                {/* 已提交的日报仅管理员可编辑/删除；草稿状态本人或有权限的用户可操作 */}
                {modalDetail.status === 'submitted' ? (
                  currentUser?.is_admin && (
                    <>
                      <button onClick={() => { closeDetail(); openEdit(modalDetail) }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white transition-colors border border-border">编辑</button>
                      <button onClick={() => handleDelete(modalDetail.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border border-border"><Trash2 size={13} /></button>
                    </>
                  )
                ) : (
                  <>
                    {(modalDetail.user_id === currentUser?.id || hasPermission('report:edit')) && (
                      <button onClick={() => { closeDetail(); openEdit(modalDetail) }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white transition-colors border border-border">编辑</button>
                    )}
                    {(modalDetail.user_id === currentUser?.id || hasPermission('report:delete')) && (
                      <button onClick={() => handleDelete(modalDetail.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border border-border"><Trash2 size={13} /></button>
                    )}
                  </>
                )}
                <button onClick={closeDetail} className="ml-2 p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
              </div>
            </div>

            {/* 内容 */}
            <div className="p-4 md:p-6">
              {modalLoading ? (
                <div className="text-center py-12"><Loader2 size={20} className="mx-auto animate-spin text-gray-500" /></div>
              ) : (
                <>
                  <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed max-w-none">
                    <MarkdownRenderer content={modalDetail.content_md} />
                  </div>
                  {modalDetail.files_json && (() => {
                    try {
                      const files = JSON.parse(modalDetail.files_json)
                      return Array.isArray(files) && files.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {files.map((f: any, idx: number) => (
                            <a key={idx} href={f.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-hover border border-border text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
                              {f.type?.startsWith('image/') ? (
                                <img src={f.url} alt={f.name} className="w-5 h-5 rounded object-cover" />
                              ) : null}
                              {f.name}
                            </a>
                          ))}
                        </div>
                      )
                    } catch { return null }
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      {showForm && (
        <div className={`fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm`} onClick={safeClose}>
          <div className={`w-full md:mx-4 p-4 md:p-6 md:rounded-2xl bg-bg-card border border-border shadow-2xl flex flex-col rounded-t-2xl md:rounded-t-2xl ${
            isMaximized 
              ? 'md:max-w-5xl md:h-[calc(100vh-2rem)] md:max-h-[900px] h-[95dvh]' 
              : 'md:max-w-2xl md:max-h-[90vh] max-h-[85dvh]'
          }`} onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-lg font-bold text-white">{editingReport ? '编辑日报' : '写日报'}</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setIsMaximized(!isMaximized)} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors">
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button onClick={safeClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>
            </div>

            {/* 表单内容 - 可滚动 */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400 flex-shrink-0">日期</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                  />
                </div>
                <RichTextEditor
                  value={formContent}
                  onChange={(val) => setFormContent(val)}
                  placeholder="今天做了什么？支持富文本和 Markdown 格式..."
                  uploadFn={async (file: File) => {
                    const formData = new FormData()
                    formData.append('file', file)
                    const res = await fetch('/api/v1/files/upload', {
                      method: 'POST',
                      body: formData,
                    })
                    if (!res.ok) throw new Error('Upload failed')
                    const uploaded = await res.json() as { url: string }
                    return uploaded.url
                  }}
                  className={isMaximized ? 'min-h-[400px]' : 'min-h-[280px]'}
                />
                <FileUpload filesJson={formFiles} onChange={setFormFiles} />
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-border shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.md,.markdown,.docx" onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border disabled:opacity-50">
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={13} />}
                  {uploading ? '提取中...' : '上传文件'}
                </button>
                {audioDevices.length > 1 && !recording && (
                  <SearchableSelect
                    options={audioDevices.map((d) => ({ value: d.deviceId, label: d.label || `麦克风 ${d.deviceId.slice(0, 8)}` }))}
                    value={selectedDeviceId}
                    onChange={(v) => updateDevicePreference(v === null ? '' : String(v))}
                  />
                )}
                <button onClick={toggleRecording}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    recording 
                      ? 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse' 
                      : 'bg-bg-hover text-gray-400 hover:text-white border-border'
                  }`}>
                  {recording ? <MicOff size={13} /> : <Mic size={13} />}
                  {recording ? '停止录音' : '语音录入'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => handleSave('draft')} disabled={saving || !formContent.trim()}
                  className="px-4 py-2.5 rounded-xl bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : '💾 保存草稿'}
                </button>
                <button onClick={() => handleSave('submitted')} disabled={saving || !formContent.trim()}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-accent-blue text-[#fff] text-xs font-bold hover:bg-blue-600 disabled:opacity-50 transition-all cursor-pointer shadow-sm">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Send size={12} />}
                  <span>提交上级</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 未保存修改确认弹窗 */}
      {UnsavedDialog}
    </div>
  )
}
