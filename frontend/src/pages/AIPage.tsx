import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, Sparkles, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeft,
  Loader2, FileText, Users, Briefcase, Calendar, Globe, TrendingUp,
  CheckSquare, Square, StopCircle, ChevronDown, ChevronRight,
} from 'lucide-react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useToast } from '../contexts/ToastContext'
import { StatusBadge } from '../components/design-system'
import type { Tone } from '../theme/tokens'
import type { LucideIcon } from 'lucide-react'

// ─── Tool metadata ────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { label: string; emoji: string }> = {
  // 日报
  search_all:                  { label: '全局搜索',       emoji: '🔍' },
  search_reports:              { label: '搜索日报',       emoji: '📋' },
  get_reports_by_date:         { label: '查询日报',       emoji: '📅' },
  get_reports_by_date_range:   { label: '查询日期范围',   emoji: '📅' },
  summarize_today_reports:     { label: '总结今日日报',   emoji: '✨' },
  // 客户
  get_customer_summary:        { label: '查询客户详情',   emoji: '👥' },
  search_company_info:         { label: '搜索公司信息',   emoji: '🌐' },
  create_customer:             { label: '录入新客户',     emoji: '➕' },
  // 项目
  list_projects:               { label: '获取项目列表',   emoji: '📊' },
  get_project_analysis:        { label: 'AI 分析项目',    emoji: '🤖' },
  // 会议
  search_meetings:             { label: '搜索会议纪要',   emoji: '📝' },
  // 合同
  search_contracts:            { label: '搜索合同',       emoji: '📄' },
  get_contract_detail:         { label: '查看合同详情',   emoji: '📑' },
  // 对账
  query_reconcile:             { label: '查询对账数据',   emoji: '💰' },
  // 供应商 & 通道
  list_suppliers:              { label: '查看供应商',     emoji: '🏭' },
  list_channels:               { label: '查看通道列表',   emoji: '📡' },
  // 审批
  get_my_pending_approvals:    { label: '查询审批事项',   emoji: '🔔' },
  // 看板
  get_dashboard_overview:      { label: '数据看板概览',   emoji: '📈' },
  // Wiki
  search_wiki:                 { label: '搜索知识库',     emoji: '📖' },
  // 定时任务
  create_scheduled_task:       { label: '创建定时任务',   emoji: '⏰' },
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolStep = { tool: string; status: 'running' | 'done' | 'error' }

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolSteps?: ToolStep[]
  streaming?: boolean
  error?: boolean
}

interface Conversation {
  id: number
  title: string
  updated_at: string
  message_count: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6)  return '夜深了，还在工作？'
  if (h < 11) return '早上好！'
  if (h < 14) return '中午好！'
  if (h < 18) return '下午好！'
  return '晚上好！'
}

function formatDate(s: string) {
  const d = new Date(s)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 86400000
  if (diff < 1) return '今天'
  if (diff < 2) return '昨天'
  if (diff < 7) return `${Math.floor(diff)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function hasMarkdown(str: string) {
  return /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\*\*|__|`{1,3}|^\s*>\s|\[.*\]\(.*\)/m.test(str)
}

// ─── Welcome capability cards ─────────────────────────────────────────────────

const CAPABILITY_CARDS: {
  emoji: string; label: string; desc: string; prompt: string; fillInput?: boolean
  gradientClass: string; hoverBorder: string
}[] = [
  {
    emoji: '📋', label: '今日日报总结',
    desc: '汇总所有人今天的工作进展',
    prompt: '帮我总结今天所有人的日报',
    gradientClass: 'from-blue-500/10 to-violet-500/8',
    hoverBorder: 'hover:border-blue-500/50',
  },
  {
    emoji: '📊', label: '项目状态速览',
    desc: '一览当前所有在进行中的项目',
    prompt: '列出所有进行中的项目，告诉我每个项目的当前状态和主要进展',
    gradientClass: 'from-orange-500/10 to-amber-500/8',
    hoverBorder: 'hover:border-orange-500/50',
  },
  {
    emoji: '👥', label: '客户跟进动态',
    desc: '查看最近的客户会议和跟进记录',
    prompt: '最近哪些客户有新的会议纪要或跟进记录？列出来并简要说明',
    gradientClass: 'from-purple-500/10 to-pink-500/8',
    hoverBorder: 'hover:border-purple-500/50',
  },
  {
    emoji: '📄', label: '合同智能检索',
    desc: 'AI 搜索并解析合同关键信息',
    prompt: '帮我搜索最近的合同，列出合同名称、金额、甲乙双方和签订日期',
    gradientClass: 'from-cyan-500/10 to-teal-500/8',
    hoverBorder: 'hover:border-cyan-500/50',
  },
  {
    emoji: '🌐', label: '搜索公司信息',
    desc: '联网获取目标公司的行业动态',
    prompt: '搜索公司：',
    fillInput: true,
    gradientClass: 'from-emerald-500/10 to-green-500/8',
    hoverBorder: 'hover:border-emerald-500/50',
  },
  {
    emoji: '✅', label: '审批待办处理',
    desc: '查看所有待我审批的申请事项',
    prompt: '我有哪些待审批的合同或申请？',
    gradientClass: 'from-rose-500/10 to-red-500/8',
    hoverBorder: 'hover:border-rose-500/50',
  },
]

// ─── Smart quick prompts (time-aware) ────────────────────────────────────────

interface QuickPrompt { icon: LucideIcon; label: string; prompt: string; tone: Tone }

function getSmartPrompts(): QuickPrompt[] {
  const h = new Date().getHours()
  const list: QuickPrompt[] = [
    { icon: FileText,    label: '今日日报',  prompt: '总结今天所有人的工作日报',                     tone: 'blue'   },
    { icon: Briefcase,   label: '项目概览',  prompt: '列出所有进行中的项目，给我一个状态概览',       tone: 'orange' },
    { icon: Users,       label: '客户动态',  prompt: '最近哪些客户有新的会议或跟进记录？',           tone: 'purple' },
    { icon: CheckSquare, label: '待办审批',  prompt: '查看我有哪些待处理的审批事项',                 tone: 'green'  },
    { icon: FileText,    label: '合同查询',  prompt: '查找最近签订的合同，展示金额、甲乙方',         tone: 'cyan'   },
    { icon: Globe,       label: '搜索公司',  prompt: '搜索公司：',                                   tone: 'pink'   },
  ]
  if (h >= 8 && h < 11)   list.unshift({ icon: Calendar,    label: '今日重点', prompt: '今天有哪些需要跟进的项目或客户？', tone: 'blue' })
  else if (h >= 17)        list.unshift({ icon: TrendingUp,  label: '工作回顾', prompt: '总结今天的工作：日报和项目动态',   tone: 'pink' })
  return list.slice(0, 5)
}

// ─── ToolSteps component ──────────────────────────────────────────────────────

function ToolStepsBubble({ steps }: { steps: ToolStep[] }) {
  const [expanded, setExpanded] = useState(true)
  const running = steps.some((s) => s.status === 'running')
  const done = steps.length > 0 && !running

  return (
    <div className="mb-2.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-400 transition-colors"
      >
        {running
          ? <Loader2 size={11} className="animate-spin text-accent-blue" />
          : <Square size={11} className="text-green-500" style={{ fill: 'currentColor' }} />
        }
        <span>{running ? '正在处理...' : `已完成 ${steps.length} 步`}</span>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-1 space-y-1">
          {steps.map((s, i) => {
            const meta = TOOL_META[s.tool] ?? { label: s.tool, emoji: '⚙️' }
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                {s.status === 'running' ? (
                  <Loader2 size={11} className="animate-spin text-accent-blue shrink-0" />
                ) : (
                  <span className="text-green-500 text-[11px] shrink-0">✅</span>
                )}
                <span className={s.status === 'running' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-500 dark:text-gray-500'}>
                  {meta.emoji} {meta.label}
                  {s.status === 'running' && '…'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AIPage() {
  const { confirm: showConfirm } = useToast()
  const [greetText] = useState(greeting)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 1024)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [activeModel, setActiveModel] = useState<{ provider_name: string; model_name: string }>({
    provider_name: '未配置', model_name: '',
  })
  const [chatStats, setChatStats] = useState<{
    conversation_count: number; message_count: number
    retention_days: number; max_messages_per_user: number
  } | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingMsgIdRef = useRef<string | null>(null)

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [input])

  const fetchActiveModel = useCallback(() => {
    fetch('/api/v1/ai/active-model').then(r => r.json()).then(setActiveModel).catch(() => {})
  }, [])

  const fetchConversations = useCallback(() => {
    fetch('/api/v1/ai/conversations').then(r => r.json()).then(d => setConversations(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const fetchChatStats = useCallback(() => {
    fetch('/api/v1/ai/stats').then(r => r.json()).then(setChatStats).catch(() => {})
  }, [])

  useEffect(() => {
    fetchActiveModel()
    fetchConversations()
    fetchChatStats()
  }, [fetchActiveModel, fetchConversations, fetchChatStats])

  const loadConversation = async (convId: number) => {
    setActiveConvId(convId)
    try {
      const res = await fetch(`/api/v1/ai/conversations/${convId}`)
      const data = await res.json()
      setMessages(data.messages?.map((m: any) => ({ id: String(m.id ?? Math.random()), role: m.role, content: m.content })) ?? [])
    } catch { setMessages([]) }
  }

  const createNewConversation = async () => {
    try {
      const res = await fetch('/api/v1/ai/conversations', { method: 'POST' })
      const data = await res.json()
      setMessages([])
      setActiveConvId(data.id)
      fetchConversations()
    } catch {}
  }

  const deleteConversation = async (convId: number) => {
    if (!await showConfirm('确定删除此对话及其所有消息？')) return
    setDeletingId(convId)
    try {
      await fetch(`/api/v1/ai/conversations/${convId}`, { method: 'DELETE' })
      if (activeConvId === convId) { setActiveConvId(null); setMessages([]) }
      fetchConversations()
    } finally { setDeletingId(null) }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
  }

  const sendMessage = async (overrideInput?: string) => {
    const text = (overrideInput ?? input).trim()
    if (!text || streaming) return

    // Ensure we have a conversation
    let convId = activeConvId
    if (!convId) {
      try {
        const res = await fetch('/api/v1/ai/conversations', { method: 'POST' })
        if (!res.ok) throw new Error('create failed')
        const data = await res.json()
        convId = data.id
        setActiveConvId(convId)
      } catch {
        setStreaming(false)
        const errId = `a-${Date.now()}`
        setMessages(prev => [...prev,
          { id: `u-${Date.now()}`, role: 'user' as const, content: text },
          { id: errId, role: 'assistant' as const, content: '无法连接到后端，请确认服务正在运行。', streaming: false, error: true },
        ])
        return
      }
    }

    setInput('')
    setStreaming(true)

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
    const assistantId = `a-${Date.now()}`
    streamingMsgIdRef.current = assistantId
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', toolSteps: [], streaming: true }

    setMessages(prev => [...prev, userMsg, assistantMsg])

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch(`/api/v1/ai/conversations/${convId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: ctrl.signal,
      })

      // 降级：后端未升级时 /stream 不存在，回退到同步 /chat
      if (!res.ok) {
        const fallback = await fetch(`/api/v1/ai/conversations/${convId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
          signal: ctrl.signal,
        })
        if (!fallback.ok) throw new Error('Chat failed')
        const data = await fallback.json()
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: data.reply || '无法获取回复', streaming: false } : m
        ))
        fetchConversations()
        return
      }

      if (!res.body) throw new Error('Stream body missing')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: any
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === 'tool_start') {
            setMessages(prev => prev.map(m =>
              m.id === assistantId
                ? { ...m, toolSteps: [...(m.toolSteps ?? []), { tool: event.tool, status: 'running' }] }
                : m
            ))
          } else if (event.type === 'tool_done') {
            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m
              const steps = [...(m.toolSteps ?? [])]
              const idx = steps.map(s => s.tool).lastIndexOf(event.tool)
              if (idx >= 0) steps[idx] = { ...steps[idx], status: 'done' }
              return { ...m, toolSteps: steps }
            }))
          } else if (event.type === 'text') {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: event.content, streaming: false } : m
            ))
          } else if (event.type === 'error') {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: event.message ?? '发生错误', streaming: false, error: true } : m
            ))
          } else if (event.type === 'done') {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, streaming: false } : m
            ))
            fetchConversations()
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: '连接失败，请确保后端服务正在运行。', streaming: false, error: true }
            : m
        ))
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: m.content || '（已停止生成）', streaming: false } : m
        ))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
      streamingMsgIdRef.current = null
    }
  }

  const handleCardClick = (card: typeof CAPABILITY_CARDS[0]) => {
    if (card.fillInput) {
      setInput(card.prompt)
      textareaRef.current?.focus()
    } else {
      sendMessage(card.prompt)
    }
  }

  const modelLabel = activeModel.model_name
    ? `${activeModel.provider_name} / ${activeModel.model_name}`
    : activeModel.provider_name

  const smartPrompts = getSmartPrompts()

  return (
    <div className="flex h-[calc(100vh-5rem)] max-md:h-[calc(100vh-7rem)] gap-3 relative overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`
        flex-shrink-0 flex flex-col rounded-2xl bg-bg-card border border-border overflow-hidden
        transition-all duration-200
        ${sidebarOpen ? 'w-52' : 'w-0 border-0'}
        max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:shadow-2xl
        ${sidebarOpen ? 'max-lg:w-60' : 'max-lg:w-0'}
      `}>
        {sidebarOpen && (
          <div className="flex flex-col h-full min-w-[13rem]">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-accent-blue" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">历史对话</span>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="p-1 rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-400">
                <PanelLeftClose size={13} />
              </button>
            </div>

            <div className="px-3 pb-2">
              <button
                onClick={createNewConversation}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg-hover/50 hover:bg-accent-blue/10 hover:border-accent-blue/40 text-[11px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all"
              >
                <Plus size={13} /> 新对话
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {conversations.length === 0 ? (
                <p className="text-[11px] text-gray-500 text-center py-8">暂无对话记录</p>
              ) : (
                conversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => loadConversation(c.id)}
                    className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      activeConvId === c.id
                        ? 'bg-accent-blue/10 border border-accent-blue/30'
                        : 'hover:bg-bg-hover border border-transparent'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-800 dark:text-gray-300 truncate">{c.title || '新对话'}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(c.updated_at)} · {c.message_count} 条</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
                      disabled={deletingId === c.id}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-all"
                    >
                      {deletingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 存储用量 & 保留策略 */}
            {(() => {
              const maxMsgs = chatStats?.max_messages_per_user ?? 200
              const retentionDays = chatStats?.retention_days ?? 30
              // 优先用 stats 精确值，否则从已加载的对话列表加总
              const msgCount = chatStats?.message_count
                ?? conversations.reduce((s, c) => s + (c.message_count ?? 0), 0)
              const pct = maxMsgs > 0 ? Math.min(100, (msgCount / maxMsgs) * 100) : 0
              const nearLimit = maxMsgs > 0 && msgCount >= maxMsgs * 0.8
              return (
                <div className="mx-3 mb-3 px-3 py-2.5 rounded-lg bg-bg-hover/60 border border-border/60">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">存储用量</span>
                    <span className={`text-[11px] font-medium tabular-nums ${nearLimit ? 'text-amber-500' : 'text-gray-500'}`}>
                      {msgCount} / {maxMsgs} 条
                    </span>
                  </div>
                  <div className="w-full h-1 bg-border rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${nearLimit ? 'bg-amber-500' : 'bg-accent-blue/60'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    {conversations.length} 个会话
                    {retentionDays > 0 && ` · 超 ${retentionDays} 天自动清理`}
                  </p>
                </div>
              )
            })()}
          </div>
        )}
      </aside>

      {/* ─── Main area ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg bg-bg-card border border-border text-gray-500 hover:text-gray-900 dark:hover:text-white shrink-0"
              >
                <PanelLeft size={15} />
              </button>
            )}
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                 style={{ background: 'linear-gradient(135deg,#7C3AED,#A855F7,#EC4899)', boxShadow: '0 4px 12px rgba(124,58,237,0.3)' }}>
              <Sparkles size={15} color="#fff" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-gray-900 dark:text-white leading-tight">WorkTrack AI</h2>
              <p className="text-[11px] text-gray-500 hidden sm:block">智能工作助手 · 日报 · 项目 · 客户 · 合同 · 审批</p>
            </div>
          </div>
          {activeModel.model_name
            ? <StatusBadge variant="success" title="当前模型">{modelLabel}</StatusBadge>
            : <StatusBadge variant="warning">未配置模型</StatusBadge>
          }
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto space-y-5 mb-3 pr-0.5">
          {messages.length === 0 ? (
            /* ─── Welcome screen ─── */
            <div className="py-6 px-2">
              <div className="text-center mb-8">
                <div className="inline-flex w-14 h-14 rounded-2xl items-center justify-center mb-4"
                     style={{ background: 'linear-gradient(135deg,#7C3AED,#A855F7,#EC4899)', boxShadow: '0 8px 24px rgba(124,58,237,0.35)' }}>
                  <Sparkles size={24} color="#fff" strokeWidth={2.2} />
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{greetText}</p>
                <p className="text-sm text-gray-500 mt-1">我是 WorkTrack AI，有什么可以帮你？</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-w-2xl mx-auto">
                {CAPABILITY_CARDS.map((card, i) => (
                  <button
                    key={i}
                    onClick={() => handleCardClick(card)}
                    className={`group text-left p-3.5 rounded-xl border border-border bg-gradient-to-br ${card.gradientClass} ${card.hoverBorder} hover:shadow-sm transition-all`}
                  >
                    <span className="text-2xl block mb-2">{card.emoji}</span>
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug">{card.label}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{card.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ─── Messages ─── */
            messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md text-sm bg-accent-blue text-white whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[88%] min-w-0">
                    {/* Tool steps */}
                    {(msg.toolSteps?.length ?? 0) > 0 && (
                      <ToolStepsBubble steps={msg.toolSteps!} />
                    )}
                    {/* Content */}
                    {msg.streaming && !msg.content ? (
                      <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-bg-hover border border-border text-[13px] text-gray-500">
                        <Loader2 size={14} className="animate-spin text-accent-blue" />
                        <span>正在生成回答…</span>
                      </div>
                    ) : msg.content ? (
                      <div className={`px-4 py-3 rounded-2xl rounded-bl-md text-sm border markdown-body ${
                        msg.error
                          ? 'bg-red-500/8 border-red-500/20 text-red-600 dark:text-red-400'
                          : 'bg-bg-hover border-border text-gray-300'
                      }`}>
                        {hasMarkdown(msg.content)
                          ? <MarkdownRenderer content={msg.content} />
                          : <span className="whitespace-pre-wrap leading-relaxed">{msg.content}</span>
                        }
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Quick prompt chips */}
        {messages.length === 0 && (
          <div className="flex items-center gap-2 mb-2 overflow-x-auto scrollbar-none shrink-0">
            {smartPrompts.map((p, i) => (
              <button
                key={i}
                onClick={() => p.prompt.endsWith('：') ? setInput(p.prompt) : sendMessage(p.prompt)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-hover border border-border text-[11px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-accent-blue/40 hover:bg-accent-blue/5 whitespace-nowrap shrink-0 transition-all"
              >
                <p.icon size={12} />
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="shrink-0">
          <div className="flex items-end gap-2 bg-bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-accent-blue/50 transition-colors">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
              }}
              placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
              disabled={streaming}
              className="flex-1 resize-none bg-transparent text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 outline-none leading-relaxed disabled:opacity-50"
              style={{ minHeight: '24px', maxHeight: '160px' }}
            />
            {streaming ? (
              <button
                onClick={stopStreaming}
                className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors shrink-0"
                title="停止生成"
              >
                <StopCircle size={18} />
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                className="p-2 rounded-xl bg-accent-blue hover:bg-accent-blue/85 disabled:opacity-30 text-white transition-colors shrink-0"
                title="发送 (Enter)"
              >
                <Send size={18} />
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-500 text-center mt-2">
            AI 可能会犯错，重要决策请自行核实
          </p>
        </div>
      </div>
    </div>
  )
}
