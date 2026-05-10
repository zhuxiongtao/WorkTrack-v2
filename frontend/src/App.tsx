import { useState, useEffect, useRef } from 'react'
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { Briefcase, Calendar, Sparkles, Settings, Search, X, Sun, Moon, Clock, Menu, BookOpen, FileText, Users, LogOut, Loader2, Shield, LayoutDashboard, AlertTriangle } from 'lucide-react'
import { SidebarIcon } from './components/GradientIcon'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { useAuth } from './contexts/AuthContext'
import ReportHubPage from './pages/ReportHubPage'
import ProjectsPage from './pages/ProjectsPage'
import MeetingsPage from './pages/MeetingsPage'
import AIPage from './pages/AIPage'
import SettingsPage from './pages/SettingsPage'
import ScheduledTasksPage from './pages/ScheduledTasksPage'
import LogViewerPage from './pages/LogViewerPage'
import CustomersPage from './pages/CustomersPage'
import ContractsPage from './pages/ContractsPage'
import LoginPage from './pages/LoginPage'
import UserManagementPage from './pages/UserManagementPage'
import DashboardPage from './pages/DashboardPage'
import SetupPage from './pages/SetupPage'

interface SearchResult {
  id: number | string
  title?: string
  snippet?: string
  date?: string
  name?: string
  customer?: string
  status?: string
  type: string
  label: string
}

function AppContent() {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const { user, loading: authLoading, logout, isAdmin } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  // 初始化向导状态
  const [setupChecking, setSetupChecking] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)

  // 品牌自定义
  const [brandLogo, setBrandLogo] = useState('')
  const [brandTitle, setBrandTitle] = useState('WorkTrack')

  // 加载品牌配置
  useEffect(() => {
    fetch('/api/v1/settings/branding', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.logo_url) {
          setBrandLogo(data.logo_url)
          // 更新浏览器 favicon
          const favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement
          if (favicon) {
            favicon.href = data.logo_url
            // 根据扩展名动态调整 type
            const ext = data.logo_url.split('.').pop()?.toLowerCase()
            if (ext === 'svg') favicon.type = 'image/svg+xml'
            else if (ext === 'png') favicon.type = 'image/png'
            else if (ext === 'ico') favicon.type = 'image/x-icon'
            else favicon.type = 'image/png'
          }
          // 同步更新 iOS Safari 图标
          const appleIcon = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement
          if (appleIcon) appleIcon.href = data.logo_url
        }
        if (data.site_title) {
          setBrandTitle(data.site_title)
          document.title = data.site_title
          // 更新 <title> 标签内容和 iOS PWA 标题
          const titleEl = document.querySelector('title')
          if (titleEl) titleEl.textContent = data.site_title
          const appleTitle = document.querySelector("meta[name='apple-mobile-web-app-title']") as HTMLMetaElement
          if (appleTitle) appleTitle.content = data.site_title
        }
      })
      .catch(() => {})
  }, [])

  // 后端健康检查
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/health')
        if (res.ok) {
          const data = await res.json()
          setBackendStatus(data.status === 'healthy' ? 'online' : 'offline')
        } else {
          setBackendStatus('offline')
        }
      } catch {
        setBackendStatus('offline')
      }
    }
    check()
    const timer = setInterval(check, 30000)
    return () => clearInterval(timer)
  }, [])

  // 初始化向导检测（首次运行）
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch('/api/v1/setup/status')
        const data = await res.json()
        setSetupNeeded(data.needs_setup === true)
      } catch {
        // 服务未启动时也不显示初始化向导
        setSetupNeeded(false)
      } finally {
        setSetupChecking(false)
      }
    }
    checkSetup()
  }, [])

  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [homePage, setHomePage] = useState('/reports')
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 加载首页偏好（登录后加载 & 监听设置变更事件）
  useEffect(() => {
    if (!user) return
    const loadHomePage = () => {
      fetch('/api/v1/settings/preferences')
        .then((r) => r.json())
        .then((d) => { if (d.home_page) setHomePage(d.home_page) })
        .catch(() => {})
    }
    loadHomePage()
    window.addEventListener('home-page-changed', loadHomePage)
    return () => window.removeEventListener('home-page-changed', loadHomePage)
  }, [user])

  const [showModelWarning, setShowModelWarning] = useState(false)
  const [modelWarningDismissed, setModelWarningDismissed] = useState(false)

  useEffect(() => {
    if (!user) {
      setShowModelWarning(false)
      setModelWarningDismissed(false)
      return
    }
    fetch('/api/v1/settings/providers')
      .then(r => r.json())
      .then((providers: any[]) => {
        const hasOwn = providers.some((p: any) => p.user_id === user.id)
        const hasShared = providers.some((p: any) => p.user_id === null)
        const hasAny = providers.length > 0
        if (user.is_admin) {
          setShowModelWarning(!hasAny)
        } else if (user.can_manage_models && !user.use_shared_models) {
          setShowModelWarning(!hasOwn && !hasShared)
        } else if (user.use_shared_models) {
          setShowModelWarning(!hasShared)
        } else {
          setShowModelWarning(false)
        }
      })
      .catch(() => setShowModelWarning(false))
  }, [user])

  // 点击外部关闭搜索下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        const items: SearchResult[] = []
        ;(data.reports || []).forEach((r: { id: number; date: string; snippet: string }) => {
          items.push({ id: r.id, title: r.date, snippet: r.snippet, date: r.date, type: 'report', label: '日报' })
        })
        ;(data.projects || []).forEach((p: { id: number; name: string; customer: string; status: string; snippet: string }) => {
          items.push({ id: p.id, name: p.name, customer: p.customer, status: p.status, snippet: p.snippet, type: 'project', label: '项目' })
        })
        ;(data.meetings || []).forEach((m: { id: number; title: string; date: string; snippet: string }) => {
          items.push({ id: m.id, title: m.title, snippet: m.snippet, date: m.date, type: 'meeting', label: '会议' })
        })
        ;(data.customers || []).forEach((c: { id: number; name: string; status: string }) => {
          items.push({ id: c.id, name: c.name, status: c.status, type: 'customer', label: '客户' })
        })
        if (data.semantic) {
          Object.entries(data.semantic).forEach(([key, arr]: [string, any]) => {
            ;(arr || []).forEach((s: { id: string; score: number; snippet: string }) => {
              const typeMap: Record<string, string> = { semantic_reports: 'report', semantic_projects: 'project', semantic_meetings: 'meeting' }
              const labelMap: Record<string, string> = { semantic_reports: '日报(语义)', semantic_projects: '项目(语义)', semantic_meetings: '会议(语义)' }
              items.push({ id: s.id, snippet: s.snippet, type: typeMap[key] || 'report', label: labelMap[key] || '语义匹配' })
            })
          })
        }
        setSearchResults(items.slice(0, 15))
        setShowDropdown(true)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const goToResult = (item: SearchResult) => {
    setShowDropdown(false)
    setSearchQuery('')
    if (item.type === 'report') window.open(`/reports?highlight=${item.id}`, '_blank')
    else if (item.type === 'project') window.open(`/projects?highlight=${item.id}`, '_blank')
    else if (item.type === 'meeting') window.open(`/meetings?highlight=${item.id}`, '_blank')
    else if (item.type === 'customer') window.open(`/customers?highlight=${item.id}`, '_blank')
  }

  const typeColor: Record<string, string> = {
    report: 'text-accent-blue bg-accent-blue/10',
    project: 'text-amber-400 bg-amber-500/10',
    meeting: 'text-green-400 bg-green-500/10',
    customer: 'text-purple-400 bg-purple-500/10',
  }

  return (
    <div className="flex h-screen overflow-hidden w-full">
      {/* 初始化向导加载中 */}
      {setupChecking && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-accent-blue" />
        </div>
      )}

      {/* 需要初始化 -> 显示初始化向导 */}
      {!setupChecking && setupNeeded && (
        <div className="flex-1">
          <SetupPage onSetupComplete={() => setSetupNeeded(false)} />
        </div>
      )}

      {/* 初始化完成 -> 正常认证流程 */}
      {!setupChecking && !setupNeeded && (
        <>
      {/* 认证加载中 */}
      {authLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-accent-blue" />
        </div>
      )}

      {/* 未登录 -> 显示登录页 */}
      {!authLoading && !user && (
        <div className="flex-1">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      )}

      {/* 已登录 -> 正常界面 */}
      {!authLoading && user && (
        <>
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 左边栏 */}
      <aside className={`
        w-56 xl:w-60 2xl:w-64 flex-shrink-0 flex flex-col h-screen border-r border-border bg-bg-sidebar
        transition-transform duration-300 z-50 safe-area-top safe-area-bottom
        max-md:fixed max-md:inset-y-0 max-md:left-0
        ${sidebarOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
        md:translate-x-0
      `}>
        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2.5 px-4 pt-5 pb-3.5 border-b border-border">
          {brandLogo ? (
            <img src={brandLogo} alt="Logo" className="w-6 h-6 rounded object-contain shrink-0" />
          ) : (
            <Sparkles size={20} className="text-accent-blue shrink-0" />
          )}
          <span className="text-[17px] font-bold text-gray-900 dark:text-white truncate">{brandTitle}</span>
        </NavLink>

        {/* 搜索栏 */}
        <div ref={searchRef} className="px-3 py-3 relative">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-card border border-border focus-within:border-accent-blue transition-colors">
            <Search size={14} className="text-gray-500 flex-shrink-0" />
            <input
              type="text"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              className="bg-transparent text-xs text-gray-300 outline-none w-full placeholder-gray-600"
            />
            {searching && <Sparkles size={12} className="animate-spin text-accent-blue flex-shrink-0" />}
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false) }} className="text-gray-500 hover:text-gray-900 dark:hover:text-white flex-shrink-0">
                <X size={12} />
              </button>
            )}
          </div>

          {/* 搜索下拉 */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute top-full left-3 right-3 mt-1 max-h-80 overflow-y-auto rounded-xl bg-bg-card border border-border shadow-2xl z-50">
              {searchResults.map((item, i) => (
                <button
                  key={`${item.type}-${item.id}-${i}`}
                  onClick={() => goToResult(item)}
                  className="w-full text-left px-3 py-2.5 hover:bg-bg-sidebar border-b border-border last:border-b-0 transition-colors"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[9px] px-1 py-0.5 rounded ${typeColor[item.type] || 'text-gray-400 bg-gray-500/10'}`}>
                      {item.label}
                    </span>
                    <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                      {item.title || item.name || item.id}
                    </span>
                  </div>
                  {item.snippet && (
                    <p className="text-[10px] text-gray-500 truncate mt-0.5 leading-tight">{item.snippet}</p>
                  )}
                </button>
              ))}
            </div>
          )}
          {showDropdown && searchQuery && !searching && searchResults.length === 0 && (
            <div className="absolute top-full left-3 right-3 mt-1 rounded-xl bg-bg-card border border-border shadow-2xl z-50 p-4 text-center">
              <p className="text-xs text-gray-500">没有找到相关内容</p>
            </div>
          )}
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          <div className="space-y-0.5">
          {/* ===== AI 中心 ===== */}
          <NavLink
            to="/ai"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-violet-500/15 to-purple-500/10 font-medium ring-1 ring-violet-500/30 shadow-lg shadow-violet-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={Sparkles} gradientFrom="#8B5CF6" gradientTo="#A78BFA" isActive={false} />
            <span>AI 中心</span>
          </NavLink>

          {/* ===== 数据看板 ===== */}
          <NavLink
            to="/dashboard"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-blue-500/15 to-cyan-500/10 font-medium ring-1 ring-blue-500/30 shadow-lg shadow-blue-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={LayoutDashboard} gradientFrom="#3B82F6" gradientTo="#06B6D4" isActive={false} />
            <span>数据看板</span>
          </NavLink>

          {/* ===== 日报周报 ===== */}
          <NavLink
            to="/reports"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-emerald-500/15 to-green-500/10 font-medium ring-1 ring-emerald-500/30 shadow-lg shadow-emerald-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={BookOpen} gradientFrom="#10B981" gradientTo="#34D399" isActive={false} />
            <span>日报周报</span>
          </NavLink>

          {/* ===== 项目管理 ===== */}
          <NavLink
            to="/projects"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-amber-500/15 to-orange-500/10 font-medium ring-1 ring-amber-500/30 shadow-lg shadow-amber-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={Briefcase} gradientFrom="#F59E0B" gradientTo="#FBBF24" isActive={false} />
            <span>项目管理</span>
          </NavLink>

          <NavLink
            to="/customers"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-pink-500/15 to-rose-500/10 font-medium ring-1 ring-pink-500/30 shadow-lg shadow-pink-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={Users} gradientFrom="#EC4899" gradientTo="#F472B6" isActive={false} />
            <span>客户管理</span>
          </NavLink>

          {/* ===== 会议纪要 ===== */}
          <NavLink
            to="/meetings"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-cyan-500/15 to-teal-500/10 font-medium ring-1 ring-cyan-500/30 shadow-lg shadow-cyan-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
                }`
              }
            >
              <SidebarIcon icon={Calendar} gradientFrom="#06B6D4" gradientTo="#22D3EE" isActive={false} />
              <span>会议纪要</span>
            </NavLink>

            {/* ===== 合同管理 ===== */}
            <NavLink
              to="/contracts"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                  isActive
                    ? 'text-gray-900 dark:text-white bg-gradient-to-r from-cyan-500/15 to-teal-500/10 font-medium ring-1 ring-cyan-500/30 shadow-lg shadow-cyan-500/10'
                    : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
                }`
              }
            >
              <SidebarIcon icon={FileText} gradientFrom="#06B6D4" gradientTo="#14B8A6" isActive={false} />
              <span>合同管理</span>
            </NavLink>

            {/* ===== 定时任务 ===== */}
            <NavLink
              to="/tasks"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                  isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-purple-500/15 to-fuchsia-500/10 font-medium ring-1 ring-purple-500/30 shadow-lg shadow-purple-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
                }`
              }
            >
              <SidebarIcon icon={Clock} gradientFrom="#8B5CF6" gradientTo="#C084FC" isActive={false} />
              <span>定时任务</span>
            </NavLink>

            {/* ===== 用户管理（仅管理员可见） ===== */}
            {isAdmin && (
              <NavLink
                to="/users"
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                    isActive
                    ? 'text-gray-900 dark:text-white bg-gradient-to-r from-red-500/15 to-rose-500/10 font-medium ring-1 ring-red-500/30 shadow-lg shadow-red-500/10'
                    : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
                  }`
                }
              >
                <SidebarIcon icon={Shield} gradientFrom="#EF4444" gradientTo="#F87171" isActive={false} />
                <span>用户管理</span>
              </NavLink>
            )}

            {/* ===== 系统设置 ===== */}
            <NavLink
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                  isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-gray-500/15 to-slate-500/10 font-medium ring-1 ring-gray-500/30 shadow-lg shadow-gray-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
                }`
              }
            >
            <SidebarIcon icon={Settings} gradientFrom="#6B7280" gradientTo="#9CA3AF" isActive={false} />
            <span>系统设置</span>
          </NavLink>
          </div>
        </nav>

        {/* 底部状态 */}
        <div className="px-4 py-3 border-t border-border max-md:hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'online' ? 'bg-[#10B981] animate-pulse' : backendStatus === 'checking' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-[10px] text-gray-500">
                {backendStatus === 'online' ? '服务运行中' : backendStatus === 'checking' ? '检查中...' : '服务离线'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { navigate('/logs'); setSidebarOpen(false) }}
                className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                title="运行日志"
              >
                <FileText size={14} />
              </button>
              <button
                onClick={toggle}
                className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </div>
          {/* 用户信息行 */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 min-w-0">
              {user?.avatar ? (
                <img src={user.avatar} alt="头像" className="w-6 h-6 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center text-[10px] text-accent-blue font-medium shrink-0">
                  {(user?.name || user?.username || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs text-gray-300 truncate">{user?.name || user?.username}</p>
                {isAdmin && (
                  <p className="text-[9px] text-accent-blue/70">管理员</p>
                )}
              </div>
            </div>
            <button
              onClick={() => { logout(); navigate('/login', { replace: true }) }}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
              title="退出登录"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* 内容区 */}
      <main className="flex-1 overflow-y-auto">
        {/* 移动端顶部栏 */}
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 py-2 border-b border-border/50 bg-bg-sidebar/85 backdrop-blur-xl safe-area-top">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 -ml-1 rounded-lg hover:bg-white/10 active:bg-white/15 text-gray-400 transition-colors"
            aria-label="打开菜单"
          >
          {brandLogo ? (
            <img src={brandLogo} alt="Logo" className="w-5 h-5 rounded object-contain" />
          ) : (
            <Menu size={18} />
          )}
          </button>
          <span className="text-base font-semibold text-gray-900 dark:text-white tracking-wide">{brandTitle}</span>
          <button
            onClick={toggle}
            className="p-1.5 -mr-1 rounded-lg hover:bg-white/10 active:bg-white/15 text-gray-400 transition-colors"
            aria-label="切换主题"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <div className="p-4 md:px-6 md:py-8">
          {/* 模型未配置警告 */}
          {showModelWarning && (
            modelWarningDismissed ? (
              <button
                onClick={() => setModelWarningDismissed(false)}
                className="mb-4 inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                title="展开模型配置提醒"
              >
                <AlertTriangle size={16} className="text-amber-400" />
              </button>
            ) : (
              <div className="mb-6 px-5 py-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-500 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">需要配置模型才能使用 AI 功能</p>
                  <p className="text-xs text-amber-700/70 dark:text-gray-400 mt-1">你的账号需要自己配置模型供应商。点击下方链接前往设置页面添加供应商和模型。</p>
                  <button
                    onClick={() => navigate('/settings')}
                    className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-lg bg-amber-200 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-sm font-medium hover:bg-amber-300 dark:hover:bg-amber-500/30 transition-colors"
                  >
                    <Settings size={14} /> 前往模型管理
                  </button>
                </div>
                <button
                  onClick={() => setModelWarningDismissed(true)}
                  className="p-1 rounded-lg hover:bg-amber-200/50 dark:hover:bg-white/10 text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors shrink-0"
                  title="收起提醒"
                >
                  <X size={16} />
                </button>
              </div>
            )
          )}
          <Routes>
            <Route path="/" element={<Navigate to={homePage} replace />} />
            <Route path="/reports" element={<ReportHubPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/meetings" element={<MeetingsPage />} />
            <Route path="/ai" element={<AIPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/contracts" element={<ContractsPage />} />
            <Route path="/tasks" element={<ScheduledTasksPage />} />
            <Route path="/logs" element={<LogViewerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {isAdmin && <Route path="/users" element={<UserManagementPage />} />}
            <Route path="/dashboard" element={<DashboardPage />} />
          </Routes>
        </div>
      </main>
          </>
        )}
        </>
      )}
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

export default App
