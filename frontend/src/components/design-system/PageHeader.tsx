import type { LucideIcon } from 'lucide-react'
import { IconBox, type IconBoxSize } from './IconBox'
import type { Tone } from '../../theme/tokens'

/**
 * PageHeader — 页面级标题栏（用于每个顶级页面顶部）
 *
 * 统一以下用法：
 * 1. ProjectsPage / CustomersPage / MeetingsPage / ReportsPage / ContractsPage 等
 * 2. 任何 "图标徽章 + 标题 + 描述 + 统计徽章组 + 右侧操作" 的页面顶部
 *
 * 设计原则（WorkTrack v2 统一规范）：
 * - 标题字号 18-20px（text-lg/20px），加粗
 * - 描述 12-13px，灰色
 * - 统计徽章 12px，加 padding 圆角胶囊
 * - 右侧操作区可放按钮 / 切换器 / 搜索框
 *
 * @example
 * <PageHeader
 *   icon={Briefcase}
 *   title="项目管理"
 *   description="管理您负责的所有项目，跟进进度并推动成交"
 *   tone="blue"
 *   stats={[{ label: '项目', value: 12 }, { label: '本周', value: 3 }]}
 *   right={<TeamViewSwitcher />}
 * />
 */
interface PageHeaderStat {
  label: string
  value: string | number
  tone?: Tone
}

interface PageHeaderProps {
  icon: LucideIcon
  title: string
  description?: string
  tone?: Tone
  size?: IconBoxSize
  /** 右侧操作区（按钮、切换器、搜索等） */
  right?: React.ReactNode
  /** 标题下方的统计徽章组（可省略） */
  stats?: PageHeaderStat[]
  /** 自定义 class */
  className?: string
}

export function PageHeader({
  icon,
  title,
  description,
  tone = 'blue',
  size = 'md',
  right,
  stats,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-5 ${className}`}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <IconBox icon={icon} size={size} tone={tone} variant="solid" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">{title}</h2>
            {stats && stats.length > 0 && stats.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-400 bg-white/5 px-2 py-0.5 rounded-full ring-1 ring-white/5 tabular-nums"
              >
                <span className="text-gray-500">{s.label}</span>
                <span className="text-white">{s.value}</span>
              </span>
            ))}
          </div>
          {description && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {right && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {right}
        </div>
      )}
    </div>
  )
}
