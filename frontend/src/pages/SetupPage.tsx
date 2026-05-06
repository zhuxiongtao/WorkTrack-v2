import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Loader2, Database, UserPlus, CheckCircle, AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react'

interface SetupStatus {
  needs_setup: boolean
  db_ok: boolean
  message: string
}

type Step = 'checking' | 'db_config' | 'create_admin' | 'done'

interface SetupPageProps {
  onSetupComplete?: () => void
}

export default function SetupPage({ onSetupComplete }: SetupPageProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('checking')
  const [error, setError] = useState('')

  // DB 配置表单
  const [dbHost, setDbHost] = useState('postgres')
  const [dbPort, setDbPort] = useState('5432')
  const [dbUser, setDbUser] = useState('worktrack')
  const [dbPassword, setDbPassword] = useState('worktrack')
  const [dbName, setDbName] = useState('worktrack')
  const [testingDb, setTestingDb] = useState(false)

  // 管理员创建表单
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [adminName, setAdminName] = useState('管理员')
  const [creating, setCreating] = useState(false)

  // 初始化检查
  useEffect(() => {
    checkStatus()
  }, [])

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/v1/setup/status')
      const data: SetupStatus = await res.json()

      if (!data.db_ok) {
        setStep('db_config')
      } else if (data.needs_setup) {
        setStep('create_admin')
      } else {
        // 已经初始化，跳转登录
        navigate('/login', { replace: true })
      }
    } catch {
      setError('无法连接到服务器，请确认服务已启动')
    }
  }

  const handleTestDb = async () => {
    setTestingDb(true)
    setError('')
    const dbUrl = `postgresql://${dbUser}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`
    try {
      const res = await fetch('/api/v1/setup/test-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db_url: dbUrl }),
      })
      const data = await res.json()
      if (data.ok) {
        setStep('create_admin')
      } else {
        setError(data.error || '数据库连接测试失败')
      }
    } catch {
      setError('连接测试请求失败')
    } finally {
      setTestingDb(false)
    }
  }

  const handleCreateAdmin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('请填写用户名和密码')
      return
    }
    if (password.length < 6) {
      setError('密码长度至少 6 位')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/v1/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password,
          name: adminName.trim() || '管理员',
        }),
      })
      if (!res.ok) {
        let detail = '创建管理员失败'
        try {
          const err = await res.json()
          detail = err.detail || detail
        } catch {
          // 服务端返回了非 JSON 错误（如 502），用状态码提示
          detail = `服务异常 (HTTP ${res.status})，请查看容器日志`
        }
        throw new Error(detail)
      }
      setStep('done')
      // 通知父组件初始化完成，让 App 挂载正常路由（包括 /login）
      onSetupComplete?.()
      // 3 秒后跳转到登录页面
      setTimeout(() => navigate('/login', { replace: true }), 3000)
    } catch (e: any) {
      setError(e.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-blue/10 mb-4">
            <Sparkles size={32} className="text-accent-blue" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">WorkTrack</h1>
          <p className="text-sm text-gray-400">个人工作管理平台 · 初始化向导</p>
        </div>

        {/* 加载状态 */}
        {step === 'checking' && (
          <div className="text-center py-8">
            <Loader2 size={32} className="animate-spin text-accent-blue mx-auto mb-3" />
            <p className="text-gray-400 text-sm">正在检查系统状态...</p>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5">
            <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Step 1: 数据库配置 */}
        {step === 'db_config' && (
          <div className="bg-bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <Database size={20} className="text-accent-blue" />
              <h2 className="text-lg font-semibold text-white">配置数据库连接</h2>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs text-gray-400 mb-1">主机地址</label>
                <input
                  type="text"
                  value={dbHost}
                  onChange={(e) => setDbHost(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                  placeholder="数据库主机地址"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">端口</label>
                <input
                  type="text"
                  value={dbPort}
                  onChange={(e) => setDbPort(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                  placeholder="5432"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">用户名</label>
                <input
                  type="text"
                  value={dbUser}
                  onChange={(e) => setDbUser(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                  placeholder="数据库用户名"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">密码</label>
                <input
                  type="password"
                  value={dbPassword}
                  onChange={(e) => setDbPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                  placeholder="数据库密码"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">数据库名</label>
                <input
                  type="text"
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                  placeholder="worktrack"
                />
              </div>
            </div>

            <button
              onClick={handleTestDb}
              disabled={testingDb}
              className="w-full mt-5 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-50 transition-all"
            >
              {testingDb ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <ArrowRight size={18} />
              )}
              {testingDb ? '测试中...' : '测试连接'}
            </button>
          </div>
        )}

        {/* Step 2: 创建管理员 */}
        {step === 'create_admin' && (
          <div className="bg-bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <UserPlus size={20} className="text-green-400" />
              <h2 className="text-lg font-semibold text-white">创建管理员账户</h2>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs text-gray-400 mb-1">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                  placeholder="登录用户名"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">密码</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2.5 pr-10 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                    placeholder="至少 6 位"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">显示名称</label>
                <input
                  type="text"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-primary border border-border text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
                  placeholder="管理员"
                />
              </div>
            </div>

            <button
              onClick={handleCreateAdmin}
              disabled={creating}
              className="w-full mt-5 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-500 text-white text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-all"
            >
              {creating ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <CheckCircle size={18} />
              )}
              {creating ? '创建中...' : '完成初始化'}
            </button>
          </div>
        )}

        {/* Step 3: 完成 */}
        {step === 'done' && (
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
              <CheckCircle size={32} className="text-green-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">初始化完成!</h2>
            <p className="text-sm text-gray-400 mb-4">正在跳转到登录页面...</p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="px-6 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/90 transition-all"
            >
              立即前往登录
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
