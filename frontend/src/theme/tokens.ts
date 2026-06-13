/**
 * WorkTrack v2 设计系统 — 颜色 / 圆角 / 阴影 token
 *
 * 设计原则：
 * - 8 档语义色：blue / purple / green / orange / pink / red / cyan / gray
 * - 每档有 5 个梯度：50 (浅背景) / 100 (悬停) / 500 (主色) / 600 (按下) / 900 (深色)
 * - 与 tailwind theme 中的 --color-accent-* 保持一致
 *
 * ⚠️ 改这里 = 改整个平台的视觉语言，请谨慎评估影响范围
 */

export type Tone = 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'red' | 'cyan' | 'gray'

export interface ToneScale {
  50: string   // 极浅背景 (badge 底色)
  100: string  // 浅背景 (chip 选中态)
  500: string  // 主色 (icon、border、text)
  600: string  // 加深 (hover)
  900: string  // 文字 (高对比)
  ring: string // focus ring (rgba 50% 透明)
  shadow: string // IconBox 投影
}

export const TONES: Record<Tone, ToneScale> = {
  blue: {
    50: '#EFF6FF',   100: '#DBEAFE',  500: '#3B82F6',  600: '#2563EB',  900: '#1E3A8A',
    ring: 'rgba(59, 130, 246, 0.45)',  shadow: 'rgba(59, 130, 246, 0.28)',
  },
  purple: {
    50: '#F5F3FF',   100: '#EDE9FE',  500: '#8B5CF6',  600: '#7C3AED',  900: '#4C1D95',
    ring: 'rgba(139, 92, 246, 0.45)',  shadow: 'rgba(139, 92, 246, 0.28)',
  },
  green: {
    50: '#ECFDF5',   100: '#D1FAE5',  500: '#10B981',  600: '#059669',  900: '#064E3B',
    ring: 'rgba(16, 185, 129, 0.45)',  shadow: 'rgba(16, 185, 129, 0.28)',
  },
  orange: {
    50: '#FFF7ED',   100: '#FFEDD5',  500: '#F59E0B',  600: '#D97706',  900: '#7C2D12',
    ring: 'rgba(245, 158, 11, 0.45)',  shadow: 'rgba(245, 158, 11, 0.28)',
  },
  pink: {
    50: '#FDF2F8',   100: '#FCE7F3',  500: '#EC4899',  600: '#DB2777',  900: '#831843',
    ring: 'rgba(236, 72, 153, 0.45)',  shadow: 'rgba(236, 72, 153, 0.28)',
  },
  red: {
    50: '#FEF2F2',   100: '#FEE2E2',  500: '#EF4444',  600: '#DC2626',  900: '#7F1D1D',
    ring: 'rgba(239, 68, 68, 0.45)',   shadow: 'rgba(239, 68, 68, 0.28)',
  },
  cyan: {
    50: '#ECFEFF',   100: '#CFFAFE',  500: '#06B6D4',  600: '#0891B2',  900: '#164E63',
    ring: 'rgba(6, 182, 212, 0.45)',   shadow: 'rgba(6, 182, 212, 0.28)',
  },
  gray: {
    50: '#F9FAFB',   100: '#F3F4F6',  500: '#6B7280',  600: '#4B5563',  900: '#1F2937',
    ring: 'rgba(107, 114, 128, 0.45)', shadow: 'rgba(107, 114, 128, 0.20)',
  },
} as const

/** 中性色（背景/边框/文字）— 与现有 --bg-* 联动 */
export const NEUTRAL = {
  bgPrimary: 'var(--bg-primary)',
  bgCard: 'var(--bg-card)',
  bgInput: 'var(--bg-input)',
  bgHover: 'var(--bg-hover)',
  border: 'var(--border)',
  textPrimary: '#E5E7EB',   // 暗色默认
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
} as const

/** 圆角 token */
export const RADIUS = {
  sm: 'rounded-md',      // 6px — 按钮、chip
  md: 'rounded-lg',      // 8px — 卡片内嵌
  lg: 'rounded-xl',      // 12px — 卡片
  xl: 'rounded-2xl',     // 16px — 大卡片/弹窗
} as const

/** 阴影 token（覆盖默认） */
export const SHADOW = {
  card: 'shadow-sm',                                            // 普通卡片
  elevated: 'shadow-lg shadow-black/5',                         // 悬停/激活卡片
  modal: 'shadow-2xl',                                          // 弹窗
  iconBox: '0 4px 12px var(--tw-shadow-color), inset 0 1px 1px rgba(255,255,255,0.15)',  // IconBox
} as const

/** 间距节奏 — 8px 基准 */
export const SPACE = {
  xs: 'gap-1',       // 4px
  sm: 'gap-2',       // 8px
  md: 'gap-3',       // 12px
  lg: 'gap-4',       // 16px
  xl: 'gap-6',       // 24px
} as const

/** 状态语义 */
export type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export const STATUS_TONE: Record<StatusVariant, Tone> = {
  success: 'green',
  warning: 'orange',
  danger: 'red',
  info: 'blue',
  neutral: 'gray',
}

/** 状态对应的中文标签（统一术语） */
export const STATUS_LABEL: Record<StatusVariant, string> = {
  success: '已配置',
  warning: '类型不匹配',
  danger: '能力不足',
  info: '信息',
  neutral: '未配置',
}
