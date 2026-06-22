import { CheckCircle2, AlertTriangle, XCircle, Info, Circle } from 'lucide-react'
import { TONES, STATUS_TONE, type StatusVariant } from '../../theme/tokens'

/**
 * StatusBadge — 统一状态徽标
 *
 * 取代散落的 ✓ / ⚠️ / 错误 等混合表达
 *
 * @example
 * <StatusBadge variant="success">已配置</StatusBadge>
 * <StatusBadge variant="danger" icon={false}>能力不足</StatusBadge>
 */
interface StatusBadgeProps {
  variant: StatusVariant
  children: React.ReactNode
  /** 不显示图标（极端紧凑场景） */
  noIcon?: boolean
  className?: string
  title?: string
}

const ICON_MAP: Record<StatusVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
  info: Info,
  neutral: Circle,
}

const VARIANT_STYLE: Record<StatusVariant, { text: string; bg: string; border: string; iconColor: string }> = {
  success: { text: 'text-[#10B981]', bg: 'bg-[#10B981]/10', border: 'border-[#10B981]/30', iconColor: '#10B981' },
  warning: { text: 'text-amber-400',   bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  iconColor: '#F59E0B' },
  danger:  { text: 'text-rose-400',    bg: 'bg-rose-500/10',   border: 'border-rose-500/30',   iconColor: '#F472B6' },
  info:    { text: 'text-[#3B82F6]',   bg: 'bg-[#3B82F6]/10',  border: 'border-[#3B82F6]/30',  iconColor: '#3B82F6' },
  neutral: { text: 'text-gray-500',    bg: 'bg-gray-500/10',   border: 'border-gray-500/30',   iconColor: '#9CA3AF' },
}

export function StatusBadge({ variant, children, noIcon = false, className = '', title }: StatusBadgeProps) {
  const Icon = ICON_MAP[variant]
  const style = VARIANT_STYLE[variant]
  void TONES[STATUS_TONE[variant]]  // 保留 tone 引用以便后续扩展（实色背景变体）
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium border ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      {!noIcon && <Icon size={10} style={{ color: style.iconColor }} />}
      {children}
    </span>
  )
}
