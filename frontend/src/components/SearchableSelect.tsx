import { useEffect, useRef, useState, useMemo, useCallback, ReactNode } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'

export type SearchableSelectOption<T = any> = {
  value: string | number
  label: string
  meta?: ReactNode   // 列表项中显示的补充信息（图标签/小字等）
  badge?: ReactNode  // 选中项中显示的小徽章（如「默认」）
  hint?: string      // 用于模糊搜索的补充关键词
  disabled?: boolean
}

type Props<T> = {
  value: T | null | undefined
  onChange: (v: T | null) => void
  options: SearchableSelectOption<T>[]
  placeholder?: string
  /** 自定义列表项渲染（拿到 option，可渲染多行内容） */
  renderOption?: (opt: SearchableSelectOption<T>, active: boolean, selected: boolean) => ReactNode
  /** 自定义触发器（折叠态）显示内容。默认显示 option.label */
  renderTrigger?: (selected: SearchableSelectOption<T> | null) => ReactNode
  /** 自定义空状态文案 */
  emptyText?: string
  /** 整行小尺寸（适配表格内） */
  size?: 'sm' | 'md'
  /** 触发器 className */
  className?: string
  /** 面板宽度（默认与触发器同宽，可指定 '240px' / '100%' 等） */
  panelWidth?: string
  /** 失焦时是否清空搜索关键字 */
  resetSearchOnClose?: boolean
}

/**
 * 通用可搜索下拉组件
 * - 折叠态：显示当前选中项的 label（可被 renderTrigger 覆盖）
 * - 展开态：顶部搜索框 + 可滚动的选项列表
 * - 模糊匹配：label + hint 一起匹配（不区分大小写、支持中文）
 * - 键盘：Esc 关闭、Enter 选中高亮项
 * - 点击外部自动关闭
 */
export default function SearchableSelect<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = '请选择',
  renderOption,
  renderTrigger,
  emptyText = '无匹配项',
  size = 'md',
  className = '',
  panelWidth,
  resetSearchOnClose = true,
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const [kw, setKw] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 找到当前选中项
  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  )

  // 过滤后的选项
  const filtered = useMemo(() => {
    if (!kw.trim()) return options
    const k = kw.trim().toLowerCase()
    return options.filter((o) => {
      const hay = [o.label, o.hint || ''].join(' ').toLowerCase()
      return hay.includes(k)
    })
  }, [options, kw])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        if (resetSearchOnClose) setKw('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, resetSearchOnClose])

  // 打开时聚焦输入框 + 重置高亮
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30)
      setHighlight(0)
    } else {
      if (resetSearchOnClose) setKw('')
    }
  }, [open, resetSearchOnClose])

  const choose = useCallback(
    (opt: SearchableSelectOption<T>) => {
      if (opt.disabled) return
      onChange(opt.value)
      setOpen(false)
    },
    [onChange]
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(filtered.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[highlight]
      if (opt) choose(opt)
    } else if (e.key === 'Backspace' && !kw && selected) {
      // 退格清空当前选项（贴近原生 select 体验）
      onChange(null)
    }
  }

  // 尺寸
  const isSm = size === 'sm'
  const triggerH = isSm ? 'h-7 text-xs px-2' : 'h-9 text-sm px-3'

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* 触发器 */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`w-full flex items-center justify-between gap-1.5 rounded-lg border border-border bg-bg-card
                    hover:border-accent-blue/50 focus:border-accent-blue focus:outline-none
                    transition-colors ${triggerH}
                    ${open ? 'border-accent-blue' : ''}`}
      >
        <span className="flex-1 text-left truncate flex items-center gap-1.5 min-w-0">
          {selected ? (
            <>
              {selected.badge && <span className="shrink-0">{selected.badge}</span>}
              {renderTrigger ? (
                renderTrigger(selected)
              ) : (
                <span className="truncate">{selected.label}</span>
              )}
            </>
          ) : (
            <span className="text-gray-400 truncate">{placeholder}</span>
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selected && !isSm && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); onChange(null) }}
              className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
              title="清空"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={isSm ? 12 : 14}
            className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* 展开面板 */}
      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-border bg-bg-card shadow-xl
                      overflow-hidden flex flex-col"
          style={{ maxHeight: '320px', minWidth: panelWidth || undefined }}
        >
          {/* 搜索框 */}
          <div className="px-2 py-1.5 border-b border-border bg-bg-hover/40">
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                value={kw}
                onChange={(e) => { setKw(e.target.value); setHighlight(0) }}
                onKeyDown={onKeyDown}
                placeholder="输入关键词搜索…"
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border border-transparent bg-bg-card
                           outline-none focus:border-accent-blue"
              />
            </div>
          </div>
          {/* 列表 */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400">{emptyText}</div>
            ) : (
              filtered.map((opt, idx) => {
                const isSel = opt.value === value
                const isActive = idx === highlight
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => choose(opt)}
                    onMouseEnter={() => setHighlight(idx)}
                    disabled={opt.disabled}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2
                                ${opt.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                                ${isActive ? 'bg-bg-hover' : ''}
                                ${isSel ? 'text-accent-blue' : 'text-gray-700 dark:text-gray-200'}
                                hover:bg-bg-hover transition-colors`}
                  >
                    {renderOption ? (
                      renderOption(opt, isActive, isSel)
                    ) : (
                      <>
                        <span className="flex-1 truncate">{opt.label}</span>
                        {opt.badge && <span className="shrink-0">{opt.badge}</span>}
                        {isSel && <Check size={12} className="text-accent-blue shrink-0" />}
                      </>
                    )}
                  </button>
                )
              })
            )}
          </div>
          {/* 底部小提示 */}
          {filtered.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border bg-bg-hover/40
                            text-[10px] text-gray-400 flex items-center justify-between">
              <span>共 {filtered.length} 项</span>
              <span className="hidden sm:inline">↑↓ 选择 · Enter 确认 · Esc 关闭</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
