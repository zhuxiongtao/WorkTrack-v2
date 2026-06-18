import { useState, useMemo } from 'react'
import { NavLink, Navigate, useNavigate } from 'react-router-dom'
import {
  Sun, Moon, Monitor, LogOut, ArrowLeft, ChevronDown,
  BarChart3, Shield, GitBranch, Activity, Database,
  Settings, Cpu, FileText, Menu, type LucideIcon,
} from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import { SidebarIcon } from '../GradientIcon'
import AdminRoutes from './AdminRoutes'

interface AdminMenuItem {
  to: string
  label: string
  icon: LucideIcon
  gradientFrom: string
  gradientTo: string
  permission?: string
}

interface AdminMenuSection {
  id: string
  title: string
  items: AdminMenuItem[]
}

const ADMIN_SECTIONS: AdminMenuSection[] = [
  {
    id: 'overview',
    title: '概览',
    items: [
      { to: '/admin/console', label: '管理总览', icon: BarChart3, gradientFrom: '#F97316', gradientTo: '#FBBF24', permission: 'management:console' },
    ],
  },
  {
    id: 'system',
    title: '系统管理',
    items: [
      { to: '/admin/users',          label: '用户管理',   icon: Shield,    gradientFrom: '#EF4444', gradientTo: '#F87171', permission: 'user:read' },
      { to: '/admin/approval-flows', label: '审批流配置', icon: GitBranch, gradientFrom: '#8B5CF6', gradientTo: '#6366F1' },
      { to: '/admin/monitor',        label: '运维监控',   icon: Activity,  gradientFrom: '#10B981', gradientTo: '#14B8A6', permission: 'monitor:read' },
      { to: '/admin/data',           label: '数据管理',   icon: Database,  gradientFrom: '#6366F1', gradientTo: '#8B5CF6', permission: 'data:export' },
      { to: '/admin/logs',           label: '日志查看',   icon: FileText,  gradientFrom: '#6B7280', gradientTo: '#9CA3AF', permission: 'log:read' },
    ],
  },
  {
    id: 'platform',
    title: '平台配置',
    items: [
      { to: '/admin/models',   label: '模型管理', icon: Cpu,      gradientFrom: '#EC4899', gradientTo: '#F472B6' },
      { to: '/admin/settings', label: '系统设置', icon: Settings, gradientFrom: '#6B7280', gradientTo: '#9CA3AF' },
    ],
  },
]

interface AdminLayoutProps {
  brandLogo: string
  brandTitle: string
}

export default function AdminLayout({ brandLogo, brandTitle }: AdminLayoutProps) {
  const { isAdmin, user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!isAdmin) return <Navigate to="/" replace />

  const visibleSections = useMemo(() => {
    return ADMIN_SECTIONS
      .map(s => ({ ...s, items: s.items.filter(it => !it.permission || hasPermission(it.permission)) }))
      .filter(s => s.items.length > 0)
  }, [hasPermission])

  const defaultRoute = hasPermission('management:console') ? '/admin/console' : '/admin/settings'
  const toggleSection = (id: string) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="flex h-screen overflow-hidden w-full">
      {/* 移动端遮罩 */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── 管理后台侧边栏 ── */}
      <aside className={`
        w-56 xl:w-60 flex-shrink-0 flex flex-col h-screen border-r border-border
        bg-[#110d1c] transition-transform duration-300 z-50 safe-area-top safe-area-bottom
        max-md:fixed max-md:inset-y-0 max-md:left-0
        ${mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
        md:translate-x-0
      `}>
        {/* 品牌头 + 后台标签 */}
        <div className="px-4 pt-5 pb-3.5 border-b border-white/5">
          <div className="flex items-center gap-2.5 mb-3">
            {brandLogo ? (
              <img src={brandLogo} alt="Logo" className="w-6 h-6 rounded object-contain shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                <Settings size={13} className="text-purple-400" />
              </div>
            )}
            <span className="text-[14px] font-bold text-white/90 truncate tracking-tight">{brandTitle}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/15 border border-purple-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-[10px] font-bold tracking-wider text-purple-300">管理后台</span>
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          <div className="space-y-4">
            {visibleSections.map(section => {
              const isCollapsed = collapsed[section.id] === true
              return (
                <div key={section.id}>
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors group"
                  >
                    <span className="text-[10.5px] font-bold tracking-widest uppercase text-purple-400/60 flex-1 text-left group-hover:text-purple-300 transition-colors">
                      {section.title}
                    </span>
                    <ChevronDown
                      size={12}
                      className={`text-purple-400/40 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                  </button>
                  {!isCollapsed && (
                    <div className="mt-1 space-y-0.5">
                      {section.items.map(it => (
                        <NavLink
                          key={it.to}
                          to={it.to}
                          onClick={() => setMobileOpen(false)}
                          className={({ isActive }) =>
                            `relative group flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg text-[12.5px] transition-all ${
                              isActive
                                ? 'text-white bg-purple-500/20 font-medium'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span
                                className={`absolute left-0 w-0.5 h-4 rounded-r-full transition-all ${isActive ? 'opacity-100' : 'opacity-0'}`}
                                style={{ background: 'var(--accent-blue)' }}
                              />
                              <SidebarIcon icon={it.icon} gradientFrom={it.gradientFrom} gradientTo={it.gradientTo} isActive={isActive} />
                              <span className="flex-1 truncate">{it.label}</span>
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

        {/* 底部：返回前台 + 用户信息 */}
        <div className="px-4 py-3 border-t border-white/5">
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-purple-300/80 hover:text-purple-200 transition-colors mb-3 text-[12px] font-medium"
          >
            <ArrowLeft size={13} />
            <span>返回业务前台</span>
          </button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              {user?.avatar ? (
                <img src={user.avatar} alt="头像" className="w-6 h-6 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-[10px] text-purple-300 font-medium shrink-0">
                  {(user?.name || user?.username || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[11px] text-gray-300 truncate">{user?.name || user?.username}</p>
                <p className="text-[9px] text-purple-400">管理员</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggle}
                className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                title={theme === 'dark' ? '切换浅色' : theme === 'light' ? '跟随系统' : '切换深色'}
              >
                {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
              </button>
              <button
                onClick={() => { logout(); navigate('/login', { replace: true }) }}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                title="退出登录"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── 内容区 ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 移动端 header */}
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 py-2 border-b border-border/50 bg-[#110d1c]/90 backdrop-blur-xl safe-area-top">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-semibold text-purple-300">管理后台</span>
          <button onClick={toggle} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400">
            {theme === 'dark' ? <Moon size={16} /> : theme === 'light' ? <Sun size={16} /> : <Monitor size={16} />}
          </button>
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="p-3 md:px-6 md:py-8 safe-area-bottom">
            <AdminRoutes defaultRoute={defaultRoute} />
          </div>
        </main>
      </div>
    </div>
  )
}
