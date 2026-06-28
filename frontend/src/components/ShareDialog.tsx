import { useState, useEffect } from 'react'
import { Share2, X, User, Calendar, Send, Trash2 } from 'lucide-react'
import SearchableSelect from './SearchableSelect'

interface ShareDialogProps {
  targetType: 'report' | 'meeting' | 'project' | 'customer' | 'contract'
  targetId: number
  targetTitle?: string
  open: boolean
  onClose: () => void
}

interface ShareRecord {
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

interface SimpleUser {
  id: number
  name: string
  username: string
}

export default function ShareDialog({ targetType, targetId, targetTitle, open, onClose }: ShareDialogProps) {
  const [shares, setShares] = useState<ShareRecord[]>([])
  const [users, setUsers] = useState<SimpleUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('')
  const [permission, setPermission] = useState<'viewer' | 'commenter'>('viewer')
  const [expiresAt, setExpiresAt] = useState('')
  const [, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      loadShares()
      loadUsers()
    }
  }, [open, targetType, targetId])

  const loadShares = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/shares/target/${targetType}/${targetId}`)
      if (res.ok) {
        const data = await res.json()
        setShares(data)
      }
    } catch (e) {
      console.error('Failed to load shares:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadUsers = async () => {
    try {
      const res = await fetch('/api/v1/users/simple')
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      }
    } catch (e) {
      console.error('Failed to load users:', e)
    }
  }

  const handleShare = async () => {
    if (!selectedUserId) return
    setError('')
    setSubmitting(true)
    try {
      const body: any = {
        target_type: targetType,
        target_id: targetId,
        shared_to: Number(selectedUserId),
        permission,
      }
      if (expiresAt) {
        body.expires_at = new Date(expiresAt).toISOString()
      }
      const res = await fetch('/api/v1/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        await loadShares()
        setSelectedUserId('')
        setExpiresAt('')
      } else {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || '分享失败')
      }
    } catch (e) {
      setError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (shareId: number) => {
    try {
      const res = await fetch(`/api/v1/shares/${shareId}`, { method: 'DELETE' })
      if (res.ok) {
        setShares(prev => prev.filter(s => s.id !== shareId))
      }
    } catch (e) {
      console.error('Failed to revoke:', e)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-bg-card border border-border rounded-xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Share2 size={16} className="text-[#3B82F6]" />
            <span className="text-sm font-medium text-white">分享</span>
            {targetTitle && (
              <span className="text-xs text-gray-500 truncate max-w-[200px]">{targetTitle}</span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* 新建分享表单 */}
          <div className="space-y-3">
            <label className="text-xs text-gray-400">分享给</label>
            <SearchableSelect
              options={[
                { value: '', label: '选择用户...' },
                ...users.map(u => ({ value: u.id, label: `${u.name} (@${u.username})` })),
              ]}
              value={selectedUserId}
              onChange={(v) => setSelectedUserId(v && v !== 0 ? (v as number) : '')}
            />

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">权限</label>
                <div className="flex gap-2">
                  <label className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    permission === 'viewer' ? 'border-[#3B82F6] bg-[#3B82F6]/10 text-[#3B82F6]' : 'border-border text-gray-400'
                  }`}>
                    <input type="radio" name="perm" value="viewer" checked={permission === 'viewer'} onChange={() => setPermission('viewer')} className="hidden" />
                    只读
                  </label>
                  <label className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    permission === 'commenter' ? 'border-[#3B82F6] bg-[#3B82F6]/10 text-[#3B82F6]' : 'border-border text-gray-400'
                  }`}>
                    <input type="radio" name="perm" value="commenter" checked={permission === 'commenter'} onChange={() => setPermission('commenter')} className="hidden" />
                    可评论
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 mb-1 block">过期时间（可选）</label>
              <input
                type="date"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full bg-bg-hover border border-border rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-[#3B82F6]/50"
              />
            </div>

            {error && <div className="text-xs text-red-400">{error}</div>}

            <button
              onClick={handleShare}
              disabled={!selectedUserId || submitting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#3B82F6] text-white text-sm rounded-lg hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={14} />
              {submitting ? '分享中...' : '分享'}
            </button>
          </div>

          {/* 已分享列表 */}
          {shares.length > 0 && (
            <div className="border-t border-border pt-4">
              <label className="text-xs text-gray-400 mb-3 block">已分享给</label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {shares.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-2.5 bg-bg-hover rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-bg-card flex items-center justify-center">
                      <User size={12} className="text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white truncate">{s.shared_to_name}</div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500">
                        <span className={s.permission === 'commenter' ? 'text-blue-400' : 'text-gray-400'}>
                          {s.permission === 'commenter' ? '可评论' : '只读'}
                        </span>
                        {s.expires_at && (
                          <span className="flex items-center gap-0.5">
                            <Calendar size={9} />
                            {new Date(s.expires_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevoke(s.id)}
                      className="text-gray-500 hover:text-red-400 p-1"
                      title="取消分享"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
