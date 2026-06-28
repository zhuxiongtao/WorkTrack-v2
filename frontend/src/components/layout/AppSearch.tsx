import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Sparkles } from 'lucide-react'
import { MENU_CATEGORIES } from './menuConfig'

export interface SearchResult {
  id: number | string
  title?: string
  snippet?: string
  date?: string
  name?: string
  customer?: string
  status?: string
  type: string
  label: string
}

const typeColor: Record<string, string> = {
  report: 'text-accent-blue bg-accent-blue/10',
  project: 'text-amber-400 bg-amber-500/10',
  meeting: 'text-green-400 bg-green-500/10',
  customer: 'text-purple-400 bg-purple-500/10',
  module: 'text-cyan-400 bg-cyan-500/10',
}

function AppSearch() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 本地菜单索引：用于"功能模块"搜索（按 label/categoryTitle/to 匹配）
  const menuIndex = useMemo(() => {
    const out: SearchResult[] = []
    for (const cat of MENU_CATEGORIES) {
      for (const it of cat.items) {
        out.push({
          id: it.to,
          title: it.label,
          snippet: `${cat.title} · ${it.to}`,
          type: 'module',
          label: '功能模块',
        })
      }
    }
    return out
  }, [])

  const localMatchMenu = (q: string): SearchResult[] => {
    const lower = q.toLowerCase().trim()
    if (!lower) return []
    return menuIndex.filter((m) => {
      const t = (m.title || '').toLowerCase()
      const s = (m.snippet || '').toLowerCase()
      return t.includes(lower) || s.includes(lower) || String(m.id).toLowerCase().includes(lower)
    })
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    // 1) 本地菜单匹配（同步、零延迟）
    const menuHits = localMatchMenu(q)
    if (menuHits.length > 0) {
      setSearchResults(menuHits.slice(0, 10))
      setShowDropdown(true)
    } else {
      setSearchResults([])
    }
    // 2) 后端业务数据搜索（防抖）
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        const items: SearchResult[] = [...menuHits] // 菜单结果保留
        ;(data.reports || []).forEach((r: { id: number; date: string; snippet: string }) => {
          items.push({ id: r.id, title: r.date, snippet: r.snippet, date: r.date, type: 'report', label: '日报' })
        })
        ;(data.projects || []).forEach((p: { id: number; name: string; customer: string; status: string; snippet: string }) => {
          items.push({ id: p.id, name: p.name, customer: p.customer, status: p.status, snippet: p.snippet, type: 'project', label: '项目' })
        })
        ;(data.meetings || []).forEach((m: { id: number; title: string; date: string; snippet: string }) => {
          items.push({ id: m.id, title: m.title, snippet: m.snippet, date: m.date, type: 'meeting', label: '会议' })
        })
        ;(data.customers || []).forEach((c: { id: number; name: string; status: string }) => {
          items.push({ id: c.id, name: c.name, status: c.status, type: 'customer', label: '客户' })
        })
        if (data.semantic) {
          Object.entries(data.semantic).forEach(([key, arr]: [string, any]) => {
            ;(arr || []).forEach((s: { id: string; score: number; snippet: string }) => {
              const typeMap: Record<string, string> = { semantic_reports: 'report', semantic_projects: 'project', semantic_meetings: 'meeting' }
              const labelMap: Record<string, string> = { semantic_reports: '日报(语义)', semantic_projects: '项目(语义)', semantic_meetings: '会议(语义)' }
              items.push({ id: s.id, snippet: s.snippet, type: typeMap[key] || 'report', label: labelMap[key] || '语义匹配' })
            })
          })
        }
        setSearchResults(items.slice(0, 15))
        setShowDropdown(true)
      } catch {
        // 后端失败时保留本地菜单结果
        if (menuHits.length === 0) setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const goToResult = (item: SearchResult) => {
    setShowDropdown(false)
    setSearchQuery('')
    if (item.type === 'module') {
      // 功能模块：SPA 跳转（不刷新页面）
      navigate(String(item.id))
    } else if (item.type === 'report') window.open(`/reports?highlight=${item.id}`, '_blank')
    else if (item.type === 'project') window.open(`/projects?highlight=${item.id}`, '_blank')
    else if (item.type === 'meeting') window.open(`/meetings?highlight=${item.id}`, '_blank')
    else if (item.type === 'customer') window.open(`/customers?highlight=${item.id}`, '_blank')
  }

  return (
    <div ref={searchRef} className="px-3 py-3 relative">
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-card border border-border focus-within:border-accent-blue transition-colors">
        <Search size={14} className="text-gray-500 flex-shrink-0" />
        <input
          type="text"
          placeholder="搜索菜单 / 业务数据..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
          className="bg-transparent text-xs text-gray-300 outline-none w-full placeholder-gray-600"
        />
        {searching && <Sparkles size={12} className="animate-spin text-accent-blue flex-shrink-0" />}
        {searchQuery && (
          <button onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false) }} className="text-gray-500 hover:text-gray-900 dark:hover:text-white flex-shrink-0">
            <X size={12} />
          </button>
        )}
      </div>

      {showDropdown && searchResults.length > 0 && (
        <div className="absolute top-full left-3 right-3 mt-1 max-h-80 overflow-y-auto rounded-xl bg-bg-card border border-border shadow-2xl z-50">
          {searchResults.map((item, i) => (
            <button
              key={`${item.type}-${item.id}-${i}`}
              onClick={() => goToResult(item)}
              className="w-full text-left px-3 py-2.5 hover:bg-bg-sidebar border-b border-border last:border-b-0 transition-colors"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-[11px] px-1 py-0.5 rounded ${typeColor[item.type] || 'text-gray-400 bg-gray-500/10'}`}>
                  {item.label}
                </span>
                <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                  {item.title || item.name || item.id}
                </span>
              </div>
              {item.snippet && (
                <p className="text-[11px] text-gray-500 truncate mt-0.5 leading-tight">{item.snippet}</p>
              )}
            </button>
          ))}
        </div>
      )}
      {showDropdown && searchQuery && !searching && searchResults.length === 0 && (
        <div className="absolute top-full left-3 right-3 mt-1 rounded-xl bg-bg-card border border-border shadow-2xl z-50 p-4 text-center">
          <p className="text-xs text-gray-500">没有找到相关内容</p>
        </div>
      )}
    </div>
  )
}

export default AppSearch
