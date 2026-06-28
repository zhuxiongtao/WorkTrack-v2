import { useState, useEffect, useCallback } from 'react'
import { MessageSquarePlus, Bug, Lightbulb, Sparkles, HelpCircle, Loader2, Send, Clock, X, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import SearchableSelect from '../components/SearchableSelect'

interface FeedbackItem {
  id: number
  category: string
  module: string
  is_custom_module: boolean
  title: string
  content: string
  images: string | null
  contact: string | null
  user_priority: string
  status: string
  admin_priority: string | null
  handler_name: string | null
  admin_reply: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

const CATEGORIES = [
  { key: 'bug', label: '问题反馈', icon: Bug, desc: '哪里不能用 / 报错', color: '#EF4444' },
  { key: 'feature', label: '新功能', icon: Lightbulb, desc: '希望增加什么', color: '#F59E0B' },
  { key: 'improve', label: '体验改进', icon: Sparkles, desc: '哪里可以更好用', color: '#8B5CF6' },
  { key: 'other', label: '其他', icon: HelpCircle, desc: '其他想法', color: '#6B7280' },
] as const

const PRIORITIES = [
  { key: 'low', label: '不急' },
  { key: 'medium', label: '一般' },
  { key: 'high', label: '比较急' },
]

const CATEGORY_LABEL: Record<string, string> = {
  bug: '问题反馈', feature: '新功能', improve: '体验改进', other: '其他',
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:    { label: '待处理', cls: 'text-gray-400 bg-gray-500/10' },
  reviewing:  { label: '已读待评估', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20' },
  processing: { label: '处理中', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' },
  done:       { label: '已完成', cls: 'text-green-400 bg-green-500/10' },
  closed:     { label: '已关闭', cls: 'text-gray-500 bg-gray-500/10' },
  wontfix:    { label: '不予处理', cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20' },
}

const CUSTOM_VALUE = '__custom__'

function fmtDate(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

export default function FeedbackPage() {
  const { fetchWithAuth } = useAuth()
  const { toast: showToast } = useToast()

  const [modules, setModules] = useState<string[]>([])
  const [category, setCategory] = useState<string>('bug')
  const [moduleSel, setModuleSel] = useState<string>('')
  const [customModule, setCustomModule] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [images, setImages] = useState<string | null>(null)
  const [priority, setPriority] = useState('medium')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [mine, setMine] = useState<FeedbackItem[]>([])
  const [loadingMine, setLoadingMine] = useState(true)
  const [pasteUploading, setPasteUploading] = useState(false)
  const [selected, setSelected] = useState<FeedbackItem | null>(null)

  // 表单级粘贴截图：在表单任意位置 Ctrl+V 粘贴图片都能附加
  const handleFormPaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault()
        const blob = items[i].getAsFile()
        if (!blob) return
        const ext = items[i].type.split('/')[1] || 'png'
        const file = new File([blob], `paste_${Date.now()}.${ext}`, { type: items[i].type })
        setPasteUploading(true)
        try {
          const fd = new FormData()
          fd.append('file', file)
          const res = await fetchWithAuth('/api/v1/files/upload', { method: 'POST', body: fd })
          if (!res.ok) throw new Error('上传失败')
          const uploaded = await res.json()
          setImages((prev) => {
            const arr = prev ? JSON.parse(prev) : []
            return JSON.stringify([...arr, uploaded])
          })
          showToast('截图已粘贴', 'success')
        } catch {
          showToast('截图上传失败，请重试', 'error')
        } finally {
          setPasteUploading(false)
        }
        break  // 一次粘贴只处理第一张图片
      }
    }
  }, [fetchWithAuth, showToast])

  const loadModules = useCallback(() => {
    fetchWithAuth('/api/v1/feedback/modules')
      .then((r) => r.json())
      .then((d) => setModules(d.modules || []))
      .catch(() => {})
  }, [fetchWithAuth])

  const loadMine = useCallback(() => {
    setLoadingMine(true)
    fetchWithAuth('/api/v1/feedback/mine')
      .then((r) => r.json())
      .then((d) => setMine(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoadingMine(false))
  }, [fetchWithAuth])

  useEffect(() => { loadModules(); loadMine() }, [loadModules, loadMine])

  const resetForm = () => {
    setModuleSel(''); setCustomModule(''); setTitle(''); setContent('')
    setImages(null); setPriority('medium'); setContact('')
  }

  const handleSubmit = async () => {
    const isCustom = moduleSel === CUSTOM_VALUE
    const moduleVal = isCustom ? customModule.trim() : moduleSel
    if (!moduleVal) { showToast('请选择或填写功能模块', 'warning'); return }
    if (!title.trim()) { showToast('请填写一句话标题', 'warning'); return }
    if (!content.trim()) { showToast('请填写详细描述', 'warning'); return }

    setSubmitting(true)
    try {
      const res = await fetchWithAuth('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          module: moduleVal,
          is_custom_module: isCustom,
          title: title.trim(),
          content: content.trim(),
          images,
          contact: contact.trim() || null,
          user_priority: priority,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '提交失败')
      }
      showToast('反馈已提交，感谢你的建议！', 'success')
      resetForm()
      loadMine()
    } catch (e: any) {
      showToast(e.message || '提交失败，请稍后重试', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <MessageSquarePlus size={22} className="text-blue-500" />
          意见反馈
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">哪里不好用、想要什么新功能，都可以告诉我们 —— 每条反馈都会汇总到后台处理</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ===== 提交表单 ===== */}
        <div className="lg:col-span-3 rounded-xl border border-border bg-bg-card p-5 space-y-4" onPaste={handleFormPaste}>
          {/* 类型 */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">反馈类型</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CATEGORIES.map((c) => {
                const active = category === c.key
                return (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    className={`flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all ${
                      active ? 'border-transparent' : 'border-border hover:bg-bg-hover'
                    }`}
                    style={active ? { background: `${c.color}1a`, borderColor: `${c.color}66` } : undefined}
                  >
                    <c.icon size={16} style={{ color: c.color }} />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{c.label}</span>
                    <span className="text-[10px] text-gray-500">{c.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 模块 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">功能模块</label>
            <SearchableSelect
              options={[
                ...modules.map((m) => ({ value: m, label: m })),
                { value: CUSTOM_VALUE, label: '＋ 自定义模块' },
              ]}
              value={moduleSel}
              onChange={(v) => setModuleSel(v === null ? '' : String(v))}
              placeholder="请选择功能模块…"
            />
            {moduleSel === CUSTOM_VALUE && (
              <input
                value={customModule}
                onChange={(e) => setCustomModule(e.target.value)}
                placeholder="输入自定义模块名称"
                className="w-full mt-2 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6]"
              />
            )}
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">一句话标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={60}
              placeholder="简短描述，如「客户列表导出按钮点击无反应」"
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6]"
            />
          </div>

          {/* 详细描述 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">详细描述</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="问题：操作步骤、期望结果、实际结果；需求：你想解决的场景和期望的效果"
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] resize-none"
            />
          </div>

          {/* 截图 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 flex items-center gap-2">
              截图（可选，表单内任意位置 Ctrl+V 粘贴 / 拖拽 / 点击）
              {pasteUploading && <Loader2 size={11} className="animate-spin text-blue-400" />}
            </label>
            <FileUpload filesJson={images} onChange={setImages} />
          </div>

          {/* 紧急度 + 联系方式 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">紧急程度</label>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPriority(p.key)}
                    className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
                      priority === p.key
                        ? 'border-[#3B82F6] text-[#3B82F6] bg-[#3B82F6]/10'
                        : 'border-border text-gray-500 hover:bg-bg-hover'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">联系方式（可选）</label>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="方便我们追问，如微信 / 手机"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6]"
              />
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
            提交反馈
          </button>
        </div>

        {/* ===== 我的反馈 ===== */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-bg-card p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <Clock size={15} className="text-gray-400" /> 我的反馈
          </h2>
          {loadingMine ? (
            <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
              <Loader2 size={16} className="animate-spin mr-2" /> 加载中…
            </div>
          ) : mine.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">还没有提交过反馈</div>
          ) : (
            <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
              {mine.map((f) => {
                const st = STATUS_META[f.status] || STATUS_META.pending
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelected(f)}
                    className="w-full rounded-lg border border-border bg-bg-input/40 p-3 text-left hover:border-[#3B82F6]/50 hover:bg-bg-hover transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-gray-700 dark:text-gray-200 font-medium leading-snug">{f.title}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        <ChevronRight size={12} className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
                      <span className="px-1.5 py-0.5 rounded bg-bg-hover">{CATEGORY_LABEL[f.category] || f.category}</span>
                      <span className="px-1.5 py-0.5 rounded bg-bg-hover">{f.module}</span>
                      <span className="ml-auto">{fmtDate(f.created_at)}</span>
                    </div>
                    {f.admin_reply && (
                      <div className="mt-2 pt-2 border-t border-border/60 text-[11px] text-gray-400 text-left">
                        <span className="text-green-400">官方回复：</span>{f.admin_reply}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ===== 详情弹窗 ===== */}
      {selected && (() => {
        const st = STATUS_META[selected.status] || STATUS_META.pending
        const CatIcon = CATEGORIES.find(c => c.key === selected.category)?.icon || HelpCircle
        const catColor = CATEGORIES.find(c => c.key === selected.category)?.color || '#6B7280'
        const PRIORITY_LABEL: Record<string, string> = { low: '不急', medium: '一般', high: '比较急' }
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
          >
            <div className="relative w-full max-w-lg rounded-2xl border border-border bg-bg-card shadow-2xl flex flex-col max-h-[90vh]">
              {/* 头部 */}
              <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-border shrink-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${catColor}1a` }}>
                  <CatIcon size={16} style={{ color: catColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white leading-snug">{selected.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    <span className="text-[10px] text-gray-500">{CATEGORY_LABEL[selected.category] || selected.category}</span>
                    <span className="text-[10px] text-gray-500">·</span>
                    <span className="text-[10px] text-gray-500">{selected.module}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="p-1 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 内容 */}
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
                {/* 详细描述 */}
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">详细描述</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{selected.content}</p>
                </div>

                {/* 截图 */}
                {selected.images && JSON.parse(selected.images).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">截图附件</p>
                    <FileUpload filesJson={selected.images} disabled />
                  </div>
                )}

                {/* 元信息 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-bg-input/60 px-3 py-2">
                    <p className="text-gray-500 mb-0.5">紧急程度</p>
                    <p className="text-gray-700 dark:text-gray-300 font-medium">{PRIORITY_LABEL[selected.user_priority] || selected.user_priority}</p>
                  </div>
                  <div className="rounded-lg bg-bg-input/60 px-3 py-2">
                    <p className="text-gray-500 mb-0.5">提交时间</p>
                    <p className="text-gray-700 dark:text-gray-300 font-medium">{fmtDate(selected.created_at)}</p>
                  </div>
                  {selected.handler_name && (
                    <div className="rounded-lg bg-bg-input/60 px-3 py-2">
                      <p className="text-gray-500 mb-0.5">处理人</p>
                      <p className="text-gray-700 dark:text-gray-300 font-medium">{selected.handler_name}</p>
                    </div>
                  )}
                  {selected.contact && (
                    <div className="rounded-lg bg-bg-input/60 px-3 py-2">
                      <p className="text-gray-500 mb-0.5">联系方式</p>
                      <p className="text-gray-700 dark:text-gray-300 font-medium">{selected.contact}</p>
                    </div>
                  )}
                </div>

                {/* 官方回复 */}
                {selected.admin_reply && (
                  <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3">
                    <p className="text-xs text-green-400 font-medium mb-1.5">官方回复</p>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{selected.admin_reply}</p>
                  </div>
                )}
              </div>

              {/* 底部 */}
              <div className="px-5 py-3 border-t border-border shrink-0">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="w-full py-2 rounded-lg text-sm text-gray-500 hover:text-gray-300 hover:bg-bg-hover transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
