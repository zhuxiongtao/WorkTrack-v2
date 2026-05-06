import { useState, useEffect } from 'react'
import { Clock, ToggleLeft, ToggleRight, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'

interface ScheduledTask {
  id: number
  name: string
  trigger_type: string
  trigger_config: string
  action_type: string
  action_params: string | null
  enabled: boolean
  created_at: string
}

const ACTION_LABELS: Record<string, { label: string; desc: string }> = {
  ai_summarize_daily: { label: '📋 日报 AI 总结', desc: '自动总结当日工作日报' },
  ai_analyze_project: { label: '📊 项目分析', desc: '定期分析项目状态和风险' },
}

function parseCron(cron: string): string {
  // 简单 Cron 解析：分 时 日 月 周
  const parts = cron.trim().split(/\s+/)
  if (parts.length >= 2) {
    const minute = parts[0]
    const hour = parts[1]
    const mm = minute.padStart(2, '0')
    const hh = hour.padStart(2, '0')
    if (parts.length === 5) {
      return `每天 ${hh}:${mm}`
    }
    return `${hh}:${mm}`
  }
  return cron
}

function parseTrigger(task: ScheduledTask): string {
  try {
    const cfg = JSON.parse(task.trigger_config)
    if (task.trigger_type === 'cron') {
      return parseCron(cfg.cron || '')
    }
    if (task.trigger_type === 'interval') {
      const h = cfg.hours || 0
      const m = cfg.minutes || 0
      if (h && m) return `每 ${h} 小时 ${m} 分钟`
      if (h) return `每 ${h} 小时`
      if (m) return `每 ${m} 分钟`
    }
    if (task.trigger_type === 'date') {
      return `单次: ${cfg.run_date || ''}`
    }
  } catch { /* noop */ }
  return task.trigger_config
}

export default function ScheduledTasksPage() {
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [error, setError] = useState('')

  const loadTasks = () => {
    setLoading(true)
    fetch('/api/v1/scheduled-tasks')
      .then((r) => r.json())
      .then((d) => setTasks(d as ScheduledTask[]))
      .catch(() => setError('加载任务列表失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadTasks() }, [])

  const toggleTask = async (task: ScheduledTask) => {
    setToggling(task.id)
    try {
      await fetch(`/api/v1/scheduled-tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !task.enabled }),
      })
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, enabled: !t.enabled } : t)))
      showToast(task.enabled ? '任务已暂停' : '任务已启用', 'success')
    } catch {
      setError('切换状态失败')
    } finally {
      setToggling(null)
    }
  }

  const deleteTask = async (id: number) => {
    if (!await showConfirm('确定要删除这个定时任务吗？')) return
    setDeleting(id)
    try {
      await fetch(`/api/v1/scheduled-tasks/${id}`, { method: 'DELETE' })
      setTasks((prev) => prev.filter((t) => t.id !== id))
      showToast('任务已删除', 'success')
    } catch {
      setError('删除失败')
    } finally {
      setDeleting(null)
    }
  }

  const getActionInfo = (actionType: string) => {
    return ACTION_LABELS[actionType] || { label: actionType, desc: '' }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">定时任务</h2>
          <p className="text-sm text-gray-500 mt-1">管理自动执行的工作日报总结和项目分析任务</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-xs underline">关闭</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-gray-500" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-20">
          <Clock size={40} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-2">暂无定时任务</p>
          <p className="text-xs text-gray-600">
            在 AI 中心让助手帮你创建定时任务，例如「帮我创建一个每天 18:00 总结日报的任务」
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const action = getActionInfo(task.action_type)
            return (
              <div
                key={task.id}
                className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-colors ${
                  task.enabled
                    ? 'bg-bg-card border-border hover:border-accent-blue/30'
                    : 'bg-bg-card/50 border-border/50 opacity-60'
                }`}
              >
                {/* 图标 */}
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  task.enabled ? 'bg-accent-blue/10 text-accent-blue' : 'bg-gray-500/10 text-gray-500'
                }`}>
                  <Clock size={18} />
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-white">{task.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      task.enabled
                        ? 'text-[#10B981] bg-[#10B981]/10'
                        : 'text-gray-500 bg-gray-500/10'
                    }`}>
                      {task.enabled ? '启用' : '停用'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{action.label}</span>
                    <span className="text-gray-600">·</span>
                    <span>{parseTrigger(task)}</span>
                  </div>
                  {action.desc && (
                    <p className="text-xs text-gray-500 mt-1">{action.desc}</p>
                  )}
                </div>

                {/* 操作 */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => toggleTask(task)}
                    disabled={toggling === task.id}
                    className="p-2 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                    title={task.enabled ? '停用' : '启用'}
                  >
                    {toggling === task.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : task.enabled ? (
                      <ToggleRight size={18} className="text-[#10B981]" />
                    ) : (
                      <ToggleLeft size={18} className="text-gray-500" />
                    )}
                  </button>
                  <button
                    onClick={() => deleteTask(task.id)}
                    disabled={deleting === task.id}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                    title="删除"
                  >
                    {deleting === task.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
