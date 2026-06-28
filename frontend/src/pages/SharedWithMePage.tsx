import { useState, useEffect, useCallback } from 'react'
import { Share2, FileText, Users, Briefcase, Building2, FileCheck, Calendar, MessageSquare, Send, X, Loader2, Clock, UserCircle, ExternalLink, ArrowUpRight, ArrowDownLeft, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useNavigate } from 'react-router-dom'

interface ShareItem {
  id: number
  target_type: string
  target_id: number
  shared_by: number
  shared_to: number
  shared_by_name: string
  shared_to_name: string
  permission: string
  expires_at: string | null
  created_at: string
  target_title: string
}

interface Comment {
  id: number
  share_id: number
  user_id: number
  user_name: string
  user_avatar: string | null
  content: string
  created_at: string
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; path: string }> = {
  report:   { label: '日报',   icon: <FileText size={13} />,  color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20',   path: '/reports' },
  meeting:  { label: '会议纪要', icon: <Users size={13} />,    color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20', path: '/meetings' },
  project:  { label: '项目',   icon: <Briefcase size={13} />, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20', path: '/projects' },
  customer: { label: '客户',   icon: <Building2 size={13} />, color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20', path: '/customers' },
  contract: { label: '合同',   icon: <FileCheck size={13} />, color: 'text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-500/10 border-pink-200 dark:border-pink-500/20',   path: '/contracts' },
}

const TABS = [
  { key: '', label: '全部' },
  { key: 'report', label: '日报' },
  { key: 'meeting', label: '会议纪要' },
  { key: 'project', label: '项目' },
  { key: 'customer', label: '客户' },
  { key: 'contract', label: '合同' },
]

function extractSummary(type: string, data: Record<string, unknown>): { lines: { label: string; value: string }[]; body?: string } {
  const lines: { label: string; value: string }[] = []
  const str = (v: unknown) => (v != null && v !== '' ? String(v) : null)

  if (type === 'report') {
    if (str(data.date)) lines.push({ label: '日期', value: str(data.date)! })
    if (str(data.user_name)) lines.push({ label: '提交人', value: str(data.user_name)! })
    return { lines, body: str(data.content_md) || str(data.content) || undefined }
  }
  if (type === 'meeting') {
    if (str(data.title)) lines.push({ label: '主题', value: str(data.title)! })
    if (str(data.meeting_date)) lines.push({ label: '时间', value: str(data.meeting_date)! })
    if (str(data.location)) lines.push({ label: '地点', value: str(data.location)! })
    if (str(data.participants)) lines.push({ label: '参会人', value: str(data.participants)! })
    return { lines, body: str(data.content_md) || str(data.summary) || undefined }
  }
  if (type === 'project') {
    if (str(data.name)) lines.push({ label: '项目名', value: str(data.name)! })
    if (str(data.status)) lines.push({ label: '状态', value: str(data.status)! })
    if (str(data.customer_name)) lines.push({ label: '客户', value: str(data.customer_name)! })
    if (str(data.deal_amount)) lines.push({ label: '金额', value: `${data.deal_amount}${data.deal_amount_unit || ''}` })
    if (str(data.start_date)) lines.push({ label: '开始', value: str(data.start_date)! })
    return { lines, body: str(data.description) || str(data.background) || undefined }
  }
  if (type === 'customer') {
    if (str(data.name)) lines.push({ label: '客户名', value: str(data.name)! })
    if (str(data.industry)) lines.push({ label: '行业', value: str(data.industry)! })
    if (str(data.region)) lines.push({ label: '地区', value: str(data.region)! })
    if (str(data.contact_name)) lines.push({ label: '联系人', value: str(data.contact_name)! })
    return { lines, body: str(data.notes) || str(data.description) || undefined }
  }
  if (type === 'contract') {
    if (str(data.contract_no)) lines.push({ label: '合同号', value: str(data.contract_no)! })
    if (str(data.title)) lines.push({ label: '名称', value: str(data.title)! })
    if (str(data.status)) lines.push({ label: '状态', value: str(data.status)! })
    if (str(data.contract_amount)) lines.push({ label: '金额', value: `${data.contract_amount}${data.amount_unit || ''}` })
    if (str(data.sign_date)) lines.push({ label: '签署日期', value: str(data.sign_date)! })
    return { lines, body: str(data.notes) || str(data.description) || undefined }
  }
  return { lines }
}

export default function SharedWithMePage() {
  const { hasPermission, fetchWithAuth } = useAuth()
  const { toast: showToast } = useToast()
  const navigate = useNavigate()

  const [direction, setDirection] = useState<'sent' | 'received'>('sent')
  const [shares, setShares] = useState<ShareItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('')
  const [selectedShare, setSelectedShare] = useState<ShareItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState<{ lines: { label: string; value: string }[]; body?: string } | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [sendingComment, setSendingComment] = useState(false)

  const loadShares = useCallback(() => {
    setLoading(true)
    const base = direction === 'sent' ? '/api/v1/shares/sent' : '/api/v1/shares/received'
    const url = base + (activeTab ? `?target_type=${activeTab}` : '')
    fetchWithAuth(url)
      .then(r => r.json())
      .then(data => setShares(Array.isArray(data) ? data : []))
      .catch(() => showToast('加载分享列表失败', 'error'))
      .finally(() => setLoading(false))
  }, [direction, activeTab, fetchWithAuth, showToast])

  useEffect(() => { loadShares() }, [loadShares])

  const openDetail = async (share: ShareItem) => {
    setSelectedShare(share)
    setDetailLoading(true)
    setDetailData(null)
    setComments([])

    const urlMap: Record<string, string> = {
      report:   `/api/v1/reports/${share.target_id}`,
      meeting:  `/api/v1/meetings/${share.target_id}`,
      project:  `/api/v1/projects/${share.target_id}`,
      customer: `/api/v1/customers/${share.target_id}/overview`,
      contract: `/api/v1/contracts/${share.target_id}`,
    }
    const url = urlMap[share.target_type]
    if (url) {
      try {
        const res = await fetchWithAuth(url)
        if (res.ok) {
          const data = await res.json()
          setDetailData(extractSummary(share.target_type, data))
        } else {
          setDetailData({ lines: [], body: '无法加载详情，可能没有访问权限' })
        }
      } catch {
        setDetailData({ lines: [], body: '加载失败' })
      }
    }

    try {
      const res = await fetchWithAuth(`/api/v1/shares/${share.id}/comments`)
      if (res.ok) {
        const data = await res.json()
        setComments(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }

    setDetailLoading(false)
  }

  const closeDetail = () => {
    setSelectedShare(null)
    setDetailData(null)
    setComments([])
    setNewComment('')
  }

  const submitComment = async () => {
    if (!selectedShare || !newComment.trim()) return
    setSendingComment(true)
    try {
      const res = await fetchWithAuth(`/api/v1/shares/${selectedShare.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: newComment.trim() }),
      })
      if (!res.ok) {
        const err = await res.json()
        showToast(err.detail || '评论失败', 'error')
        return
      }
      const comment = await res.json()
      setComments(prev => [...prev, comment])
      setNewComment('')
    } catch {
      showToast('评论请求失败', 'error')
    } finally {
      setSendingComment(false)
    }
  }

  const revokeShare = async (shareId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetchWithAuth(`/api/v1/shares/${shareId}`, { method: 'DELETE' })
      if (res.ok) {
        showToast('已撤销分享', 'success')
        setShares(prev => prev.filter(s => s.id !== shareId))
      } else {
        const err = await res.json()
        showToast(err.detail || '撤销失败', 'error')
      }
    } catch {
      showToast('撤销请求失败', 'error')
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="space-y-6 pb-12">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-accent-blue/10 border border-accent-blue/20">
            <Share2 size={20} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">协作分享</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {direction === 'sent' ? '我分享出去的内容' : '别人分享给我的内容'}
            </p>
          </div>
        </div>
        {/* 发出 / 收到 切换 */}
        <div className="inline-flex p-1 rounded-xl bg-bg-hover/80 border border-gray-200 dark:border-border/20">
          <button
            onClick={() => { setDirection('sent'); setActiveTab('') }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
              direction === 'sent'
                ? 'bg-bg-card text-gray-900 dark:text-gray-100 shadow-md border-gray-200 dark:border-border/30'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <ArrowUpRight size={14} /> 我发出的
          </button>
          <button
            onClick={() => { setDirection('received'); setActiveTab('') }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
              direction === 'received'
                ? 'bg-bg-card text-gray-900 dark:text-gray-100 shadow-md border-gray-200 dark:border-border/30'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            <ArrowDownLeft size={14} /> 收到的
          </button>
        </div>
      </div>

      {/* 标签筛选 */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              activeTab === tab.key
                ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30'
                : 'bg-bg-card border-border text-gray-500 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容列表 */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">
          <Loader2 size={24} className="mx-auto animate-spin mb-3" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : shares.length === 0 ? (
        <div className="text-center py-20">
          <Share2 size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            {direction === 'sent' ? '还没有发出分享' : '暂无收到的分享'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-600">
            {direction === 'sent' ? '在日报、会议、项目等详情页中可以分享给同事' : '其他用户分享给你的内容会在这里显示'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {shares.map(share => {
            const cfg = TYPE_CONFIG[share.target_type] || TYPE_CONFIG.report
            return (
              <div
                key={share.id}
                onClick={() => openDetail(share)}
                className="group p-4 rounded-xl bg-bg-card border border-border hover:border-accent-blue/40 hover:shadow-sm transition-all cursor-pointer flex flex-col gap-3"
              >
                {/* 类型标签 + 权限 / 撤销按钮 */}
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${cfg.color}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                  {direction === 'sent' ? (
                    <button
                      onClick={e => revokeShare(share.id, e)}
                      className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="撤销分享"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : share.permission === 'commenter' ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                      <MessageSquare size={10} /> 可评论
                    </span>
                  ) : null}
                </div>

                {/* 标题 */}
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-accent-blue transition-colors">
                  {share.target_title || `#${share.target_id}`}
                </p>

                {/* 元信息 */}
                <div className="flex flex-col gap-1 mt-auto">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <UserCircle size={12} />
                    {direction === 'sent' ? (
                      <span>分享给 <span className="font-medium text-gray-700 dark:text-gray-300">{share.shared_to_name || '未知'}</span></span>
                    ) : (
                      <span>来自 <span className="font-medium text-gray-700 dark:text-gray-300">{share.shared_by_name || '未知'}</span></span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                    <Calendar size={12} />
                    <span>{formatDate(share.created_at)}</span>
                  </div>
                  {share.expires_at && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-500">
                      <Clock size={12} />
                      <span>有效期至 {formatDate(share.expires_at)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 详情弹窗 */}
      {selectedShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeDetail}>
          <div
            className="bg-bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                {(() => {
                  const cfg = TYPE_CONFIG[selectedShare.target_type] || TYPE_CONFIG.report
                  return (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border shrink-0 ${cfg.color}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                  )
                })()}
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {selectedShare.target_title || `#${selectedShare.target_id}`}
                </h3>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {/* 跳转到原始记录 */}
                {(() => {
                  const cfg = TYPE_CONFIG[selectedShare.target_type]
                  if (!cfg) return null
                  return (
                    <button
                      onClick={() => { navigate(cfg.path); closeDetail() }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border text-gray-500 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue transition-colors"
                      title="在原页面中查看"
                    >
                      <ExternalLink size={12} /> 查看原记录
                    </button>
                  )
                })()}
                <button onClick={closeDetail} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-bg-hover transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto">
              {detailLoading ? (
                <div className="text-center py-12 text-gray-400">
                  <Loader2 size={22} className="mx-auto animate-spin mb-2" />
                  <span className="text-sm">加载中...</span>
                </div>
              ) : detailData ? (
                <div className="px-5 py-4 space-y-4">
                  {/* 分享来源 */}
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 pb-3 border-b border-border">
                    <UserCircle size={13} />
                    {direction === 'sent' ? (
                      <span>你于 {formatDate(selectedShare.created_at)} 分享给 <span className="font-medium text-gray-700 dark:text-gray-300">{selectedShare.shared_to_name}</span></span>
                    ) : (
                      <span>由 <span className="font-medium text-gray-700 dark:text-gray-300">{selectedShare.shared_by_name}</span> 于 {formatDate(selectedShare.created_at)} 分享给你</span>
                    )}
                    {selectedShare.permission === 'commenter'
                      ? <span className="ml-auto text-emerald-600 dark:text-emerald-400 font-medium">可评论</span>
                      : <span className="ml-auto text-gray-400">仅查看</span>
                    }
                  </div>

                  {/* 结构化摘要 */}
                  {detailData.lines.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      {detailData.lines.map(({ label, value }) => (
                        <div key={label} className="flex gap-1.5 text-xs">
                          <span className="text-gray-400 dark:text-gray-500 shrink-0 w-[4em]">{label}</span>
                          <span className="text-gray-700 dark:text-gray-200 break-words min-w-0 flex-1">{value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 正文内容 */}
                  {detailData.body && (
                    <div className="pt-3 border-t border-border">
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">内容摘要</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap line-clamp-10 leading-relaxed">
                        {detailData.body.replace(/#+\s/g, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n')}
                      </p>
                    </div>
                  )}

                  {!detailData.lines.length && !detailData.body && (
                    <p className="text-sm text-gray-400 py-4 text-center">暂无可展示的内容</p>
                  )}
                </div>
              ) : null}

              {/* 评论区 */}
              <div className="px-5 pb-5">
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-1.5">
                    <MessageSquare size={12} /> 评论 ({comments.length})
                  </h4>
                  {comments.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {comments.map(c => (
                        <div key={c.id} className="flex gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-[11px] font-bold shrink-0">
                            {(c.user_name || '?')[0].toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{c.user_name}</span>
                              <span className="text-[11px] text-gray-400">{formatDate(c.created_at)}</span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 break-words">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {comments.length === 0 && <p className="text-xs text-gray-400 mb-3">暂无评论</p>}

                  {selectedShare.permission === 'commenter' && hasPermission('share:comment') ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submitComment()}
                        placeholder="输入评论，Enter 发送..."
                        className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-colors"
                      />
                      <button
                        onClick={submitComment}
                        disabled={sendingComment || !newComment.trim()}
                        className="px-3 py-2 rounded-lg bg-accent-blue text-white text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {sendingComment ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">当前权限为只读，无法评论</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
