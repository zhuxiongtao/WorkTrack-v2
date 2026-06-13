import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Key, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useResetPasswordMutation } from '../../hooks/useUserManagementQueries'
import type { UserData } from '../../services/types'

interface ResetPasswordModalProps {
  isOpen: boolean
  user: UserData | null
  onClose: () => void
}

export function ResetPasswordModal({ isOpen, user, onClose }: ResetPasswordModalProps) {
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const mutation = useResetPasswordMutation()

  if (!isOpen || !user) return null

  const handleReset = () => {
    if (!newPassword.trim()) return
    mutation.mutate({ id: user.id, newPassword }, { onSuccess: onClose })
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl p-6 animate-scaleIn" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-650 dark:text-amber-500">
            <Key size={15} />
          </div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">强制重置账户密码</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
          您正在强制修改用户 <span className="text-gray-750 dark:text-gray-300 font-bold">{user.name || user.username}</span> 的系统登录密码。
        </p>

        <div className="relative mb-4">
          <input
            type={showPassword ? "text" : "password"}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-mono"
            placeholder="新密码（最少 8 位数字与字母）"
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex items-center pr-3 hover:text-gray-800 dark:hover:text-gray-200 text-gray-400 cursor-pointer">
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">取消</button>
          <button onClick={handleReset} disabled={!newPassword.trim() || mutation.isPending} className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 disabled:opacity-40 transition-colors cursor-pointer shadow-sm">
            {mutation.isPending ? <Loader2 size={13} className="animate-spin mx-auto" /> : '确认强制重置'}
          </button>
        </div>
      </div>
    </div>
  , document.body)
}
