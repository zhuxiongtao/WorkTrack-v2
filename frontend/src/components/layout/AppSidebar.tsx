import { useState, useEffect, useMemo } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  Sparkles, Sun, Moon, LogOut,
  ArrowRight, Wand2, ChevronDown, FileText,
} from 'lucide-react'
import { SidebarIcon } from '../GradientIcon'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import AppSearch from './AppSearch'
import { MENU_CATEGORIES } from './menuConfig'

interface AppSidebarProps {
  sidebarOpen: boolean
  onCloseSidebar: () => void
  brandLogo: string
  brandTitle: string
  isInsideSpace: boolean
}

const STORAGE_KEY = 'worktrack:sidebar:collapsed-categories'

function AppSidebar({ sidebarOpen, onCloseSidebar, brandLogo, brandTitle, isInsideSpace }: AppSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggle } = useTheme()
  const { user, logout, isAdmin, hasPermission } = useAuth()
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  // 折叠记忆：{ categoryId: boolean }，true 表示折叠
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed))
  }, [collapsed])

  // 自动展开当前路由所在分类（仅首次路由进入时）
  useEffect(() => {
    const activeCat = MENU_CATEGORIES.find((c) =>
      c.items.some((it) => it.to === location.pathname || (it.to !== '/' && location.pathname.startsWith(it.to)))
    )
    if (activeCat && collapsed[activeCat.id]) {
      setCollapsed((prev) => ({ ...prev, [activeCat.id]: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

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

  const toggleCategory = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

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
            className="group relative flex items-center gap-3 p-3 rounded-xl overflow-hidden transition-all hover:shadow-lg hover:shadow-violet-500/25 hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)',
              boxShadow: '0 4px 12px rgba(124, 58, 237, 0.30), inset 0 1px 1px rgba(255,255,255,0.18)',
            }}
            title="进入 AI 智能助手"
          >
            <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 55%)' }} />
            <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl opacity-60 group-hover:opacity-90 transition-opacity pointer-events-none"
                 style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.6) 0%, transparent 70%)' }} />
            <div className="relative w-9 h-9 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0 ring-1 ring-white/25">
              <Wand2
                size={18}
                strokeWidth={2.4}
                style={{ color: '#ffffff', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))' }}
              />
            </div>
            <div className="relative flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-sm font-bold drop-shadow-sm"
                  style={{ color: '#ffffff' }}
                >
                  AI 智能助手
                </span>
                <span
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white/25 backdrop-blur-sm"
                  style={{ color: '#ffffff' }}
                >
                  NEW
                </span>
              </div>
              <p
                className="text-[10px] mt-0.5 truncate"
                style={{ color: 'rgba(255,255,255,0.95)' }}
              >
                搜索 · 总结 · 分析 · 联网
              </p>
            </div>
            <ArrowRight size={14} className="relative text-white/70 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
          </NavLink>
        </div>
      )}

      <AppSearch />

      {/* 4 大分类导航 */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="space-y-3">
          {visibleCategories.map((cat) => {
            const isCollapsed = collapsed[cat.id] === true
            const hasActive = cat.items.some((it) =>
              it.to === location.pathname || (it.to !== '/' && location.pathname.startsWith(it.to + '/'))
            )
            return (
              <div key={cat.id}>
                {/* 分类头 */}
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-bg-hover-secondary/40 transition-colors group/cat"
                  aria-expanded={!isCollapsed}
                >
                  {/* 分类级 IconBox (compact) */}
                  <div
                    className="relative w-6 h-6 rounded flex items-center justify-center shrink-0"
                    style={{
                      background: ICON_TONE_BG[cat.iconTone],
                      boxShadow: `0 1px 2px ${ICON_TONE_SHADOW[cat.iconTone]}`,
                    }}
                  >
                    <div
                      className="pointer-events-none absolute inset-0 rounded"
                      style={{
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 55%)',
                      }}
                    />
                    <cat.icon
                      size={13}
                      strokeWidth={2.4}
                      style={{ position: 'relative', zIndex: 1, color: '#ffffff' }}
                    />
                  </div>
                  <span className={`text-[14px] flex-1 text-left ${hasActive ? 'text-gray-900 dark:text-white font-bold' : 'text-gray-700 dark:text-gray-300 font-medium'} group-hover/cat:text-gray-900 dark:group-hover/cat:text-white group-hover/cat:font-semibold transition-colors`}>
                    {cat.title}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'} ${hasActive ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'} group-hover/cat:text-gray-900 dark:group-hover/cat:text-white`}
                  />
                </button>
                {/* 子项 */}
                {!isCollapsed && (
                  <div className="mt-1 space-y-0.5">
                    {cat.items.map((it) => (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        onClick={() => onCloseSidebar()}
                        className={({ isActive }) =>
                          `relative group flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg text-[12.5px] transition-all ${
                            isActive
                              ? 'text-white bg-bg-hover font-medium'
                              : 'text-gray-300 hover:text-white hover:bg-bg-hover-secondary/60'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* 当前项左侧色条 */}
                            <span
                              className={`absolute left-0 w-0.5 h-4 rounded-r-full transition-all ${isActive ? 'opacity-100' : 'opacity-0'}`}
                              style={{ background: `linear-gradient(to bottom, ${it.gradientFrom}, ${it.gradientTo})` }}
                            />
                            <SidebarIcon icon={it.icon} gradientFrom={it.gradientFrom} gradientTo={it.gradientTo} isActive={isActive} />
                            <span className="flex-1 truncate" style={{ color: 'inherit', opacity: 1 }}>{it.label}</span>
                            {it.adminOnly && (
                              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">ADMIN</span>
                            )}
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>

      {/* 底部状态栏 + 用户信息 */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'online' ? 'bg-[#10B981] animate-pulse' : backendStatus === 'checking' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] text-gray-500">
              {backendStatus === 'online' ? '服务运行中' : backendStatus === 'checking' ? '检查中...' : '服务离线'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { navigate('/logs'); onCloseSidebar() }}
              className={`p-1.5 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors ${hasPermission('log:read') ? '' : 'hidden'}`}
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
              <p className="text-[9px] text-accent-blue/70">
                {isAdmin ? '管理员' : user?.roles?.includes('dept_leader') ? '部门负责人' : user?.roles?.includes('boss') ? '老板' : ''}
              </p>
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
  )
}

/** 分类级 IconBox 纯色背景：与设计系统 tone 500 对齐（与主题无关，浅深一致） */
const ICON_TONE_BG: Record<'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'gray' | 'cyan' | 'red', string> = {
  blue:   '#3B82F6',
  green:  '#10B981',
  orange: '#F59E0B',
  purple: '#8B5CF6',
  pink:   '#EC4899',
  gray:   '#6B7280',
  cyan:   '#06B6D4',
  red:    '#EF4444',
}
const ICON_TONE_SHADOW: Record<'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'gray' | 'cyan' | 'red', string> = {
  blue:   'rgba(59, 130, 246, 0.45)',
  green:  'rgba(16, 185, 129, 0.45)',
  orange: 'rgba(245, 158, 11, 0.45)',
  purple: 'rgba(139, 92, 246, 0.45)',
  pink:   'rgba(236, 72, 153, 0.45)',
  gray:   'rgba(107, 114, 128, 0.30)',
  cyan:   'rgba(6, 182, 212, 0.45)',
  red:    'rgba(239, 68, 68, 0.45)',
}

export default AppSidebar
