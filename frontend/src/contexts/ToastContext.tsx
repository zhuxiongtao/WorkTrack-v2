import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, Info, X } from 'lucide-react'

type ToastType = 'info' | 'success' | 'error' | 'warning'

interface ToastItem {
  id: number
  message: string
  type: ToastType
  visible: boolean
}

interface ToastContextValue {
  alert: (message: string, type?: ToastType) => void
  confirm: (message: string, type?: ToastType) => Promise<boolean>
  /** 侧边轻通知：3 秒自动消失，不阻塞操作 */
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const iconMap: Record<ToastType, typeof AlertTriangle> = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
}

const colorMap: Record<ToastType, string> = {
  info: 'text-[#3B82F6]',
  success: 'text-[#10B981]',
  error: 'text-[#EF4444]',
  warning: 'text-[#F59E0B]',
}

const bgColorMap: Record<ToastType, string> = {
  info: 'bg-blue-500/10 border-blue-500/20',
  success: 'bg-green-500/10 border-green-500/20',
  error: 'bg-red-500/10 border-red-500/20',
  warning: 'bg-yellow-500/10 border-yellow-500/20',
}

const barColorMap: Record<ToastType, string> = {
  info: 'bg-[#3B82F6]',
  success: 'bg-[#10B981]',
  error: 'bg-[#EF4444]',
  warning: 'bg-[#F59E0B]',
}

let toastIdCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false)
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<ToastType>('info')
  const [isConfirm, setIsConfirm] = useState(false)
  const resolveRef = useRef<((val: boolean) => void) | null>(null)

  // ---- 侧边轻通知队列 ----
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((msg: string, t: ToastType = 'info') => {
    const id = ++toastIdCounter
    setToasts((prev) => [...prev, { id, message: msg, type: t, visible: false }])
    // 下一帧触发入场动画
    requestAnimationFrame(() => {
      setToasts((prev) => prev.map((item) => item.id === id ? { ...item, visible: true } : item))
    })
    // 3 秒后自动移除
    setTimeout(() => {
      setToasts((prev) => prev.map((item) => item.id === id ? { ...item, visible: false } : item))
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id))
      }, 300) // 等待离场动画
    }, 3000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((item) => item.id === id ? { ...item, visible: false } : item))
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 300)
  }, [])

  // ---- 全屏弹窗 ----
  const open = useCallback(() => {
    setShow(true)
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const close = useCallback((result: boolean = false) => {
    setVisible(false)
    setTimeout(() => {
      setShow(false)
      resolveRef.current?.(result)
      resolveRef.current = null
    }, 200)
  }, [])

  const alertFn = useCallback((msg: string, t: ToastType = 'info') => {
    setMessage(msg)
    setType(t)
    setIsConfirm(false)
    open()
  }, [open])

  const confirmFn = useCallback((msg: string, t: ToastType = 'warning'): Promise<boolean> => {
    return new Promise((resolve) => {
      setMessage(msg)
      setType(t)
      setIsConfirm(true)
      resolveRef.current = resolve
      open()
    })
  }, [open])

  const handleBackdrop = () => {
    if (isConfirm) close(false)
    else close(false)
  }

  const Icon = iconMap[type]

  return (
    <ToastContext.Provider value={{ alert: alertFn, confirm: confirmFn, toast: addToast }}>
      {children}

      {/* ============ 侧边轻通知 ============ */}
      <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
        {toasts.map((item) => {
          const TIcon = iconMap[item.type]
          return (
            <div
              key={item.id}
              onClick={() => dismissToast(item.id)}
              className={`pointer-events-auto flex items-center gap-3 min-w-[280px] max-w-[420px] px-4 py-3 rounded-xl bg-bg-card border border-border shadow-xl backdrop-blur-sm transition-all duration-300 cursor-pointer ${
                item.visible
                  ? 'translate-x-0 opacity-100'
                  : 'translate-x-full opacity-0'
              }`}
            >
              {/* 左侧色条 */}
              <div className={`absolute left-0 top-1 bottom-1 w-1 rounded-full ${barColorMap[item.type]}`} />
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${bgColorMap[item.type]}`}>
                <TIcon size={16} className={colorMap[item.type]} />
              </div>
              <p className="text-sm text-gray-200 leading-snug flex-1">{item.message}</p>
              <button
                onClick={(e) => { e.stopPropagation(); dismissToast(item.id) }}
                className="p-1 rounded-md hover:bg-bg-hover text-gray-500 hover:text-white transition-colors flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>

      {/* ============ 全屏弹窗（confirm 保留给删除等需确认操作） ============ */}
      {show && (
        <div
          className={`fixed inset-0 z-[9999] flex items-center justify-center transition-all duration-200 ${
            visible ? 'bg-black/60 backdrop-blur-sm opacity-100' : 'bg-transparent opacity-0'
          }`}
          onClick={handleBackdrop}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm mx-4 rounded-2xl bg-bg-card border border-border shadow-2xl transition-all duration-200 ${
              visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
            }`}
          >
            <div className="flex flex-col items-center pt-8 pb-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border ${bgColorMap[type]}`}>
                <Icon size={28} className={colorMap[type]} />
              </div>
              <p className="text-sm text-gray-200 text-center px-6 leading-relaxed whitespace-pre-line">
                {message}
              </p>
            </div>

            <div className={`flex items-center border-t border-border ${isConfirm ? 'justify-between' : 'justify-center'}`}>
              {isConfirm ? (
                <>
                  <button
                    onClick={() => close(false)}
                    className="flex-1 px-4 py-3.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-bg-hover transition-colors rounded-bl-2xl"
                  >
                    取消
                  </button>
                  <div className="w-px h-10 bg-border" />
                  <button
                    onClick={() => close(true)}
                    className="flex-1 px-4 py-3.5 text-sm font-medium text-[#3B82F6] hover:bg-blue-500/5 transition-colors rounded-br-2xl"
                  >
                    确定
                  </button>
                </>
              ) : (
                <button
                  onClick={() => close(true)}
                  className="w-full px-4 py-3.5 text-sm font-medium text-[#3B82F6] hover:bg-blue-500/5 transition-colors rounded-b-2xl"
                >
                  确定
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
