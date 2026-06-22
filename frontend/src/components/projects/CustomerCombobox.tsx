import { useState, useRef, useEffect } from 'react'
import { Search, X, Check, Plus, UserCircle2 } from 'lucide-react'
import type { CustomerOption } from '../../hooks/useProjectFormOptions'

interface CustomerComboboxProps {
  value: { id: number; name: string } | null
  onChange: (v: { id: number; name: string } | null) => void
  options: CustomerOption[]
  placeholder?: string
  disabled?: boolean
}

export function CustomerCombobox({ value, onChange, options, placeholder, disabled }: CustomerComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [isManual, setIsManual] = useState(value?.id === 0 || (value && !options.find(o => o.id === value.id)))
  const [draftName, setDraftName] = useState(value?.name || '')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (value && !options.find(o => o.id === value.id) && value.id !== 0) {
      setIsManual(true)
      setDraftName(value.name)
    }
  }, [value, options])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = options.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    (o.industry && o.industry.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 50)

  const handleSelect = (opt: CustomerOption) => {
    onChange({ id: opt.id, name: opt.name })
    setSearch('')
    setOpen(false)
    setIsManual(false)
  }

  const handleManualConfirm = () => {
    if (draftName.trim()) {
      onChange({ id: 0, name: draftName.trim() })
      setOpen(false)
    }
  }

  const handleClear = () => {
    onChange(null)
    setDraftName('')
    setIsManual(false)
    setSearch('')
  }

  const switchToManual = () => {
    setIsManual(true)
    setOpen(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const switchToSearch = () => {
    setIsManual(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border bg-white dark:bg-bg-input transition-all ${
        open ? 'border-accent-blue ring-2 ring-accent-blue/15' : 'border-gray-200 dark:border-border/60'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <UserCircle2 size={14} className="text-gray-400 shrink-0" />
        {isManual ? (
          <input
            ref={inputRef}
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleManualConfirm() } }}
            placeholder="手动输入客户名称"
            disabled={disabled}
            className="flex-1 bg-transparent border-none outline-none text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400"
          />
        ) : (
          <>
            <Search size={13} className="text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search || value?.name || ''}
              onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
              onFocus={() => { setOpen(true); setSearch('') }}
              placeholder={placeholder || '搜索或选择客户（可手动输入新客户）'}
              disabled={disabled}
              className="flex-1 bg-transparent border-none outline-none text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400"
            />
          </>
        )}
        {value && !isManual && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue text-[11px] font-semibold shrink-0">
            <Check size={9} /> 已选
          </span>
        )}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            tabIndex={-1}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-bg-card border border-gray-200 dark:border-border/60 rounded-lg shadow-xl shadow-black/5">
          {!isManual && (
            <>
              <button
                type="button"
                onClick={switchToManual}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent-blue font-semibold hover:bg-accent-blue/5 border-b border-gray-100 dark:border-border/20 transition-colors"
              >
                <Plus size={12} />
                {search ? `新建客户：「${search}」` : '手动输入其他客户名称'}
              </button>
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-gray-400">
                  没有匹配的客户，可点击上方「手动输入」
                </div>
              ) : (
                <div className="py-1">
                  {filtered.map((o) => (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() => handleSelect(o)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-bg-hover transition-colors ${
                        value?.id === o.id ? 'bg-accent-blue/5' : ''
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 text-blue-500 flex items-center justify-center text-[11px] font-bold shrink-0">
                        {o.name.slice(0, 1)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-800 dark:text-gray-200 truncate">{o.name}</div>
                        {o.industry && <div className="text-[11px] text-gray-400 truncate">{o.industry}</div>}
                      </div>
                      {value?.id === o.id && <Check size={12} className="text-accent-blue" />}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {isManual && (
            <div className="p-3 space-y-2">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">手动输入新客户（不会关联已有客户表）</div>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleManualConfirm() } }}
                placeholder="请输入客户全称"
                autoFocus
                className="w-full px-2.5 py-1.5 rounded border border-gray-200 dark:border-border/60 bg-white dark:bg-bg-input text-xs outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/15"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleManualConfirm}
                  disabled={!draftName.trim()}
                  className="px-2.5 py-1 rounded text-xs font-semibold bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={switchToSearch}
                  className="px-2.5 py-1 rounded text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  返回搜索
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
