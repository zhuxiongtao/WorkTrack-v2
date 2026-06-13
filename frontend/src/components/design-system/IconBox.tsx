import type { LucideIcon } from 'lucide-react'
import { TONES, type Tone } from '../../theme/tokens'

/**
 * IconBox — 统一图标容器
 *
 * 取代三种不同风格的图标用法：
 * 1. 裸 Lucide 图标
 * 2. SidebarIcon 渐变方块（侧边栏专用）
 * 3. 内联 emoji
 *
 * 4 档尺寸对应不同位置：
 * - sm (24px 容器 / 14px 图标) — 行内/表格
 * - md (32px 容器 / 18px 图标) — 卡片头/区块头
 * - lg (40px 容器 / 22px 图标) — 侧边栏
 * - xl (48px 容器 / 26px 图标) — 欢迎页/大卡片
 *
 * @example
 * <IconBox icon={MessageSquare} size="md" tone="blue" />
 * <IconBox icon={Cpu} size="lg" tone="pink" variant="solid" />
 */
export type IconBoxSize = 'sm' | 'md' | 'lg' | 'xl'

interface IconBoxProps {
  icon: LucideIcon
  size?: IconBoxSize
  tone?: Tone
  /** solid: 实心渐变（默认）；soft: 浅色背景 + 主色图标；outline: 透明 + 描边 */
  variant?: 'solid' | 'soft' | 'outline'
  className?: string
  /** 强制单色（不画背景/边框），仅渲染图标本身 */
  bare?: boolean
}

const SIZE_MAP: Record<IconBoxSize, { container: number; icon: number; rounded: string }> = {
  sm: { container: 24, icon: 14, rounded: 'rounded-md' },
  md: { container: 32, icon: 18, rounded: 'rounded-lg' },
  lg: { container: 40, icon: 22, rounded: 'rounded-lg' },
  xl: { container: 48, icon: 26, rounded: 'rounded-xl' },
}

export function IconBox({
  icon: Icon,
  size = 'md',
  tone = 'blue',
  variant = 'solid',
  className = '',
  bare = false,
}: IconBoxProps) {
  const sz = SIZE_MAP[size] || SIZE_MAP.md
  // 防御性 fallback：未知 tone 回退到 blue，避免 TONES[tone] 抛错
  const t = TONES[tone] || TONES.blue

  if (bare) {
    return <Icon size={sz.icon} className={className} style={{ color: t[500] }} strokeWidth={2} />
  }

  // —— 容器背景/边框/投影 ——
  let bg = ''
  let border = ''
  let shadow = ''

  if (variant === 'solid') {
    bg = `linear-gradient(135deg, ${t[500]} 0%, ${t[600]} 100%)`
    shadow = `0 2px 8px ${t.shadow}, inset 0 1px 1px rgba(255,255,255,0.20)`
  } else if (variant === 'soft') {
    bg = `linear-gradient(135deg, ${t[50]} 0%, ${t[100]} 100%)`
    border = `1px solid ${t[100]}`
    shadow = `inset 0 1px 1px rgba(255,255,255,0.40)`
  } else {
    // outline
    bg = 'transparent'
    border = `1px solid ${t[500]}55`
  }

  // —— 图标颜色 ——
  const iconColor = variant === 'solid' ? '#ffffff' : t[500]
  const iconStroke = variant === 'solid' ? 2.2 : 2

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${sz.rounded} ${className}`}
      style={{
        width: sz.container,
        height: sz.container,
        background: bg,
        border,
        boxShadow: shadow || undefined,
      }}
    >
      {/* 顶部高光 — 仅 solid/soft */}
      {variant !== 'outline' && (
        <div
          className="absolute inset-0 rounded-[inherit] pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 55%)',
          }}
        />
      )}
      <Icon
        size={sz.icon}
        className="relative z-10"
        style={{ color: iconColor, filter: variant === 'solid' ? 'drop-shadow(0 1px 1px rgba(0,0,0,0.15))' : undefined }}
        strokeWidth={iconStroke}
      />
    </div>
  )
}
