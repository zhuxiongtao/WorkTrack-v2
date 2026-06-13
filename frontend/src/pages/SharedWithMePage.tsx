import { useState, useEffect, useCallback } from 'react'
import { Share2, FileText, Users, Briefcase, Building2, FileCheck, Calendar, MessageSquare, Send, X, Loader2, Clock, Eye } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import MarkdownRenderer from '../components/MarkdownRenderer'

interface ShareItem {
  id: number
  target_type: string
  target_id: number
  shared_by: number
  shared_to: number
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

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  report: { label: '日报', icon: <FileText size={14} />, color: 'text-blue-400 bg-blue-500/10' },
  meeting: { label: '会议', icon: <Users size={14} />, color: 'text-purple-400 bg-purple-500/10' },
  project: { label: '项目', icon: <Briefcase size={14} />, color: 'text-green-400 bg-green-500/10' },
  customer: { label: '客户', icon: <Building2 size={14} />, color: 'text-orange-400 bg-orange-500/10' },
  contract: { label: '合同', icon: <FileCheck size={14} />, color: 'text-pink-400 bg-pink-500/10' },
}

const TABS = [
  { key: '', label: '全部' },
  { key: 'report', label: '日报' },
  { key: 'meeting', label: '会议' },
  { key: 'project', label: '项目' },
  { key: 'customer', label: '客户' },
  { key: 'contract', label: '合同' },
]

export default function SharedWithMePage() {
  const { hasPermission } = useAuth()
  const { toast: showToast } = useToast()
  const [shares, setShares] = useState<ShareItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('')
  const [selectedShare, setSelectedShare] = useState<ShareItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailContent, setDetailContent] = useState<string>('')
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [sendingComment, setSendingComment] = useState(false)

  const loadShares = useCallback(() => {
    setLoading(true)
    const url = '/api/v1/shares/received' + (activeTab ? `?target_type=${activeTab}` : '')
    fetch(url)
      .then(r => r.json())
      .then(data => setShares(Array.isArray(data) ? data : []))
      .catch(() => showToast('加载分享列表失败', 'error'))
      .finally(() => setLoading(false))
  }, [activeTab, showToast])

  useEffect(() => { loadShares() }, [loadShares])

  const openDetail = async (share: ShareItem) => {
    setSelectedShare(share)
    setDetailLoading(true)
    setDetailContent('')
    setComments([])

    // 加载详情内容
    try {
      let url = ''
      if (share.target_type === 'report') {
        url = `/api/v1/reports/${share.target_id}`
      } else if (share.target_type === 'meeting') {
        url = `/api/v1/meetings/${share.target_id}`
      } else if (share.target_type === 'project') {
        url = `/api/v1/projects/${share.target_id}`
      } else if (share.target_type === 'customer') {
        url = `/api/v1/customers/${share.target_id}/overview`
      } else if (share.target_type === 'contract') {
        url = `/api/v1/contracts/${share.target_id}`
      }
      if (url) {
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          if (data.content_md) {
            setDetailContent(data.content_md)
          } else if (data.description) {
            setDetailContent(data.description)
          } else if (data.notes) {
            setDetailContent(data.notes)
          } else {
            setDetailContent(JSON.stringify(data, null, 2))
          }
        } else {
          setDetailContent('无法加载详情内容')
        }
      }
    } catch {
      setDetailContent('加载失败')
    }

    // 加载评论
    try {
      const res = await fetch(`/api/v1/shares/${share.id}/comments`)
      if (res.ok) {
        const data = await res.json()
        setComments(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }

    setDetailLoading(false)
  }

  const closeDetail = () => {
    setSelectedShare(null)
    setDetailContent('')
    setComments([])
    setNewComment('')
  }

  const submitComment = async () => {
    if (!selectedShare || !newComment.trim()) return
    setSendingComment(true)
    try {
      const res = await fetch(`/api/v1/shares/${selectedShare.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div>
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20">
            <Share2 size={22} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">我的分享</h2>
            <p className="text-sm text-gray-500 mt-0.5">{shares.length} 条分享内容</p>
          </div>
        </div>
      </div>

      {/* 标签筛选 */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-[#3B82F6] text-[#fff] shadow-lg shadow-blue-500/20'
                : 'bg-bg-card border border-border text-gray-400 hover:text-white hover:border-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容列表 */}
      {loading ? (
        <div className="text-center py-20 text-gray-500">
          <Loader2 size={28} className="mx-auto animate-spin mb-3" />
          加载中...
        </div>
      ) : shares.length === 0 ? (
        <div className="text-center py-20">
          <Share2 size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-2">暂无分享的内容</p>
          <p className="text-xs text-gray-600">当其他用户分享数据给你时，会在这里显示</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {shares.map(share => {
            const config = TYPE_CONFIG[share.target_type] || TYPE_CONFIG.report
            return (
              <div
                key={share.id}
                onClick={() => openDetail(share)}
                className="group p-4 rounded-xl bg-bg-card border border-border hover:border-[#3B82F6]/50 transition-all cursor-pointer min-h-[140px] flex flex-col"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${config.color}`}>
                    {config.icon}
                    {config.label}
                  </span>
                  {share.permission === 'commenter' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-emerald-400 bg-emerald-500/10">
                      <MessageSquare size={10} />
                      可评论
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-medium text-white mb-2 line-clamp-2 group-hover:text-[#3B82F6] transition-colors">
                  {share.target_title || `#${share.target_id}`}
                </h3>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Eye size={11} />
                    {share.shared_to_name}
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Calendar size={11} />
                    {formatDate(share.created_at)}
                  </span>
                </div>
                {share.expires_at && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-amber-500/70">
                    <Clock size={11} />
                    有效期至 {formatDate(share.expires_at)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 详情弹窗 */}
      {selectedShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={closeDetail}>
          <div
            className="bg-bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                {(() => {
                  const config = TYPE_CONFIG[selectedShare.target_type] || TYPE_CONFIG.report
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${config.color}`}>
                      {config.icon}
                      {config.label}
                    </span>
                  )
                })()}
                <h3 className="text-base font-medium text-white">{selectedShare.target_title}</h3>
              </div>
              <button onClick={closeDetail} className="text-gray-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {detailLoading ? (
                <div className="text-center py-10 text-gray-500">
                  <Loader2 size={24} className="mx-auto animate-spin mb-2" />
                  加载中...
                </div>
              ) : (
                <div className="prose prose-invert prose-sm max-w-none">
                  <MarkdownRenderer content={detailContent || '暂无内容'} />
                </div>
              )}

              {/* 评论区 */}
              <div className="mt-6 pt-4 border-t border-border">
                <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  <MessageSquare size={14} />
                  评论 ({comments.length})
                </h4>
                {comments.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {comments.map(c => (
                      <div key={c.id} className="flex gap-3">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-[#fff] text-xs font-medium shrink-0">
                          {(c.user_name || '?')[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium text-gray-300">{c.user_name}</span>
                            <span className="text-xs text-gray-600">{formatDate(c.created_at)}</span>
                          </div>
                          <p className="text-sm text-gray-400 break-words">{c.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 mb-4">暂无评论</p>
                )}

                {/* 评论输入框 */}
                {selectedShare.permission === 'commenter' && hasPermission('share:comment') && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submitComment()}
                      placeholder="输入评论..."
                      className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                    />
                    <button
                      onClick={submitComment}
                      disabled={sendingComment || !newComment.trim()}
                      className="px-3 py-2 rounded-lg bg-[#3B82F6] text-[#fff] text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {sendingComment ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                  </div>
                )}
                {selectedShare.permission !== 'commenter' && (
                  <p className="text-xs text-gray-600 italic">当前分享权限为只读，无法评论</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
