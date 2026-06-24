import { useState, useEffect, useCallback } from 'react'
import {
  MessageSquarePlus, Inbox, Clock, CheckCircle2, TrendingUp,
  Loader2, X, Trash2, Bug, Lightbulb, Sparkles, HelpCircle, Search,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import SearchableSelect from '../components/SearchableSelect'

interface FeedbackItem {
  id: number
  user_id: number
  user_name: string | null
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
  handler_id: number | null
  handler_name: string | null
  admin_reply: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

interface Stats {
  total: number
  pending: number
  resolved: number
  week_new: number
  resolved_rate: number
  by_category: Record<string, number>
  by_module: { module: string; count: number }[]
}

interface SimpleUser { id: number; name: string; username: string }

const CATEGORY_META: Record<string, { label: string; icon: typeof Bug; color: string }> = {
  bug:     { label: '问题反馈', icon: Bug, color: '#EF4444' },
  feature: { label: '新功能', icon: Lightbulb, color: '#F59E0B' },
  improve: { label: '体验改进', icon: Sparkles, color: '#8B5CF6' },
  other:   { label: '其他', icon: HelpCircle, color: '#6B7280' },
}

const STATUS_OPTIONS = [
  { key: 'pending', label: '待处理' },
  { key: 'reviewing', label: '已读待评估' },
  { key: 'processing', label: '处理中' },
  { key: 'done', label: '已完成' },
  { key: 'closed', label: '已关闭' },
  { key: 'wontfix', label: '不予处理' },
]
const STATUS_CLS: Record<string, string> = {
  pending: 'text-gray-400 bg-gray-500/10', reviewing: 'text-blue-400 bg-blue-500/10',
  processing: 'text-amber-400 bg-amber-500/10', done: 'text-green-400 bg-green-500/10',
  closed: 'text-gray-500 bg-gray-500/10', wontfix: 'text-rose-400 bg-rose-500/10',
}
const PRIORITY_OPTIONS = [
  { key: 'low', label: '低' }, { key: 'medium', label: '中' }, { key: 'high', label: '高' },
]
const PRIORITY_CLS: Record<string, string> = {
  low: 'text-gray-400', medium: 'text-amber-400', high: 'text-rose-400',
}

function statusLabel(s: string) { return STATUS_OPTIONS.find(o => o.key === s)?.label || s }

function fmtDate(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

function parseImages(raw: string | null): { url: string; name: string }[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

export default function FeedbackAdminPage() {
  const { fetchWithAuth } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()

  const [stats, setStats] = useState<Stats | null>(null)
  const [list, setList] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<SimpleUser[]>([])

  // 筛选
  const [fCategory, setFCategory] = useState('')
  const [fModule, setFModule] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fPriority, setFPriority] = useState('')
  const [keyword, setKeyword] = useState('')

  // 详情抽屉
  const [active, setActive] = useState<FeedbackItem | null>(null)
  const [saving, setSaving] = useState(false)

  const loadStats = useCallback(() => {
    fetchWithAuth('/api/v1/feedback/stats').then(r => r.json()).then(setStats).catch(() => {})
  }, [fetchWithAuth])

  const loadList = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (fCategory) qs.set('category', fCategory)
    if (fModule) qs.set('module', fModule)
    if (fStatus) qs.set('status', fStatus)
    if (fPriority) qs.set('priority', fPriority)
    if (keyword.trim()) qs.set('keyword', keyword.trim())
    fetchWithAuth(`/api/v1/feedback?${qs.toString()}`)
      .then(r => r.json())
      .then(d => setList(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fetchWithAuth, fCategory, fModule, fStatus, fPriority, keyword])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    fetchWithAuth('/api/v1/users/simple?scope=all').then(r => r.json())
      .then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {})
  }, [fetchWithAuth])

  const patchActive = async (patch: Record<string, any>) => {
    if (!active) return
    setSaving(true)
    try {
      const res = await fetchWithAuth(`/api/v1/feedback/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('保存失败')
      const updated: FeedbackItem = await res.json()
      setActive(updated)
      setList(prev => prev.map(f => f.id === updated.id ? updated : f))
      loadStats()
    } catch {
      showToast('保存失败，请重试', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (f: FeedbackItem) => {
    const ok = await showConfirm(`确定删除反馈《${f.title}》？`, 'warning')
    if (!ok) return
    const res = await fetchWithAuth(`/api/v1/feedback/${f.id}`, { method: 'DELETE' })
    if (res.ok) {
      setList(prev => prev.filter(x => x.id !== f.id))
      if (active?.id === f.id) setActive(null)
      loadStats()
      showToast('已删除', 'success')
    } else {
      showToast('删除失败', 'error')
    }
  }

  const statCards = [
    { label: '反馈总数', value: stats?.total ?? 0, icon: Inbox, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: '待处理', value: stats?.pending ?? 0, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { label: '本周新增', value: stats?.week_new ?? 0, icon: TrendingUp, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    { label: '已解决率', value: `${stats?.resolved_rate ?? 0}%`, icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <MessageSquarePlus size={22} className="text-blue-500" /> 意见反馈管理
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">汇总全员提交的问题与需求，分派处理并回复</p>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(c => (
          <div key={c.label} className="rounded-xl border border-border bg-bg-card p-4">
            <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center mb-3`}>
              <c.icon size={16} className={c.color} />
            </div>
            <p className="text-xs text-gray-500 mb-0.5">{c.label}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{c.value}</p>
          </div>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜索标题 / 描述…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6]"
          />
        </div>
        <SearchableSelect
          options={[{ id: '', label: '全部类型' }, ...Object.entries(CATEGORY_META).map(([k, v]) => ({ id: k, label: v.label }))]}
          value={fCategory}
          onChange={(v) => setFCategory(v === 0 ? '' : String(v))}
          clearValue=""
        />
        <SearchableSelect
          options={[{ id: '', label: '全部状态' }, ...STATUS_OPTIONS.map(o => ({ id: o.key, label: o.label }))]}
          value={fStatus}
          onChange={(v) => setFStatus(v === 0 ? '' : String(v))}
          clearValue=""
        />
        <SearchableSelect
          options={[{ id: '', label: '全部紧急度' }, ...PRIORITY_OPTIONS.map(o => ({ id: o.key, label: o.label }))]}
          value={fPriority}
          onChange={(v) => setFPriority(v === 0 ? '' : String(v))}
          clearValue=""
        />
        {stats && stats.by_module.length > 0 && (
          <SearchableSelect
            options={[{ id: '', label: '全部模块' }, ...stats.by_module.map(m => ({ id: m.module, label: `${m.module} (${m.count})` }))]}
            value={fModule}
            onChange={(v) => setFModule(v === 0 ? '' : String(v))}
            clearValue=""
          />
        )}
      </div>

      {/* 列表 */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> 加载中…
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">暂无反馈</div>
        ) : (
          <div className="divide-y divide-border">
            {list.map(f => {
              const cm = CATEGORY_META[f.category] || CATEGORY_META.other
              return (
                <div
                  key={f.id}
                  onClick={() => setActive(f)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover cursor-pointer transition-colors"
                >
                  <cm.icon size={16} style={{ color: cm.color }} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-700 dark:text-gray-200 font-medium truncate">{f.title}</span>
                      {f.admin_priority && <span className={`text-[10px] ${PRIORITY_CLS[f.admin_priority]}`}>●{PRIORITY_OPTIONS.find(p => p.key === f.admin_priority)?.label}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                      <span className="px-1.5 py-0.5 rounded bg-bg-hover">{f.module}</span>
                      <span>{f.user_name || `用户#${f.user_id}`}</span>
                      <span>·</span>
                      <span>{fmtDate(f.created_at)}</span>
                      {f.handler_name && <><span>·</span><span className="text-blue-400">@{f.handler_name}</span></>}
                    </div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLS[f.status]}`}>{statusLabel(f.status)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(f) }}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 详情抽屉 */}
      {active && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setActive(null)}>
          <div className="w-full max-w-md h-full bg-bg-card border-l border-border overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-bg-card flex items-center justify-between px-5 py-4 border-b border-border z-10">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">反馈详情 #{active.id}</h3>
              <button onClick={() => setActive(null)} className="p-1 rounded-lg hover:bg-bg-hover text-gray-500"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* 元信息 */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  {(() => { const cm = CATEGORY_META[active.category] || CATEGORY_META.other; return <><cm.icon size={15} style={{ color: cm.color }} /><span className="text-xs text-gray-500">{cm.label}</span></> })()}
                  <span className="text-xs text-gray-500">·</span>
                  <span className="text-xs text-gray-500">{active.module}{active.is_custom_module ? '（自定义）' : ''}</span>
                </div>
                <h4 className="text-base font-medium text-gray-800 dark:text-gray-100">{active.title}</h4>
              </div>

              {/* 描述 */}
              <div className="rounded-lg bg-bg-input/40 border border-border p-3">
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{active.content}</p>
              </div>

              {/* 截图 */}
              {parseImages(active.images).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {parseImages(active.images).map((img, i) => (
                    <a key={i} href={img.url} target="_blank" rel="noreferrer">
                      <img src={img.url} alt={img.name} className="w-16 h-16 rounded-lg object-cover border border-border" />
                    </a>
                  ))}
                </div>
              )}

              {/* 提交信息 */}
              <div className="text-xs text-gray-500 space-y-1">
                <div className="flex justify-between"><span>提交人</span><span className="text-gray-400">{active.user_name || `用户#${active.user_id}`}</span></div>
                <div className="flex justify-between"><span>提交时间</span><span className="text-gray-400">{fmtDate(active.created_at)}</span></div>
                <div className="flex justify-between"><span>提交者紧急度</span><span className={PRIORITY_CLS[active.user_priority]}>{PRIORITY_OPTIONS.find(p => p.key === active.user_priority)?.label}</span></div>
                {active.contact && <div className="flex justify-between"><span>联系方式</span><span className="text-gray-400">{active.contact}</span></div>}
                {active.resolved_at && <div className="flex justify-between"><span>解决时间</span><span className="text-green-400">{fmtDate(active.resolved_at)}</span></div>}
              </div>

              <div className="border-t border-border pt-4 space-y-4">
                {/* 状态 */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">状态</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {STATUS_OPTIONS.map(o => (
                      <button
                        key={o.key}
                        disabled={saving}
                        onClick={() => patchActive({ status: o.key })}
                        className={`py-1.5 rounded-lg text-xs border transition-colors disabled:opacity-50 ${
                          active.status === o.key ? 'border-[#3B82F6] text-[#3B82F6] bg-[#3B82F6]/10' : 'border-border text-gray-500 hover:bg-bg-hover'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 优先级 */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">处理优先级</label>
                  <div className="flex gap-1.5">
                    {PRIORITY_OPTIONS.map(o => (
                      <button
                        key={o.key}
                        disabled={saving}
                        onClick={() => patchActive({ admin_priority: active.admin_priority === o.key ? '' : o.key })}
                        className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors disabled:opacity-50 ${
                          active.admin_priority === o.key ? 'border-[#3B82F6] text-[#3B82F6] bg-[#3B82F6]/10' : 'border-border text-gray-500 hover:bg-bg-hover'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 指派处理人 */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">处理人</label>
                  <SearchableSelect
                    options={[{ id: 0, label: '未指派' }, ...users.map(u => ({ id: u.id, label: u.name || u.username }))]}
                    value={active.handler_id || 0}
                    onChange={(v) => patchActive({ handler_id: (v as number) || 0 })}
                    clearValue={0}
                  />
                </div>

                {/* 回复 */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">回复提交者（提交者可在「我的反馈」看到）</label>
                  <ReplyEditor
                    key={active.id}
                    initial={active.admin_reply || ''}
                    saving={saving}
                    onSave={(text) => patchActive({ admin_reply: text })}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReplyEditor({ initial, saving, onSave }: { initial: string; saving: boolean; onSave: (t: string) => void }) {
  const [text, setText] = useState(initial)
  return (
    <div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder="写一句回复，让提交者知道处理进展…"
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] resize-none"
      />
      <button
        onClick={() => onSave(text)}
        disabled={saving || text === initial}
        className="mt-2 w-full py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
      >
        {saving ? '保存中…' : '保存回复'}
      </button>
    </div>
  )
}
