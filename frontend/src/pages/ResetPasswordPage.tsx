import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Sparkles, Loader2, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return setError('请输入新密码')
    if (password !== confirm) return setError('两次输入的密码不一致')
    setError('')
    setLoading(true)
    try {
      const r = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || '重置失败')
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 3000)
    } catch (e: any) {
      setError(e.message || '重置失败')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-main p-4">
        <div className="text-center text-gray-400 text-sm">
          <p>无效的重置链接</p>
          <Link to="/forgot-password" className="text-accent-blue hover:underline text-xs mt-2 block">重新申请重置</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main p-4 safe-area-top safe-area-bottom">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="relative inline-block mb-4">
            <div className="absolute inset-0 bg-accent-blue/40 rounded-2xl blur-xl" />
            <div className="relative inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-blue to-purple-500 text-white shadow-lg shadow-accent-blue/30">
              <Sparkles size={26} strokeWidth={2.4} />
            </div>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">设置新密码</h1>
          <p className="text-xs text-gray-500 mt-1.5">请输入您的新密码</p>
        </div>

        {done ? (
          <div className="p-6 rounded-2xl bg-bg-card border border-border text-center space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 size={22} className="text-emerald-400" />
            </div>
            <p className="text-sm text-gray-300 font-medium">密码已成功重置</p>
            <p className="text-xs text-gray-500">3 秒后自动跳转到登录页...</p>
            <Link to="/login" className="text-xs text-accent-blue hover:underline">立即前往登录</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 rounded-2xl bg-bg-card border border-border space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">{error}</div>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">新密码</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                  placeholder="至少 8 位，含大小写字母和数字"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-accent-blue placeholder-gray-600"
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">确认新密码</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="再次输入新密码"
                className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-accent-blue placeholder-gray-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-accent-blue text-white text-sm font-bold hover:bg-accent-blue/85 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? '重置中...' : '确认重置密码'}
            </button>
            <div className="text-center">
              <Link to="/login" className="text-xs text-gray-500 hover:text-accent-blue transition-colors flex items-center justify-center gap-1">
                <ArrowLeft size={12} /> 返回登录
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
