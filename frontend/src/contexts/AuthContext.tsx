import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'

interface User {
  id: number
  username: string
  name: string
  email: string | null
  is_admin: boolean
  is_active: boolean
  can_manage_models: boolean
  use_shared_models: boolean
  avatar: string | null
  last_login_at: string | null
}

interface AuthContextValue {
  user: User | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
  isAdmin: boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  changePassword: async () => {},
  isAdmin: false,
  fetchWithAuth: async () => new Response(),
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'))
  const [loading, setLoading] = useState(true)
  const tokenRef = useRef<string | null>(token)
  const originalFetch = useRef<typeof fetch | null>(null)

  // 保持 ref 与 state 同步
  useEffect(() => {
    tokenRef.current = token
  }, [token])

  // 全局 fetch 拦截：自动为 /api/ 请求添加 Authorization header
  useEffect(() => {
    if (originalFetch.current === null) {
      originalFetch.current = window.fetch.bind(window)
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const currentToken = tokenRef.current

      // 只拦截同源 /api/ 请求，且当前有 token
      if (currentToken && (url.startsWith('/api/') || url.includes('/api/'))) {
        const headers = new Headers(init?.headers)
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${currentToken}`)
        }
        const newInit: RequestInit = { ...init, headers }
        return originalFetch.current!(input, newInit)
      }
      return originalFetch.current!(input, init)
    }

    return () => {
      // 组件卸载时恢复原始 fetch
      if (originalFetch.current) {
        window.fetch = originalFetch.current
        originalFetch.current = null
      }
    }
  }, [])

  // 初始化时用现有 token 获取用户信息
  useEffect(() => {
    if (token) {
      fetch('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (!res.ok) throw new Error('token invalid')
          return res.json()
        })
        .then((data) => {
          setUser(data)
          setLoading(false)
        })
        .catch(() => {
          // Token 无效则清除
          localStorage.removeItem('auth_token')
          setToken(null)
          setUser(null)
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [token])

  /** 带认证头的 fetch 封装 */
  const fetchWithAuth = useCallback(
    (url: string, options?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {
        ...((options?.body instanceof FormData) ? {} : { 'Content-Type': 'application/json' }),
        ...(options?.headers as Record<string, string>),
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      return fetch(url, { ...options, headers })
    },
    [token],
  )

  /** 登录 */
  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || '登录失败')
    }
    const data = await res.json()
    localStorage.setItem('auth_token', data.access_token)
    setToken(data.access_token)
    setUser(data.user)
  }, [])

  /** 退出登录 */
  const logout = useCallback(() => {
    localStorage.removeItem('auth_token')
    setToken(null)
    setUser(null)
  }, [])

  /** 修改密码 */
  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      const res = await fetchWithAuth('/api/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '修改密码失败')
      }
      // 修改密码后 token_version 已变，需要重新登录
      localStorage.removeItem('auth_token')
      setToken(null)
      setUser(null)
    },
    [fetchWithAuth],
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        changePassword,
        isAdmin: user?.is_admin ?? false,
        fetchWithAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
