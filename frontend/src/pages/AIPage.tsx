import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Sparkles, Zap, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeft, Loader2, Search, FileText, Building2, Briefcase, CalendarCheck, TrendingUp, Globe, Clock } from 'lucide-react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useToast } from '../contexts/ToastContext'

function hasMarkdown(str: string): boolean {
  return /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\*\*|__|`{1,3}|^\s*>\s|\[.*\]\(.*\)/m.test(str)
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Conversation {
  id: number
  title: string
  updated_at: string
  message_count: number
}

export default function AIPage() {
  const { confirm: showConfirm } = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<number | null>(null)
  const [activeModel, setActiveModel] = useState<{ provider_name: string; model_name: string }>({
    provider_name: '未配置', model_name: '',
  })
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 获取当前激活模型
  const fetchActiveModel = useCallback(() => {
    fetch('/api/v1/ai/active-model')
      .then((r) => r.json())
      .then((d) => setActiveModel(d))
      .catch(() => {})
  }, [])

  // 获取对话列表
  const fetchConversations = useCallback(() => {
    fetch('/api/v1/ai/conversations')
      .then((r) => r.json())
      .then((d) => setConversations(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchActiveModel()
    fetchConversations()
  }, [fetchActiveModel, fetchConversations])

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // 加载指定对话的消息
  const loadConversation = async (convId: number) => {
    setActiveConvId(convId)
    try {
      const res = await fetch(`/api/v1/ai/conversations/${convId}`)
      const data = await res.json()
      setMessages(data.messages?.map((m: any) => ({ role: m.role, content: m.content })) || [])
    } catch {
      setMessages([])
    }
  }

  // 创建新对话
  const createNewConversation = async () => {
    try {
      const res = await fetch('/api/v1/ai/conversations', { method: 'POST' })
      const data = await res.json()
      setMessages([])
      setActiveConvId(data.id)
      fetchConversations()
    } catch { /* noop */ }
  }

  // 删除对话
  const deleteConversation = async (convId: number) => {
    if (!await showConfirm('确定删除此对话及其所有消息？')) return
    setDeletingId(convId)
    try {
      await fetch(`/api/v1/ai/conversations/${convId}`, { method: 'DELETE' })
      if (activeConvId === convId) {
        setActiveConvId(null)
        setMessages([])
      }
      fetchConversations()
    } finally {
      setDeletingId(null)
    }
  }

  // 发送消息
  const sendMessage = async () => {
    if (!input.trim() || loading) return

    // 如果没有活跃对话，自动创建
    let convId = activeConvId
    if (!convId) {
      try {
        const res = await fetch('/api/v1/ai/conversations', { method: 'POST' })
        const data = await res.json()
        convId = data.id
        setActiveConvId(convId)
      } catch {
        // fallback to stateless chat
      }
    }

    const userMsg: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      let res: Response
      if (convId) {
        res = await fetch(`/api/v1/ai/conversations/${convId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: input }),
        })
      } else {
        res = await fetch('/api/v1/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: input, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
        })
      }
      const data = await res.json()
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply || '抱歉，我无法处理这个请求。' }])
      if (convId) fetchConversations()
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '连接失败，请确保后端服务正在运行。' }])
    } finally {
      setLoading(false)
    }
  }

  const modelLabel = activeModel.model_name
    ? `${activeModel.provider_name} / ${activeModel.model_name}`
    : activeModel.provider_name

  return (
    <div className="flex h-[calc(100vh-5rem)] max-md:h-[calc(100vh-7rem)] gap-4 relative">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setSidebarOpen(false)} />
      )}
      {/* 侧边栏 - 对话历史 */}
      <div className={`
        ${sidebarOpen ? 'w-48' : 'w-0'} transition-all duration-200 overflow-hidden flex flex-col rounded-2xl bg-bg-card border border-bg-hover
        max-md:absolute max-md:inset-y-0 max-md:left-2 max-md:z-40 max-md:shadow-2xl
        ${sidebarOpen ? 'max-md:w-60' : 'max-md:w-0 max-md:border-0'}
      `}>
        {sidebarOpen && (
          <div className="flex flex-col h-full">
            <div className="p-4 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-400 flex items-center gap-2">
                <MessageSquare size={14} /> 历史对话
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-gray-600 hover:text-gray-400"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
            <button
              onClick={createNewConversation}
              className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-hover text-xs text-gray-300 hover:text-white hover:bg-border border border-border transition-colors"
            >
              <Plus size={14} /> 新对话
            </button>
            <div className="flex-1 overflow-y-auto px-2 space-y-1">
              {conversations.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-8">暂无对话记录</p>
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
                      <p className="text-xs text-gray-300 truncate">{c.title || '新对话'}</p>
                      <p className="text-[10px] text-gray-600 mt-0.5">
                        {c.message_count} 条消息 · {new Date(c.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
                      disabled={deletingId === c.id}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-600 hover:text-red-400 transition-all"
                    >
                      {deletingId === c.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between gap-2 mb-3 max-md:mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg bg-bg-card border border-border text-gray-400 hover:text-white shrink-0"
              >
                <PanelLeft size={16} />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-lg max-md:text-base font-bold text-white truncate">AI 中心</h2>
              <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">智能助手 · 搜索日报客户项目会议 · AI 分析 · 联网查询 · 自动任务</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-hover border border-border shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${activeModel.model_name ? 'bg-[#10B981]' : 'bg-gray-600'}`} />
            <span className="text-[10px] max-md:text-[9px] text-gray-400">{modelLabel}</span>
          </div>
        </div>

        {/* 聊天区域 */}
        <div className="flex-1 overflow-y-auto mb-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Sparkles size={40} className="mx-auto text-[#8B5CF6] mb-4" />
              <p className="text-gray-300 text-lg font-medium mb-2">你好！我是 WorkTrack AI 助手</p>
              <p className="text-xs text-gray-500 mb-8">我可以帮你完成以下工作</p>
              {/* 能力卡片 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-xl mx-auto">
                {[
                  { icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10', label: '日报搜索', desc: '语义搜索日报' },
                  { icon: Building2, color: 'text-purple-400', bg: 'bg-purple-500/10', label: '客户查询', desc: '客户详情+动态' },
                  { icon: Briefcase, color: 'text-amber-400', bg: 'bg-amber-500/10', label: '项目分析', desc: 'AI评估+建议' },
                  { icon: CalendarCheck, color: 'text-green-400', bg: 'bg-green-500/10', label: '会议纪要', desc: '搜索会议记录' },
                  { icon: Globe, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: '联网搜索', desc: 'Tavily实时查询' },
                  { icon: TrendingUp, color: 'text-pink-400', bg: 'bg-pink-500/10', label: '日报总结', desc: '今日工作概览' },
                  { icon: Clock, color: 'text-orange-400', bg: 'bg-orange-500/10', label: '定时任务', desc: '自动化调度' },
                  { icon: Search, color: 'text-gray-400', bg: 'bg-gray-500/10', label: '全局搜索', desc: '跨模块检索' },
                ].map((cap, i) => (
                  <div key={i} className="p-3 rounded-xl bg-bg-hover border border-border/50 hover:border-border transition-colors">
                    <div className={`w-8 h-8 rounded-lg ${cap.bg} flex items-center justify-center mx-auto mb-2`}>
                      <cap.icon size={16} className={cap.color} />
                    </div>
                    <p className="text-xs font-medium text-gray-300">{cap.label}</p>
                    <p className="text-[10px] text-gray-600 mt-0.5">{cap.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] max-md:max-w-[92%] px-3.5 py-2.5 max-md:px-3 max-md:py-2 rounded-2xl text-sm max-md:text-[13px] ${
                  msg.role === 'user'
                    ? 'bg-accent-blue text-white rounded-br-md'
                    : 'bg-bg-hover text-gray-300 rounded-bl-md border border-border markdown-body'
                }`}
              >
                {msg.role === 'user' ? (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : hasMarkdown(msg.content) ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <span className="whitespace-pre-wrap leading-relaxed">{msg.content}</span>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-bg-hover border border-border">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-accent-blue animate-pulse" />
                  <span className="text-sm text-gray-500">思考中...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 快捷指令 */}
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto scrollbar-none">
          {[
            { icon: Search, label: '/搜索', color: 'text-blue-400' },
            { icon: TrendingUp, label: '/总结', color: 'text-pink-400' },
            { icon: Building2, label: '/客户', color: 'text-purple-400' },
            { icon: Briefcase, label: '/项目', color: 'text-amber-400' },
            { icon: Globe, label: '/搜索公司', color: 'text-cyan-400' },
          ].map((cmd, i) => (
            <button
              key={i}
              onClick={() => setInput(cmd.label + ' ')}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover text-[10px] text-gray-400 hover:text-white hover:bg-border whitespace-nowrap border border-border shrink-0"
            >
              <cmd.icon size={10} className={cmd.color} />
              {cmd.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="输入消息，Enter 发送..."
            className="flex-1 px-4 py-3 rounded-xl bg-bg-card border border-border text-sm text-gray-300 outline-none focus:border-accent-blue placeholder-gray-600"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="p-3 rounded-xl bg-accent-blue text-white hover:bg-accent-blue/85 disabled:opacity-50 transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
