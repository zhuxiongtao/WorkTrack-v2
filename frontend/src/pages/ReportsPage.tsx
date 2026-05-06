import { useState, useEffect, useRef } from 'react'
import { Plus, X, Trash2, Loader2, Sparkles, Calendar, ChevronDown, ChevronRight, Upload, Mic, MicOff, Maximize2, Minimize2 } from 'lucide-react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import FileUpload from '../components/FileUpload'
import RichTextEditor from '../components/RichTextEditor'
import { useToast } from '../contexts/ToastContext'

interface ReportCard {
  id: number; date: string; title: string; snippet: string; ai_summary: string; has_summary: boolean
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
  id: number; report_date: string; content_md: string; ai_summary: string | null
  files_json?: string | null
}

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export default function ReportsPage() {
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [grouped, setGrouped] = useState<YearGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingReport, setEditingReport] = useState<ReportDetail | null>(null)
  const [formContent, setFormContent] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formFiles, setFormFiles] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState<number | null>(null)
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

  const loadReports = () => {
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
  }

  useEffect(() => { loadReports() }, [])

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
    setShowForm(true)
  }

  const openEdit = (report: ReportDetail) => {
    setEditingReport(report)
    setFormContent(report.content_md)
    setFormFiles(report.files_json || null)
    setFormDate(report.report_date?.slice(0, 10) || '')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formContent.trim()) return
    setSaving(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const base = { content_md: formContent, report_date: formDate || undefined, files_json: formFiles || undefined }
      if (editingReport) {
        await fetch(`/api/v1/reports/${editingReport.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(base),
        })
      } else {
        await fetch('/api/v1/reports', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...base, report_date: formDate || today }),
        })
      }
      setShowForm(false)
      loadReports()
      if (modalDetail) openDetail(modalDetail.id)
      showToast(editingReport ? '日报已更新' : '日报保存成功', 'success')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!await showConfirm('确定删除这条日报？')) return
    await fetch(`/api/v1/reports/${id}`, { method: 'DELETE' })
    if (modalDetail?.id === id) setModalDetail(null)
    loadReports()
    showToast('日报已删除', 'success')
  }

  const handleAiSummarize = async (id: number) => {
    setAiLoading(id)
    try {
      await fetch(`/api/v1/reports/${id}/ai-summarize`, { method: 'POST' })
      loadReports()
      if (modalDetail?.id === id) openDetail(id)
    } finally { setAiLoading(null) }
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">日报</h2>
          <p className="text-sm text-gray-500 mt-1">{total} 条记录</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/85 transition-all shadow-lg shadow-accent-blue/20">
          <Plus size={17} /><span>写日报</span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20">
          <Calendar size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-3">暂无日报记录</p>
          <button onClick={openCreate} className="text-sm text-accent-blue hover:underline">写第一篇日报</button>
        </div>
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                          {allCards.map((r) => {
                            const d = new Date(r.date)
                            return (
                              <button
                                key={r.id}
                                onClick={() => openDetail(r.id)}
                                className="w-full text-left p-4 rounded-xl bg-bg-card border border-border hover:border-[#3B82F6]/60 hover:bg-bg-hover-secondary transition-all group/card h-36 flex flex-col"
                              >
                                <div className="flex items-center justify-between mb-2 shrink-0">
                                  <div className="flex items-center gap-1.5">
                                    <Calendar size={11} className="text-gray-500" />
                                    <span className="text-xs text-gray-400">
                                      {d.getMonth() + 1}/{d.getDate()} {WEEKDAY_NAMES[d.getDay()]}
                                    </span>
                                  </div>
                                  {r.has_summary && <Sparkles size={11} className="text-[#8B5CF6]" />}
                                </div>
                                {r.ai_summary ? (
                                  <p className="text-xs text-gray-300 line-clamp-4 leading-relaxed flex-1">{r.ai_summary}</p>
                                ) : (
                                  <p className="text-xs text-gray-600 line-clamp-4 leading-relaxed flex-1 italic">暂无 AI 摘要，点击查看详情</p>
                                )}
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
          ))}
        </div>
      )}

      {/* 全屏详情弹窗 */}
      {modalDetail && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[10vh] pb-10 overflow-y-auto" onClick={closeDetail}>
          <div className="w-full max-w-3xl mx-4 rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b border-border bg-bg-card/95 backdrop-blur-sm rounded-t-2xl">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {new Date(modalDetail.report_date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => handleAiSummarize(modalDetail.id)} disabled={aiLoading === modalDetail.id}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-[#8B5CF6] hover:bg-border transition-colors disabled:opacity-50 border border-border">
                  {aiLoading === modalDetail.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}AI 整理
                </button>
                <button onClick={() => { closeDetail(); openEdit(modalDetail) }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white transition-colors border border-border">编辑</button>
                <button onClick={() => handleDelete(modalDetail.id)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border border-border"><Trash2 size={13} /></button>
                <button onClick={closeDetail} className="ml-2 p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
              </div>
            </div>

            {/* 内容 */}
            <div className="p-6">
              {modalLoading ? (
                <div className="text-center py-12"><Loader2 size={20} className="mx-auto animate-spin text-gray-500" /></div>
              ) : (
                <>
                  <div className="text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none">
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
                  {modalDetail.ai_summary && (
                    <div className="mt-6 p-5 rounded-xl bg-gradient-to-br from-bg-hover to-bg-card border border-border">
                      <p className="text-xs text-gray-500 mb-2 flex items-center gap-2"><Sparkles size={13} className="text-[#8B5CF6]" />AI 摘要</p>
                      <div className="text-sm text-gray-300 leading-relaxed"><MarkdownRenderer content={modalDetail.ai_summary} /></div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      {showForm && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm ${isMaximized ? 'items-start pt-4 pb-4' : ''}`} onClick={() => { setShowForm(false); setIsMaximized(false) }}>
          <div className={`mx-4 p-6 rounded-2xl bg-bg-card border border-border shadow-2xl flex flex-col ${
            isMaximized 
              ? 'w-full max-w-5xl h-[calc(100vh-2rem)] max-h-[900px]' 
              : 'w-full max-w-2xl max-h-[90vh]'
          }`} onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-lg font-bold text-white">{editingReport ? '编辑日报' : '写日报'}</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setIsMaximized(!isMaximized)} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors">
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button onClick={() => { setShowForm(false); setIsMaximized(false) }} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
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
                    const token = localStorage.getItem('auth_token')
                    const res = await fetch('/api/v1/files/upload', {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
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
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border shrink-0">
              <div className="flex items-center gap-2">
                <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.md,.markdown,.docx" onChange={handleFileUpload} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border disabled:opacity-50">
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={13} />}
                  {uploading ? '提取中...' : '上传文件'}
                </button>
                {audioDevices.length > 1 && !recording && (
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => updateDevicePreference(e.target.value)}
                    className="px-2 py-1.5 rounded-lg bg-bg-hover border border-border text-[11px] text-gray-400 outline-none focus:border-[#3B82F6] max-w-[120px] truncate"
                  >
                    {audioDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `麦克风 ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
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
              <button onClick={handleSave} disabled={saving || !formContent.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/85 disabled:opacity-50 transition-all">
                {saving && <Loader2 size={15} className="animate-spin" />}{saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
