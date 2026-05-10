import { useState, useEffect, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Plus, X, Loader2, Trash2, Sparkles, Globe, Building2, Users, FileText, TrendingUp, Pencil, Image, RefreshCw, Filter } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'

interface Customer {
  id: number; name: string; industry: string | null; status: string; contact: string | null
  core_products: string | null; business_scope: string | null
  scale: string | null; profile: string | null; recent_news: string | null
  logo_url: string | null; website: string | null
}

interface CompanySearchResult {
  name: string
  full_name: string
}

interface CompanyInfo {
  name?: string
  industry?: string
  core_products?: string
  business_scope?: string
  scale?: string
  profile?: string
  recent_news?: string
  logo_url?: string
  website?: string
}

interface CustomerContact {
  id: number
  customer_id: number
  name: string
  phone: string
  email: string
  position: string
  is_primary: boolean
}

// CompanyLogo 组件：多源加载logo + localStorage 缓存，失败则显示公司首字
const LOGO_CACHE_PREFIX = 'wt_logo_'

type LogoCache = { url: string } | { fallback: true }

function getLogoCacheKey(logoUrl: string | null): string {
  if (!logoUrl) return ''
  const domain = logoUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
  return LOGO_CACHE_PREFIX + (domain || logoUrl)
}

function readLogoCache(key: string): LogoCache | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeLogoCache(key: string, value: LogoCache) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function buildLogoSources(logoUrl: string | null): string[] {
  if (!logoUrl) return []
  if (/^https?:\/\//.test(logoUrl) && /\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/i.test(logoUrl)) {
    return [logoUrl]
  }
  const domain = logoUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
  if (!domain || !domain.includes('.')) return []
  return [
    `https://${domain}/favicon.ico`,
    `https://www.${domain}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://logo.clearbit.com/${domain}`,
  ]
}

function CompanyLogo({ name, logoUrl, size = 40 }: { name: string; logoUrl: string | null; size?: number }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const cacheKey = useMemo(() => getLogoCacheKey(logoUrl), [logoUrl])
  const cached = useMemo<LogoCache | null>(() => cacheKey ? readLogoCache(cacheKey) : null, [cacheKey])

  const [showFallback, setShowFallback] = useState(() => cached ? ('fallback' in cached) : false)
  const cachedUrl = useMemo(() => cached && 'url' in cached ? cached.url : null, [cached])
  const [loadAttempts, setLoadAttempts] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cleanName = (name || '').trim()

  const sources = useMemo(() => buildLogoSources(logoUrl), [logoUrl])
  const currentSrc = cachedUrl || (sources.length > loadAttempts ? sources[loadAttempts] : null)

  useEffect(() => {
    if (!cachedUrl) {
      setShowFallback(false)
      setLoadAttempts(0)
    }
  }, [logoUrl, cachedUrl])

  useEffect(() => {
    if (!currentSrc || cachedUrl) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const w = imgRef.current?.naturalWidth ?? 0
      if (w < 3) tryNextSource()
    }, 3000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [currentSrc, cachedUrl])

  const tryNextSource = () => {
    const next = loadAttempts + 1
    if (next < sources.length) {
      setLoadAttempts(next)
    } else {
      setShowFallback(true)
      if (cacheKey) writeLogoCache(cacheKey, { fallback: true })
    }
  }

  const handleImgLoad = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const w = imgRef.current?.naturalWidth ?? 0
    if (w < 3) {
      tryNextSource()
    } else if (!cachedUrl && currentSrc && cacheKey) {
      writeLogoCache(cacheKey, { url: currentSrc })
    }
  }

  const handleImgError = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    tryNextSource()
  }

  const colors = useMemo(() => [
    'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-amber-500',
    'bg-pink-500', 'bg-cyan-500', 'bg-red-500', 'bg-indigo-500',
  ], [])
  const colorIndex = cleanName ? cleanName.charCodeAt(0) % colors.length : 0

  if (showFallback || !currentSrc) {
    return (
      <div
        className={`flex-shrink-0 rounded-lg ${colors[colorIndex]} flex items-center justify-center text-white font-bold`}
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {cleanName ? cleanName[0].toUpperCase() : '?'}
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 rounded-lg overflow-hidden bg-white" style={{ width: size, height: size }}>
      <img
        ref={imgRef}
        src={currentSrc}
        alt={cleanName}
        className="w-full h-full object-contain"
        onLoad={handleImgLoad}
        onError={handleImgError}
        referrerPolicy="no-referrer"
      />
    </div>
  )
}

const statusOptions = ['潜在', '接洽中', '已签约', '维护中']
const statusColors: Record<string, string> = {
  '潜在': 'text-gray-400 bg-bg-hover',
  '接洽中': 'text-blue-400 bg-blue-500/10',
  '已签约': 'text-green-400 bg-green-500/10',
  '维护中': 'text-purple-400 bg-purple-500/10',
}

export default function CustomersPage() {
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', industry: '', contact: '', status: '潜在', core_products: '', business_scope: '', scale: '', profile: '', recent_news: '', logo_url: '', website: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState<string>('')
  const [selectedCustomerStatus, setSelectedCustomerStatus] = useState<string>('')

  // 公司智能搜索
  const [companyKeyword, setCompanyKeyword] = useState('')
  const [companyResults, setCompanyResults] = useState<CompanySearchResult[]>([])
  const [searchingCompany, setSearchingCompany] = useState(false)
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)

  // 公司信息采集
  const [fetchingCompanyInfo, setFetchingCompanyInfo] = useState(false)
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)

  // 刷新动态
  const [refreshingNewsId, setRefreshingNewsId] = useState<number | null>(null)

  // 列表展开
  const [expandedCustomerId, setExpandedCustomerId] = useState<number | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const [contacts, setContacts] = useState<CustomerContact[]>([])
  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', position: '', is_primary: false })
  const [editingContactId, setEditingContactId] = useState<number | null>(null)

  const loadContacts = (customerId: number) => {
    fetch(`/api/v1/customers/${customerId}/contacts`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    }).then(r => r.json()).then(data => setContacts(data || [])).catch(() => setContacts([]))
  }

  const saveContact = async (customerId: number) => {
    if (!contactForm.name.trim()) return
    const method = editingContactId ? 'PUT' : 'POST'
    const url = editingContactId
      ? `/api/v1/customers/${customerId}/contacts/${editingContactId}`
      : `/api/v1/customers/${customerId}/contacts`
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
      body: JSON.stringify(contactForm),
    })
    if (res.ok) {
      setContactForm({ name: '', phone: '', email: '', position: '', is_primary: false })
      setEditingContactId(null)
      loadContacts(customerId)
    }
  }

  const deleteContact = async (customerId: number, contactId: number) => {
    const ok = await showConfirm('确定删除此联系人？')
    if (!ok) return
    const res = await fetch(`/api/v1/customers/${customerId}/contacts/${contactId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    })
    if (res.ok) loadContacts(customerId)
  }

  // 从 URL 参数自动打开客户详情
  useEffect(() => {
    const customerId = searchParams.get('customer')
    if (customerId && customers.length > 0) {
      const c = customers.find(x => x.id === Number(customerId))
      if (c) {
        setExpandedCustomerId(c.id)
        setSearchParams({}, { replace: true })
      }
    }
  }, [customers, searchParams])

  useEffect(() => {
    if (expandedCustomerId) {
      loadContacts(expandedCustomerId)
    } else {
      setContacts([])
    }
  }, [expandedCustomerId])

  const resetForm = () => {
    setForm({ name: '', industry: '', contact: '', status: '潜在', core_products: '', business_scope: '', scale: '', profile: '', recent_news: '', logo_url: '', website: '' })
    setEditingId(null)
    setCompanyKeyword('')
    setCompanyResults([])
    setCompanyInfo(null)
  }

  const openEdit = (c: Customer) => {
    setForm({
      name: c.name, industry: c.industry || '', contact: c.contact || '', status: c.status,
      core_products: c.core_products || '', business_scope: c.business_scope || '',
      scale: c.scale || '', profile: c.profile || '', recent_news: c.recent_news || '',
      logo_url: c.logo_url || '', website: c.website || '',
    })
    setEditingId(c.id)
    setCompanyKeyword('')
    setCompanyResults([])
    setCompanyInfo(null)
    setShowForm(true)
  }

  const loadCustomers = () => {
    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => { setCustomers(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { loadCustomers() }, [])

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const url = editingId ? `/api/v1/customers/${editingId}` : '/api/v1/customers'
      const method = editingId ? 'PUT' : 'POST'
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setShowForm(false)
      resetForm()
      loadCustomers()
      showToast(editingId ? '客户信息已更新' : '客户创建成功', 'success')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!await showConfirm('确定删除此客户？')) return
    await fetch(`/api/v1/customers/${id}`, { method: 'DELETE' })
    loadCustomers()
    showToast('客户已删除', 'success')
  }

  const handleSearchCompany = async () => {
    if (!companyKeyword.trim() || companyKeyword.trim().length < 2) return
    setSearchingCompany(true)
    setCompanyResults([])
    try {
      const res = await fetch('/api/v1/customers/search-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: companyKeyword.trim() }),
      })
      const data = await res.json()
      if (data.results?.length > 0) {
        setCompanyResults(data.results)
        setShowCompanyDropdown(true)
      } else {
        showToast('未找到匹配的公司，请尝试更具体的关键词', 'info')
      }
    } catch {
      showToast('公司搜索失败，请检查 AI 模型配置', 'error')
    } finally {
      setSearchingCompany(false)
    }
  }

  const selectCompany = (result: CompanySearchResult) => {
    setForm({ ...form, name: result.full_name || result.name })
    setShowCompanyDropdown(false)
    setCompanyKeyword('')
    setCompanyResults([])
  }

  const handleFetchCompanyInfo = async () => {
    if (!form.name.trim()) return
    setFetchingCompanyInfo(true)
    setCompanyInfo(null)
    try {
      const res = await fetch('/api/v1/customers/fetch-company-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: form.name.trim() }),
      })
      const data = await res.json()
      if (data && Object.keys(data).length > 0) {
        setCompanyInfo(data)
        // 自动填充表单
        setForm((prev) => ({
          ...prev,
          industry: data.industry || prev.industry,
          core_products: data.core_products || prev.core_products || '',
          business_scope: data.business_scope || prev.business_scope || '',
          scale: data.scale || prev.scale || '',
          profile: data.profile || prev.profile || '',
          recent_news: data.recent_news || prev.recent_news || '',
          logo_url: data.logo_url || prev.logo_url || '',
          website: data.website || prev.website || '',
        }))
      } else {
        showToast('未能获取到公司信息，请手动填写', 'warning')
      }
    } catch {
      showToast('公司信息获取失败，请检查 AI 模型配置', 'error')
    } finally {
      setFetchingCompanyInfo(false)
    }
  }

  const handleRefreshNews = async (customerId: number) => {
    setRefreshingNewsId(customerId)
    try {
      const res = await fetch(`/api/v1/customers/${customerId}/refresh-news`, { method: 'POST' })
      const data = await res.json()
      if (data.recent_news) {
        setCustomers((prev) => prev.map((c) => c.id === customerId ? { ...c, recent_news: data.recent_news } : c))
      }
    } catch {
      showToast('刷新动态失败，请检查 AI 模型配置', 'error')
    } finally {
      setRefreshingNewsId(null)
    }
  }

  const filtered = customers.filter((c) => {
    const matchSearch = !search || c.name.includes(search) || (c.industry || '').includes(search)
    const matchIndustry = !selectedIndustry || c.industry === selectedIndustry
    const matchStatus = !selectedCustomerStatus || c.status === selectedCustomerStatus
    return matchSearch && matchIndustry && matchStatus
  })

  // 从所有客户中提取行业分类（自动累积）
  const industries = [...new Set(customers.map((c) => c.industry).filter(Boolean))] as string[]
  const statuses = [...new Set(customers.map((c) => c.status).filter(Boolean))] as string[]

  // 交叉计数
  const industryCounts = (ind: string) => customers.filter((c) =>
    c.industry === ind && (!selectedCustomerStatus || c.status === selectedCustomerStatus)
  ).length
  const statusCounts = (st: string) => customers.filter((c) =>
    c.status === st && (!selectedIndustry || c.industry === selectedIndustry)
  ).length

  const visibleIndustries = industries.filter((i) => industryCounts(i) > 0)
  const visibleStatuses = statuses.filter((s) => statusCounts(s) > 0)

  const hasActiveFilter = selectedIndustry || selectedCustomerStatus
  const clearAllFilters = () => { setSelectedIndustry(''); setSelectedCustomerStatus('') }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">客户管理</h2>
          <p className="text-sm text-gray-500 mt-1">{customers.length} 个客户</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-hover border border-border">
            <Search size={16} className="text-gray-500" />
            <input type="text" placeholder="搜索..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm text-gray-300 outline-none w-32" />
          </div>

          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-sm hover:bg-blue-600">
            <Plus size={16} /><span>新建客户</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : filtered.length === 0 && customers.length > 0 ? (
        <div className="text-center py-20">
          <Building2 size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-3">没有匹配的客户</p>
          <button onClick={() => { setSearch(''); clearAllFilters() }} className="text-sm text-[#3B82F6] hover:underline">清除筛选</button>
        </div>
      ) : customers.length === 0 ? (
        <div className="text-center py-20">
          <Building2 size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-3">暂无客户</p>
          <button onClick={() => setShowForm(true)} className="text-sm text-[#3B82F6] hover:underline">添加第一个客户</button>
        </div>
      ) : (
        <>
          {/* 多维筛选标签 */}
          {(visibleIndustries.length > 0 || visibleStatuses.length > 0 || hasActiveFilter) && (
            <div className="mb-6 space-y-3">
              <div className="flex items-center gap-2">
                <Filter size={12} className="text-gray-500" />
                <span className="text-[11px] text-gray-500">筛选</span>
                {hasActiveFilter && (
                  <button onClick={clearAllFilters} className="text-[10px] text-[#3B82F6] hover:underline ml-1">清除全部</button>
                )}
              </div>

              {/* 行业标签行 */}
              {visibleIndustries.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                  <span className="text-[10px] text-gray-600 mr-1 flex-shrink-0">行业</span>
                  {industries.map((ind) => {
                    const cnt = industryCounts(ind)
                    if (cnt === 0) return null
                    return (
                      <button
                        key={ind}
                        onClick={() => setSelectedIndustry(selectedIndustry === ind ? '' : ind)}
                        className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap border transition-colors ${
                          selectedIndustry === ind
                            ? 'bg-[#8B5CF6]/20 text-[#A78BFA] border-[#8B5CF6]/40'
                            : 'bg-bg-hover text-gray-400 border-border hover:text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {ind}
                        <span className="text-[10px] opacity-60 ml-1">{cnt}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* 状态标签行 */}
              {visibleStatuses.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                  <span className="text-[10px] text-gray-600 mr-1 flex-shrink-0">状态</span>
                  {statuses.map((st) => {
                    const cnt = statusCounts(st)
                    if (cnt === 0) return null
                    return (
                      <button
                        key={st}
                        onClick={() => setSelectedCustomerStatus(selectedCustomerStatus === st ? '' : st)}
                        className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap border transition-colors ${
                          selectedCustomerStatus === st
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                            : 'bg-bg-hover text-gray-400 border-border hover:text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {st}
                        <span className="text-[10px] opacity-60 ml-1">{cnt}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 平铺卡片 */}
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
            {filtered.map((c) => (
              <div
                key={c.id}
                className="w-full text-left break-inside-avoid mb-4 rounded-xl bg-bg-card border border-border hover:border-[#8B5CF6]/60 hover:bg-bg-hover-secondary transition-all group/card cursor-pointer"
              >
                <div onClick={() => setExpandedCustomerId(c.id)} className="p-5 pb-3">
                  {/* Logo + 标题 */}
                  <div className="flex items-start gap-3 mb-3">
                    <CompanyLogo name={c.name} logoUrl={c.logo_url} size={40} />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">{c.name}</h4>
                      <p className="text-[11px] text-gray-500 mt-0.5">{c.industry || '未设置行业'}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 ${statusColors[c.status] || statusColors['潜在']}`}>{c.status}</span>
                  </div>
                  {/* 关键信息 */}
                  <div className="space-y-1.5 text-[11px]">
                    {c.core_products && (
                      <div className="flex items-start gap-1.5 text-gray-400">
                        <Building2 size={10} className="text-gray-600 mt-0.5 shrink-0" />
                        <span className="line-clamp-1">{c.core_products}</span>
                      </div>
                    )}
                    {c.scale && (
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <Users size={10} className="text-gray-600 shrink-0" />
                        <span>{c.scale}</span>
                      </div>
                    )}
                    {c.website && (
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <Globe size={10} className="text-gray-600 shrink-0" />
                        <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                          target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="truncate text-[#8B5CF6] hover:underline">{c.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
                      </div>
                    )}
                    {c.profile && (
                      <div className="text-gray-500 line-clamp-2 mt-2 pt-2 border-t border-border/50">{c.profile}</div>
                    )}
                    {!c.profile && c.recent_news && (
                      <div className="text-gray-500 line-clamp-2 mt-2 pt-2 border-t border-border/50">{c.recent_news}</div>
                    )}
                  </div>
                </div>
                {/* 操作按钮 — 始终可见 */}
                <div className="flex items-center gap-2 px-5 pb-3">
                  <button onClick={(e) => { e.stopPropagation(); handleRefreshNews(c.id) }}
                    disabled={refreshingNewsId === c.id}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-bg-hover text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50">
                    {refreshingNewsId === c.id ? <Loader2 size={10} className="animate-spin" /> : <TrendingUp size={10} />}动态
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openEdit(c) }}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-bg-hover text-gray-400 hover:text-white transition-colors"><Pencil size={10} />编辑</button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-bg-hover text-red-400 hover:text-red-300 transition-colors"><Trash2 size={10} />删除</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 客户详情弹窗 */}
      {expandedCustomerId && (() => {
        const c = customers.find(x => x.id === expandedCustomerId)
        if (!c) return null
        const hasDetail = c.core_products || c.business_scope || c.scale || c.profile || c.recent_news || c.contact
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setExpandedCustomerId(null)}>
            <div className="w-full max-w-lg mx-4 rounded-2xl bg-bg-card border border-border shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border bg-bg-card/95 backdrop-blur-sm rounded-t-2xl">
                <div className="flex items-center gap-3">
                  <CompanyLogo name={c.name} logoUrl={c.logo_url} size={36} />
                  <div>
                    <h3 className="text-base font-bold text-white">{c.name}</h3>
                    <p className="text-[11px] text-gray-500">{c.industry || '未设置行业'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setExpandedCustomerId(null); openEdit(c) }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white border border-border"><Pencil size={11} className="inline mr-1" />编辑</button>
                  <button onClick={() => setExpandedCustomerId(null)} className="p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white"><X size={18} /></button>
                </div>
              </div>
              {/* Body */}
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] px-2.5 py-1 rounded-full border ${statusColors[c.status] || statusColors['潜在']}`}>{c.status}</span>
                  {c.contact && (
                    <span className="text-[11px] text-gray-400 bg-bg-input px-2 py-1 rounded-md border border-border">{c.contact}</span>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-bg-input/30 border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400 flex items-center gap-1.5"><Users size={12} />联系人</p>
                    <button onClick={() => { setContactForm({ name: '', phone: '', email: '', position: '', is_primary: false }); setEditingContactId(null) }}
                      className="text-[10px] text-[#3B82F6] hover:text-blue-400 flex items-center gap-0.5"><Plus size={10} />添加</button>
                  </div>
                  {contacts.length === 0 ? (
                    <p className="text-xs text-gray-600">暂无联系人</p>
                  ) : (
                    <div className="space-y-1.5">
                      {contacts.map(ct => (
                        <div key={ct.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-bg-card/50 border border-border/50 group/ct">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-200">{ct.name}</span>
                              {ct.is_primary && <span className="text-[9px] px-1 rounded bg-[#3B82F6]/20 text-[#3B82F6]">主要</span>}
                              {ct.position && <span className="text-[10px] text-gray-500">{ct.position}</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {ct.phone && <span className="text-[10px] text-gray-400">{ct.phone}</span>}
                              {ct.email && <span className="text-[10px] text-gray-400">{ct.email}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover/ct:opacity-100 transition-opacity">
                            <button onClick={() => { setContactForm({ name: ct.name, phone: ct.phone, email: ct.email, position: ct.position, is_primary: ct.is_primary }); setEditingContactId(ct.id) }}
                              className="p-1 rounded text-gray-500 hover:text-white"><Pencil size={10} /></button>
                            <button onClick={() => deleteContact(c.id, ct.id)}
                              className="p-1 rounded text-gray-500 hover:text-red-400"><Trash2 size={10} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(contacts.length === 0 || editingContactId || (!editingContactId && contacts.length > 0)) && (
                    <div className={`${contacts.length === 0 && !editingContactId ? 'hidden' : ''} mt-2 pt-2 border-t border-border/50`}>
                      {(editingContactId || contacts.length > 0) && !editingContactId && (
                        <div className="h-0 overflow-hidden">
                          {/* placeholder to keep the ternary working */}
                        </div>
                      )}
                      {editingContactId || contacts.length === 0 ? (
                        <div className="space-y-1.5">
                          <input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                            placeholder="联系人姓名 *" className="w-full px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                          <div className="grid grid-cols-2 gap-1.5">
                            <input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                              placeholder="手机" className="w-full px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                            <input value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                              placeholder="邮箱" className="w-full px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                          </div>
                          <div className="flex items-center gap-3">
                            <input value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                              placeholder="职位" className="flex-1 px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                            <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
                              <input type="checkbox" checked={contactForm.is_primary} onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                                className="w-3 h-3 rounded" />主要联系人
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => saveContact(c.id)}
                              className="px-3 py-1 rounded bg-[#3B82F6] text-white text-[10px] hover:bg-blue-600">保存</button>
                            <button onClick={() => { setEditingContactId(null); setContactForm({ name: '', phone: '', email: '', position: '', is_primary: false }) }}
                              className="px-3 py-1 rounded bg-bg-hover text-gray-400 text-[10px] hover:text-white">取消</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
                {hasDetail ? (
                  <div className="space-y-3">
                    {c.core_products && (
                      <div>
                        <span className="text-[10px] text-gray-500 flex items-center gap-1 mb-1"><Building2 size={10} />核心产品</span>
                        <p className="text-sm text-gray-300">{c.core_products}</p>
                      </div>
                    )}
                    {c.business_scope && (
                      <div>
                        <span className="text-[10px] text-gray-500 flex items-center gap-1 mb-1"><Globe size={10} />主营业务</span>
                        <p className="text-sm text-gray-300">{c.business_scope}</p>
                      </div>
                    )}
                    {c.scale && (
                      <div>
                        <span className="text-[10px] text-gray-500 flex items-center gap-1 mb-1"><Users size={10} />规模</span>
                        <p className="text-sm text-gray-300">{c.scale}</p>
                      </div>
                    )}
                    {c.website && (
                      <div>
                        <span className="text-[10px] text-gray-500 flex items-center gap-1 mb-1"><Globe size={10} />官网</span>
                        <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-sm text-[#8B5CF6] hover:underline break-all">{c.website}</a>
                      </div>
                    )}
                    {c.profile && (
                      <div>
                        <span className="text-[10px] text-gray-500 flex items-center gap-1 mb-1"><FileText size={10} />公司简介</span>
                        <p className="text-sm text-gray-300 leading-relaxed">{c.profile}</p>
                      </div>
                    )}
                    {c.recent_news && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-gray-500 flex items-center gap-1"><TrendingUp size={10} />近期动向</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRefreshNews(c.id) }}
                            disabled={refreshingNewsId === c.id}
                            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                          >
                            {refreshingNewsId === c.id ? <Loader2 size={9} className="animate-spin" /> : <RefreshCw size={9} />}
                            {refreshingNewsId === c.id ? '刷新中' : '刷新'}
                          </button>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed">{c.recent_news}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 py-4 text-center">暂无详细信息，点击编辑完善客户资料</p>
                )}
                <div className="pt-2 border-t border-border flex items-center gap-3">
                  <button onClick={() => { setExpandedCustomerId(null); openEdit(c) }}
                    className="flex-1 py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 transition-colors">编辑客户</button>
                  <button onClick={() => { setExpandedCustomerId(null); handleDelete(c.id) }}
                    className="py-2 px-4 rounded-lg bg-bg-hover text-red-400 text-sm hover:text-red-300 border border-border transition-colors">删除</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowForm(false); resetForm() }}>
          <div className="w-full max-w-lg mx-4 p-6 rounded-2xl bg-bg-card border border-border shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-medium text-white">{editingId ? '编辑客户' : '新建客户'}</h3>
              <button onClick={() => { setShowForm(false); resetForm() }} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>

            {/* ===== 公司智能搜索 ===== */}
            <div className="mb-5 p-4 rounded-xl bg-bg-input/50 border border-border">
              <p className="text-xs text-gray-400 mb-3 flex items-center gap-1.5">
                <Sparkles size={12} className="text-[#8B5CF6]" />智能搜索公司
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    value={companyKeyword}
                    onChange={(e) => { setCompanyKeyword(e.target.value); if (e.target.value.length >= 2) setShowCompanyDropdown(false) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearchCompany() }}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#8B5CF6] pr-8"
                    placeholder="输入关键词搜索公司全称..."
                  />
                  {companyKeyword && (
                    <button onClick={() => { setCompanyKeyword(''); setCompanyResults([]); setShowCompanyDropdown(false) }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button
                  onClick={handleSearchCompany}
                  disabled={searchingCompany || companyKeyword.trim().length < 2}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-medium hover:bg-purple-600 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {searchingCompany ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  {searchingCompany ? '搜索中...' : '搜索'}
                </button>
              </div>
              {/* 搜索结果下拉 */}
              {showCompanyDropdown && companyResults.length > 0 && (
                <div className="mt-2 rounded-lg bg-bg-card border border-[#8B5CF6]/30 overflow-hidden">
                  {companyResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => selectCompany(r)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-bg-hover transition-colors border-b border-border last:border-b-0"
                    >
                      <span className="text-gray-200">{r.name}</span>
                      {r.full_name && r.full_name !== r.name && (
                        <span className="text-xs text-gray-500 ml-2">{r.full_name}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {showCompanyDropdown && companyResults.length === 0 && !searchingCompany && (
                <p className="text-xs text-gray-500 mt-2 text-center">无匹配结果</p>
              )}
            </div>

            {/* ===== 表单字段 ===== */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">客户名称 *</label>
                <div className="flex items-center gap-2">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="输入客户名称" />
                  {form.name.trim() && !fetchingCompanyInfo && (
                    <button
                      onClick={handleFetchCompanyInfo}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg bg-bg-hover border border-border text-xs text-[#8B5CF6] hover:text-white hover:bg-[#8B5CF6]/10 transition-colors whitespace-nowrap"
                      title="获取公司详情"
                    >
                      <Sparkles size={13} />获取详情
                    </button>
                  )}
                  {fetchingCompanyInfo && (
                    <span className="flex items-center gap-1 px-3 py-2 text-xs text-gray-400">
                      <Loader2 size={13} className="animate-spin" />获取中...
                    </span>
                  )}
                </div>
              </div>

              {/* 公司信息卡片 */}
              {companyInfo && Object.keys(companyInfo).length > 0 && (
                <div className="p-4 rounded-xl bg-gradient-to-br from-[#8B5CF6]/5 to-bg-card border border-[#8B5CF6]/20">
                  <p className="text-xs text-[#A78BFA] mb-3 flex items-center gap-1.5">
                    <Sparkles size={12} />AI 采集的公司信息
                  </p>
                  <div className="space-y-2">
                    {companyInfo.logo_url && (
                      <div className="flex items-start gap-2">
                        <Image size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-500">Logo域名</span>
                          <p className="text-xs text-gray-300">{companyInfo.logo_url}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.industry && (
                      <div className="flex items-start gap-2">
                        <Globe size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-500">行业</span>
                          <p className="text-xs text-gray-300">{companyInfo.industry}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.core_products && (
                      <div className="flex items-start gap-2">
                        <Building2 size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-500">核心产品</span>
                          <p className="text-xs text-gray-300">{companyInfo.core_products}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.business_scope && (
                      <div className="flex items-start gap-2">
                        <FileText size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-500">主营业务</span>
                          <p className="text-xs text-gray-300">{companyInfo.business_scope}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.scale && (
                      <div className="flex items-start gap-2">
                        <Users size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-500">规模</span>
                          <p className="text-xs text-gray-300">{companyInfo.scale}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.profile && (
                      <div className="flex items-start gap-2">
                        <FileText size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-500">公司简介</span>
                          <p className="text-xs text-gray-300">{companyInfo.profile}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.recent_news && (
                      <div className="flex items-start gap-2">
                        <TrendingUp size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[10px] text-gray-500">近期动向</span>
                          <p className="text-xs text-gray-300">{companyInfo.recent_news}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1">行业</label>
                <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="如 IT、金融" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">联系方式</label>
                <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="电话或邮箱" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">状态</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]">
                  {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* 详细信息 */}
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-gray-500 mb-3 flex items-center gap-1.5">
                  <FileText size={12} />详细信息（可手动填写或通过 AI 获取）
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Image size={10} />Logo 域名</label>
                    <input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="如 example.com（用于自动获取Logo）" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Globe size={10} />官网网址</label>
                    <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="如 https://www.example.com" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">核心产品 / 明星产品</label>
                    <input value={form.core_products} onChange={(e) => setForm({ ...form, core_products: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="如 云计算、AI 平台" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">主营业务</label>
                    <input value={form.business_scope} onChange={(e) => setForm({ ...form, business_scope: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="如 企业级软件服务" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">规模人数</label>
                    <input value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="如 1000-5000人" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">公司简介</label>
                    <textarea value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })} rows={3}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] resize-none" placeholder="简要介绍公司背景..." />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">近期动向</label>
                    <textarea value={form.recent_news} onChange={(e) => setForm({ ...form, recent_news: e.target.value })} rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] resize-none" placeholder="如 最近融资、新产品发布等" />
                  </div>
                </div>
              </div>
            </div>
            <button onClick={handleSave} disabled={saving || !form.name.trim()}
              className="w-full mt-5 py-2.5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={16} className="animate-spin mx-auto" /> : editingId ? '保存修改' : '创建客户'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
