/**
 * Modal — 统一弹窗组件
 *
 * 业务管理大模块（供应商/通道/对账/模型/项目/客户）的所有弹窗统一用此组件。
 *
 * 用法：
 *   <Modal
 *     icon={Building2}
 *     title="新建供应商"
 *     subtitle="录入基础信息，后续可在详情页补充"
 *     tone="blue"
 *     onClose={() => setShow(false)}
 *   >
 *     <SectionLabel>基本信息</SectionLabel>
 *     <Field label="名称" required>
 *       <input className="form-input" />
 *     </Field>
 *   </Modal>
 *
 * 设计：
 * - 容器：圆角 2xl + 主题色边框，亮/暗模式自动适配（src/index.css 已处理 .from-gray-900.to-gray-950）
 * - Header：sticky，tone 渐变背景 + IconBox + 标题/副标题
 * - Footer：sticky，半透明主题色，主按钮用 tone 渐变
 * - 主题色由 tone 决定，与侧边栏 SectionHeader / PageHeader 保持一致
 */
import type { LucideIcon } from 'lucide-react'
import { X, Loader2 } from 'lucide-react'
import { TONES, type Tone } from '../../theme/tokens'
import { IconBox } from './IconBox'

type ModalTone = Tone

export interface ModalProps {
  icon?: LucideIcon
  title: string
  subtitle?: string
  tone?: ModalTone
  onClose: () => void
  /** 限制最大宽度，默认 max-w-2xl（可用 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'） */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  children: React.ReactNode
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-5xl',
}

/** Header 的 tone 渐变背景 — 半透明，主色淡 */
const HEADER_GRADIENT: Record<ModalTone, string> = {
  blue: 'from-blue-500/12 to-cyan-500/8',
  cyan: 'from-cyan-500/12 to-blue-500/8',
  green: 'from-emerald-500/12 to-green-500/8',
  orange: 'from-orange-500/12 to-amber-500/8',
  red: 'from-rose-500/12 to-red-500/8',
  purple: 'from-violet-500/12 to-purple-500/8',
  pink: 'from-pink-500/12 to-rose-500/8',
  gray: 'from-gray-500/10 to-slate-500/8',
}

/** 主按钮 tone 渐变 */
const FOOTER_GRADIENT: Record<ModalTone, string> = {
  blue: 'from-blue-500 to-cyan-500',
  cyan: 'from-cyan-500 to-blue-500',
  green: 'from-emerald-500 to-green-500',
  orange: 'from-orange-500 to-amber-500',
  red: 'from-rose-500 to-red-500',
  purple: 'from-violet-500 to-purple-500',
  pink: 'from-pink-500 to-rose-500',
  gray: 'from-gray-500 to-slate-500',
}

export function Modal({
  icon: Icon,
  title,
  subtitle,
  tone = 'blue',
  onClose,
  size = '2xl',
  children,
}: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`w-full ${SIZE_CLASS[size]} max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl animate-scaleIn overflow-hidden`}
        style={{
          borderColor: `${TONES[tone][500]}33`, // 边框：tone 色 20% 透明
          background: 'var(--bg-card)',         // 主体：主题色卡片
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b bg-gradient-to-r ${HEADER_GRADIENT[tone]}`}
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-start gap-3 min-w-0">
            {Icon && <IconBox icon={Icon} size="md" tone={tone} variant="solid" />}
            <div className="min-w-0">
              <h3
                className="text-base font-bold leading-tight"
                style={{ color: 'var(--text-primary, #E5E7EB)' }}
              >
                {title}
              </h3>
              {subtitle && (
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary, #9CA3AF)' }}>
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 dark:hover:bg-white/10 transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — 可滚动 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export interface ModalFooterProps {
  onClose: () => void
  onSave?: () => void
  saving?: boolean
  tone?: ModalTone
  saveText?: string
  saveDisabled?: boolean
  /** 显示在左侧的辅助信息（自动隐藏如果没传） */
  leftHint?: React.ReactNode
  /** 自定义右侧按钮（覆盖默认的「取消 + 保存」） */
  rightExtra?: React.ReactNode
}

/**
 * ModalFooter — 统一底部操作栏
 *
 * 用法：
 *   <ModalFooter onClose={...} onSave={...} saving={saving} tone="blue" saveText="创建通道" />
 */
export function ModalFooter({
  onClose,
  onSave,
  saving = false,
  tone = 'blue',
  saveText = '保存',
  saveDisabled = false,
  leftHint,
  rightExtra,
}: ModalFooterProps) {
  return (
    <div
      className="shrink-0 sticky bottom-0 z-10 flex items-center justify-between gap-2 px-5 py-3 border-t backdrop-blur"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg-card) 88%, transparent)',
      }}
    >
      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate flex-1 min-w-0">
        {leftHint}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {rightExtra}
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-border/30 rounded-lg font-semibold transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          取消
        </button>
        {onSave && (
          <button
            onClick={onSave}
            disabled={saving || saveDisabled}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-gradient-to-r ${FOOTER_GRADIENT[tone]} rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm`}
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {saveText}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * SectionLabel — 弹窗内的分组标题（统一灰色小字 + 大写 + tracking）
 */
export function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`text-[11px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${className}`}
      style={{ color: 'var(--text-secondary, #9CA3AF)' }}
    >
      {children}
    </div>
  )
}

/**
 * Field — 统一表单字段（label 在上 + required 红星）
 */
export function Field({
  label,
  required,
  full,
  hint,
  children,
  className = '',
}: {
  label: string
  required?: boolean
  /** 占满整行（用于 textarea / 跨列字段） */
  full?: boolean
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''} ${className}`}>
      <span
        className="text-[11px] font-semibold mb-1.5 block"
        style={{ color: 'var(--text-secondary, #9CA3AF)' }}
      >
        {label}
        {required && <span className="text-rose-400 ml-0.5">*</span>}
        {hint && (
          <span
            className="ml-1.5 text-[10px] font-normal"
            style={{ color: 'var(--text-muted, #6B7280)' }}
          >
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  )
}
