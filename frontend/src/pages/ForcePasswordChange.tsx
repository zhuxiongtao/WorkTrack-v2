import { useState, type FormEvent } from 'react'
import { ShieldAlert, Loader2, Eye, EyeOff, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/**
 * 首次登录强制改密页。
 * 当 user.must_change_password=true 时由 App 门控渲染，用户改密成功前无法进入系统。
 * 改密成功后 AuthContext 会清除 token（token_version 已变），自动回到登录页。
 */
export default function ForcePasswordChange() {
  const { user, changePassword, logout } = useAuth()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!oldPassword || !newPassword || !confirm) {
      setError('请填写所有字段')
      return
    }
    if (newPassword.length < 8) {
      setError('新密码长度至少为 8 位')
      return
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('新密码必须同时包含字母和数字')
      return
    }
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    if (newPassword === oldPassword) {
      setError('新密码不能与初始密码相同')
      return
    }
    setError('')
    setLoading(true)
    try {
      // 成功后 AuthContext 会清空登录态，自动回到登录页用新密码登录
      await changePassword(oldPassword, newPassword)
    } catch (err: any) {
      setError(err.message || '修改密码失败')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex-1 flex items-center justify-center bg-bg-main p-4 safe-area-top safe-area-bottom">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="relative inline-block mb-4">
            <div className="absolute inset-0 bg-amber-500/40 rounded-2xl blur-xl" />
            <div className="relative inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-[#fff] shadow-lg shadow-amber-500/30">
              <ShieldAlert size={26} strokeWidth={2.4} />
            </div>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">首次登录，请修改密码</h1>
          <p className="text-xs text-gray-500 mt-1.5">
            {user?.name || user?.username}，为保障账号安全，请设置您的新密码
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 rounded-2xl bg-bg-card border border-border space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">初始密码（邮件中提供）</label>
            <input
              type={show ? 'text' : 'password'}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-accent-blue placeholder-gray-600"
              placeholder="请输入初始密码"
              autoFocus
              autoComplete="current-password"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">新密码</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-accent-blue placeholder-gray-600"
                placeholder="至少 8 位，含字母和数字"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">确认新密码</label>
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-accent-blue placeholder-gray-600"
              placeholder="再次输入新密码"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-accent-blue text-[#fff] text-sm font-bold hover:bg-accent-blue/85 disabled:opacity-50 flex items-center justify-center gap-2 transition-all hover:shadow-lg hover:shadow-accent-blue/30 cursor-pointer"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? '提交中...' : '修改密码并继续'}
          </button>

          <button
            type="button"
            onClick={logout}
            className="w-full text-xs text-gray-500 hover:text-gray-300 flex items-center justify-center gap-1.5 transition-colors"
          >
            <LogOut size={13} /> 退出登录
          </button>
        </form>
      </div>
    </div>
  )
}
