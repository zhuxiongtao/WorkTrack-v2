import { type LucideIcon } from 'lucide-react'

interface GradientIconProps {
  icon: LucideIcon
  size?: number
  className?: string
  gradient?: string
  gradientFrom?: string
  gradientTo?: string
  shadow?: boolean
  animate?: boolean
}

/**
 * 带渐变色和立体效果的图标组件
 * 
 * @example
 * // 使用预设渐变色
 * <GradientIcon icon={Sparkles} gradient="blue" />
 * 
 * // 自定义渐变色
 * <GradientIcon icon={Sparkles} gradientFrom="#3B82F6" gradientTo="#8B5CF6" />
 */
export function GradientIcon({
  icon: Icon,
  size = 18,
  className = '',
  gradient,
  gradientFrom,
  gradientTo,
  shadow = true,
  animate = false,
}: GradientIconProps) {
  // 预设渐变色方案
  const gradientMap: Record<string, { from: string; to: string; shadow: string }> = {
    blue: { from: '#3B82F6', to: '#60A5FA', shadow: 'rgba(59, 130, 246, 0.3)' },
    green: { from: '#10B981', to: '#34D399', shadow: 'rgba(16, 185, 129, 0.3)' },
    purple: { from: '#8B5CF6', to: '#A78BFA', shadow: 'rgba(139, 92, 246, 0.3)' },
    orange: { from: '#F59E0B', to: '#FBBF24', shadow: 'rgba(245, 158, 11, 0.3)' },
    pink: { from: '#EC4899', to: '#F472B6', shadow: 'rgba(236, 72, 153, 0.3)' },
    red: { from: '#EF4444', to: '#F87171', shadow: 'rgba(239, 68, 68, 0.3)' },
    cyan: { from: '#06B6D4', to: '#22D3EE', shadow: 'rgba(6, 182, 212, 0.3)' },
    amber: { from: '#F59E0B', to: '#FCD34D', shadow: 'rgba(245, 158, 11, 0.3)' },
    emerald: { from: '#059669', to: '#34D399', shadow: 'rgba(5, 150, 105, 0.3)' },
    violet: { from: '#7C3AED', to: '#A78BFA', shadow: 'rgba(124, 58, 237, 0.3)' },
  }

  // 确定渐变色
  let from = gradientFrom || '#3B82F6'
  let to = gradientTo || '#60A5FA'
  let shadowColor = 'rgba(59, 130, 246, 0.3)'

  if (gradient && gradientMap[gradient]) {
    from = gradientMap[gradient].from
    to = gradientMap[gradient].to
    shadowColor = gradientMap[gradient].shadow
  }

  const containerSize = size + 8 // 容器比图标大一点

  return (
    <div
      className={`relative flex items-center justify-center rounded-lg ${className} ${animate ? 'group-hover:scale-110 group-active:scale-95' : ''} transition-all duration-200`}
      style={{
        width: containerSize,
        height: containerSize,
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        boxShadow: shadow
          ? `0 2px 8px ${shadowColor}, inset 0 1px 1px rgba(255, 255, 255, 0.2)`
          : 'none',
      }}
    >
      {/* 高光效果 */}
      <div
        className="absolute inset-0 rounded-lg opacity-40"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 50%)',
        }}
      />
      {/* 图标 */}
      <Icon
        size={size}
        className="relative z-10 text-white drop-shadow-sm"
        strokeWidth={2}
      />
    </div>
  )
}

/**
 * 侧边栏图标 - Void Indigo 极简风格：无背景方块，纯色图标
 * active 时颜色跟随 --accent-blue CSS 变量（深色=薰衣草 / 浅色=靛蓝）
 */
export function SidebarIcon({
  icon: Icon,
  isActive = false,
  size = 16,
  // 以下两个 prop 保留签名兼容性，不再使用
  gradientFrom: _gradientFrom,
  gradientTo: _gradientTo,
}: {
  icon: LucideIcon
  gradientFrom?: string
  gradientTo?: string
  isActive?: boolean
  size?: number
}) {
  return (
    <Icon
      size={size}
      strokeWidth={isActive ? 2.4 : 2}
      style={{
        color: isActive ? 'var(--accent-blue)' : 'currentColor',
        flexShrink: 0,
        transition: 'color 0.15s',
      }}
    />
  )
}

/**
 * 小图标按钮 - 用于工具栏等场景
 */
export function MiniIcon({
  icon: Icon,
  size = 14,
  color,
  className = '',
}: {
  icon: LucideIcon
  size?: number
  color?: string
  className?: string
}) {
  return (
    <div className={`group/icon flex items-center justify-center ${className}`}>
      <Icon
        size={size}
        className="transition-all duration-200 group-hover/icon:scale-110"
        style={{
          color: color || 'currentColor',
        }}
      />
    </div>
  )
}
