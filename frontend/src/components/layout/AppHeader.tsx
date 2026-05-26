import { useState, useEffect } from 'react'
import { Sun, Moon, Menu, AlertTriangle, Settings, X } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'

interface AppHeaderProps {
  brandLogo: string
  brandTitle: string
  onOpenSidebar: () => void
}

function AppHeader({ brandLogo, brandTitle, onOpenSidebar }: AppHeaderProps) {
  const { theme, toggle } = useTheme()
  const { user } = useAuth()

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

  return (
    <>
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3 py-2 border-b border-border/50 bg-bg-sidebar/85 backdrop-blur-xl safe-area-top">
        <button
          onClick={onOpenSidebar}
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
                onClick={() => window.location.href = '/settings?tab=models'}
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
    </>
  )
}

export default AppHeader
