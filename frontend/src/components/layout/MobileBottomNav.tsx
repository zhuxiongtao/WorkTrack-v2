import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, CheckSquare, Sparkles, MoreHorizontal, User } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
  homePage: string
  onOpenSidebar: () => void
}

export function MobileBottomNav({ homePage, onOpenSidebar }: Props) {
  const { fetchWithAuth, hasPermission } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const location = useLocation()
  const canUseAI = hasPermission('ai:use')

  useEffect(() => {
    let cancelled = false
    fetchWithAuth('/api/v1/approvals/pending')
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown[]) => {
        if (!cancelled) setPendingCount(Array.isArray(data) ? data.length : 0)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [location.pathname, fetchWithAuth])

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 py-1 min-h-[52px] transition-colors active:scale-95 ${
      isActive ? 'text-accent-blue' : 'text-gray-500 hover:text-gray-300'
    }`

  const isHomeActive = location.pathname === homePage || location.pathname === '/'
  const isApprovalsActive = location.pathname.startsWith('/approvals')
  const isAIActive = location.pathname.startsWith('/ai')
  const isSettingsActive = location.pathname.startsWith('/settings')

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden" role="navigation" aria-label="底部导航">
      <div
        className="flex items-stretch border-t border-border/40 bg-bg-sidebar/95 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* 首页 */}
        <NavLink
          to={homePage}
          end
          className={() => linkCls({ isActive: isHomeActive })}
        >
          <Home size={22} strokeWidth={isHomeActive ? 2.5 : 1.8} />
          <span className="text-[10px] font-medium leading-none">首页</span>
        </NavLink>

        {/* 审批（带徽标） */}
        <NavLink
          to="/approvals"
          className={() => linkCls({ isActive: isApprovalsActive })}
        >
          <div className="relative">
            <CheckSquare size={22} strokeWidth={isApprovalsActive ? 2.5 : 1.8} />
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none shadow-sm">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium leading-none">审批</span>
        </NavLink>

        {/* AI 助手（无权限则隐藏占位） */}
        {canUseAI ? (
          <NavLink
            to="/ai"
            className={() => linkCls({ isActive: isAIActive })}
          >
            <Sparkles size={22} strokeWidth={isAIActive ? 2.5 : 1.8} />
            <span className="text-[10px] font-medium leading-none">AI</span>
          </NavLink>
        ) : (
          <div className="flex-1" />
        )}

        {/* 更多（打开侧边栏） */}
        <button
          onClick={onOpenSidebar}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1 min-h-[52px] text-gray-500 hover:text-gray-300 transition-colors active:scale-95"
        >
          <MoreHorizontal size={22} strokeWidth={1.8} />
          <span className="text-[10px] font-medium leading-none">更多</span>
        </button>

        {/* 我的 */}
        <NavLink
          to="/settings"
          className={() => linkCls({ isActive: isSettingsActive })}
        >
          <User size={22} strokeWidth={isSettingsActive ? 2.5 : 1.8} />
          <span className="text-[10px] font-medium leading-none">我的</span>
        </NavLink>
      </div>
    </nav>
  )
}
