import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Loader2, Mail, ArrowLeft } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return setError('请输入邮箱地址')
    setError('')
    setLoading(true)
    try {
      const r = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || '请求失败')
      setSent(true)
    } catch (e: any) {
      setError(e.message || '请求失败')
    } finally {
      setLoading(false)
    }
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
          <h1 className="text-xl font-bold text-white tracking-tight">重置密码</h1>
          <p className="text-xs text-gray-500 mt-1.5">输入注册邮箱，我们将发送重置链接</p>
        </div>

        {sent ? (
          <div className="p-6 rounded-2xl bg-bg-card border border-border text-center space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Mail size={22} className="text-emerald-400" />
            </div>
            <p className="text-sm text-gray-300">如果该邮箱已注册，重置邮件将在几分钟内发出。</p>
            <p className="text-xs text-gray-500">请检查收件箱（含垃圾邮件）</p>
            <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-accent-blue hover:underline">
              <ArrowLeft size={13} /> 返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 rounded-2xl bg-bg-card border border-border space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">{error}</div>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">注册邮箱</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                placeholder="your@email.com"
                className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-accent-blue placeholder-gray-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-accent-blue text-white text-sm font-bold hover:bg-accent-blue/85 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? '发送中...' : '发送重置邮件'}
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
