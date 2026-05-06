import { useState, useEffect } from 'react'
import { Loader2, AlertCircle, AlertTriangle, Info, Trash2, RefreshCw, ChevronDown, ChevronRight, ScrollText, Filter } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'

interface LogItem {
  id: number
  level: string
  category: string
  message: string
  details: string | null
  created_at: string
}

const LEVEL_ICONS: Record<string, { icon: typeof AlertCircle; color: string; bg: string }> = {
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
}

const CATEGORY_LABELS: Record<string, string> = {
  system: '系统',
  task: '任务',
  ai: 'AI',
  report: '日报',
  meeting: '会议',
  project: '项目',
  other: '其他',
}

export default function LogViewerPage() {
  const { confirm: showConfirm } = useToast()
  const [logs, setLogs] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filterLevel, setFilterLevel] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [clearing, setClearing] = useState(false)

  const loadLogs = () => {
    const params = new URLSearchParams()
    if (filterLevel) params.set('level', filterLevel)
    if (filterCategory) params.set('category', filterCategory)
    params.set('limit', '100')
    fetch(`/api/v1/logs?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => { setLogs(d.items || []); setTotal(d.total || 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setLoading(true)
    loadLogs()
  }, [filterLevel, filterCategory])

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const clearLogs = async () => {
    if (!await showConfirm('确定要清空所有日志吗？此操作不可撤销。')) return
    setClearing(true)
    await fetch('/api/v1/logs/clear', { method: 'DELETE' })
    loadLogs()
    setClearing(false)
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">任务日志</h2>
          <p className="text-sm text-gray-500 mt-1">系统运行、任务执行及错误信息 · 共 {total} 条</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-hover text-gray-400 hover:text-white border border-border text-xs transition-colors"
          >
            <RefreshCw size={12} />刷新
          </button>
          <button
            onClick={clearLogs}
            disabled={clearing || logs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-hover text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-border text-xs transition-colors disabled:opacity-50"
          >
            <Trash2 size={12} />清空
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter size={13} className="text-gray-500" />
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="px-2.5 py-1 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none"
        >
          <option value="">全部级别</option>
          <option value="error">🔴 错误</option>
          <option value="warning">🟡 警告</option>
          <option value="info">🔵 信息</option>
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-2.5 py-1 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none"
        >
          <option value="">全部分类</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* 日志列表 */}
      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-20">
          <ScrollText size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-2">暂无日志</p>
          <p className="text-xs text-gray-600">系统运行正常，无错误或事件记录</p>
        </div>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => {
            const level = LEVEL_ICONS[log.level] || LEVEL_ICONS.info
            const isExpanded = expandedIds.has(log.id)
            return (
              <div key={log.id} className="rounded-lg bg-bg-card border border-border overflow-hidden">
                <button
                  onClick={() => log.details && toggleExpand(log.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover-secondary/50 transition-colors text-left"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${level.bg} ${level.color} flex-shrink-0`} />
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${level.bg} ${level.color} flex-shrink-0`}>
                    {log.level.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-gray-500 flex-shrink-0">
                    {CATEGORY_LABELS[log.category] || log.category}
                  </span>
                  <span className="flex-1 min-w-0 text-xs text-gray-300 truncate">{log.message}</span>
                  <span className="text-[10px] text-gray-600 flex-shrink-0">{formatTime(log.created_at)}</span>
                  {log.details && (
                    isExpanded
                      ? <ChevronDown size={12} className="text-gray-500 flex-shrink-0" />
                      : <ChevronRight size={12} className="text-gray-500 flex-shrink-0" />
                  )}
                </button>
                {isExpanded && log.details && (
                  <div className="border-t border-border px-4 py-3 bg-bg-input/50">
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap break-all font-mono leading-relaxed">{log.details}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
