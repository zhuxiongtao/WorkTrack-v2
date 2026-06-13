import { AlertTriangle, X } from 'lucide-react'

export type ConfirmVariant = 'danger' | 'primary'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 通用确认弹窗（覆盖在所有内容之上）
 * 用法：受控组件，由父级管理 isOpen 状态
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null

  const confirmColors =
    variant === 'danger'
      ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
      : 'bg-[#3B82F6] hover:bg-blue-600 shadow-blue-500/20'

  const iconColors =
    variant === 'danger'
      ? 'bg-red-500/15 text-red-400'
      : 'bg-blue-500/15 text-blue-400'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-bg-card border border-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconColors}`}>
              <AlertTriangle size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="text-sm text-gray-400 mt-1.5 leading-relaxed">{message}</p>
            </div>
            <button
              onClick={onCancel}
              className="p-1 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-bg-hover/30">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-bg-hover transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-5 py-2 rounded-xl text-sm font-medium text-white transition-all shadow-lg ${confirmColors}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
