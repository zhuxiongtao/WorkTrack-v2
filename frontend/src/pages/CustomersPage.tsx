import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search as SearchIcon, Plus, X, Loader2, Trash2, Sparkles, Globe, Building2, Users, FileText, TrendingUp, Pencil, Image, RefreshCw, Filter, ChevronDown, Brain, CheckCircle2, Globe2, BookOpen, ExternalLink } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import RichTextEditor from '../components/RichTextEditor'
import { PageHeader, EmptyState } from '../components/design-system'
import SearchableSelect from '../components/SearchableSelect'

interface Customer {
  id: number; name: string; industry: string | null; status: string; contact: string | null
  core_products: string | null; business_scope: string | null
  scale: string | null; profile: string | null; recent_news: string | null
  recent_news_evidence: string | null
  logo_url: string | null; website: string | null
  ai_initiatives: string | null
  ai_evidence: string | null
  created_at: string
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
  recent_news_evidence?: string
  logo_url?: string
  website?: string
  ai_initiatives?: string
  ai_evidence?: string
}

interface AIEvidenceItem {
  text: string
  url: string
  domain: string
  title: string
}

// 4 阶段进度配置（按时间切换模拟进度，后端会按 tavily → site → llm 推送）
const STAGE_LIST = [
  { key: 'tavily', label: '联网搜索', icon: SearchIcon, color: 'text-[#3B82F6]', bg: 'bg-[#3B82F6]' },
  { key: 'site',   label: '抓取官网+百科', icon: Globe2,    color: 'text-[#10B981]', bg: 'bg-[#10B981]' },
  { key: 'llm',    label: 'AI 整理',   icon: Brain,      color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]' },
  { key: 'done',   label: '完成',      icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500' },
] as const
type StageKey = typeof STAGE_LIST[number]['key']

interface CustomerContact {
  id: number
  customer_id: number
  name: string
  phone: string
  email: string
  position: string
  is_primary: boolean
}

// CompanyLogo 组件:走后端 /api/v1/customers/logo 代理 + 失败时降级显示公司首字

// 去掉 HTML 标签得到纯文本（profile/recent_news 可能含富文本 HTML，避免在卡片 line-clamp 摘要中显示 <p> 等字面量）
function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(?!\n)/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 解析 ai_evidence JSON 字符串
function parseAIEvidence(raw: string | null | undefined): AIEvidenceItem[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object')
  } catch { /* ignore */ }
  return []
}

// AI 动向带来源链接的渲染组件
function AIInitiativeBlock({ text, evidence, compact = false }: { text: string; evidence: AIEvidenceItem[]; compact?: boolean }) {
  if (!text) return null
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return null
  return (
    <div className="rounded-lg bg-[#8B5CF6]/5 border border-[#8B5CF6]/25 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Brain size={12} className="text-[#A78BFA]" />
        <span className="text-[11px] text-[#A78BFA] font-medium">AI 领域动向</span>
        <span className="text-[11px] text-gray-500 ml-1">
          基于多源真实证据{evidence.length ? `（${evidence.length} 条来源）` : ''}
        </span>
      </div>
      <ul className={`space-y-1.5 ${compact ? 'text-xs' : 'text-sm'} text-gray-300 leading-relaxed`}>
        {lines.map((line, idx) => {
          const t = line.replace(/^[-*•·]\s*/, '').trim()
          if (!t) return null
          const ev = evidence[idx]
          return (
            <li key={idx} className="flex gap-2">
              <span className="text-[#A78BFA] mt-1 shrink-0">•</span>
              <div className="flex-1 min-w-0">
                <span>{t}</span>
                {ev?.url && (
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 ml-1.5 text-[11px] text-[#A78BFA] hover:text-white hover:bg-[#8B5CF6]/30 px-1.5 py-0.5 rounded transition-colors align-baseline whitespace-nowrap"
                    title={ev.title || ev.url}
                  >
                    <span className="truncate max-w-[120px]">{ev.domain || ev.url}</span>
                    <ExternalLink size={9} className="shrink-0" />
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface NewsSourceItem { url: string; title: string; domain: string }

function parseNewsSources(raw: string | null | undefined): NewsSourceItem[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return data.filter((x) => x && x.url)
  } catch { /* ignore */ }
  return []
}

// 最新动态带来源链接的渲染组件
function RecentNewsBlock({ text, sources }: { text: string; sources: NewsSourceItem[] }) {
  if (!text) return null
  return (
    <div>
      <p className="text-sm text-gray-300 leading-relaxed">{text}</p>
      {sources.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-gray-500">来源：</span>
          {sources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-[#3B82F6]/80 hover:text-[#3B82F6] hover:bg-[#3B82F6]/10 px-1.5 py-0.5 rounded transition-colors"
              title={s.title || s.url}
            >
              <Globe size={9} className="shrink-0" />
              <span className="truncate max-w-[120px]">{s.domain || s.url}</span>
              <ExternalLink size={8} className="shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// 多源采集进度条（4 阶段可视化）
function StageProgress({ current, elapsed }: { current: StageKey | null; elapsed: number }) {
  if (!current) return null
  const idx = STAGE_LIST.findIndex((s) => s.key === current)
  const isDone = current === 'done'
  return (
    <div className="rounded-lg bg-[#8B5CF6]/5 border border-[#8B5CF6]/25 px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {isDone
            ? <CheckCircle2 size={12} className="text-emerald-400" />
            : <Loader2 size={12} className="animate-spin text-[#A78BFA]" />}
          <span className="text-[11px] text-[#A78BFA] font-medium">
            {isDone ? '采集完成' : '多源采集中...'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          {!isDone && <span className="text-gray-600">预计约 30s</span>}
          <span className={isDone ? 'text-emerald-400' : 'text-[#A78BFA]/70 tabular-nums'}>
            {isDone ? `共用时 ${elapsed}s` : `已用 ${elapsed}s`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {STAGE_LIST.map((s, i) => {
          const Icon = s.icon
          const done = isDone || i < idx
          const active = !isDone && i === idx
          return (
            <div key={s.key} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] flex-1 justify-center
                ${done ? `${s.color} bg-[var(--stage-bg)]/10` :
                  active ? `${s.color} bg-[var(--stage-bg)]/15 ring-1 ring-current/30` :
                  'text-gray-600 bg-bg-hover/40'}`}
                style={active || done ? { ['--stage-bg' as any]: s.bg.replace('bg-', '') } : undefined}
              >
                {done ? <CheckCircle2 size={10} /> : <Icon size={10} className={active ? 'animate-pulse' : ''} />}
                <span className="whitespace-nowrap">{s.label}</span>
              </div>
              {i < STAGE_LIST.length - 1 && (
                <div className={`h-px w-2 shrink-0 ${i < idx || isDone ? 'bg-[#8B5CF6]/40' : 'bg-gray-700'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompanyLogo({ name, logoUrl, website, size = 40 }: { name: string; logoUrl: string | null; website?: string | null; size?: number }) {
  const cleanName = (name || '').trim()
  const [showFallback, setShowFallback] = useState(false)

  // 已经是图片直链 → 直接用,否则视为域名交给后端 /api/v1/customers/logo 代理
  // logo_url 为空时尝试用 website 字段兜底(很多客户只填了官网没单独维护 logo_url)
  const imgSrc = useMemo(() => {
    const extractDomain = (s: string | null | undefined) =>
      (s || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
    const raw = logoUrl || website
    if (!raw) return ''
    if (/^https?:\/\/.+\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/i.test(raw)) {
      return raw
    }
    const domain = extractDomain(raw)
    if (!domain || !domain.includes('.')) return ''
    return `/api/v1/customers/logo?domain=${encodeURIComponent(domain)}`
  }, [logoUrl, website])

  const colors = useMemo(() => [
    'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-amber-500',
    'bg-pink-500', 'bg-cyan-500', 'bg-red-500', 'bg-indigo-500',
  ], [])
  const colorIndex = cleanName ? cleanName.charCodeAt(0) % colors.length : 0

  if (!imgSrc || showFallback) {
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
        src={imgSrc}
        alt={cleanName}
        className="w-full h-full object-contain"
        onError={() => setShowFallback(true)}
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
  const { hasPermission } = useAuth()
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  
  // 成员数据联动切换
  const [memberList, setMemberList] = useState<any[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | string>('')
  
  const [form, setForm] = useState({ name: '', industry: '', status: '潜在', core_products: '', business_scope: '', scale: '', profile: '', recent_news: '', recent_news_evidence: '', logo_url: '', website: '', ai_initiatives: '', ai_evidence: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndustry, setSelectedIndustry] = useState<string>('')
  const [selectedIndustryGroup, setSelectedIndustryGroup] = useState<string>('')
  const [selectedCustomerStatus, setSelectedCustomerStatus] = useState<string>('')

  interface IndustryGroup { group: string; count: number; industries: { name: string; count: number }[] }
  const [industryGroups, setIndustryGroups] = useState<IndustryGroup[]>([])
  const [expandedGroup, setExpandedGroup] = useState<string>('')

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
  const [showAddContact, setShowAddContact] = useState(false)

  const loadContacts = (customerId: number) => {
    fetch(`/api/v1/customers/${customerId}/contacts`)
      .then(r => { if (!r.ok) return []; return r.json() })
      .then(data => setContacts(Array.isArray(data) ? data : []))
      .catch(() => setContacts([]))
  }

  const saveContact = async (customerId: number) => {
    if (!contactForm.name.trim()) return
    const method = editingContactId ? 'PUT' : 'POST'
    const url = editingContactId
      ? `/api/v1/customers/${customerId}/contacts/${editingContactId}`
      : `/api/v1/customers/${customerId}/contacts`
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactForm),
    })
    if (res.ok) {
      setContactForm({ name: '', phone: '', email: '', position: '', is_primary: false })
      setEditingContactId(null)
      setShowAddContact(false)
      loadContacts(customerId)
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.detail || '保存联系人失败', 'error')
    }
  }

  const deleteContact = async (customerId: number, contactId: number) => {
    const ok = await showConfirm('确定删除此联系人？')
    if (!ok) return
    const res = await fetch(`/api/v1/customers/${customerId}/contacts/${contactId}`, {
      method: 'DELETE',
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
    setForm({ name: '', industry: '', status: '潜在', core_products: '', business_scope: '', scale: '', profile: '', recent_news: '', recent_news_evidence: '', logo_url: '', website: '', ai_initiatives: '', ai_evidence: '' })
    setEditingId(null)
    setCompanyKeyword('')
    setCompanyResults([])
    setCompanyInfo(null)
  }

  const openEdit = (c: Customer) => {
    setForm({
      name: c.name, industry: c.industry || '', status: c.status,
      core_products: c.core_products || '', business_scope: c.business_scope || '',
      scale: c.scale || '', profile: c.profile || '', recent_news: c.recent_news || '',
      recent_news_evidence: c.recent_news_evidence || '',
      logo_url: c.logo_url || '', website: c.website || '',
      ai_initiatives: c.ai_initiatives || '',
      ai_evidence: c.ai_evidence || '',
    })
    setEditingId(c.id)
    setCompanyKeyword('')
    setCompanyResults([])
    setCompanyInfo(null)
    setShowForm(true)
  }

  const loadCustomers = useCallback(() => {
    setLoading(true)
    const url = '/api/v1/customers' + (selectedUserId ? `?user_id=${selectedUserId}` : '')
    fetch(url)
      .then((res) => { if (!res.ok) return []; return res.json() })
      .then((data) => { setCustomers(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setCustomers([]); setLoading(false) })
  }, [selectedUserId])

  useEffect(() => { loadCustomers() }, [loadCustomers])

  useEffect(() => {
    fetch('/api/v1/users/simple')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setMemberList(d) })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const url = editingId ? `/api/v1/customers/${editingId}` : '/api/v1/customers'
      const method = editingId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '保存失败', 'error')
        return
      }
      setShowForm(false)
      resetForm()
      loadCustomers()
      showToast('客户信息已保存', 'success')
    } catch {
      showToast('保存请求失败', 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/v1/customers/${id}/delete-preview`)
      const preview = await res.json()

      const parts: string[] = []
      if (preview.contracts?.length > 0) {
        const names = preview.contracts.map((c: any) => c.contract_no ? `《${c.title}》(#${c.contract_no})` : `《${c.title}》`)
        parts.push(`${preview.contracts.length} 份合同：${names.join('、')}`)
      }
      if (preview.contacts?.length > 0) {
        const names = preview.contacts.map((c: any) => `${c.name}${c.position ? `（${c.position}）` : ''}`)
        parts.push(`${preview.contacts.length} 位联系人：${names.join('、')}`)
      }
      if (preview.meetings_count > 0) parts.push(`${preview.meetings_count} 场会议（将解除关联）`)
      if (preview.projects_count > 0) parts.push(`${preview.projects_count} 个项目（将解除关联）`)

      const warning = parts.length > 0
        ? `删除「${preview.customer_name}」将同时删除：\n• ${parts.join('\n• ')}\n\n确定继续？`
        : `确定删除「${preview.customer_name}」？此操作不可撤销。`

      if (!await showConfirm(warning)) return
    } catch {
      if (!await showConfirm('确定删除此客户？此操作不可撤销。')) return
    }
    await fetch(`/api/v1/customers/${id}`, { method: 'DELETE' })
    loadCustomers()
    showToast('客户已删除', 'success')
  }

  const handleSearchCompany = async (refresh = false) => {
    if (!companyKeyword.trim() || companyKeyword.trim().length < 2) return
    setSearchingCompany(true)
    setCompanyResults([])
    try {
      const res = await fetch('/api/v1/customers/search-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: companyKeyword.trim(), refresh }),
      })
      const data = await res.json()
      const errItem = Array.isArray(data.results) ? data.results.find((r: any) => r?._error) : null
      const valid = Array.isArray(data.results) ? data.results.filter((r: any) => r && !r._error) : []
      if (valid.length > 0) {
        setCompanyResults(valid)
        setShowCompanyDropdown(true)
      } else if (refresh) {
        // 诊断模式：展示真实原因（Provider 被跳过 / API 报错 / 解析为空）
        const reason = data.diagnostics?.reason || data.diagnostics?.fatal || errItem?._error
          || '未找到匹配的公司，且未取得诊断信息，请查看后台运行日志。'
        showToast(`诊断结果：${reason}`, 'error')
      } else {
        // 普通搜索无结果 → 自动发起一次绕过缓存的诊断，告诉用户真实原因
        showToast('未找到匹配公司，正在诊断原因…', 'info')
        await handleSearchCompany(true)
      }
    } catch {
      showToast('公司搜索请求失败，请检查网络或后端服务', 'error')
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

  const [fetchStage, setFetchStage] = useState<StageKey | null>(null)
  const [fetchElapsed, setFetchElapsed] = useState(0)
  const stageTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearStageTimers = () => {
    stageTimersRef.current.forEach(clearTimeout)
    stageTimersRef.current = []
  }

  const stopElapsedTimer = () => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }

  const handleFetchCompanyInfo = async () => {
    if (!form.name.trim()) return
    setFetchingCompanyInfo(true)
    setCompanyInfo(null)
    setFetchStage('tavily')
    setFetchElapsed(0)
    clearStageTimers()
    stopElapsedTimer()
    // 每秒更新已用时
    elapsedTimerRef.current = setInterval(() => setFetchElapsed((s) => s + 1), 1000)
    // 按时间切换阶段（兜底，避免后端卡住时 UI 一直停留在 tavily）
    stageTimersRef.current = [
      setTimeout(() => setFetchStage('site'), 3500),
      setTimeout(() => setFetchStage('llm'),  9000),
    ]
    try {
      const res = await fetch('/api/v1/customers/fetch-company-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.name.trim(),
          customer_id: editingId || undefined,
        }),
      })
      const data = await res.json()
      clearStageTimers()
      stopElapsedTimer()
      setFetchStage('done')
      setTimeout(() => setFetchStage(null), 2000)
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
          recent_news_evidence: data.recent_news_evidence || prev.recent_news_evidence || '',
          logo_url: data.logo_url || prev.logo_url || '',
          website: data.website || prev.website || '',
          ai_initiatives: data.ai_initiatives || prev.ai_initiatives || '',
          ai_evidence: data.ai_evidence || prev.ai_evidence || '',
        }))
        if (editingId && (data.ai_initiatives || data.ai_evidence)) {
          showToast('AI 动向已同步到客户档案', 'success')
        } else {
          showToast('已从多源数据采集客户信息', 'success')
        }
      } else {
        showToast('未能获取到公司信息，请手动填写', 'warning')
      }
    } catch {
      clearStageTimers()
      stopElapsedTimer()
      setFetchStage(null)
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
        setCustomers((prev) => prev.map((c) => c.id === customerId ? {
          ...c,
          recent_news: data.recent_news,
          recent_news_evidence: data.recent_news_evidence ?? c.recent_news_evidence,
        } : c))
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
    const matchGroup = !selectedIndustryGroup || industryGroups
      .find(g => g.group === selectedIndustryGroup)?.industries.some(i => i.name === c.industry)
    const matchStatus = !selectedCustomerStatus || c.status === selectedCustomerStatus
    return matchSearch && matchIndustry && matchGroup && matchStatus
  }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

  const statuses = [...new Set(customers.map((c) => c.status).filter(Boolean))] as string[]

  const loadIndustryAggregation = useCallback(() => {
    fetch('/api/v1/customers/industry-aggregation')
      .then(r => r.json())
      .then(d => setIndustryGroups(d.groups || []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadIndustryAggregation() }, [loadIndustryAggregation])

  const statusCounts = (st: string) => customers.filter((c) =>
    c.status === st && (!selectedIndustry || c.industry === selectedIndustry) && (!selectedIndustryGroup || industryGroups.find(g => g.group === selectedIndustryGroup)?.industries.some(i => i.name === c.industry))
  ).length

  const hasActiveFilter = selectedIndustry || selectedIndustryGroup || selectedCustomerStatus
  const clearAllFilters = () => { setSelectedIndustry(''); setSelectedIndustryGroup(''); setExpandedGroup(''); setSelectedCustomerStatus('') }

  return (
    <div>
      <PageHeader
        icon={Users}
        title="客户管理"
        description="集中管理所有客户信息和跟进记录"
        tone="green"
        stats={[{ label: '客户', value: customers.length }]}
        right={
          <>
            {memberList.length > 1 && (
              <SearchableSelect
                options={[
                  { id: '', label: '全部成员' },
                  ...memberList.map(m => ({ id: String(m.id), label: m.name || m.username })),
                ]}
                value={selectedUserId}
                onChange={(v) => setSelectedUserId(v === 0 ? '' : String(v))}
                clearValue=""
              />
            )}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-hover border border-border focus-within:border-[#3B82F6]/50 transition-colors">
              <SearchIcon size={14} className="text-gray-500" />
              <input type="text" placeholder="搜索客户..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-xs text-gray-300 outline-none w-24 sm:w-32" />
            </div>
            {hasPermission('customer:create') && (
              <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#3B82F6] text-[#fff] text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer shrink-0">
                <Plus size={14} strokeWidth={2.5} /><span>新建客户</span>
              </button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : filtered.length === 0 && customers.length > 0 ? (
        <EmptyState
          icon={Building2}
          title="没有匹配的客户"
          description="尝试调整搜索词或清除筛选条件"
          tone="gray"
          className="mb-8"
        />
      ) : customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="还没有客户"
          description="创建第一个客户，开始建立您的客户网络"
          actionLabel="新建客户"
          onAction={() => setShowForm(true)}
          tone="green"
          className="mb-8"
        />
      ) : (
        <>
          {/* 多维筛选标签 */}
          {(industryGroups.length > 0 || statuses.length > 0 || hasActiveFilter) && (
            <div className="mb-6 space-y-3">
              <div className="flex items-center gap-2">
                <Filter size={12} className="text-gray-500" />
                <span className="text-[11px] text-gray-500">筛选</span>
                {hasActiveFilter && (
                  <button onClick={clearAllFilters} className="text-[11px] text-[#3B82F6] hover:underline ml-1">清除全部</button>
                )}
              </div>

              {/* 行业标签行 - 大类聚合 */}
              {industryGroups.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                    <span className="text-[11px] text-gray-600 mr-1 flex-shrink-0">行业</span>
                    {industryGroups.map((ig) => (
                      <button
                        key={ig.group}
                        onClick={() => {
                          if (selectedIndustryGroup === ig.group) {
                            setSelectedIndustryGroup('')
                            setSelectedIndustry('')
                            setExpandedGroup('')
                          } else {
                            setSelectedIndustryGroup(ig.group)
                            setSelectedIndustry('')
                            setExpandedGroup(ig.group)
                          }
                        }}
                        className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap border transition-colors ${
                          selectedIndustryGroup === ig.group
                            ? 'bg-[#8B5CF6]/20 text-[#A78BFA] border-[#8B5CF6]/40'
                            : expandedGroup === ig.group
                              ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]/80 border-[#8B5CF6]/20'
                              : 'bg-bg-hover text-gray-400 border-border hover:text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {ig.group}
                        <span className="text-[11px] opacity-60 ml-1">{ig.count}</span>
                      </button>
                    ))}
                  </div>
                  {/* 展开小类 */}
                  {expandedGroup && industryGroups.find(g => g.group === expandedGroup) && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pl-8">
                      {industryGroups.find(g => g.group === expandedGroup)!.industries.map((ind) => (
                        <button
                          key={ind.name}
                          onClick={() => {
                            if (selectedIndustry === ind.name) {
                              setSelectedIndustry('')
                            } else {
                              setSelectedIndustry(ind.name)
                            }
                          }}
                          className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap border transition-colors ${
                            selectedIndustry === ind.name
                              ? 'bg-[#8B5CF6]/20 text-[#A78BFA] border-[#8B5CF6]/40'
                              : 'bg-bg-hover/60 text-gray-500 border-border/60 hover:text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {ind.name}
                          <span className="text-[11px] opacity-50 ml-1">{ind.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 状态标签行 */}
              {statuses.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                  <span className="text-[11px] text-gray-600 mr-1 flex-shrink-0">状态</span>
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
                        <span className="text-[11px] opacity-60 ml-1">{cnt}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 平铺卡片(按添加时间倒序,grid 避免 columns 右侧空白) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
            {filtered.map((c) => (
              <div
                key={c.id}
                className="w-full text-left rounded-xl bg-bg-card border border-border hover:border-[#8B5CF6]/60 hover:bg-bg-hover-secondary transition-all group/card cursor-pointer flex flex-col"
              >
                <div onClick={() => setExpandedCustomerId(c.id)} className="p-4 md:p-5 pb-3 flex-1">
                  {/* Logo + 标题 */}
                  <div className="flex items-start gap-3 mb-3">
                    <CompanyLogo name={c.name} logoUrl={c.logo_url} website={c.website} size={40} />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-bold text-white truncate">{c.name}</h4>
                      <p className="text-[11px] text-gray-500 mt-0.5">{c.industry || '未设置行业'}</p>
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border flex-shrink-0 ${statusColors[c.status] || statusColors['潜在']}`}>{c.status}</span>
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
                      <div className="text-gray-500 line-clamp-2 mt-2 pt-2 border-t border-border/50">{stripHtml(c.profile)}</div>
                    )}
                    {!c.profile && c.recent_news && (
                      <div className="text-gray-500 line-clamp-2 mt-2 pt-2 border-t border-border/50">{stripHtml(c.recent_news)}</div>
                    )}
                  </div>
                </div>
                {/* 操作按钮 — 始终可见 */}
                <div className="flex items-center gap-2 px-4 md:px-5 pb-3">
                  <button onClick={(e) => { e.stopPropagation(); handleRefreshNews(c.id) }}
                    disabled={refreshingNewsId === c.id}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-bg-hover text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50">
                    {refreshingNewsId === c.id ? <Loader2 size={10} className="animate-spin" /> : <TrendingUp size={10} />}动态
                  </button>
                   {hasPermission('customer:edit') && (
                    <button onClick={(e) => { e.stopPropagation(); openEdit(c) }}
                      className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-bg-hover text-gray-400 hover:text-white transition-colors"><Pencil size={10} />编辑</button>
                  )}
                  {hasPermission('customer:delete') && (
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }}
                      className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-bg-hover text-red-400 hover:text-red-300 transition-colors"><Trash2 size={10} />删除</button>
                  )}
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
        const hasDetail = c.core_products || c.business_scope || c.scale || c.profile || c.recent_news || c.contact || c.ai_initiatives
        return (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setExpandedCustomerId(null)}>
            <div className="w-full max-w-lg mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-card border border-border shadow-2xl max-h-[85vh] md:max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-4 md:px-5 py-4 border-b border-border bg-bg-card/95 backdrop-blur-sm rounded-t-none md:rounded-t-2xl">
                <div className="flex items-center gap-3">
                  <CompanyLogo name={c.name} logoUrl={c.logo_url} website={c.website} size={36} />
                  <div>
                    <h3 className="text-base font-bold text-white">{c.name}</h3>
                    <p className="text-[11px] text-gray-500">{c.industry || '未设置行业'}</p>
                  </div>
                </div>
                 <div className="flex items-center gap-2">
                  {hasPermission('customer:edit') && (
                    <button onClick={() => { setExpandedCustomerId(null); openEdit(c) }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white border border-border"><Pencil size={11} className="inline mr-1" />编辑</button>
                  )}
                  <button onClick={() => setExpandedCustomerId(null)} className="p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white"><X size={18} /></button>
                </div>
              </div>
              {/* Body */}
              <div className="p-4 md:p-5 space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] px-2.5 py-1 rounded-full border ${statusColors[c.status] || statusColors['潜在']}`}>{c.status}</span>
                  {c.contact && (
                    <span className="text-[11px] text-gray-400 bg-bg-input px-2 py-1 rounded-md border border-border">{c.contact}</span>
                  )}
                </div>

                <div className="p-4 rounded-xl bg-bg-input/30 border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-400 flex items-center gap-1.5"><Users size={12} />联系人</p>
                    <button onClick={() => { setContactForm({ name: '', phone: '', email: '', position: '', is_primary: false }); setEditingContactId(null); setShowAddContact(true) }}
                      className="text-[11px] text-[#3B82F6] hover:text-blue-400 flex items-center gap-0.5"><Plus size={10} />添加</button>
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
                              {ct.is_primary && <span className="text-[11px] px-1 rounded bg-[#3B82F6]/20 text-[#3B82F6]">主要</span>}
                              {ct.position && <span className="text-[11px] text-gray-500">{ct.position}</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {ct.phone && <span className="text-[11px] text-gray-400">{ct.phone}</span>}
                              {ct.email && <span className="text-[11px] text-gray-400">{ct.email}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover/ct:opacity-100 transition-opacity">
                            <button onClick={() => { setContactForm({ name: ct.name, phone: ct.phone, email: ct.email, position: ct.position, is_primary: ct.is_primary }); setEditingContactId(ct.id); setShowAddContact(true) }}
                              className="p-1 rounded text-gray-500 hover:text-white"><Pencil size={10} /></button>
                            <button onClick={() => deleteContact(c.id, ct.id)}
                              className="p-1 rounded text-gray-500 hover:text-red-400"><Trash2 size={10} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 添加/编辑联系人表单 */}
                  {showAddContact && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <div className="space-y-1.5">
                        <input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                          placeholder="联系人姓名 *" className="w-full px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                          <input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                            placeholder="手机" className="w-full px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                          <input value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                            placeholder="邮箱" className="w-full px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                        </div>
                        <div className="flex items-center gap-3">
                          <input value={contactForm.position} onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                            placeholder="职位" className="flex-1 px-2 py-1.5 rounded bg-bg-card border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                          <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer">
                            <input type="checkbox" checked={contactForm.is_primary} onChange={(e) => setContactForm({ ...contactForm, is_primary: e.target.checked })}
                              className="w-3 h-3 rounded" />主要联系人
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => saveContact(c.id)}
                            className="px-3 py-1 rounded bg-[#3B82F6] text-[#fff] text-[11px] hover:bg-blue-600">保存</button>
                          <button onClick={() => { setEditingContactId(null); setShowAddContact(false); setContactForm({ name: '', phone: '', email: '', position: '', is_primary: false }) }}
                            className="px-3 py-1 rounded bg-bg-hover text-gray-400 text-[11px] hover:text-white">取消</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {hasDetail ? (
                  <div className="space-y-3">
                    {c.core_products && (
                      <div>
                        <span className="text-[11px] text-gray-500 flex items-center gap-1 mb-1"><Building2 size={10} />核心产品</span>
                        <p className="text-sm text-gray-300">{c.core_products}</p>
                      </div>
                    )}
                    {c.business_scope && (
                      <div>
                        <span className="text-[11px] text-gray-500 flex items-center gap-1 mb-1"><Globe size={10} />主营业务</span>
                        <p className="text-sm text-gray-300">{c.business_scope}</p>
                      </div>
                    )}
                    {c.scale && (
                      <div>
                        <span className="text-[11px] text-gray-500 flex items-center gap-1 mb-1"><Users size={10} />规模</span>
                        <p className="text-sm text-gray-300">{c.scale}</p>
                      </div>
                    )}
                    {c.website && (
                      <div>
                        <span className="text-[11px] text-gray-500 flex items-center gap-1 mb-1"><Globe size={10} />官网</span>
                        <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-sm text-[#8B5CF6] hover:underline break-all">{c.website}</a>
                      </div>
                    )}
                    {c.profile && (
                      <div>
                        <span className="text-[11px] text-gray-500 flex items-center gap-1 mb-1"><FileText size={10} />公司简介</span>
                        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{stripHtml(c.profile)}</p>
                      </div>
                    )}
                    {c.recent_news && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] text-gray-500 flex items-center gap-1"><TrendingUp size={10} />近期动向</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRefreshNews(c.id) }}
                            disabled={refreshingNewsId === c.id}
                            className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                          >
                            {refreshingNewsId === c.id ? <Loader2 size={9} className="animate-spin" /> : <RefreshCw size={9} />}
                            {refreshingNewsId === c.id ? '刷新中' : '刷新'}
                          </button>
                        </div>
                        <RecentNewsBlock
                          text={c.recent_news!}
                          sources={parseNewsSources(c.recent_news_evidence)}
                        />
                      </div>
                    )}
                    {c.ai_initiatives && (
                      <AIInitiativeBlock
                        text={c.ai_initiatives}
                        evidence={parseAIEvidence(c.ai_evidence)}
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 py-4 text-center">暂无详细信息，点击编辑完善客户资料</p>
                )}
                <div className="pt-2 border-t border-border flex items-center gap-3">
                  <button onClick={() => { setExpandedCustomerId(null); openEdit(c) }}
                    className="flex-1 py-2 rounded-lg bg-[#3B82F6] text-[#fff] text-sm font-medium hover:bg-blue-600 transition-colors">编辑客户</button>
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
          <div className="w-full max-w-lg mx-0 md:mx-4 p-4 md:p-6 rounded-none md:rounded-2xl bg-bg-card border border-border shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
                  onClick={() => handleSearchCompany()}
                  disabled={searchingCompany || companyKeyword.trim().length < 2}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-medium hover:bg-purple-600 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {searchingCompany ? <Loader2 size={14} className="animate-spin" /> : <SearchIcon size={14} />}
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
                      <Loader2 size={13} className="animate-spin" />采集中...
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
                          <span className="text-[11px] text-gray-500">Logo域名</span>
                          <p className="text-xs text-gray-300">{companyInfo.logo_url}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.industry && (
                      <div className="flex items-start gap-2">
                        <Globe size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[11px] text-gray-500">行业</span>
                          <p className="text-xs text-gray-300">{companyInfo.industry}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.core_products && (
                      <div className="flex items-start gap-2">
                        <Building2 size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[11px] text-gray-500">核心产品</span>
                          <p className="text-xs text-gray-300">{companyInfo.core_products}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.business_scope && (
                      <div className="flex items-start gap-2">
                        <FileText size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[11px] text-gray-500">主营业务</span>
                          <p className="text-xs text-gray-300">{companyInfo.business_scope}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.scale && (
                      <div className="flex items-start gap-2">
                        <Users size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[11px] text-gray-500">规模</span>
                          <p className="text-xs text-gray-300">{companyInfo.scale}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.profile && (
                      <div className="flex items-start gap-2">
                        <FileText size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-[11px] text-gray-500">公司简介</span>
                          <p className="text-xs text-gray-300">{companyInfo.profile}</p>
                        </div>
                      </div>
                    )}
                    {companyInfo.recent_news && (
                      <div className="flex items-start gap-2">
                        <TrendingUp size={13} className="text-gray-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] text-gray-500">近期动向</span>
                          <RecentNewsBlock
                            text={companyInfo.recent_news}
                            sources={parseNewsSources(companyInfo.recent_news_evidence)}
                          />
                        </div>
                      </div>
                    )}
                    {companyInfo.ai_initiatives && (
                      <div className="mt-1">
                        <AIInitiativeBlock
                          text={companyInfo.ai_initiatives}
                          evidence={parseAIEvidence(companyInfo.ai_evidence)}
                          compact
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {fetchStage && (
                <div className="mt-2">
                  <StageProgress current={fetchStage} elapsed={fetchElapsed} />
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1">行业</label>
                <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" placeholder="如 IT、金融" />
              </div>
              <div className="pt-2 border-t border-border">
                <label className="block text-xs text-gray-400 mb-1">状态</label>
                <SearchableSelect
                  options={statusOptions.map(s => ({ id: s, label: s }))}
                  value={form.status}
                  onChange={(v) => setForm({ ...form, status: v === 0 ? '' : String(v) })}
                  clearValue=""
                />
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
                    <RichTextEditor
                      value={form.profile || ''}
                      onChange={(v) => setForm({ ...form, profile: v })}
                      placeholder="简要介绍公司背景..."
                      className="min-h-[120px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1">近期动向</label>
                    {form.recent_news && form.recent_news_evidence && (
                      <div className="mb-1.5 max-h-40 overflow-y-auto">
                        <RecentNewsBlock
                          text={form.recent_news}
                          sources={parseNewsSources(form.recent_news_evidence)}
                        />
                      </div>
                    )}
                    <textarea value={form.recent_news} onChange={(e) => setForm({ ...form, recent_news: e.target.value })} rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] resize-none" placeholder="如 最近融资、新产品发布等" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] text-[#A78BFA] flex items-center gap-1">
                        <Brain size={11} />AI 领域动向
                      </label>
                      {form.name.trim() && !fetchingCompanyInfo && (
                        <button
                          type="button"
                          onClick={handleFetchCompanyInfo}
                          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md text-[#A78BFA] hover:text-white hover:bg-[#8B5CF6]/20 border border-[#8B5CF6]/30 transition-colors"
                          title="联网采集该公司在 AI 领域的真实动向"
                        >
                          <Sparkles size={10} />AI 采集
                        </button>
                      )}
                    </div>
                    {form.ai_initiatives ? (
                      <div className="max-h-56 overflow-y-auto">
                        <AIInitiativeBlock
                          text={form.ai_initiatives}
                          evidence={parseAIEvidence(form.ai_evidence)}
                        />
                        <textarea
                          value={form.ai_initiatives}
                          onChange={(e) => setForm({ ...form, ai_initiatives: e.target.value })}
                          rows={Math.min(6, Math.max(2, form.ai_initiatives.split('\n').length))}
                          className="w-full mt-2 px-2 py-1.5 rounded bg-bg-input border border-border text-[11px] text-gray-300 outline-none focus:border-[#8B5CF6] resize-none"
                          placeholder="可手动调整要点..."
                        />
                      </div>
                    ) : (
                      <textarea
                        value={form.ai_initiatives}
                        onChange={(e) => setForm({ ...form, ai_initiatives: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#8B5CF6] resize-none"
                        placeholder="暂无可信 AI 动向，点击右上「AI 采集」联网搜索该公司在 AI 领域的真实成果 / 创新 / 落地（基于 Tavily 真实证据）"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
            <button onClick={handleSave} disabled={saving || !form.name.trim()}
              className="w-full mt-5 py-2.5 rounded-lg bg-[#3B82F6] text-[#fff] text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={16} className="animate-spin mx-auto" /> : editingId ? '保存修改' : '创建客户'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
