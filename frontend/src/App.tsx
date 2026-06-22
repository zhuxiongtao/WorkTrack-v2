import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ThemeProvider } from './contexts/ThemeContext'
import { useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import ForcePasswordChange from './pages/ForcePasswordChange'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import PublicWikiPage from './pages/PublicWikiPage'
import SetupPage from './pages/SetupPage'
import AppSidebar from './components/layout/AppSidebar'
import AppHeader from './components/layout/AppHeader'
import AppRoutes from './components/layout/AppRoutes'
import AdminLayout from './components/layout/AdminLayout'
import AIFab from './components/AIFab'
import { GlobalTickerBar } from './components/GlobalTickerBar'

function AppContent() {
  const location = useLocation()
  const { user, loading: authLoading, hasPermission, fetchWithAuth } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isInsideSpace = /^\/wiki\/\d+/.test(location.pathname)

  const [setupChecking, setSetupChecking] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)

  const [brandLogo, setBrandLogo] = useState('')
  const [brandTitle, setBrandTitle] = useState('WorkTrack')

  useEffect(() => {
    fetch('/api/v1/settings/branding')
      .then(res => res.json())
      .then(data => {
        if (data.logo_url) {
          setBrandLogo(data.logo_url)
          const favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement
          if (favicon) {
            favicon.href = data.logo_url
            const ext = data.logo_url.split('.').pop()?.toLowerCase()
            if (ext === 'svg') favicon.type = 'image/svg+xml'
            else if (ext === 'png') favicon.type = 'image/png'
            else if (ext === 'ico') favicon.type = 'image/x-icon'
            else favicon.type = 'image/png'
          }
          const appleIcon = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement
          if (appleIcon) appleIcon.href = data.logo_url
        }
        if (data.site_title) {
          setBrandTitle(data.site_title)
          document.title = data.site_title
          const titleEl = document.querySelector('title')
          if (titleEl) titleEl.textContent = data.site_title
          const appleTitle = document.querySelector("meta[name='apple-mobile-web-app-title']") as HTMLMetaElement
          if (appleTitle) appleTitle.content = data.site_title
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch('/api/v1/setup/status')
        const data = await res.json()
        setSetupNeeded(data.needs_setup === true)
      } catch {
        setSetupNeeded(false)
      } finally {
        setSetupChecking(false)
      }
    }
    checkSetup()
  }, [])

  const [homePage, setHomePage] = useState('/settings')

  useEffect(() => {
    if (!user) return
    const loadHomePage = () => {
      fetch('/api/v1/settings/preferences')
        .then((r) => r.json())
        .then((d) => {
          if (d.home_page) {
            const permMap: Record<string, string> = {
              '/reports': 'report:read', '/projects': 'project:read', '/meetings': 'meeting:read',
              '/ai': 'ai:use', '/customers': 'customer:read', '/contracts': 'contract:read',
              '/dashboard': 'dashboard:read', '/wiki': 'wiki:read', '/tasks': 'task:read',
              '/users': 'user:read', '/monitor': 'monitor:read', '/logs': 'log:read',
              '/console': 'management:console', '/shared': 'share:read',
            }
            const requiredPerm = permMap[d.home_page]
            if (!requiredPerm || hasPermission(requiredPerm)) {
              setHomePage(d.home_page)
            } else {
              setHomePage(computeDefaultHome())
            }
          }
        })
        .catch(() => {})
    }
    loadHomePage()
    window.addEventListener('home-page-changed', loadHomePage)
    return () => window.removeEventListener('home-page-changed', loadHomePage)
  }, [user, hasPermission])

  function computeDefaultHome(): string {
    // 只考虑业务前台页面，admin 页面已迁移至 /admin/*
    const pages: [string, string][] = [
      ['/dashboard', 'dashboard:read'], ['/reports', 'report:read'],
      ['/projects', 'project:read'], ['/meetings', 'meeting:read'],
      ['/wiki', 'wiki:read'], ['/ai', 'ai:use'], ['/shared', 'share:read'],
    ]
    for (const [path, perm] of pages) {
      if (!perm || hasPermission(perm)) return path
    }
    return '/settings'
  }

  return (
    <div className="flex h-screen overflow-hidden w-full">
      {setupChecking && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-accent-blue" />
        </div>
      )}

      {!setupChecking && setupNeeded && (
        <div className="flex-1">
          <SetupPage onSetupComplete={() => setSetupNeeded(false)} />
        </div>
      )}

      {!setupChecking && !setupNeeded && (
        <>
      {authLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-accent-blue" />
        </div>
      )}

      {!authLoading && !user && (
        <div className="flex-1">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/wiki/public/:spaceId/:pageId" element={<PublicWikiPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      )}

      {/* 首次登录强制改密：未改密前拦截整个应用 */}
      {!authLoading && user && user.must_change_password && (
        <div className="flex-1">
          <ForcePasswordChange />
        </div>
      )}

      {!authLoading && user && !user.must_change_password && (
        <>
      {/* ── 管理后台：/admin/* ── */}
      {/* 系统管理员只允许访问 /admin，强制跳转 */}
      {user.is_admin && !location.pathname.startsWith('/admin') && (
        <Navigate to="/admin" replace />
      )}
      {location.pathname.startsWith('/admin') ? (
        <AdminLayout brandLogo={brandLogo} brandTitle={brandTitle} />
      ) : (
        <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AppSidebar
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        brandLogo={brandLogo}
        brandTitle={brandTitle}
        isInsideSpace={isInsideSpace}
      />

      <main className="flex-1 overflow-y-auto">
        <GlobalTickerBar fetchWithAuth={fetchWithAuth} />
        <AppHeader
          brandLogo={brandLogo}
          brandTitle={brandTitle}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        <div className="p-3 md:px-6 md:py-8 safe-area-bottom">
          <AppRoutes homePage={homePage} />
        </div>
      </main>

      {/* L2: AI 浮动入口按钮（任意页面 1 键直达，AI 页面自身隐藏） */}
      <AIFab
        visible={location.pathname !== '/ai'}
        canUse={hasPermission('ai:use')}
      />
        </>
      )}
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
