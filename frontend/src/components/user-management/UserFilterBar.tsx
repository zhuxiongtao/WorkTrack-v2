import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import type { RoleData } from '../../services/types'
import SearchableSelect from '../SearchableSelect'

interface UserFilterBarProps {
  search: string
  onSearchChange: (v: string) => void
  roleId: string | number
  onRoleChange: (v: string | number) => void
  status: string
  onStatusChange: (v: string) => void
  roles: RoleData[]
}

export function UserFilterBar({
  search, onSearchChange,
  roleId, onRoleChange,
  status, onStatusChange,
  roles,
}: UserFilterBarProps) {
  const { resolvedTheme: theme } = useTheme()
  const [localSearch, setLocalSearch] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLocalSearch(search)
  }, [search])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleSearchInput = (v: string) => {
    setLocalSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onSearchChange(v), 350)
  }

  return (
    <div className="p-4 rounded-xl bg-bg-card border border-gray-200 dark:border-border/30 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
      {/* 模糊搜索（带去抖） */}
      <div className="relative md:col-span-1">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <Search size={14} className="text-gray-400 dark:text-gray-500" />
        </span>
        <input
          type="text"
          placeholder="搜索用户名、姓名、邮箱..."
          value={localSearch}
          onChange={e => handleSearchInput(e.target.value)}
          className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium"
        />
        {localSearch && (
          <button onClick={() => handleSearchInput('')} className="absolute inset-y-0 right-0 flex items-center pr-2.5 hover:text-gray-800 dark:hover:text-gray-200 text-gray-400 cursor-pointer">
            <X size={12} />
          </button>
        )}
      </div>

      {/* 角色过滤 */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 shrink-0">角色:</span>
        <div className="flex-1">
          <SearchableSelect
            options={[
              { id: 'all', label: '全部系统角色' },
              ...roles.map(r => ({ id: r.id, label: r.name })),
            ]}
            value={roleId}
            onChange={(v) => onRoleChange(v === 0 ? 'all' : v)}
            clearValue=""
          />
        </div>
      </div>

      {/* 状态过滤 */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 shrink-0">账号状态:</span>
        <div className="flex-1">
          <SearchableSelect
            options={[
              { id: 'all', label: '不限状态' },
              { id: 'active', label: '正常活跃' },
              { id: 'disabled', label: '已停用' },
              { id: 'resigned', label: '已离职' },
              { id: 'locked', label: '锁定制中' },
            ]}
            value={status}
            onChange={(v) => onStatusChange(v === 0 ? 'all' : String(v))}
            clearValue=""
          />
        </div>
      </div>
    </div>
  )
}
