import { useState, useEffect, useCallback, useRef } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'

interface UseUnsavedGuardReturn {
  /**
   * 请求关闭。返回 Promise<boolean>：
   * - true: 用户同意关闭（无修改 / 用户选择放弃修改）
   * - false: 用户取消（继续留在表单）
   */
  requestClose: () => Promise<boolean>
  /** 渲染到页面中的确认弹窗 JSX */
  Dialog: JSX.Element
}

/**
 * 未保存修改守护 hook
 *
 * 用法：
 *   const { requestClose, Dialog } = useUnsavedGuard(isDirty)
 *   <button onClick={async () => { if (await requestClose()) doClose() }}>关闭</button>
 *   {Dialog}
 *
 * 同时会拦截：
 * - 浏览器关闭/刷新（beforeunload）
 * - ESC 键
 */
export function useUnsavedGuard(dirty: boolean): UseUnsavedGuardReturn {
  const [showPrompt, setShowPrompt] = useState(false)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)

  // 拦截浏览器关闭/刷新
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // 拦截 ESC 键
  useEffect(() => {
    if (!dirty) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        // ESC 也走 requestClose 流程
        if (resolverRef.current) return // 已经有弹窗了
        resolverRef.current = null
        setShowPrompt(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [dirty])

  const requestClose = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!dirty) {
        resolve(true)
        return
      }
      resolverRef.current = resolve
      setShowPrompt(true)
    })
  }, [dirty])

  const handleConfirm = useCallback(() => {
    const r = resolverRef.current
    resolverRef.current = null
    setShowPrompt(false)
    r?.(true)
  }, [])

  const handleCancel = useCallback(() => {
    const r = resolverRef.current
    resolverRef.current = null
    setShowPrompt(false)
    r?.(false)
  }, [])

  const Dialog = (
    <ConfirmDialog
      isOpen={showPrompt}
      title="未保存的修改"
      message="您有尚未保存的修改，离开后内容将丢失。确定要放弃修改吗？"
      confirmText="放弃修改"
      cancelText="继续编辑"
      variant="danger"
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )

  return { requestClose, Dialog }
}
