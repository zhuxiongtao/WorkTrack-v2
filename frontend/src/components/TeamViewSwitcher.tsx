import { useState, useRef, useEffect } from 'react'
import { Users, User, ChevronDown, Check, X } from 'lucide-react'

interface Member {
  id: number
  name?: string
  username: string
}

interface TeamViewSwitcherProps {
  memberList: Member[]
  viewMode: 'personal' | 'team'
  onViewModeChange: (mode: 'personal' | 'team') => void
  selectedUserIds: number[]
  onSelectedUserIdsChange: (ids: number[]) => void
}

export default function TeamViewSwitcher({
  memberList,
  viewMode,
  onViewModeChange,
  selectedUserIds,
  onSelectedUserIdsChange,
}: TeamViewSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (memberList.length <= 1) return null

  const getMemberName = (m: Member) => m.name || m.username

  const filtered = memberList.filter(m =>
    getMemberName(m).toLowerCase().includes(search.toLowerCase())
  )

  const toggleMember = (id: number) => {
    if (selectedUserIds.includes(id)) {
      onSelectedUserIdsChange(selectedUserIds.filter(i => i !== id))
    } else {
      onSelectedUserIdsChange([...selectedUserIds, id])
    }
  }

  const clearSelection = () => {
    onSelectedUserIdsChange([])
  }

  const selectedNames = selectedUserIds
    .map(id => memberList.find(m => m.id === id))
    .filter(Boolean)
    .map(m => getMemberName(m!))

  const summaryText = selectedUserIds.length === 0
    ? '全部成员'
    : selectedUserIds.length === 1
      ? selectedNames[0]
      : `${selectedNames[0]} 等 ${selectedUserIds.length} 人`

  return (
    <div className="flex items-center gap-2">
      {/* Segmented toggle */}
      <div className="flex items-center rounded-lg bg-bg-card border border-border p-0.5">
        <button
          onClick={() => onViewModeChange('personal')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
            viewMode === 'personal'
              ? 'bg-[#3B82F6] text-white shadow-sm shadow-[#3B82F6]/30'
              : 'text-gray-500 hover:text-gray-200'
          }`}
        >
          <User size={13} />
          我的
        </button>
        <button
          onClick={() => onViewModeChange('team')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
            viewMode === 'team'
              ? 'bg-[#3B82F6] text-white shadow-sm shadow-[#3B82F6]/30'
              : 'text-gray-500 hover:text-gray-200'
          }`}
        >
          <Users size={13} />
          团队
        </button>
      </div>

      {/* Team member selector - only shown in team mode */}
      {viewMode === 'team' && (
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setOpen(!open)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all duration-200 ${
              open
                ? 'bg-[#3B82F6]/10 border-[#3B82F6]/50 text-[#60A5FA]'
                : 'bg-bg-card border-border text-gray-300 hover:border-gray-500'
            } ${selectedUserIds.length > 0 ? 'border-[#3B82F6]/40' : ''}`}
          >
            <span className="max-w-[140px] truncate">{summaryText}</span>
            {selectedUserIds.length > 0 && (
              <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#3B82F6] text-white text-[10px] font-bold leading-none">
                {selectedUserIds.length}
              </span>
            )}
            <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="absolute top-full left-0 mt-1.5 w-56 bg-bg-card border border-border rounded-xl shadow-xl shadow-black/40 dark:shadow-black/40 z-50 overflow-hidden">
              {/* Search */}
              <div className="p-2 border-b border-border">
                <input
                  type="text"
                  placeholder="搜索成员..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-bg-input border border-border rounded-lg text-gray-300 outline-none focus:border-[#3B82F6]/50 placeholder-gray-600"
                  autoFocus
                />
              </div>

              {/* Select all / clear */}
              {selectedUserIds.length > 0 && (
                <div className="px-2 py-1.5 border-b border-border">
                  <button
                    onClick={clearSelection}
                    className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-[#60A5FA] transition-colors"
                  >
                    <X size={11} />
                    清除筛选，查看全部成员
                  </button>
                </div>
              )}

              {/* Member list */}
              <div className="max-h-[240px] overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-600 text-center">无匹配成员</div>
                ) : (
                  filtered.map(m => {
                    const isSelected = selectedUserIds.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleMember(m.id)}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors ${
                          isSelected
                            ? 'bg-[#3B82F6]/10 text-[#60A5FA]'
                            : 'text-gray-400 hover:bg-bg-hover hover:text-gray-200'
                        }`}
                      >
                        <span className={`flex items-center justify-center w-4 h-4 rounded border transition-all ${
                          isSelected
                            ? 'bg-[#3B82F6] border-[#3B82F6]'
                            : 'border-gray-500 bg-transparent'
                        }`}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </span>
                        <span className="truncate">{getMemberName(m)}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
