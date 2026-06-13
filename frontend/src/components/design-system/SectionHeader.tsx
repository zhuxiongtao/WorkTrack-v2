import { IconBox, type IconBoxSize } from './IconBox'
import type { LucideIcon } from 'lucide-react'
import type { Tone } from '../../theme/tokens'

/**
 * SectionHeader — 区块标题（卡片/弹窗/Section 通用）
 *
 * 统一以下用法：
 * 1. SettingsPage 任务组卡片头
 * 2. TaskOverrideModal 各 Section
 * 3. DashboardPage 统计卡片
 * 4. 任何 "IconBox + 标题 + 描述 + 右侧操作" 的场景
 *
 * @example
 * <SectionHeader
 *   icon={MessageSquare} tone="blue" size="md"
 *   title="通用对话"
 *   description="AI 助手、在线问答、自由聊天"
 *   right={<StatusBadge>3/3</StatusBadge>}
 * />
 */
interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  description?: string
  tone?: Tone
  size?: IconBoxSize
  /** 标题字号 (默认 sm) */
  titleSize?: 'sm' | 'base' | 'lg'
  right?: React.ReactNode
  className?: string
}

export function SectionHeader({
  icon,
  title,
  description,
  tone = 'blue',
  size = 'md',
  titleSize = 'sm',
  right,
  className = '',
}: SectionHeaderProps) {
  const titleClass = {
    sm: 'text-sm',
    base: 'text-base',
    lg: 'text-lg',
  }[titleSize]

  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <IconBox icon={icon} size={size} tone={tone} variant="solid" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className={`${titleClass} font-semibold text-gray-900 dark:text-white truncate`}>{title}</h3>
          {right}
        </div>
        {description && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{description}</p>
        )}
      </div>
    </div>
  )
}
