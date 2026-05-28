import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Briefcase, Calendar, Sparkles, Settings, Sun, Moon, Clock, BookOpen, FileText, Users, LogOut, Shield, LayoutDashboard, Activity, Database, Share2, BarChart3 } from 'lucide-react'
import { SidebarIcon } from '../GradientIcon'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import AppSearch from './AppSearch'

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
      <NavLink to="/" className="flex items-center gap-2.5 px-4 pt-5 pb-3.5 border-b border-border">
        {brandLogo ? (
          <img src={brandLogo} alt="Logo" className="w-6 h-6 rounded object-contain shrink-0" />
        ) : (
          <Sparkles size={20} className="text-accent-blue shrink-0" />
        )}
        <span className="text-[17px] font-bold text-gray-900 dark:text-white truncate">{brandTitle}</span>
      </NavLink>

      <AppSearch />

      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="space-y-0.5">
          {hasPermission('ai:use') && (
          <NavLink
            to="/ai"
            onClick={() => onCloseSidebar()}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-violet-500/15 to-purple-500/10 font-medium ring-1 ring-violet-500/30 shadow-lg shadow-violet-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={Sparkles} gradientFrom="#8B5CF6" gradientTo="#A78BFA" isActive={false} />
            <span className="inline-flex items-center">
              <span className="text-sm bg-gradient-to-r from-violet-500 to-purple-500 bg-clip-text text-transparent font-extrabold mr-1.5">AI</span>
              中心
            </span>
          </NavLink>
          )}

          {hasPermission('wiki:read') && (
          <NavLink
            to="/wiki"
            onClick={() => onCloseSidebar()}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-indigo-500/15 to-blue-500/10 font-medium ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={BookOpen} gradientFrom="#6366F1" gradientTo="#3B82F6" isActive={false} />
            <span className="inline-flex items-center">
              在线文档
            </span>
          </NavLink>
          )}

          {hasPermission('dashboard:read') && (
          <NavLink
            to="/dashboard"
            onClick={() => onCloseSidebar()}
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
          )}

          {hasPermission('management:console') && (
          <NavLink
            to="/console"
            onClick={() => onCloseSidebar()}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-orange-500/15 to-amber-500/10 font-medium ring-1 ring-orange-500/30 shadow-lg shadow-orange-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={BarChart3} gradientFrom="#F97316" gradientTo="#FBBF24" isActive={false} />
            <span>管理总览</span>
          </NavLink>
          )}

          {hasPermission('share:read') && (
          <NavLink
            to="/shared"
            onClick={() => onCloseSidebar()}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'text-gray-900 dark:text-white bg-gradient-to-r from-indigo-500/15 to-violet-500/10 font-medium ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/10'
                  : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
              }`
            }
          >
            <SidebarIcon icon={Share2} gradientFrom="#6366F1" gradientTo="#8B5CF6" isActive={false} />
            <span>我的分享</span>
          </NavLink>
          )}

          {hasPermission('report:read') && (
          <NavLink
            to="/reports"
            onClick={() => onCloseSidebar()}
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
          )}

          {hasPermission('project:read') && (
          <NavLink
            to="/projects"
            onClick={() => onCloseSidebar()}
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
          )}

          {hasPermission('customer:read') && (
            <NavLink
              to="/customers"
              onClick={() => onCloseSidebar()}
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
          )}

          {hasPermission('meeting:read') && (
          <NavLink
            to="/meetings"
            onClick={() => onCloseSidebar()}
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
          )}

            {hasPermission('contract:read') && (
              <NavLink
                to="/contracts"
                onClick={() => onCloseSidebar()}
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
            )}

            {hasPermission('task:read') && (
            <NavLink
              to="/tasks"
              onClick={() => onCloseSidebar()}
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
            )}

            {hasPermission('user:read') && (
              <NavLink
                to="/users"
                onClick={() => onCloseSidebar()}
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

            {hasPermission('monitor:read') && (
              <NavLink
                to="/monitor"
                onClick={() => onCloseSidebar()}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                    isActive
                    ? 'text-gray-900 dark:text-white bg-gradient-to-r from-emerald-500/15 to-teal-500/10 font-medium ring-1 ring-emerald-500/30 shadow-lg shadow-emerald-500/10'
                    : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
                  }`
                }
              >
                <SidebarIcon icon={Activity} gradientFrom="#10B981" gradientTo="#14B8A6" isActive={false} />
                <span>运维监控</span>
              </NavLink>
            )}

            {hasPermission('data:export') && (
              <NavLink
                to="/data"
                onClick={() => onCloseSidebar()}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-1.5 rounded-xl text-sm transition-all ${
                    isActive
                    ? 'text-gray-900 dark:text-white bg-gradient-to-r from-indigo-500/15 to-purple-500/10 font-medium ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/10'
                    : 'text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-bg-hover-secondary'
                  }`
                }
              >
                <SidebarIcon icon={Database} gradientFrom="#6366F1" gradientTo="#8B5CF6" isActive={false} />
                <span>数据管理</span>
              </NavLink>
            )}

            <NavLink
              to="/settings"
              onClick={() => onCloseSidebar()}
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

export default AppSidebar
