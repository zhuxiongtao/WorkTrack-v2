import { useState, useRef, useEffect } from 'react'
import { Search, X, Check, ChevronDown } from 'lucide-react'

type SelectValue = string | number

interface SearchableSelectProps {
  options: { id: SelectValue; label: string; sub?: string }[]
  value: SelectValue | SelectValue[]  // single or multiple
  onChange: (val: SelectValue | SelectValue[]) => void
  placeholder?: string
  emptyText?: string
  searchPlaceholder?: string
  multiple?: boolean
  className?: string
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '请选择...',
  emptyText = '无匹配结果',
  searchPlaceholder = '输入关键词搜索...',
  multiple = false,
  className = '',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setKeyword('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 打开时聚焦搜索框
  useEffect(() => {
    if (open) {
      setKeyword('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = options.filter((o) => {
    if (!keyword.trim()) return true
    const k = keyword.toLowerCase()
    return o.label.toLowerCase().includes(k) || (o.sub && o.sub.toLowerCase().includes(k))
  })

  const selectedIds: SelectValue[] = multiple ? (value as SelectValue[]) : (value ? [value as SelectValue] : [])
  const idSet = new Set(selectedIds.filter(Boolean))

  const getDisplay = () => {
    if (multiple) {
      const count = idSet.size
      if (count === 0) return placeholder
      const names = options.filter((o) => idSet.has(o.id)).map((o) => o.label)
      if (names.length <= 2) return names.join(', ')
      return `${names[0]}, ${names[1]} 等 ${count} 项`
    }
    const found = options.find((o) => o.id === value)
    return found ? found.label : placeholder
  }

  const handleSelect = (id: SelectValue) => {
    if (multiple) {
      const next = new Set(idSet)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onChange(Array.from(next))
    } else {
      onChange(id)
      setOpen(false)
      setKeyword('')
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(multiple ? [] : 0)
  }

  const hasValue = multiple ? idSet.size > 0 : !!value

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-left outline-none focus:border-[#3B82F6] transition-colors flex items-center justify-between gap-2"
      >
        <span className={hasValue ? 'text-gray-300 truncate' : 'text-gray-600 truncate'}>
          {getDisplay()}
        </span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {hasValue && (
            <X size={14} className="text-gray-500 hover:text-gray-300" onClick={handleClear} />
          )}
          <ChevronDown size={14} className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 min-w-[320px] w-full rounded-lg bg-bg-card border border-border shadow-xl overflow-visible">
          {/* 搜索框 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={13} className="text-gray-500 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={searchPlaceholder}
              className="bg-transparent text-sm text-gray-300 outline-none flex-1 placeholder-gray-600"
            />
          </div>

          {/* 列表 */}
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-4">{emptyText}</p>
            ) : (
              filtered.map((o) => {
                const selected = idSet.has(o.id)
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => handleSelect(o.id)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      selected ? 'bg-[#3B82F6]/10 text-[#3B82F6]' : 'text-gray-300 hover:bg-bg-hover'
                    }`}
                  >
                    {multiple && (
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[10px] transition-colors ${
                        selected ? 'bg-[#3B82F6] border-[#3B82F6] text-white' : 'border-gray-600'
                      }`}>
                        {selected && <Check size={10} />}
                      </span>
                    )}
                    <span className="truncate">{o.label}</span>
                    {o.sub && (
                      <span className="text-[11px] text-gray-600 truncate flex-shrink-0 ml-auto max-w-[40%]">{o.sub}</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
