import type { LucideIcon } from 'lucide-react'
import { IconBox, type IconBoxSize } from './IconBox'
import type { Tone } from '../../theme/tokens'

/**
 * EmptyState — 统一空状态展示
 *
 * 用于：暂无数据、暂无结果、未搜索到等场景
 *
 * 设计原则：
 * - 大尺寸图标徽章 + 渐变光晕 + 引导文案 + 可选 CTA
 * - 居中展示，留白充足
 * - 使用 tone 色调（蓝/绿/紫/橙/灰）
 *
 * @example
 * <EmptyState
 *   icon={Briefcase}
 *   title="还没有项目"
 *   description="创建第一个项目，开始您的销售之旅"
 *   actionLabel="新建项目"
 *   onAction={() => setShowCreate(true)}
 *   tone="blue"
 * />
 */
interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  tone?: Tone
  size?: IconBoxSize
  className?: string
}

// tone → 渐变色对照表（与 IconBox 的 TONES 字典保持一致）
const TONE_GRADIENTS: Record<Tone, string> = {
  blue:   'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
  green:  'linear-gradient(135deg, #10B981 0%, #059669 100%)',
  purple: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
  orange: 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)',
  pink:   'linear-gradient(135deg, #EC4899 0%, #F43F5E 100%)',
  red:    'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
  cyan:   'linear-gradient(135deg, #06B6D4 0%, #0EA5E9 100%)',
  gray:   'linear-gradient(135deg, #6B7280 0%, #4B5563 100%)',
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  tone = 'gray',
  size = 'lg',
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`relative overflow-hidden text-center py-12 px-6 rounded-2xl border border-dashed border-gray-200 dark:border-white/10 bg-gradient-to-br from-gray-50 via-white to-blue-50/30 dark:from-gray-900/40 dark:via-gray-900/30 dark:to-blue-950/20 ${className}`}>
      {/* 双模糊光斑背景（用 tone 色） */}
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-[0.07] blur-3xl pointer-events-none" style={{ background: TONE_GRADIENTS[tone] }} />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full opacity-[0.05] blur-3xl pointer-events-none" style={{ background: TONE_GRADIENTS[tone] }} />

      <div className="relative flex flex-col items-center">
        <IconBox icon={icon} size={size} tone={tone} variant="soft" />

        <h3 className="mt-4 text-sm font-bold text-gray-700 dark:text-gray-200">{title}</h3>

        {description && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 max-w-xs leading-relaxed">{description}</p>
        )}

        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-all hover:scale-105 hover:shadow-lg text-[#fff]"
            style={{ background: TONE_GRADIENTS[tone] }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
