import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Sparkles, X, Trash2, Loader2, Calendar, Mic, Square, Play, Pause, FileText, FileAudio, Link2, Search, Building2, ExternalLink, Edit3, Maximize2, Minimize2 } from 'lucide-react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import SearchableSelect from '../components/SearchableSelect'
import FileUpload from '../components/FileUpload'
import RichTextEditor from '../components/RichTextEditor'
import { useToast } from '../contexts/ToastContext'

interface Meeting {
  id: number; title: string; meeting_date: string; content_md: string; audio_url: string | null; customer_id: number | null; project_id: number | null
  files_json?: string | null
  ai_summary?: string | null
}

interface ProjectBrief {
  id: number; name: string; customer_name: string; status: string
}

export default function MeetingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text')
  const [form, setForm] = useState({ title: '', content_md: '', project_id: 0, customer_id: 0, meeting_date: new Date().toISOString().slice(0, 16), files_json: null as string | null })
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState<number | null>(null)
  const [transcribingId, setTranscribingId] = useState<number | null>(null)
  const [organizingId, setOrganizingId] = useState<number | null>(null)
  const [searchText, setSearchText] = useState('')
  const [projects, setProjects] = useState<ProjectBrief[]>([])
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([])

  // 弹窗详情
  const [modalMeeting, setModalMeeting] = useState<Meeting | null>(null)
  const [linkedProject, setLinkedProject] = useState<ProjectBrief | null>(null)

  // 卡片悬停提示
  const [hoveredProjectId, setHoveredProjectId] = useState<number | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 录音状态
  const [recording, setRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const recordedBlobRef = useRef<Blob | null>(null) // 同步引用，避免 React 状态更新延迟导致 blob 丢失
  const [recordedUrl, setRecordedUrl] = useState<string>('')
  const [playing, setPlaying] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')

  const loadMeetings = () => {
    fetch('/api/v1/meetings')
      .then((res) => res.json())
      .then((data) => { setMeetings(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  const loadProjects = () => {
    fetch('/api/v1/projects')
      .then((res) => res.json())
      .then((data) => setProjects((data || []).map((p: { id: number; name: string; customer_name: string; status: string }) => ({
        id: p.id, name: p.name, customer_name: p.customer_name, status: p.status
      }))))
      .catch(() => {})
  }

  const loadCustomers = () => {
    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => setCustomers(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => {})
  }

  const loadLinkedProject = async (projectId: number | null) => {
    if (!projectId) { setLinkedProject(null); return }
    // 先从已加载的列表中查找
    const found = projects.find((p) => p.id === projectId)
    if (found) { setLinkedProject(found); return }
    // 否则单独请求
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`)
      if (res.ok) {
        const p = await res.json()
        setLinkedProject({ id: p.id, name: p.name, customer_name: p.customer_name, status: p.status })
      }
    } catch { setLinkedProject(null) }
  }

  const getProjectById = (pid: number | null): ProjectBrief | undefined => {
    if (!pid) return undefined
    return projects.find((p) => p.id === pid)
  }

  useEffect(() => { loadMeetings(); loadProjects(); loadCustomers() }, [])

  // 从 localStorage 恢复上次选择的麦克风设备
  useEffect(() => {
    const saved = localStorage.getItem('worktrack_preferred_mic')
    if (saved) setSelectedDeviceId(saved)
  }, [])

  // 从 URL 参数自动打开会议详情
  useEffect(() => {
    const meetingId = searchParams.get('meeting')
    if (meetingId && meetings.length > 0) {
      const m = meetings.find((x) => x.id === Number(meetingId))
      if (m) {
        openDetail(m)
        // 清除 URL 参数
        setSearchParams({}, { replace: true })
      }
    }
  }, [meetings, searchParams])

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
      if (audioRef.current) audioRef.current.pause()
    }
  }, [recordedUrl])

  // 切换到录音模式时枚举音频设备，优先选 Mac 内置麦克风
  useEffect(() => {
    if (inputMode === 'voice') {
      enumerateAudioDevices()
    }
  }, [inputMode])

  const enumerateAudioDevices = async () => {
    try {
      // 不调用 getUserMedia，直接枚举（避免无约束请求唤醒 iPhone）
      // 如果浏览器已保存麦克风权限，enumerateDevices 会返回带标签的设备
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId)
      setAudioDevices(inputs)

      if (inputs.length > 0 && !selectedDeviceId) {
        // 检查是否有标签（说明之前已授权）
        const hasLabels = inputs.some(d => d.label !== '')
        if (hasLabels) {
          // 优先 Mac 内置麦克风，排除 iPhone
          const builtIn = inputs.find(d =>
            d.label.includes('MacBook') || d.label.includes('Mac'))
          const notPhone = inputs.find(d => !d.label.toLowerCase().includes('iphone'))
          const preferred = builtIn || notPhone || inputs[0]
          updateDevicePreference(preferred.deviceId)
        } else {
          // 无标签时选第一个，录音后会刷新标签
          updateDevicePreference(inputs[0].deviceId)
        }
      }
    } catch {
      // 静默处理
    }
  }

  const updateDevicePreference = (deviceId: string) => {
    setSelectedDeviceId(deviceId)
    try { localStorage.setItem('worktrack_preferred_mic', deviceId) } catch { /* noop */ }
  }

  // 录音成功后刷新设备标签（此时已有权限，标签可见）
  const refreshDeviceLabels = () => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const inputs = devices.filter(d => d.kind === 'audioinput' && d.deviceId)
      if (inputs.some(d => d.label !== '')) {
        setAudioDevices(inputs)
      }
    }).catch(() => {})
  }

  // === 录音功能 ===
  const startRecording = async () => {
    try {
      // 如果还没有设备列表，先枚举（不触发 getUserMedia）
      if (audioDevices.length === 0) {
        await enumerateAudioDevices()
      }
      // 始终指定具体设备，绝不使用无约束的 { audio: true }
      let deviceId = selectedDeviceId
      if (!deviceId && audioDevices.length > 0) {
        deviceId = audioDevices[0].deviceId
        updateDevicePreference(deviceId)
      }
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      // 获取流后刷新设备标签（此时已有权限，标签可见），并记住当前设备
      refreshDeviceLabels()
      if (deviceId) {
        try { localStorage.setItem('worktrack_preferred_mic', deviceId) } catch { /* noop */ }
      }
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
      mediaRecorderRef.current = recorder
      chunksRef.current = []
      setRecordingTime(0)
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        recordedBlobRef.current = blob
        setRecordedBlob(blob)
        if (recordedUrl) URL.revokeObjectURL(recordedUrl)
        setRecordedUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach((t) => t.stop())
      }
      recorder.start()
      setRecording(true)
      setIsPaused(false)
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)
    } catch { showToast('无法访问麦克风，请检查浏览器权限', 'error') }
  }

  const stopRecording = (): Promise<void> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        setRecording(false)
        setIsPaused(false)
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined }
        resolve()
        return
      }
      // 包装 onstop，在录制停止后 resolve
      const origOnstop = recorder.onstop
      recorder.onstop = (e) => {
        if (origOnstop) origOnstop.call(recorder, e)
        resolve()
      }
      recorder.stop()
      setRecording(false)
      setIsPaused(false)
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined }
    })
  }

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') {
      recorder.pause()
      setIsPaused(true)
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined }
    }
  }

  const resumeRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'paused') {
      recorder.resume()
      setIsPaused(false)
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)
    }
  }

  const togglePlay = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.onended = () => setPlaying(false)
    }
    const a = audioRef.current
    if (playing) { a.pause() } else { a.src = recordedUrl; a.play() }
    setPlaying(!playing)
  }

  const cancelRecording = () => {
    if (recording) stopRecording()
    setRecordedBlob(null)
    recordedBlobRef.current = null
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl('') }
    setRecordingTime(0)
  }

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // === 打开新建/编辑 ===
  const openCreate = () => {
    setEditingId(null)
    setForm({ title: '', content_md: '', project_id: 0, customer_id: 0, meeting_date: new Date().toISOString().slice(0, 16), files_json: null })
    setInputMode('text')
    cancelRecording()
    setShowForm(true)
  }

  const openEdit = (m: Meeting) => {
    setEditingId(m.id)
    setForm({ title: m.title, content_md: m.content_md, project_id: m.project_id || 0, customer_id: m.customer_id || 0, meeting_date: m.meeting_date?.slice(0, 16) || new Date().toISOString().slice(0, 16), files_json: m.files_json || null })
    setInputMode('text')
    cancelRecording()
    setShowForm(true)
  }

  // === 保存会议（新建 / 编辑）===
  const handleSave = async () => {
    if (!form.title.trim()) return
    // 如果正在录音，提示用户
    if (recording) {
      if (!await showConfirm('录音仍在进行中，是否停止录音并一起保存？\n\n点击"取消"可返回继续录音。')) return
      await stopRecording()
    }
    setSaving(true)
    try {
      if (editingId) {
        // 编辑模式：PUT 更新
        const body: Record<string, unknown> = { title: form.title, content_md: form.content_md, meeting_date: form.meeting_date }
        body.project_id = form.project_id || null
        body.customer_id = form.customer_id || null
        body.files_json = form.files_json || undefined
        const res = await fetch(`/api/v1/meetings/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          showToast(`更新失败: ${errData.detail || res.statusText}`, 'error')
          return
        }
        // 刷新弹窗
        if (modalMeeting?.id === editingId) {
          const updated = meetings.find((m) => m.id === editingId)
          if (updated) {
            setModalMeeting({ ...updated, title: form.title, content_md: form.content_md, project_id: form.project_id || null })
            loadLinkedProject(form.project_id || null)
          }
        }
      } else {
        // 新建模式：POST 创建
        const body: Record<string, unknown> = { title: form.title, content_md: form.content_md, meeting_date: form.meeting_date }
        if (form.project_id) body.project_id = form.project_id
        if (form.customer_id) body.customer_id = form.customer_id
        body.files_json = form.files_json || undefined
        const res = await fetch('/api/v1/meetings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          showToast(`保存失败: ${errData.detail || res.statusText}`, 'error')
          return
        }
        const meeting = await res.json()
        if (recordedBlobRef.current && meeting.id) {
          const formData = new FormData()
          formData.append('file', recordedBlobRef.current, `recording_${Date.now()}.webm`)
          await fetch(`/api/v1/meetings/${meeting.id}/upload-audio`, { method: 'POST', body: formData })
        }
      }
      setShowForm(false)
      setEditingId(null)
      setIsMaximized(false)
      setForm({ title: '', content_md: '', project_id: 0, customer_id: 0, meeting_date: new Date().toISOString().slice(0, 16), files_json: null })
      setRecordedBlob(null)
      recordedBlobRef.current = null
      if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl('') }
      setRecordingTime(0)
      cancelRecording()
      loadMeetings()
      showToast(editingId ? '会议已更新' : '会议保存成功', 'success')
    } catch (err: any) {
      showToast(`保存异常: ${err.message}`, 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!await showConfirm('确定删除此会议？')) return
    await fetch(`/api/v1/meetings/${id}`, { method: 'DELETE' })
    if (modalMeeting?.id === id) setModalMeeting(null)
    loadMeetings()
    showToast('会议已删除', 'success')
  }

  const openDetail = (m: Meeting) => {
    setModalMeeting(m)
    loadLinkedProject(m.project_id)
  }

  const closeDetail = () => {
    setModalMeeting(null)
    setLinkedProject(null)
  }

  const handleAiExtract = async (id: number) => {
    setAiLoading(id)
    try {
      const res = await fetch(`/api/v1/meetings/${id}/ai-extract`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        showToast(`AI 提取失败: ${data.detail || res.statusText}`, 'error')
        return
      }
      // 后端已将 AI 原始结果保存到 ai_summary，直接使用
      const aiSummary = data.ai_summary
      if (aiSummary) {
        setModalMeeting((prev) => {
          if (!prev || prev.id !== id) return prev
          return { ...prev, ai_summary: aiSummary }
        })
        loadMeetings()
        showToast('AI 会议整理完成', 'success')
      } else {
        showToast('AI 未能提取有效内容', 'warning')
      }
    } catch (err: any) {
      showToast(`AI 提取异常: ${err.message}`, 'error')
    } finally { setAiLoading(null) }
  }

  const handleTranscribe = async (id: number) => {
    setTranscribingId(id)
    try {
      const res = await fetch(`/api/v1/meetings/${id}/transcribe`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        const meeting = meetings.find((m) => m.id === id)
        if (meeting) {
          await fetch(`/api/v1/meetings/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: meeting.title, content_md: `### 录音转写\n\n${data.raw_text}`, meeting_date: meeting.meeting_date }),
          })
        }
        loadMeetings()
      } else { showToast('转写失败: ' + (data.message || '未知错误'), 'error') }
    } catch { showToast('转写请求失败', 'error') }
    finally { setTranscribingId(null) }
  }

  const handleTranscribeAndOrganize = async (id: number) => {
    setOrganizingId(id)
    try {
      const res = await fetch(`/api/v1/meetings/${id}/transcribe-and-organize`, { method: 'POST' })
      const data = await res.json()
      if (data.success) { loadMeetings() }
      else { showToast('转写+整理失败: ' + (data.message || '未知错误'), 'error') }
    } catch { showToast('转写请求失败', 'error') }
    finally { setOrganizingId(null) }
  }

  const handleProjectHoverIn = (projectId: number) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    setHoveredProjectId(projectId)
  }

  const handleProjectHoverOut = () => {
    hoverTimerRef.current = setTimeout(() => setHoveredProjectId(null), 200)
  }

  const goToProject = (e: React.MouseEvent, projectId: number) => {
    e.stopPropagation()
    window.open(`/projects?project=${projectId}`, '_blank')
  }

  const filtered = meetings.filter((m) =>
    !searchText || m.title.includes(searchText) || m.content_md.includes(searchText)
  )

  const statusColors: Record<string, string> = {
    '进行中': 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    '已完成': 'text-green-400 bg-green-500/10 border-green-500/20',
    '暂停': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    '已取消': 'text-red-400 bg-red-500/10 border-red-500/20',
    '待启动': 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">会议纪要</h2>
          <p className="text-sm text-gray-500 mt-1">{meetings.length} 条记录</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-card border border-border focus-within:border-[#3B82F6] transition-colors">
            <Search size={15} className="text-gray-500" />
            <input type="text" placeholder="搜索会议..." value={searchText} onChange={(e) => setSearchText(e.target.value)}
              className="bg-transparent text-sm text-gray-300 outline-none w-36 placeholder-gray-600" />
            {searchText && <button onClick={() => setSearchText('')} className="text-gray-500 hover:text-white"><X size={14} /></button>}
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20">
            <Plus size={17} /><span>新建会议</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Calendar size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-3">{searchText ? '未找到匹配会议' : '暂无会议记录'}</p>
          {!searchText && <button onClick={openCreate} className="text-sm text-[#3B82F6] hover:underline">记录第一次会议</button>}
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-3">
          {filtered.map((m) => {
            const linkedP = getProjectById(m.project_id)
            const linkedC = m.customer_id ? customers.find(c => c.id === m.customer_id) : null
            return (
              <button
                key={m.id}
                onClick={() => openDetail(m)}
                className="w-full text-left break-inside-avoid mb-3 p-4 rounded-xl bg-bg-card border border-border hover:border-[#3B82F6]/60 hover:bg-bg-hover-secondary transition-all group/card"
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold text-white truncate flex-1">{m.title}</h4>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    {m.audio_url && <Mic size={12} className="text-red-400" />}
                    {linkedC && (
                      <span className="text-[10px] text-gray-500 bg-bg-input px-1.5 py-0.5 rounded">{linkedC.name}</span>
                    )}
                    {m.project_id && linkedP && (
                      <div className="relative"
                        onMouseEnter={() => handleProjectHoverIn(m.project_id!)}
                        onMouseLeave={handleProjectHoverOut}
                      >
                        <Link2 size={12} className="text-blue-400 cursor-pointer hover:text-blue-300" />
                        {/* 悬停提示 */}
                        {hoveredProjectId === m.project_id && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-bg-hover border border-[#3B82F6]/40 shadow-xl z-30 whitespace-nowrap"
                            onMouseEnter={() => handleProjectHoverIn(m.project_id!)}
                            onMouseLeave={handleProjectHoverOut}
                            onClick={(e) => goToProject(e, m.project_id!)}
                          >
                            <div className="flex items-center gap-2">
                              <Building2 size={11} className="text-blue-400" />
                              <span className="text-xs font-medium text-white">{linkedP.name}</span>
                              <span className={`text-[9px] px-1 py-0.5 rounded-full border ${statusColors[linkedP.status] || ''}`}>{linkedP.status}</span>
                              <ExternalLink size={10} className="text-gray-500" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400 mb-3 leading-relaxed line-clamp-3 overflow-hidden">
                  {m.content_md ? (
                    <MarkdownRenderer content={m.content_md} className="markdown-preview-card" />
                  ) : (
                    <span className="text-gray-600">暂无内容</span>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <span className="text-[11px] text-gray-400">{new Date(m.meeting_date).toLocaleDateString('zh-CN')}</span>
                  <span className="text-[10px] text-gray-600">{m.content_md ? m.content_md.length : 0} 字</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* 全屏详情弹窗 */}
      {modalMeeting && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[8vh] pb-10 overflow-y-auto" onClick={closeDetail}>
          <div className="w-full max-w-3xl mx-4 rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-bg-card/95 backdrop-blur-sm rounded-t-2xl">
              <div>
                <h3 className="text-lg font-bold text-white">{modalMeeting.title}</h3>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className="text-xs text-gray-500">{new Date(modalMeeting.meeting_date).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' })}</span>
                  {/* 关联客户 pill */}
                  {(() => {
                    const linkedC = modalMeeting.customer_id ? customers.find(c => c.id === modalMeeting.customer_id) : null
                    return linkedC ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); window.open(`/customers?customer=${linkedC.id}`, '_blank') }}
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors"
                      >
                        <Building2 size={10} />{linkedC.name}
                        <ExternalLink size={9} className="text-emerald-500/50" />
                      </button>
                    ) : null
                  })()}
                  {/* 关联项目 pill */}
                  {linkedProject && (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(`/projects?project=${linkedProject.id}`, '_blank') }}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20 hover:bg-blue-500/20 hover:text-blue-300 transition-colors"
                    >
                      <Building2 size={10} />{linkedProject.name}
                      <span className={`text-[9px] px-1 py-0 rounded-full border ${statusColors[linkedProject.status] || ''}`}>{linkedProject.status}</span>
                      <ExternalLink size={9} className="text-blue-500/50" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { closeDetail(); openEdit(modalMeeting) }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white transition-colors border border-border"><Edit3 size={12} />编辑</button>
                <button onClick={() => handleDelete(modalMeeting.id)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border border-border"><Trash2 size={13} /></button>
                <button onClick={closeDetail} className="ml-2 p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
              </div>
            </div>

            <div className="p-6">
              {/* AI 总结 */}
              {modalMeeting.ai_summary && (
                <div className="mb-4 p-4 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/20">
                  <h4 className="text-xs font-bold text-[#8B5CF6] mb-2 flex items-center gap-1.5"><Sparkles size={12} />AI 会议总结</h4>
                  <div className="text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none">
                    <MarkdownRenderer content={modalMeeting.ai_summary} />
                  </div>
                </div>
              )}

              {/* 内容 */}
              {modalMeeting.content_md && (
                <div className="text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none mb-4">
                  <MarkdownRenderer content={modalMeeting.content_md} />
                </div>
              )}

              {/* 附件 */}
              {modalMeeting.files_json && (() => {
                try {
                  const files = JSON.parse(modalMeeting.files_json)
                  return Array.isArray(files) && files.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-2">
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

              {/* 音频 */}
              {modalMeeting.audio_url && (
                <div className="mb-4 p-3 rounded-lg bg-bg-input border border-border">
                  <p className="text-xs text-gray-500 mb-2 flex items-center gap-2"><Mic size={12} className="text-red-400" />录音回放</p>
                  <audio controls className="w-full h-9" src={modalMeeting.audio_url} preload="metadata" />
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center gap-2 pt-4 border-t border-border flex-wrap">
                {modalMeeting.audio_url && (
                  <>
                    <button onClick={() => handleTranscribe(modalMeeting.id)} disabled={transcribingId === modalMeeting.id || organizingId === modalMeeting.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-bg-hover text-gray-300 hover:text-amber-400 disabled:opacity-50 transition-colors border border-border">
                      {transcribingId === modalMeeting.id ? <Loader2 size={12} className="animate-spin" /> : <FileAudio size={12} />}语音转文字
                    </button>
                    <button onClick={() => handleTranscribeAndOrganize(modalMeeting.id)} disabled={organizingId === modalMeeting.id || transcribingId === modalMeeting.id}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-bg-hover text-gray-300 hover:text-[#10B981] disabled:opacity-50 transition-colors border border-border">
                      {organizingId === modalMeeting.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}转文字+AI整理
                    </button>
                  </>
                )}
                <button onClick={() => handleAiExtract(modalMeeting.id)} disabled={aiLoading === modalMeeting.id}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-bg-hover text-gray-300 hover:text-[#8B5CF6] disabled:opacity-50 transition-colors border border-border">
                  {aiLoading === modalMeeting.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}AI 会议整理
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm ${isMaximized ? 'items-start pt-4 pb-4' : ''}`} onClick={() => { setShowForm(false); cancelRecording(); setEditingId(null); setIsMaximized(false) }}>
          <div className={`mx-4 p-6 rounded-2xl bg-bg-card border border-border shadow-2xl flex flex-col ${
            isMaximized 
              ? 'w-full max-w-5xl h-[calc(100vh-2rem)] max-h-[900px]' 
              : 'w-full max-w-lg max-h-[90vh]'
          }`} onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-lg font-bold text-white">{editingId ? '编辑会议纪要' : '新建会议纪要'}</h3>
              <div className="flex items-center gap-1">
                {!editingId && (
                  <button onClick={() => setIsMaximized(!isMaximized)} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors">
                    {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                )}
                <button onClick={() => { setShowForm(false); cancelRecording(); setEditingId(null); setIsMaximized(false) }} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
              </div>
            </div>

            {/* 表单内容 - 可滚动 */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
              <div className="space-y-3">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                  placeholder="会议标题" autoFocus />

                {/* 日期选择 */}
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">会议日期</label>
                  <input
                    type="datetime-local"
                    value={form.meeting_date}
                    onChange={(e) => setForm({ ...form, meeting_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                  />
                </div>

                {/* 客户选择 */}
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">关联客户</label>
                  <SearchableSelect
                    options={customers.map(c => ({ id: c.id, label: c.name }))}
                    value={form.customer_id}
                    onChange={(val) => {
                      const cid = val as number
                      if (cid) {
                        setForm({ ...form, customer_id: cid })
                      } else {
                        setForm({ ...form, customer_id: 0 })
                      }
                    }}
                    placeholder="选择已有客户..."
                    searchPlaceholder="搜索客户..."
                    emptyText="无匹配客户"
                  />
                </div>

                <div>
                  <SearchableSelect
                    options={projects.map(p => ({ id: p.id, label: p.name, sub: p.customer_name }))}
                    value={form.project_id}
                    onChange={(val) => {
                      const pid = val as number
                      const newForm = { ...form, project_id: pid }
                      // 若所选项目已关联客户，自动填入客户
                      if (pid && !form.customer_id) {
                        const proj = projects.find(p => p.id === pid)
                        if (proj?.customer_name) {
                          const matched = customers.find(c => c.name === proj.customer_name)
                          if (matched) {
                            newForm.customer_id = matched.id
                          }
                        }
                      }
                      setForm(newForm)
                    }}
                    placeholder="关联项目（可选）"
                    searchPlaceholder="搜索项目..."
                    emptyText="无匹配项目"
                  />
                </div>

                {editingId ? (
                  <RichTextEditor
                    value={form.content_md}
                    onChange={(val) => setForm({ ...form, content_md: val })}
                    placeholder="会议内容，支持富文本和 Markdown..."
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
                    className={isMaximized ? 'min-h-[400px]' : 'min-h-[200px]'}
                  />
                ) : inputMode === 'text' ? (
                  <RichTextEditor
                    value={form.content_md}
                    onChange={(val) => setForm({ ...form, content_md: val })}
                    placeholder="会议内容，支持富文本和 Markdown..."
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
                    className={isMaximized ? 'min-h-[400px]' : 'min-h-[160px]'}
                  />
                ) : (
                  <div>
                    {!recording && !recordedBlob && (
                      <div className="flex flex-col items-center justify-center py-10 rounded-xl bg-bg-input border border-dashed border-border">
                        {audioDevices.length > 1 && (
                          <div className="mb-4 w-56">
                            <label className="block text-xs text-gray-500 mb-1.5 text-center">选择麦克风</label>
                            <select
                              value={selectedDeviceId}
                              onChange={(e) => updateDevicePreference(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg bg-bg-hover border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                            >
                              {audioDevices.map((d) => (
                                <option key={d.deviceId} value={d.deviceId}>
                                  {d.label || `麦克风 ${d.deviceId.slice(0, 8)}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <button onClick={startRecording} className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center hover:bg-red-500/30 transition-all mb-3 ring-1 ring-red-500/30">
                          <Mic size={28} className="text-red-400" />
                        </button>
                        <p className="text-sm text-gray-400">点击开始录音</p>
                      </div>
                    )}
                    {recording && (
                      <div className="flex flex-col items-center py-10 rounded-xl bg-red-500/5 border border-red-500/20">
                        <div className="flex items-center gap-3 mb-3">
                          <span className={`w-3 h-3 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                          <span className="text-2xl font-mono text-red-400">{formatTime(recordingTime)}</span>
                        </div>
                        <p className={`text-sm mb-4 ${isPaused ? 'text-yellow-400' : 'text-red-400'}`}>{isPaused ? '已暂停' : '正在录制...'}</p>
                        <div className="flex items-center gap-3">
                          {isPaused ? (
                            <button onClick={resumeRecording} className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 transition-all shadow-lg shadow-green-500/30" title="继续录制">
                              <Play size={20} className="text-white fill-white ml-0.5" />
                            </button>
                          ) : (
                            <button onClick={pauseRecording} className="w-12 h-12 rounded-full bg-yellow-500 flex items-center justify-center hover:bg-yellow-600 transition-all shadow-lg shadow-yellow-500/30" title="暂停录制">
                              <Pause size={20} className="text-white fill-white" />
                            </button>
                          )}
                          <button onClick={stopRecording} className="w-12 h-12 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-all shadow-lg shadow-red-500/30" title="停止录制">
                            <Square size={20} className="text-white fill-white" />
                          </button>
                        </div>
                      </div>
                    )}
                    {!recording && recordedBlob && (
                      <div className="rounded-xl bg-bg-input border border-border p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm text-green-400 flex items-center gap-2"><Mic size={14} /> 录音完成 · {formatTime(recordingTime)}</span>
                          <span className="text-xs text-gray-500">{(recordedBlob.size / 1024).toFixed(0)} KB</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={togglePlay} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover text-sm text-gray-300 hover:text-white border border-border transition-colors">
                            {playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停' : '试听'}
                          </button>
                          <button onClick={cancelRecording} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover text-sm text-gray-400 hover:text-red-400 border border-border transition-colors">重新录制</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <FileUpload filesJson={form.files_json} onChange={(v) => setForm({ ...form, files_json: v })} />
              </div>
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border shrink-0">
              {editingId ? (
                <span className="text-xs text-gray-600">支持 Markdown 语法</span>
              ) : (
                <div className="flex rounded-lg bg-bg-hover border border-border">
                  <button onClick={() => { setInputMode('text'); cancelRecording() }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs transition-colors ${inputMode === 'text' ? 'bg-border text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                    <FileText size={12} /> 文本
                  </button>
                  <button onClick={() => setInputMode('voice')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-r-lg text-xs transition-colors ${inputMode === 'voice' ? 'bg-border text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                    <Mic size={12} /> 录音
                  </button>
                </div>
              )}
              <button onClick={handleSave} disabled={saving || !form.title.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-all">
                {saving && <Loader2 size={15} className="animate-spin" />}{saving ? '保存中...' : editingId ? '更新会议' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
