import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Building2, Plus, X, Edit3, Trash2, Loader2, Search,
  DollarSign, Briefcase, Globe, Phone, Mail,
  ChevronRight, BarChart3, Key, Cpu, FileText, AlertTriangle,
  ExternalLink, Network,
} from 'lucide-react'
import { PageHeader, IconBox, EmptyState, Modal, ModalFooter, SectionLabel, Field } from '../components/design-system'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

/* ──── 类型 ──── */
interface Supplier {
  id: number
  name: string
  code: string
  category: string
  status: string
  contact_person: string | null
  contact_email: string | null
  contact_phone: string | null
  settlement_currency: string
  payment_terms: string | null
  contract_start: string | null
  contract_end: string | null
  api_endpoint: string | null
  models_provided: string | null
  auth_type: string | null
  total_cost: number | null
  project_count: number | null
  remarks: string | null
  created_at: string
  updated_at: string
}
interface SupplierSummary {
  supplier_id: number
  supplier_name: string
  supplier_code: string
  category: string
  status: string
  settlement_currency: string
  total_cost: number
  project_count: number
  models: string[]
}
interface SupplierProject {
  project_id: number
  project_name: string
  customer_name: string
  currency: string
  deal_amount: number | null
  status: string
  sales_person: string | null
  total_cost: number
  gross_profit: number | null
  gross_margin: number | null
  cost_count: number
  cost_items: {
    id: number; category: string; description: string
    amount: number; cost_month: string | null; remarks: string | null
  }[]
}

const CATEGORIES = ['模型厂商', '云服务商', '代理商', '其他']
const STATUSES = ['合作中', '暂停', '已终止']
const CURRENCIES = ['USD', 'CNY', 'EUR', 'JPY']
const AUTH_TYPES = ['API Key', 'OAuth', '其他']

/** 通道计费单位短标签 */
const PRICE_UNIT_SHORT: Record<string, string> = {
  per_1k_token: '1K',
  per_1m_token: '1M',
  per_request: '次',
  per_month: '月',
}

const CATEGORY_COLORS: Record<string, string> = {
  '模型厂商': '#3B82F6',
  '云服务商': '#8B5CF6',
  '代理商': '#F59E0B',
  '其他': '#6B7280',
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  '合作中': { bg: '#10B98115', text: '#34D399' },
  '暂停': { bg: '#F59E0B15', text: '#FBBF24' },
  '已终止': { bg: '#EF444415', text: '#F87171' },
}

const CURRENCY_META: Record<string, { symbol: string; name: string }> = {
  USD: { symbol: '$', name: '美元' },
  CNY: { symbol: '¥', name: '人民币' },
  EUR: { symbol: '€', name: '欧元' },
  JPY: { symbol: '¥', name: '日元' },
}

function fmtAmt(v: number | null | undefined, currency?: string) {
  if (v == null) return '—'
  const cur = currency || 'CNY'
  const m = CURRENCY_META[cur] || CURRENCY_META.CNY
  return `${m.symbol}${v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/** 合同到期状态 */
function getContractStatus(start: string | null, end: string | null): {
  state: 'normal' | 'expiring' | 'expired' | 'none'
  daysLeft: number | null
  label: string
  color: { bg: string; text: string }
} {
  if (!end) return { state: 'none', daysLeft: null, label: '—', color: { bg: '#6B728015', text: '#6B7280' } }
  const now = new Date()
  const endDate = new Date(end + '-01') // YYYY-MM 转 Date
  const diffMs = endDate.getTime() - now.getTime()
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (days < 0) return { state: 'expired', daysLeft: days, label: `已过期 ${Math.abs(days)} 天`, color: { bg: '#EF444415', text: '#F87171' } }
  if (days <= 30) return { state: 'expiring', daysLeft: days, label: `${days} 天后到期`, color: { bg: '#F59E0B15', text: '#FBBF24' } }
  return { state: 'normal', daysLeft: days, label: end, color: { bg: '#10B98115', text: '#34D399' } }
}

/* ──── 主页面 ──── */
export default function SuppliersPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast } = useToast()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'list' | 'stats'>('list')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [summaries, setSummaries] = useState<SupplierSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')

  // 选中供应商详情
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<Supplier | null>(null)
  const [supplierProjects, setSupplierProjects] = useState<{
    supplier: { id: number; name: string; code: string; category: string; status: string; settlement_currency?: string }
    projects: SupplierProject[]
    total_cost: number
    total_projects: number
  } | null>(null)
  const [supplierChannels, setSupplierChannels] = useState<Channel[]>([])
  const [detailTab, setDetailTab] = useState<'info' | 'projects' | 'channels'>('info')
  const [detailLoading, setDetailLoading] = useState(false)

  // 新增/编辑弹窗
  const [showForm, setShowForm] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [form, setForm] = useState({
    name: '', code: '', category: '模型厂商', status: '合作中',
    contact_person: '', contact_email: '', contact_phone: '',
    settlement_currency: 'USD', payment_terms: '',
    contract_start: '', contract_end: '',
    api_endpoint: '', models_provided: '', auth_type: '',
    remarks: '',
  })
  const [saving, setSaving] = useState(false)

  const loadSuppliers = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterCategory) params.set('category', filterCategory)
      const res = await fetch(`/api/v1/suppliers?${params}`)
      if (res.ok) setSuppliers(await res.json())
    } catch { /* ignore */ }
  }, [filterStatus, filterCategory])

  const loadSummaries = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/suppliers/summary/all')
      if (res.ok) setSummaries(await res.json())
    } catch { /* ignore */ }
  }, [])

  const loadSupplierDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const [detailRes, projectsRes, channelsRes] = await Promise.all([
        fetch(`/api/v1/suppliers/${id}`),
        fetch(`/api/v1/suppliers/${id}/projects`),
        fetch(`/api/v1/channels?supplier_id=${id}`).catch(() => null),
      ])
      if (detailRes.ok) setSelectedDetail(await detailRes.json())
      else setSelectedDetail(null)
      if (projectsRes.ok) setSupplierProjects(await projectsRes.json())
      else setSupplierProjects(null)
      if (channelsRes && channelsRes.ok) {
        const chs = await channelsRes.json()
        setSupplierChannels(Array.isArray(chs) ? chs : [])
      } else {
        setSupplierChannels([])
      }
    } catch {
      setSelectedDetail(null)
      setSupplierProjects(null)
      setSupplierChannels([])
    } finally { setDetailLoading(false) }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadSuppliers(), loadSummaries()]).finally(() => setLoading(false))
  }, [loadSuppliers, loadSummaries])

  // 切换选中供应商时立即清空旧详情（避免闪烁）
  useEffect(() => {
    if (selectedId === null) {
      setSelectedDetail(null)
      setSupplierProjects(null)
      setSupplierChannels([])
      setDetailTab('info')
      return
    }
    setDetailTab('info')  // 切换供应商时重置到信息 Tab
    loadSupplierDetail(selectedId)
  }, [selectedId, loadSupplierDetail])

  const openCreate = () => {
    setEditingSupplier(null)
    setForm({
      name: '', code: '', category: '模型厂商', status: '合作中',
      contact_person: '', contact_email: '', contact_phone: '',
      settlement_currency: 'USD', payment_terms: '',
      contract_start: '', contract_end: '',
      api_endpoint: '', models_provided: '', auth_type: '',
      remarks: '',
    })
    setShowForm(true)
  }

  const openEdit = (s: Supplier) => {
    setEditingSupplier(s)
    setForm({
      name: s.name, code: s.code, category: s.category, status: s.status,
      contact_person: s.contact_person || '', contact_email: s.contact_email || '', contact_phone: s.contact_phone || '',
      settlement_currency: s.settlement_currency, payment_terms: s.payment_terms || '',
      contract_start: s.contract_start || '', contract_end: s.contract_end || '',
      api_endpoint: s.api_endpoint || '', models_provided: s.models_provided || '', auth_type: s.auth_type || '',
      remarks: s.remarks || '',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        contact_person: form.contact_person || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        payment_terms: form.payment_terms || null,
        contract_start: form.contract_start || null,
        contract_end: form.contract_end || null,
        api_endpoint: form.api_endpoint || null,
        models_provided: form.models_provided || null,
        auth_type: form.auth_type || null,
        remarks: form.remarks || null,
      }
      const url = editingSupplier ? `/api/v1/suppliers/${editingSupplier.id}` : '/api/v1/suppliers'
      const method = editingSupplier ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setShowForm(false)
        loadSuppliers()
        loadSummaries()
        if (selectedId) loadSupplierDetail(selectedId)
        showToast(editingSupplier ? '供应商已更新' : '供应商已创建', 'success')
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '操作失败', 'error')
      }
    } finally { setSaving(false) }
  }

  const handleDelete = async (s: Supplier) => {
    if (!confirm(`确认删除供应商「${s.name}」？已关联成本将无法删除。`)) return
    const res = await fetch(`/api/v1/suppliers/${s.id}`, { method: 'DELETE' })
    if (res.ok) {
      if (selectedId === s.id) setSelectedId(null)
      loadSuppliers()
      loadSummaries()
      showToast('已删除', 'success')
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.detail || '删除失败', 'error')
    }
  }

  // 筛选
  const filteredSuppliers = suppliers.filter(s =>
    !searchText || s.name.includes(searchText) || s.code.includes(searchText) || (s.models_provided || '').includes(searchText)
  )

  // 合同临期/过期数量
  const expiringSuppliers = useMemo(() => {
    return suppliers.filter(s => {
      const cs = getContractStatus(s.contract_start, s.contract_end)
      return cs.state === 'expiring' || cs.state === 'expired'
    })
  }, [suppliers])

  // 统计 Tab 数据
  const totalSuppliers = suppliers.length
  const activeSuppliers = suppliers.filter(s => s.status === '合作中').length
  const totalModels = suppliers.reduce((sum, s) => sum + ((s.models_provided || '').split(',').filter(Boolean).length), 0)

  // 按币种分组的成本
  const costByCurrency = useMemo(() => {
    const map: Record<string, { cost: number; count: number; projects: number }> = {}
    for (const s of summaries) {
      const cur = s.settlement_currency
      if (!map[cur]) map[cur] = { cost: 0, count: 0, projects: 0 }
      map[cur].cost += s.total_cost
      map[cur].count += 1
      map[cur].projects += s.project_count
    }
    return map
  }, [summaries])
  const multiCurrency = Object.keys(costByCurrency).length > 1

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    )
  }

  return (
    <div>
      {/* 页头 */}
      <PageHeader
        icon={Building2}
        title="供应商管理"
        description="管理 MaaS 平台接入的模型供应商，关联项目与成本"
        tone="blue"
        stats={[
          { label: '供应商', value: totalSuppliers },
          { label: '合作中', value: activeSuppliers },
        ]}
        right={
          hasPermission('project:edit') && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#3B82F6] text-[#fff] text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer"
            >
              <Plus size={14} strokeWidth={2.5} />新增供应商
            </button>
          )
        }
      />

      {/* 合同临期/过期提醒 */}
      {expiringSuppliers.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <IconBox icon={AlertTriangle} size="sm" tone="orange" variant="soft" />
            <span className="text-xs font-semibold text-amber-400">合同到期提醒</span>
            <span className="text-[10px] text-gray-500">{expiringSuppliers.length} 家供应商</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {expiringSuppliers.map(s => {
              const cs = getContractStatus(s.contract_start, s.contract_end)
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-amber-400/80">{cs.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 bg-bg-hover/60 border border-border rounded-lg p-0.5 w-fit mb-5">
        {([
          { key: 'list' as const, label: '供应商列表', icon: Building2 },
          { key: 'stats' as const, label: '成本统计', icon: BarChart3 },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === t.key ? 'bg-bg-card text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <t.icon size={12} />{t.label}
          </button>
        ))}
      </div>

      {/* 供应商列表 Tab */}
      {tab === 'list' && (
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
          {/* 左：供应商列表 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 bg-bg-card/50">
              <div className="flex items-center gap-2 mb-2">
                <IconBox icon={Building2} size="sm" tone="blue" variant="soft" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">供应商</span>
                <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full ml-auto">{filteredSuppliers.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
                  <input
                    type="text"
                    placeholder="搜索名称/简码/模型..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6] transition-colors placeholder-gray-600"
                  />
                </div>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6]"
                >
                  <option value="">全部状态</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6]"
                >
                  <option value="">全部类型</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {filteredSuppliers.map(s => {
                const summary = summaries.find(sm => sm.supplier_id === s.id)
                const catColor = CATEGORY_COLORS[s.category] || '#6B7280'
                const stColor = STATUS_COLORS[s.status] || { bg: '#6B728015', text: '#6B7280' }
                const cs = getContractStatus(s.contract_start, s.contract_end)
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left px-4 py-3 border-b border-border/20 hover:bg-bg-hover/40 transition-colors ${
                      selectedId === s.id ? 'bg-bg-hover/60' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white truncate">{s.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0" style={{ background: `${catColor}15`, color: catColor }}>{s.category}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0" style={{ background: stColor.bg, color: stColor.text }}>{s.status}</span>
                          {(cs.state === 'expiring' || cs.state === 'expired') && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 flex items-center gap-0.5" style={{ background: cs.color.bg, color: cs.color.text }}>
                              <AlertTriangle size={8} />{cs.label}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">
                          {s.code && <span className="text-gray-600">{s.code}</span>}
                          {summary && summary.total_cost > 0 && <span className="ml-1.5">· 成本 {fmtAmt(summary.total_cost, s.settlement_currency)}</span>}
                          {summary && summary.project_count > 0 && <span className="ml-1.5">· {summary.project_count}个项目</span>}
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-gray-600 shrink-0 ml-2" />
                    </div>
                  </button>
                )
              })}
              {filteredSuppliers.length === 0 && (
                <EmptyState icon={Building2} title="暂无供应商" description="点击右上角新增供应商" tone="blue" size="sm" />
              )}
            </div>
          </div>

          {/* 右：供应商详情 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
            {detailLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="animate-spin text-gray-400" size={20} />
              </div>
            ) : selectedDetail && supplierProjects ? (
              <div className="space-y-5">
                {/* 供应商头部 */}
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl blur-md opacity-50" />
                      <div className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-[#fff]">
                        <Building2 size={18} strokeWidth={2.5} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-white">{selectedDetail.name}</h3>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: `${CATEGORY_COLORS[selectedDetail.category] || '#6B7280'}15`, color: CATEGORY_COLORS[selectedDetail.category] || '#6B7280' }}>{selectedDetail.category}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: (STATUS_COLORS[selectedDetail.status] || { bg: '#6B728015', text: '#6B7280' }).bg, color: (STATUS_COLORS[selectedDetail.status] || { bg: '#6B728015', text: '#6B7280' }).text }}>{selectedDetail.status}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 flex-wrap">
                        {selectedDetail.code && <span>简码: {selectedDetail.code}</span>}
                        <span>币种: {selectedDetail.settlement_currency}</span>
                        {selectedDetail.payment_terms && <span>付款: {selectedDetail.payment_terms}</span>}
                      </div>
                    </div>
                  </div>
                  {hasPermission('project:edit') && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(selectedDetail)} className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-bg-hover transition-colors" title="编辑"><Edit3 size={14} /></button>
                      <button onClick={() => handleDelete(selectedDetail)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-bg-hover transition-colors" title="删除"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>

                {/* 指标条 */}
                <div className="grid grid-cols-4 gap-3">
                  <MetricBox label="累计成本" value={fmtAmt(supplierProjects.total_cost, supplierProjects.supplier.settlement_currency || selectedDetail.settlement_currency)} tone="orange" />
                  <MetricBox label="关联项目" value={supplierProjects.total_projects} tone="blue" />
                  <MetricBox label="模型数" value={(selectedDetail.models_provided || '').split(',').filter(Boolean).length} tone="purple" />
                  <MetricBox
                    label="合同期"
                    value={
                      <div className="flex items-center gap-1">
                        <span className="text-xs">{selectedDetail.contract_start || '—'}</span>
                        <span className="text-gray-500">~</span>
                        <span className="text-xs">{selectedDetail.contract_end || '—'}</span>
                      </div>
                    }
                    tone={getContractStatus(selectedDetail.contract_start, selectedDetail.contract_end).state === 'expired' ? 'red' : getContractStatus(selectedDetail.contract_start, selectedDetail.contract_end).state === 'expiring' ? 'orange' : 'green'}
                  />
                </div>

                {/* 合同临期提示 */}
                {(() => {
                  const cs = getContractStatus(selectedDetail.contract_start, selectedDetail.contract_end)
                  if (cs.state !== 'expiring' && cs.state !== 'expired') return null
                  return (
                    <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: cs.color.bg, border: `1px solid ${cs.color.text}30` }}>
                      <AlertTriangle size={14} style={{ color: cs.color.text }} />
                      <span className="text-xs font-medium" style={{ color: cs.color.text }}>
                        合同{cs.state === 'expired' ? '已过期' : '即将到期'} · {cs.label}
                      </span>
                    </div>
                  )
                })()}

                {/* 详情 Tab 切换 */}
                <div className="flex items-center gap-1 border-b border-border/40">
                  {([
                    { key: 'info' as const, label: '基本信息', icon: FileText },
                    { key: 'projects' as const, label: '关联项目', icon: Briefcase, count: supplierProjects?.projects.length || 0 },
                    { key: 'channels' as const, label: '关联通道', icon: Network, count: supplierChannels.length },
                  ] as const).map(t => (
                    <button
                      key={t.key}
                      onClick={() => setDetailTab(t.key)}
                      className={`relative px-3 py-2 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        detailTab === t.key ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      <t.icon size={13} />{t.label}
                      {'count' in t && t.count > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-bold">{t.count}</span>
                      )}
                      {detailTab === t.key && (
                        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-t" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab: 基本信息（联系信息 + 技术信息 + 备注） */}
                {detailTab === 'info' && (
                  <div className="space-y-4">
                    {/* 联系信息 + 技术信息 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* 联系信息 */}
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <IconBox icon={Phone} size="sm" tone="green" variant="soft" />
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">联系信息</span>
                        </div>
                        <div className="space-y-2 text-xs">
                          {selectedDetail.contact_person && (
                            <div className="flex items-center gap-2 text-gray-300">
                              <span className="text-gray-500 w-12 shrink-0">对接人</span>
                              <span>{selectedDetail.contact_person}</span>
                            </div>
                          )}
                          {selectedDetail.contact_email && (
                            <div className="flex items-center gap-2 text-gray-300 min-w-0">
                              <Mail size={11} className="text-gray-500 shrink-0" />
                              <a href={`mailto:${selectedDetail.contact_email}`} className="hover:text-blue-400 truncate">{selectedDetail.contact_email}</a>
                            </div>
                          )}
                          {selectedDetail.contact_phone && (
                            <div className="flex items-center gap-2 text-gray-300">
                              <Phone size={11} className="text-gray-500 shrink-0" />
                              <span>{selectedDetail.contact_phone}</span>
                            </div>
                          )}
                          {!selectedDetail.contact_person && !selectedDetail.contact_email && !selectedDetail.contact_phone && (
                            <span className="text-gray-600">暂无联系信息</span>
                          )}
                        </div>
                      </div>

                      {/* 技术信息 */}
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <IconBox icon={Cpu} size="sm" tone="blue" variant="soft" />
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">技术信息</span>
                        </div>
                        <div className="space-y-2 text-xs">
                          {selectedDetail.api_endpoint && (
                            <div className="flex items-center gap-2 text-gray-300 min-w-0">
                              <Globe size={11} className="text-gray-500 shrink-0" />
                              <a href={selectedDetail.api_endpoint} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 truncate">{selectedDetail.api_endpoint}</a>
                            </div>
                          )}
                          {selectedDetail.auth_type && (
                            <div className="flex items-center gap-2 text-gray-300">
                              <Key size={11} className="text-gray-500 shrink-0" />
                              <span>认证: {selectedDetail.auth_type}</span>
                            </div>
                          )}
                          {selectedDetail.models_provided && (
                            <div className="mt-2">
                              <span className="text-gray-500 text-[10px]">提供模型</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {selectedDetail.models_provided.split(',').filter(Boolean).map(m => (
                                  <span key={m} className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 font-medium">{m.trim()}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {!selectedDetail.api_endpoint && !selectedDetail.auth_type && !selectedDetail.models_provided && (
                            <span className="text-gray-600">暂无技术信息</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 备注 */}
                    {selectedDetail.remarks && (
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <IconBox icon={FileText} size="sm" tone="gray" variant="soft" />
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">备注</span>
                        </div>
                        <p className="text-xs text-gray-400 whitespace-pre-wrap">{selectedDetail.remarks}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: 关联项目 */}
                {detailTab === 'projects' && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <IconBox icon={Briefcase} size="sm" tone="orange" variant="soft" />
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">关联项目</span>
                        <span className="text-[10px] text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-full">{supplierProjects.projects.length}个</span>
                      </div>
                      {supplierProjects.projects.length > 0 && (
                        <span className="text-[10px] text-gray-600">按毛利率升序（关注低毛利）</span>
                      )}
                    </div>
                    {supplierProjects.projects.length === 0 ? (
                      <EmptyState icon={Briefcase} title="暂无关联项目" description="在成本利润模块录入成本时关联该供应商" tone="gray" size="sm" />
                    ) : (
                      <div className="space-y-2">
                        {supplierProjects.projects.map(p => (
                          <button
                            key={p.project_id}
                            onClick={() => navigate(`/projects`)}
                            className="w-full text-left rounded-xl bg-bg-input/50 border border-border/40 p-3 hover:border-border/80 hover:bg-bg-input transition-all group"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                                  {p.project_name.slice(0, 1)}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-white truncate">{p.project_name}</div>
                                  <div className="text-[10px] text-gray-500 truncate">
                                    {p.customer_name} · {p.currency}
                                    {p.sales_person && <span> · {p.sales_person}</span>}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right">
                                  <div className="text-xs font-bold text-amber-400 tabular-nums">{fmtAmt(p.total_cost, p.currency)}</div>
                                  {p.gross_margin != null && (
                                    <div className={`text-[10px] tabular-nums ${p.gross_margin >= 30 ? 'text-emerald-400' : p.gross_margin >= 10 ? 'text-amber-400' : 'text-red-400'}`}>
                                      毛利率 {p.gross_margin}%
                                    </div>
                                  )}
                                </div>
                                <ExternalLink size={12} className="text-gray-600 group-hover:text-blue-400 transition-colors" />
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: 关联通道 */}
                {detailTab === 'channels' && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <IconBox icon={Network} size="sm" tone="cyan" variant="soft" />
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">关联通道</span>
                        <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">{supplierChannels.length}个</span>
                      </div>
                      <button
                        onClick={() => navigate('/channels')}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"
                      >
                        管理通道<ExternalLink size={10} />
                      </button>
                    </div>
                    {supplierChannels.length === 0 ? (
                      <EmptyState icon={Network} title="暂无关联通道" description="到「通道管理」新建该供应商的通道" actionLabel="去管理" onAction={() => navigate('/channels')} tone="cyan" size="sm" />
                    ) : (
                      <div className="space-y-2">
                        {supplierChannels.map((c: Channel) => {
                          const kindColor = c.kind === '官网通道' ? '#3B82F6' : c.kind === '号池' ? '#F59E0B' : c.kind === '逆向' ? '#EF4444' : c.kind === '官方聚合' ? '#8B5CF6' : '#6B7280'
                          return (
                            <div
                              key={c.id}
                              onClick={() => navigate('/channels')}
                              className="rounded-xl bg-bg-input/50 border border-border/40 p-3 hover:border-cyan-500/40 hover:bg-cyan-500/[0.02] transition-all cursor-pointer group"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: `linear-gradient(135deg, ${kindColor} 0%, ${kindColor}cc 100%)` }}>
                                    <Cpu size={14} />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium text-white truncate flex items-center gap-1.5">
                                      {c.name}
                                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: `${kindColor}15`, color: kindColor }}>{c.kind}</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 truncate">
                                      {c.model_type || '—'} · 成本 ${c.cost_price}/{PRICE_UNIT_SHORT[c.price_unit] || c.price_unit}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <div className="text-right">
                                    <div className="text-xs font-bold text-cyan-300 tabular-nums">{(c.discount_rate * 100).toFixed(0)}折</div>
                                    <div className="text-[10px] text-gray-500">{c.active_projects} 个项目</div>
                                  </div>
                                  <ExternalLink size={12} className="text-gray-600 group-hover:text-cyan-400 transition-colors" />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <EmptyState icon={Building2} title="选择供应商查看详情" description="点击左侧供应商，查看详细信息与关联项目" tone="blue" />
            )}
          </div>
        </div>
      )}

      {/* 成本统计 Tab */}
      {tab === 'stats' && (() => {
        // 防御性 fallback：确保 summaries 始终是数组
        const safeSummaries = Array.isArray(summaries) ? summaries : []
        const safeSuppliers = Array.isArray(suppliers) ? suppliers : []
        return (
        <div className="space-y-4">
          {/* KPI 卡片 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Building2} label="供应商总数" value={totalSuppliers} sub={`合作中 ${activeSuppliers} 家`} color="#3B82F6" gradient="radial-gradient(circle, #3B82F6 0%, transparent 70%)" />
            <KpiCard
              icon={DollarSign}
              label={multiCurrency ? "总成本（混合币种）" : `总成本（${Object.keys(costByCurrency)[0] || 'CNY'}）`}
              value={fmtAmt(safeSummaries.reduce((sum, s) => sum + (Number(s.total_cost) || 0), 0), Object.keys(costByCurrency)[0])}
              sub={multiCurrency ? "⚠ 跨币种仅展示参考" : "所有供应商累计"}
              color="#F59E0B"
              gradient="radial-gradient(circle, #F59E0B 0%, transparent 70%)"
            />
            <KpiCard icon={Briefcase} label="涉及项目" value={safeSummaries.reduce((s, sm) => s + (Number(sm.project_count) || 0), 0)} sub="有供应商成本的项目" color="#10B981" gradient="radial-gradient(circle, #10B981 0%, transparent 70%)" />
            <KpiCard icon={Cpu} label="模型数" value={totalModels} sub="所有供应商提供的模型" color="#8B5CF6" gradient="radial-gradient(circle, #8B5CF6 0%, transparent 70%)" />
          </div>

          {/* 按币种分类的成本 */}
          {Object.keys(costByCurrency).length > 0 && (
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <IconBox icon={DollarSign} size="sm" tone="orange" variant="soft" />
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">按结算币种分布</h4>
                {multiCurrency && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">多币种</span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(costByCurrency).map(([cur, data]) => {
                  const meta = CURRENCY_META[cur] || { symbol: cur, name: cur }
                  return (
                    <div key={cur} className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-400 flex items-center justify-center text-xs font-bold text-white">
                            {meta.symbol}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white">{cur}</div>
                            <div className="text-[10px] text-gray-500">{meta.name}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-amber-400 tabular-nums">{fmtAmt(data.cost, cur)}</div>
                          <div className="text-[10px] text-gray-500">{data.count}家供应商 · {data.projects}个项目</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {multiCurrency && (
                <div className="mt-3 text-[11px] text-gray-500 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="text-amber-400 mt-0.5 shrink-0" />
                  <span>不同供应商采用不同结算币种，跨币种简单求和不代表实际总额，请按币种查看。</span>
                </div>
              )}
            </div>
          )}

          {/* 供应商成本排行 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <IconBox icon={BarChart3} size="sm" tone="orange" variant="soft" />
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">供应商成本排行</h4>
            </div>
            {safeSummaries.length === 0 ? (
              <EmptyState icon={BarChart3} title="暂无数据" description="添加供应商并录入成本后查看" tone="gray" size="sm" />
            ) : (
              <div className="space-y-2">
                {safeSummaries
                  .filter(s => (Number(s.total_cost) || 0) > 0)
                  .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0))
                  .map(s => {
                    // 按币种分别计算最大值
                    const sameCurCosts = safeSummaries.filter(x => x.settlement_currency === s.settlement_currency && (Number(x.total_cost) || 0) > 0).map(x => Number(x.total_cost) || 0)
                    const maxCost = Math.max(...sameCurCosts, 1)
                    const pct = ((Number(s.total_cost) || 0) / maxCost * 100)
                    const catColor = CATEGORY_COLORS[s.category] || '#6B7280'
                    return (
                      <div key={s.supplier_id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/8 transition-colors">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: catColor }}>
                          {(s.supplier_name || '?').slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-white truncate">{s.supplier_name || '未知供应商'}</span>
                              <span className="px-1 py-0.5 rounded text-[9px] font-medium" style={{ background: `${catColor}15`, color: catColor }}>{s.category || '其他'}</span>
                              <span className="text-[9px] text-gray-600">({s.settlement_currency || 'CNY'})</span>
                            </div>
                            <span className="text-xs font-bold text-amber-400 tabular-nums">{fmtAmt(Number(s.total_cost) || 0, s.settlement_currency)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, pct)}%`, background: `linear-gradient(90deg, ${catColor}, ${catColor}88)` }} />
                            </div>
                            <span className="text-[10px] text-gray-500 shrink-0">{s.project_count || 0}个项目 · {(s.models || []).length}个模型</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                {safeSummaries.every(s => !s.total_cost) && (
                  <p className="text-xs text-gray-600 text-center py-6">暂无成本数据，请在成本利润模块关联供应商</p>
                )}
              </div>
            )}
          </div>

          {/* 模型分布 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <IconBox icon={Cpu} size="sm" tone="purple" variant="soft" />
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">模型供应商分布</h4>
            </div>
            <div className="space-y-2">
              {safeSuppliers.map(s => {
                const models = (s.models_provided || '').split(',').map(m => m.trim()).filter(Boolean)
                return (
                  <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                    <div className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ background: CATEGORY_COLORS[s.category] || '#6B7280' }}>
                      {(s.name || '?').slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white">{s.name || '未知'}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {models.length > 0
                          ? models.map(m => (
                              <span key={m} className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/10 text-purple-400 font-medium">{m}</span>
                            ))
                          : <span className="text-[10px] text-gray-600">未配置模型</span>}
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-500 shrink-0">{s.status || '—'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        )
      })()}

      {/* 新增/编辑供应商弹窗（统一 Modal） */}
      {showForm && (
        <Modal
          icon={editingSupplier ? Edit3 : Plus}
          title={editingSupplier ? '编辑供应商' : '新增供应商'}
          subtitle="基础信息 · 联系信息 · 商务条款 · 技术对接 一站录入"
          tone="blue"
          size="2xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-5">
            {/* 基本信息 */}
            <div>
              <SectionLabel>基本信息</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="名称" required>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如 OpenAI" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
                <Field label="简码" hint="英文字母 + 数字，用于内部引用">
                  <input type="text" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="如 openai" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
                <Field label="类型">
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="状态">
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all">
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* 联系信息 */}
            <div>
              <SectionLabel>联系信息</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="对接人" full>
                  <input type="text" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="对接人姓名" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
                <Field label="邮箱">
                  <input type="email" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} placeholder="email@example.com" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
                <Field label="电话">
                  <input type="text" value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="联系电话" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
              </div>
            </div>

            {/* 商务信息 */}
            <div>
              <SectionLabel>商务信息</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="结算币种">
                  <select value={form.settlement_currency} onChange={e => setForm(f => ({ ...f, settlement_currency: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c} - {CURRENCY_META[c]?.name || c}</option>)}
                  </select>
                </Field>
                <Field label="付款条件">
                  <input type="text" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="如 月结30天" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
                <Field label="合同起始">
                  <input type="month" value={form.contract_start} onChange={e => setForm(f => ({ ...f, contract_start: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
                <Field label="合同终止">
                  <input type="month" value={form.contract_end} onChange={e => setForm(f => ({ ...f, contract_end: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
              </div>
            </div>

            {/* 技术信息 */}
            <div>
              <SectionLabel>技术对接</SectionLabel>
              <div className="space-y-3">
                <Field label="API 入口" full hint="完整 URL，含 https://">
                  <input type="text" value={form.api_endpoint} onChange={e => setForm(f => ({ ...f, api_endpoint: e.target.value }))} placeholder="https://api.openai.com" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="提供模型" hint="逗号分隔">
                    <input type="text" value={form.models_provided} onChange={e => setForm(f => ({ ...f, models_provided: e.target.value }))} placeholder="GPT-4o,Claude-3.5" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" />
                  </Field>
                  <Field label="认证方式">
                    <select value={form.auth_type} onChange={e => setForm(f => ({ ...f, auth_type: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all">
                      <option value="">请选择</option>
                      {AUTH_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            </div>

            {/* 备注 */}
            <Field label="备注" full>
              <textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="其他备注信息" rows={2} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all resize-none" />
            </Field>
          </div>

          <ModalFooter
            onClose={() => setShowForm(false)}
            onSave={handleSave}
            saving={saving}
            tone="blue"
            saveText={editingSupplier ? '保存修改' : '创建供应商'}
            saveDisabled={!form.name}
            leftHint={editingSupplier ? `编辑供应商：${editingSupplier.name}` : '新增供应商，提交后可在「通道管理」绑定通道'}
          />
        </Modal>
      )}
    </div>
  )
}

/* ──── 子组件 ──── */

function KpiCard({ icon: Icon, label, value, sub, color, gradient }: {
  icon: typeof Building2; label: string; value: number | string; sub?: string; color: string; gradient: string
}) {
  return (
    <div className="group relative overflow-hidden flex flex-col rounded-2xl bg-bg-card border border-border/80 p-4 md:p-5 hover:border-border transition-all">
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-[0.08] group-hover:opacity-[0.15] transition-opacity duration-500 blur-2xl" style={{ background: gradient }} />
      <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full opacity-[0.04] group-hover:opacity-[0.08] transition-opacity duration-500 blur-xl" style={{ background: gradient }} />
      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: `${color}12` }}>
          <Icon size={14} style={{ color }} strokeWidth={2.4} />
          <span className="text-[11px] text-gray-400 font-medium">{label}</span>
        </div>
      </div>
      <div className="relative">
        <span className="text-2xl md:text-[28px] font-black text-white leading-none tabular-nums tracking-tight">{value}</span>
      </div>
      {sub && <p className="relative text-[11px] text-gray-500 mt-1.5">{sub}</p>}
      <div className="relative h-0.5 flex-1 rounded-full opacity-50 group-hover:opacity-100 transition-opacity mt-3" style={{ background: `linear-gradient(to right, ${color}, transparent)` }} />
    </div>
  )
}

function MetricBox({ label, value, tone }: { label: string; value: React.ReactNode; tone: string }) {
  const TONE_MAP: Record<string, { bg: string; border: string; text: string }> = {
    blue:   { bg: '#3B82F608', border: '#3B82F620', text: '#60A5FA' },
    green:  { bg: '#10B98108', border: '#10B98120', text: '#34D399' },
    amber:  { bg: '#F59E0B08', border: '#F59E0B20', text: '#FBBF24' },
    red:    { bg: '#EF444408', border: '#EF444420', text: '#F87171' },
    purple: { bg: '#8B5CF608', border: '#8B5CF620', text: '#A78BFA' },
  }
  const t = TONE_MAP[tone] || TONE_MAP.blue
  return (
    <div className="rounded-xl p-3" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: t.text }}>{value}</div>
    </div>
  )
}
