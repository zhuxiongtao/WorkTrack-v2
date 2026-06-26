import { useState, useEffect, useMemo } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Sparkles, Sun, Moon, Monitor, LogOut,
  ArrowRight, Wand2, Settings,
} from 'lucide-react'
import { SidebarIcon } from '../GradientIcon'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import AppSearch from './AppSearch'
import { MENU_CATEGORIES } from './menuConfig'

const APP_VERSION = 'v2.8.0'

interface AppSidebarProps {
  sidebarOpen: boolean
  onCloseSidebar: () => void
  brandLogo: string
  brandTitle: string
  isInsideSpace: boolean
}

function AppSidebar({ sidebarOpen, onCloseSidebar, brandLogo, brandTitle, isInsideSpace }: AppSidebarProps) {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const { user, logout, isAdmin, hasPermission } = useAuth()
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  // 可见分类 = 至少一项对当前用户可见
  // adminOnly 标记会进一步限制：仅 isAdmin=true 才可见
  const visibleCategories = useMemo(() => {
    return MENU_CATEGORIES
      .map((c) => ({
        ...c,
        items: c.items.filter((it) => {
          if (it.permission && !hasPermission(it.permission)) return false
          if (it.adminOnly && !isAdmin) return false
          return true
        }),
      }))
      .filter((c) => c.items.length > 0)
  }, [hasPermission, isAdmin])

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

  return (
    <aside className={`
      w-56 xl:w-60 2xl:w-64 flex-shrink-0 flex flex-col h-screen border-r border-border bg-bg-sidebar
      transition-transform duration-300 z-50 safe-area-top safe-area-bottom
      max-md:fixed max-md:inset-y-0 max-md:left-0
      ${sidebarOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
      ${isInsideSpace ? 'md:hidden' : 'md:translate-x-0'}
    `}>
      {/* 品牌头 */}
      <NavLink to="/" className="flex items-center gap-2.5 px-4 pt-5 pb-3.5 border-b border-border">
        {brandLogo ? (
          <img src={brandLogo} alt="Logo" className="w-6 h-6 rounded object-contain shrink-0" />
        ) : (
          <Sparkles size={18} className="text-accent-blue shrink-0" />
        )}
        <span className="text-[15px] font-bold text-gray-900 dark:text-white truncate tracking-tight">{brandTitle}</span>
      </NavLink>

      {/* L1: AI 中心 — 三层入口的第一层（最显眼） */}
      {hasPermission('ai:use') && (
        <div className="px-3 pt-3">
          <NavLink
            to="/ai"
            onClick={() => onCloseSidebar()}
            className="group relative flex items-center gap-2.5 px-3 py-2 rounded-xl overflow-hidden transition-all hover:shadow-md hover:shadow-violet-500/20 hover:-translate-y-px active:translate-y-0"
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 60%, #EC4899 100%)',
              boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
            title="进入 AI 智能助手"
          >
            <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 60%)' }} />
            <div className="relative w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
              <Wand2 size={14} strokeWidth={2.4} style={{ color: '#ffffff' }} />
            </div>
            <div className="relative flex-1 min-w-0 flex items-center gap-1.5">
              <span className="text-[13px] font-semibold truncate" style={{ color: '#ffffff' }}>AI 智能助手</span>
              <span className="text-[10px] font-bold px-1 py-px rounded" style={{ color: '#ffffff', background: 'rgba(255,255,255,0.22)' }}>NEW</span>
            </div>
            <ArrowRight size={13} className="relative text-white/60 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
          </NavLink>
        </div>
      )}

      <AppSearch />

      {/* 4 大分类导航 */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="space-y-3">
          {visibleCategories.map((cat) => (
              <div key={cat.id}>
                {/* 分类头 */}
                <div className="px-2 py-1.5">
                  <span className="text-[12px] font-bold tracking-widest uppercase text-gray-500 dark:text-gray-500">
                    {cat.title}
                  </span>
                </div>
                {/* 子项 */}
                <div className="mt-0.5 space-y-0.5">
                  {cat.items.map((it) => (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        onClick={() => onCloseSidebar()}
                        className={({ isActive }) =>
                          `relative group flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-lg text-[13px] transition-all ${
                            isActive
                              ? 'bg-bg-hover font-semibold text-gray-900 dark:text-white'
                              : 'text-gray-400 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary/50'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* 当前项左侧色条：统一使用 accent 主色 */}
                            <span
                              className={`absolute left-0 w-0.5 h-4 rounded-r-full transition-all ${isActive ? 'opacity-100' : 'opacity-0'}`}
                              style={{ background: 'var(--accent-blue)' }}
                            />
                            <SidebarIcon icon={it.icon} isActive={isActive} size={16} />
                            <span className="flex-1 truncate">{it.label}</span>
                            {it.adminOnly && (
                              <span className="text-[11px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">ADMIN</span>
                            )}
                          </>
                        )}
                      </NavLink>
                    ))}
                </div>
              </div>
          ))}
        </div>
      </nav>

      {/* 底部状态栏 + 用户信息 */}
      <div className="px-4 py-3 border-t border-border">
        {/* 管理后台入口（仅 admin 可见） */}
        {isAdmin && (
          <button
            onClick={() => { navigate('/admin'); onCloseSidebar() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 mb-2.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 hover:border-purple-500/35 text-purple-300/80 hover:text-purple-200 transition-all text-xs font-medium"
            title="进入系统管理后台"
          >
            <Settings size={12} />
            <span className="flex-1 text-left">管理后台</span>
            <span className="text-[11px] opacity-60">→</span>
          </button>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'online' ? 'bg-[#10B981] animate-pulse' : backendStatus === 'checking' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[11px] text-gray-500">
              {backendStatus === 'online' ? '服务运行中' : backendStatus === 'checking' ? '检查中...' : '服务离线'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggle}
              className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              title={theme === 'dark' ? '切换浅色' : theme === 'light' ? '跟随系统' : '切换深色'}
            >
              {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
          <button
            onClick={() => { navigate('/settings'); onCloseSidebar() }}
            className="flex items-center gap-2 min-w-0 flex-1 rounded-lg hover:bg-bg-hover px-1 py-0.5 transition-colors text-left"
            title="个人设置"
          >
            {user?.avatar ? (
              <img src={user.avatar} alt="头像" className="w-6 h-6 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-accent-blue/20 flex items-center justify-center text-[11px] text-accent-blue font-medium shrink-0">
                {(user?.name || user?.username || '?')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-gray-300 truncate">{user?.name || user?.username}</p>
              <p className="text-[11px] text-accent-blue/70">
                {isAdmin ? '管理员' : user?.roles?.includes('dept_leader') ? '部门负责人' : user?.roles?.includes('boss') ? '老板' : ''}
              </p>
            </div>
          </button>
          <button
            onClick={() => { logout(); navigate('/login', { replace: true }) }}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
            title="退出登录"
          >
            <LogOut size={14} />
          </button>
        </div>
        <p className="text-center text-[10px] text-gray-400 dark:text-gray-600 mt-1">{APP_VERSION}</p>
      </div>
    </aside>
  )
}

export default AppSidebar
