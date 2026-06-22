import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Building2, Network, Plus, Edit3, Trash2, Loader2, Search,
  DollarSign, Briefcase, Globe, Phone, Mail,
  ChevronRight, BarChart3, Key, Cpu, FileText, AlertTriangle,
  ExternalLink, GitBranch, Activity, Hash, BookOpen, Percent,
  Layers, X, Calendar,
} from 'lucide-react'
import { PageHeader, IconBox, EmptyState, SectionHeader, Modal, ModalFooter, SectionLabel, Field } from '../components/design-system'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

/* ──── 类型 ──── */
interface Supplier {
  id: number; name: string; code: string; category: string; status: string
  contact_person: string | null; contact_email: string | null; contact_phone: string | null
  settlement_currency: string; payment_terms: string | null
  contract_start: string | null; contract_end: string | null
  api_endpoint: string | null; models_provided: string | null; auth_type: string | null
  total_cost: number | null; project_count: number | null; remarks: string | null
  created_at: string; updated_at: string
}
interface SupplierSummary {
  supplier_id: number; supplier_name: string; supplier_code: string; category: string
  status: string; settlement_currency: string; total_cost: number; project_count: number; models: string[]
}
interface SupplierProject {
  project_id: number; project_name: string; customer_name: string; currency: string
  deal_amount: number | null; status: string; sales_person: string | null
  total_cost: number; gross_profit: number | null; gross_margin: number | null; cost_count: number
}
interface Channel {
  id: number; supplier_id: number; model_type: string; name: string; code: string; kind: string
  status: string; cost_price: number; price_unit: string; discount_rate: number; suggested_markup: number
  contract_start: string | null; contract_end: string | null; sla_json: string | null
  inventory_total: number; inventory_available: number; active_projects: number
  monthly_cost: number; remarks: string | null; created_at: string; updated_at: string
}
interface ChannelSummary {
  channel_id: number; supplier_id: number; supplier_name: string; model_type: string
  name: string; kind: string; status: string; cost_price: number; price_unit: string
  discount_rate: number; inventory_available: number; active_projects: number; monthly_cost: number
}
interface ModelCatalogItem {
  id: number; name: string; version_id: string | null; provider: string | null; region: string
  modality: string | null; input_price: number | null; output_price: number | null
  cache_read_price: number | null; cache_write_price: number | null
}

/* ──── 常量 ──── */
const CATEGORIES = ['模型厂商', '云服务商', '代理商', '其他']
const SUPPLIER_STATUSES = ['合作中', '暂停', '已终止']
const KINDS = ['官网通道', '号池', '逆向', '官方聚合', '其他']
const CHANNEL_STATUSES = ['合作中', '暂停', '已终止']
const CURRENCIES = ['USD', 'CNY', 'EUR', 'JPY']
const AUTH_TYPES = ['API Key', 'OAuth', '其他']

const CATEGORY_COLORS: Record<string, string> = {
  '模型厂商': '#3B82F6', '云服务商': '#8B5CF6', '代理商': '#F59E0B', '其他': '#6B7280',
}
const SUPPLIER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  '合作中': { bg: '#10B98115', text: '#34D399' }, '暂停': { bg: '#F59E0B15', text: '#FBBF24' },
  '已终止': { bg: '#EF444415', text: '#F87171' }, '待审批': { bg: '#F59E0B15', text: '#FBBF24' },
  '已拒绝': { bg: '#EF444415', text: '#F87171' }, '待确认': { bg: '#8B5CF615', text: '#A78BFA' },
}
const KIND_COLORS: Record<string, { bg: string; text: string }> = {
  '官网通道': { bg: '#3B82F615', text: '#60A5FA' }, '号池': { bg: '#F59E0B15', text: '#FBBF24' },
  '逆向': { bg: '#EF444415', text: '#F87171' }, '官方聚合': { bg: '#8B5CF615', text: '#A78BFA' },
  '其他': { bg: '#6B728015', text: '#9CA3AF' },
}
const CHANNEL_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  '合作中': { bg: '#10B98115', text: '#34D399' }, '暂停': { bg: '#F59E0B15', text: '#FBBF24' },
  '已终止': { bg: '#EF444415', text: '#F87171' }, '待确认': { bg: '#8B5CF615', text: '#A78BFA' },
}
const CURRENCY_META: Record<string, { symbol: string; name: string }> = {
  USD: { symbol: '$', name: '美元' }, CNY: { symbol: '¥', name: '人民币' },
  EUR: { symbol: '€', name: '欧元' }, JPY: { symbol: '¥', name: '日元' },
}

const EMPTY_SUPPLIER_FORM = {
  name: '', code: '', category: '模型厂商', status: '合作中',
  contact_person: '', contact_email: '', contact_phone: '',
  settlement_currency: 'USD', payment_terms: '',
  contract_start: '', contract_end: '',
  api_endpoint: '', models_provided: '', auth_type: '', remarks: '',
}
const EMPTY_CHANNEL_FORM = {
  supplier_id: 0, model_type: '', name: '', code: '',
  kind: '官网通道', status: '合作中',
  discount_rate: 1, suggested_markup: 0.2,
  contract_start: '', contract_end: '',
  cache_hit_rate: '', tpm: '', rpm: '', avg_latency_ms: '',
  inventory_total: 0, inventory_available: 0, remarks: '',
}

/* ──── 工具函数 ──── */
function fmtAmt(v: number | null | undefined, currency?: string) {
  if (v == null) return '—'
  const m = CURRENCY_META[currency || 'CNY'] || CURRENCY_META.CNY
  return `${m.symbol}${v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} 万`
}
function fmtUSD(v: number | null | undefined) {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}
function getContractStatus(start: string | null, end: string | null) {
  if (!end) return { state: 'none' as const, label: '—', color: { bg: '#6B728015', text: '#6B7280' } }
  const days = Math.ceil((new Date(end + '-01').getTime() - Date.now()) / 86400000)
  if (days < 0) return { state: 'expired' as const, label: `已过期 ${Math.abs(days)} 天`, color: { bg: '#EF444415', text: '#F87171' } }
  if (days <= 30) return { state: 'expiring' as const, label: `${days} 天后到期`, color: { bg: '#F59E0B15', text: '#FBBF24' } }
  return { state: 'normal' as const, label: end, color: { bg: '#10B98115', text: '#34D399' } }
}
function matchProvider(modelType: string): string | null {
  const t = modelType.toLowerCase()
  if (t.includes('claude') || t.includes('anthropic')) return 'Anthropic'
  if (t.includes('gpt') || t.includes('openai') || t.includes('o1') || t.includes('o3') || t.includes('o4')) return 'OpenAI'
  if (t.includes('gemini') || t.includes('google')) return 'Google'
  if (t.includes('deepseek')) return 'DeepSeek'
  return null
}
function parseSla(json: string | null) {
  if (!json) return { cache_hit_rate: null, tpm: null, rpm: null, avg_latency_ms: null }
  try {
    const o = JSON.parse(json)
    return {
      cache_hit_rate: typeof o.cache_hit_rate === 'number' ? o.cache_hit_rate : null,
      tpm: typeof o.tpm === 'number' ? o.tpm : null,
      rpm: typeof o.rpm === 'number' ? o.rpm : null,
      avg_latency_ms: typeof o.avg_latency_ms === 'number' ? o.avg_latency_ms : null,
    }
  } catch { return { cache_hit_rate: null, tpm: null, rpm: null, avg_latency_ms: null } }
}

/* ──── 主页面 ──── */
export default function UpstreamPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast } = useToast()
  const navigate = useNavigate()

  const [mainTab, setMainTab] = useState<'suppliers' | 'channels' | 'stats'>('suppliers')
  const [loading, setLoading] = useState(true)

  // 供应商数据
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierSummaries, setSupplierSummaries] = useState<SupplierSummary[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [selectedSupplierDetail, setSelectedSupplierDetail] = useState<Supplier | null>(null)
  const [supplierProjects, setSupplierProjects] = useState<{
    supplier: { id: number; name: string; code: string; category: string; status: string; settlement_currency?: string }
    projects: SupplierProject[]; total_cost: number; total_projects: number
  } | null>(null)
  const [supplierChannels, setSupplierChannels] = useState<Channel[]>([])
  const [supplierDetailTab, setSupplierDetailTab] = useState<'channels' | 'info' | 'projects'>('channels')
  const [detailLoading, setDetailLoading] = useState(false)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierFilterStatus, setSupplierFilterStatus] = useState('')
  const [supplierFilterCategory, setSupplierFilterCategory] = useState('')

  // 通道数据
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelSummaries, setChannelSummaries] = useState<ChannelSummary[]>([])
  const [prices, setPrices] = useState<ModelCatalogItem[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null)
  const [channelSearch, setChannelSearch] = useState('')
  const [channelFilterKind, setChannelFilterKind] = useState('')
  const [channelFilterStatus, setChannelFilterStatus] = useState('')
  const [channelFilterModel, setChannelFilterModel] = useState('')
  const [channelFilterSupplier, setChannelFilterSupplier] = useState('')

  // 供应商表单
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER_FORM)
  const [savingSupplier, setSavingSupplier] = useState(false)

  // 通道表单
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [channelForm, setChannelForm] = useState(EMPTY_CHANNEL_FORM)
  const [savingChannel, setSavingChannel] = useState(false)
  const [deletingChannelId, setDeletingChannelId] = useState<number | null>(null)

  const [submittingSupplierApproval, setSubmittingSupplierApproval] = useState(false)
  const [submittingChannelApproval, setSubmittingChannelApproval] = useState(false)

  /* ── 数据加载 ── */
  const loadSuppliers = useCallback(async () => {
    try {
      const [supRes, sumRes] = await Promise.all([fetch('/api/v1/suppliers'), fetch('/api/v1/suppliers/summary/all')])
      if (supRes.ok) setSuppliers(await supRes.json())
      if (sumRes.ok) setSupplierSummaries(await sumRes.json())
    } catch { /* ignore */ }
  }, [])

  const loadChannels = useCallback(async () => {
    try {
      const [chRes, sumRes, priceRes] = await Promise.all([
        fetch('/api/v1/channels'), fetch('/api/v1/channels/summary/all'), fetch('/api/v1/models'),
      ])
      if (chRes.ok) setChannels(await chRes.json())
      if (sumRes.ok) setChannelSummaries(await sumRes.json())
      if (priceRes.ok) setPrices(await priceRes.json())
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
      if (detailRes.ok) setSelectedSupplierDetail(await detailRes.json())
      else setSelectedSupplierDetail(null)
      if (projectsRes.ok) setSupplierProjects(await projectsRes.json())
      else setSupplierProjects(null)
      if (channelsRes?.ok) { const chs = await channelsRes.json(); setSupplierChannels(Array.isArray(chs) ? chs : []) }
      else setSupplierChannels([])
    } catch { setSelectedSupplierDetail(null); setSupplierProjects(null); setSupplierChannels([]) }
    finally { setDetailLoading(false) }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadSuppliers(), loadChannels()]).finally(() => setLoading(false))
  }, [loadSuppliers, loadChannels])

  useEffect(() => {
    if (selectedSupplierId === null) {
      setSelectedSupplierDetail(null); setSupplierProjects(null); setSupplierChannels([]); setSupplierDetailTab('channels'); return
    }
    setSupplierDetailTab('channels')
    loadSupplierDetail(selectedSupplierId)
  }, [selectedSupplierId, loadSupplierDetail])

  /* ── 供应商操作 ── */
  const openCreateSupplier = () => { setEditingSupplier(null); setSupplierForm(EMPTY_SUPPLIER_FORM); setShowSupplierForm(true) }
  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s)
    setSupplierForm({
      name: s.name, code: s.code, category: s.category, status: s.status,
      contact_person: s.contact_person || '', contact_email: s.contact_email || '', contact_phone: s.contact_phone || '',
      settlement_currency: s.settlement_currency, payment_terms: s.payment_terms || '',
      contract_start: s.contract_start || '', contract_end: s.contract_end || '',
      api_endpoint: s.api_endpoint || '', models_provided: s.models_provided || '', auth_type: s.auth_type || '',
      remarks: s.remarks || '',
    })
    setShowSupplierForm(true)
  }
  const handleSaveSupplier = async () => {
    setSavingSupplier(true)
    try {
      const payload = {
        ...supplierForm,
        contact_person: supplierForm.contact_person || null, contact_email: supplierForm.contact_email || null,
        contact_phone: supplierForm.contact_phone || null, payment_terms: supplierForm.payment_terms || null,
        contract_start: supplierForm.contract_start || null, contract_end: supplierForm.contract_end || null,
        api_endpoint: supplierForm.api_endpoint || null, models_provided: supplierForm.models_provided || null,
        auth_type: supplierForm.auth_type || null, remarks: supplierForm.remarks || null,
      }
      const url = editingSupplier ? `/api/v1/suppliers/${editingSupplier.id}` : '/api/v1/suppliers'
      const res = await fetch(url, { method: editingSupplier ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) {
        setShowSupplierForm(false); await loadSuppliers()
        if (selectedSupplierId) await loadSupplierDetail(selectedSupplierId)
        showToast(editingSupplier ? '供应商已更新' : '供应商已创建', 'success')
      } else { const err = await res.json().catch(() => ({})); showToast(err.detail || '操作失败', 'error') }
    } finally { setSavingSupplier(false) }
  }
  const handleDeleteSupplier = async (s: Supplier) => {
    if (!confirm(`确认删除供应商「${s.name}」？已关联成本将无法删除。`)) return
    const res = await fetch(`/api/v1/suppliers/${s.id}`, { method: 'DELETE' })
    if (res.ok) { if (selectedSupplierId === s.id) setSelectedSupplierId(null); await loadSuppliers(); showToast('已删除', 'success') }
    else { const err = await res.json().catch(() => ({})); showToast(err.detail || '删除失败', 'error') }
  }
  const handleSubmitSupplierApproval = async (supplier: Supplier) => {
    setSubmittingSupplierApproval(true)
    try {
      const res = await fetch(`/api/v1/suppliers/${supplier.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); showToast(e.detail || '提交失败', 'error'); return }
      showToast('已提交审批', 'success'); await loadSuppliers()
      if (selectedSupplierId) await loadSupplierDetail(selectedSupplierId)
    } catch { showToast('提交失败', 'error') } finally { setSubmittingSupplierApproval(false) }
  }

  /* ── 通道操作 ── */
  const openCreateChannel = (supplierId?: number) => {
    setEditingChannel(null)
    setChannelForm({ ...EMPTY_CHANNEL_FORM, supplier_id: supplierId || suppliers[0]?.id || 0 })
    setShowChannelForm(true)
  }
  const openEditChannel = (c: Channel) => {
    setEditingChannel(c)
    const sla = parseSla(c.sla_json)
    setChannelForm({
      supplier_id: c.supplier_id, model_type: c.model_type, name: c.name, code: c.code,
      kind: c.kind, status: c.status, discount_rate: c.discount_rate, suggested_markup: c.suggested_markup,
      contract_start: c.contract_start || '', contract_end: c.contract_end || '',
      cache_hit_rate: sla.cache_hit_rate?.toString() || '', tpm: sla.tpm?.toString() || '',
      rpm: sla.rpm?.toString() || '', avg_latency_ms: sla.avg_latency_ms?.toString() || '',
      inventory_total: c.inventory_total, inventory_available: c.inventory_available, remarks: c.remarks || '',
    })
    setShowChannelForm(true)
  }
  const handleSaveChannel = async () => {
    if (!channelForm.name.trim()) { showToast('请填写通道名称', 'error'); return }
    if (!channelForm.supplier_id) { showToast('请选择所属供应商', 'error'); return }
    setSavingChannel(true)
    try {
      const slaObj: Record<string, number> = {}
      const cv = (s: string) => { const n = parseFloat(s); return isNaN(n) ? null : n }
      if (cv(channelForm.cache_hit_rate) != null) slaObj.cache_hit_rate = cv(channelForm.cache_hit_rate)!
      if (cv(channelForm.tpm) != null) slaObj.tpm = cv(channelForm.tpm)!
      if (cv(channelForm.rpm) != null) slaObj.rpm = cv(channelForm.rpm)!
      if (cv(channelForm.avg_latency_ms) != null) slaObj.avg_latency_ms = cv(channelForm.avg_latency_ms)!
      const payload = {
        supplier_id: channelForm.supplier_id, model_type: channelForm.model_type,
        name: channelForm.name, code: channelForm.code, kind: channelForm.kind, status: channelForm.status,
        discount_rate: channelForm.discount_rate, suggested_markup: channelForm.suggested_markup,
        contract_start: channelForm.contract_start || null, contract_end: channelForm.contract_end || null,
        sla_json: Object.keys(slaObj).length > 0 ? JSON.stringify(slaObj) : null,
        remarks: channelForm.remarks || null,
      }
      const url = editingChannel ? `/api/v1/channels/${editingChannel.id}` : '/api/v1/channels'
      const res = await fetch(url, { method: editingChannel ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) {
        setShowChannelForm(false)
        await Promise.all([loadChannels(), selectedSupplierId ? loadSupplierDetail(selectedSupplierId) : Promise.resolve()])
        showToast(editingChannel ? '通道已更新' : '通道已创建', 'success')
      } else { const err = await res.json().catch(() => ({})); showToast(err.detail || '操作失败', 'error') }
    } finally { setSavingChannel(false) }
  }
  const handleDeleteChannel = async (id: number) => {
    if (!confirm('确认删除该通道？删除后无法恢复。')) return
    setDeletingChannelId(id)
    try {
      const res = await fetch(`/api/v1/channels/${id}`, { method: 'DELETE' })
      if (res.ok) {
        showToast('已删除', 'success')
        if (selectedChannelId === id) setSelectedChannelId(null)
        await Promise.all([loadChannels(), selectedSupplierId ? loadSupplierDetail(selectedSupplierId) : Promise.resolve()])
      } else { const err = await res.json().catch(() => ({})); showToast(err.detail || '删除失败', 'error') }
    } finally { setDeletingChannelId(null) }
  }
  const handleSubmitChannelApproval = async (channel: Channel) => {
    setSubmittingChannelApproval(true)
    try {
      const res = await fetch(`/api/v1/channels/${channel.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); showToast(e.detail || '提交失败', 'error'); return }
      showToast('已提交价格变更审批', 'success'); await loadChannels()
    } catch { showToast('提交失败', 'error') } finally { setSubmittingChannelApproval(false) }
  }

  /* ── 计算值 ── */
  const filteredSuppliers = useMemo(() => suppliers.filter(s => {
    if (supplierFilterStatus && s.status !== supplierFilterStatus) return false
    if (supplierFilterCategory && s.category !== supplierFilterCategory) return false
    if (supplierSearch) {
      const q = supplierSearch.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.models_provided || '').toLowerCase().includes(q)
    }
    return true
  }), [suppliers, supplierSearch, supplierFilterStatus, supplierFilterCategory])

  const supplierMap = useMemo(() => { const m: Record<number, Supplier> = {}; suppliers.forEach(s => { m[s.id] = s }); return m }, [suppliers])

  const modelTypes = useMemo(() => { const set = new Set<string>(); channels.forEach(c => { if (c.model_type) set.add(c.model_type) }); return Array.from(set).sort() }, [channels])

  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase()
    return channels.filter(c => {
      if (channelFilterKind && c.kind !== channelFilterKind) return false
      if (channelFilterStatus && c.status !== channelFilterStatus) return false
      if (channelFilterModel && c.model_type !== channelFilterModel) return false
      if (channelFilterSupplier && String(c.supplier_id) !== channelFilterSupplier) return false
      if (q) { const sup = supplierMap[c.supplier_id]; return `${c.name} ${c.code} ${c.model_type} ${sup?.name || ''}`.toLowerCase().includes(q) }
      return true
    })
  }, [channels, channelFilterKind, channelFilterStatus, channelFilterModel, channelFilterSupplier, channelSearch, supplierMap])

  const channelStats = useMemo(() => {
    let totalActive = 0, totalMonthly = 0; const byKind: Record<string, number> = {}; const byStatus: Record<string, number> = {}
    channels.forEach(c => { totalActive += c.active_projects; totalMonthly += c.monthly_cost; byKind[c.kind] = (byKind[c.kind] || 0) + 1; byStatus[c.status] = (byStatus[c.status] || 0) + 1 })
    return { totalActive, totalMonthly, byKind, byStatus }
  }, [channels])

  const expiringSuppliers = useMemo(() =>
    suppliers.filter(s => { const cs = getContractStatus(s.contract_start, s.contract_end); return cs.state === 'expiring' || cs.state === 'expired' }),
    [suppliers])

  const selectedChannel = useMemo(() => channels.find(c => c.id === selectedChannelId) || null, [channels, selectedChannelId])

  const costByCurrency = useMemo(() => {
    const map: Record<string, { cost: number; count: number; projects: number }> = {}
    for (const s of supplierSummaries) {
      const cur = s.settlement_currency
      if (!map[cur]) map[cur] = { cost: 0, count: 0, projects: 0 }
      map[cur].cost += s.total_cost; map[cur].count += 1; map[cur].projects += s.project_count
    }
    return map
  }, [supplierSummaries])

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-gray-400" size={28} /></div>

  const activeChannels = channels.filter(c => c.status === '合作中').length

  return (
    <div>
      <PageHeader
        icon={Layers}
        title="上游管理"
        description="供应商 · 通道 · 模型资源一体化管理"
        tone="blue"
        stats={[
          { label: '供应商', value: suppliers.length },
          { label: '通道', value: channels.length },
          { label: '活跃通道', value: activeChannels, tone: 'green' },
          { label: '活跃项目', value: channelStats.totalActive, tone: 'purple' },
        ]}
        right={
          hasPermission('upstream:edit') && (
            <button onClick={openCreateSupplier}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#3B82F6] text-white text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer">
              <Plus size={14} strokeWidth={2.5} />新增供应商
            </button>
          )
        }
      />

      {/* 合同临期提醒 */}
      {expiringSuppliers.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <IconBox icon={AlertTriangle} size="sm" tone="orange" variant="soft" />
            <span className="text-xs font-semibold text-amber-400">合同到期提醒</span>
            <span className="text-[11px] text-gray-500">{expiringSuppliers.length} 家供应商</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {expiringSuppliers.map(s => {
              const cs = getContractStatus(s.contract_start, s.contract_end)
              return (
                <button key={s.id} onClick={() => { setMainTab('suppliers'); setSelectedSupplierId(s.id) }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 hover:bg-amber-500/20 transition-colors">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-amber-400/80">{cs.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 主 Tab */}
      <div className="flex items-center gap-0 border-b border-border/40 mb-5">
        {([
          { key: 'suppliers' as const, label: '供应商视图', icon: Building2 },
          { key: 'channels' as const, label: '通道总表', icon: Network },
          { key: 'stats' as const, label: '统计分析', icon: BarChart3 },
        ]).map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)}
            className={`relative px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${mainTab === t.key ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
            <t.icon size={13} />{t.label}
            {mainTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-t" />}
          </button>
        ))}
      </div>

      {/* ── 供应商视图 ── */}
      {mainTab === 'suppliers' && (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
          {/* 左：供应商列表 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border/50 bg-bg-card/50 space-y-2">
              <div className="flex items-center gap-2">
                <IconBox icon={Building2} size="sm" tone="blue" variant="soft" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">供应商</span>
                <span className="text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full ml-auto">{filteredSuppliers.length}</span>
              </div>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="text" placeholder="搜索名称/简码/模型..." value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6] transition-colors placeholder-gray-600" />
              </div>
              <div className="flex gap-2">
                <select value={supplierFilterStatus} onChange={e => setSupplierFilterStatus(e.target.value)}
                  className="flex-1 px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6]">
                  <option value="">全部状态</option>
                  {SUPPLIER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={supplierFilterCategory} onChange={e => setSupplierFilterCategory(e.target.value)}
                  className="flex-1 px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6]">
                  <option value="">全部类型</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[620px]">
              {filteredSuppliers.map(s => {
                const summary = supplierSummaries.find(sm => sm.supplier_id === s.id)
                const catColor = CATEGORY_COLORS[s.category] || '#6B7280'
                const stColor = SUPPLIER_STATUS_COLORS[s.status] || { bg: '#6B728015', text: '#6B7280' }
                const cs = getContractStatus(s.contract_start, s.contract_end)
                const chCount = channels.filter(c => c.supplier_id === s.id).length
                return (
                  <button key={s.id} onClick={() => setSelectedSupplierId(s.id)}
                    className={`w-full text-left px-4 py-3 border-b border-border/20 hover:bg-bg-hover/40 transition-colors ${selectedSupplierId === s.id ? 'bg-blue-500/[0.07] border-l-2 border-l-blue-500' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white truncate">{s.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0" style={{ background: `${catColor}15`, color: catColor }}>{s.category}</span>
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0" style={{ background: stColor.bg, color: stColor.text }}>{s.status}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          {s.code && <span>{s.code}</span>}
                          <span>· {chCount} 通道</span>
                          {summary && summary.total_cost > 0 && <span>· {fmtAmt(summary.total_cost, s.settlement_currency)}</span>}
                          {(cs.state === 'expiring' || cs.state === 'expired') && <span style={{ color: cs.color.text }}>· {cs.label}</span>}
                        </div>
                      </div>
                      <ChevronRight size={14} className={`text-gray-600 shrink-0 ml-2 ${selectedSupplierId === s.id ? 'text-blue-400' : ''}`} />
                    </div>
                  </button>
                )
              })}
              {filteredSuppliers.length === 0 && <EmptyState icon={Building2} title="暂无供应商" description="点击右上角新增供应商" tone="blue" size="sm" />}
            </div>
          </div>

          {/* 右：供应商详情 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
            {detailLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={20} /></div>
            ) : selectedSupplierDetail && supplierProjects ? (
              <div className="space-y-4">
                {/* 头部 */}
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl blur-md opacity-50" />
                      <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-white">
                        <Building2 size={18} strokeWidth={2.5} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-white">{selectedSupplierDetail.name}</h3>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                          style={{ background: `${CATEGORY_COLORS[selectedSupplierDetail.category] || '#6B7280'}15`, color: CATEGORY_COLORS[selectedSupplierDetail.category] || '#6B7280' }}>
                          {selectedSupplierDetail.category}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                          style={{ background: (SUPPLIER_STATUS_COLORS[selectedSupplierDetail.status] || { bg: '#6B728015', text: '#6B7280' }).bg, color: (SUPPLIER_STATUS_COLORS[selectedSupplierDetail.status] || { bg: '#6B728015', text: '#6B7280' }).text }}>
                          {selectedSupplierDetail.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2">
                        {selectedSupplierDetail.code && <span>{selectedSupplierDetail.code}</span>}
                        <span>· {selectedSupplierDetail.settlement_currency}</span>
                        {selectedSupplierDetail.payment_terms && <span>· {selectedSupplierDetail.payment_terms}</span>}
                      </div>
                    </div>
                  </div>
                  {hasPermission('upstream:edit') && (
                    <div className="flex items-center gap-2 shrink-0">
                      {selectedSupplierDetail.status === '待审批' && (
                        <button onClick={() => handleSubmitSupplierApproval(selectedSupplierDetail)} disabled={submittingSupplierApproval}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
                          {submittingSupplierApproval ? <Loader2 size={11} className="animate-spin" /> : <GitBranch size={11} />}提交审批
                        </button>
                      )}
                      <button onClick={() => openCreateChannel(selectedSupplierId!)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors">
                        <Plus size={11} />新增通道
                      </button>
                      <button onClick={() => openEditSupplier(selectedSupplierDetail)} className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-bg-hover transition-colors"><Edit3 size={14} /></button>
                      <button onClick={() => handleDeleteSupplier(selectedSupplierDetail)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-bg-hover transition-colors"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>

                {/* 指标条 */}
                <div className="grid grid-cols-4 gap-3">
                  <MetricBox label="累计成本" value={fmtAmt(supplierProjects.total_cost, supplierProjects.supplier.settlement_currency || selectedSupplierDetail.settlement_currency)} tone="orange" />
                  <MetricBox label="关联项目" value={supplierProjects.total_projects} tone="blue" />
                  <MetricBox label="关联通道" value={supplierChannels.length} tone="cyan" />
                  <MetricBox
                    label="合同期"
                    value={<div className="text-xs">{selectedSupplierDetail.contract_start || '—'} ~ {selectedSupplierDetail.contract_end || '—'}</div>}
                    tone={getContractStatus(selectedSupplierDetail.contract_start, selectedSupplierDetail.contract_end).state === 'expired' ? 'red' : getContractStatus(selectedSupplierDetail.contract_start, selectedSupplierDetail.contract_end).state === 'expiring' ? 'orange' : 'green'}
                  />
                </div>

                {/* 合同临期警告 */}
                {(() => { const cs = getContractStatus(selectedSupplierDetail.contract_start, selectedSupplierDetail.contract_end); if (cs.state !== 'expiring' && cs.state !== 'expired') return null; return (
                  <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: cs.color.bg, border: `1px solid ${cs.color.text}30` }}>
                    <AlertTriangle size={14} style={{ color: cs.color.text }} />
                    <span className="text-xs font-medium" style={{ color: cs.color.text }}>合同{cs.state === 'expired' ? '已过期' : '即将到期'} · {cs.label}</span>
                  </div>
                )})()}

                {/* 审批进度 */}
                {(selectedSupplierDetail.status === '待审批' || selectedSupplierDetail.status === '已拒绝') && (
                  <ApprovalTimeline targetType="supplier" targetId={selectedSupplierDetail.id}
                    onChanged={() => { loadSuppliers(); if (selectedSupplierId) loadSupplierDetail(selectedSupplierId) }} />
                )}

                {/* 详情 Tab */}
                <div className="flex items-center gap-0 border-b border-border/40">
                  {([
                    { key: 'channels' as const, label: '通道列表', icon: Network, count: supplierChannels.length },
                    { key: 'info' as const, label: '基本信息', icon: FileText },
                    { key: 'projects' as const, label: '关联项目', icon: Briefcase, count: supplierProjects?.projects.length || 0 },
                  ]).map(t => (
                    <button key={t.key} onClick={() => setSupplierDetailTab(t.key)}
                      className={`relative px-3 py-2 text-xs font-semibold flex items-center gap-1.5 transition-colors ${supplierDetailTab === t.key ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
                      <t.icon size={13} />{t.label}
                      {'count' in t && (t as { count?: number }).count! > 0 && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-bold">{(t as { count?: number }).count}</span>
                      )}
                      {supplierDetailTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-t" />}
                    </button>
                  ))}
                </div>

                {/* 通道列表 */}
                {supplierDetailTab === 'channels' && (
                  supplierChannels.length === 0 ? (
                    <EmptyState icon={Network} title="暂无通道" description="点击上方「新增通道」创建该供应商的通道" tone="cyan" size="sm"
                      actionLabel="新增通道" onAction={() => openCreateChannel(selectedSupplierId!)} />
                  ) : (
                    <div className="space-y-2">
                      {supplierChannels.map(c => {
                        const kindC = KIND_COLORS[c.kind] || KIND_COLORS['其他']
                        const statusC = CHANNEL_STATUS_COLORS[c.status] || CHANNEL_STATUS_COLORS['合作中']
                        return (
                          <div key={c.id} className="rounded-xl bg-bg-input/50 border border-border/40 p-3 hover:border-cyan-500/20 transition-all group">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                <IconBox icon={Cpu} size="sm" tone="cyan" variant="soft" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-semibold text-white">{c.name}</span>
                                    {c.code && <span className="text-[11px] text-gray-500 font-mono">#{c.code}</span>}
                                    <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: kindC.bg, color: kindC.text }}>{c.kind}</span>
                                    <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: statusC.bg, color: statusC.text }}>{c.status}</span>
                                  </div>
                                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                                    {c.model_type && <span>{c.model_type}</span>}
                                    <span>折扣率 {(c.discount_rate * 100).toFixed(0)}%</span>
                                    <span>{c.active_projects} 个项目</span>
                                    {c.monthly_cost > 0 && <span className="text-rose-300">${c.monthly_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}/月</span>}
                                  </div>
                                </div>
                              </div>
                              {hasPermission('upstream:edit') && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => openEditChannel(c)} className="p-1.5 rounded-lg text-gray-500 hover:text-cyan-400 hover:bg-bg-hover transition-colors"><Edit3 size={13} /></button>
                                  <button onClick={() => handleDeleteChannel(c.id)} disabled={deletingChannelId === c.id}
                                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-bg-hover transition-colors disabled:opacity-50">
                                    {deletingChannelId === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                )}

                {/* 基本信息 */}
                {supplierDetailTab === 'info' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-3"><IconBox icon={Phone} size="sm" tone="green" variant="soft" /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">联系信息</span></div>
                        <div className="space-y-2 text-xs">
                          {selectedSupplierDetail.contact_person && <div className="flex items-center gap-2 text-gray-300"><span className="text-gray-500 w-12 shrink-0">对接人</span><span>{selectedSupplierDetail.contact_person}</span></div>}
                          {selectedSupplierDetail.contact_email && <div className="flex items-center gap-2 text-gray-300 min-w-0"><Mail size={11} className="text-gray-500 shrink-0" /><a href={`mailto:${selectedSupplierDetail.contact_email}`} className="hover:text-blue-400 truncate">{selectedSupplierDetail.contact_email}</a></div>}
                          {selectedSupplierDetail.contact_phone && <div className="flex items-center gap-2 text-gray-300"><Phone size={11} className="text-gray-500 shrink-0" /><span>{selectedSupplierDetail.contact_phone}</span></div>}
                          {!selectedSupplierDetail.contact_person && !selectedSupplierDetail.contact_email && !selectedSupplierDetail.contact_phone && <span className="text-gray-600">暂无联系信息</span>}
                        </div>
                      </div>
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-3"><IconBox icon={Cpu} size="sm" tone="blue" variant="soft" /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">技术信息</span></div>
                        <div className="space-y-2 text-xs">
                          {selectedSupplierDetail.api_endpoint && <div className="flex items-center gap-2 text-gray-300 min-w-0"><Globe size={11} className="text-gray-500 shrink-0" /><a href={selectedSupplierDetail.api_endpoint} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 truncate">{selectedSupplierDetail.api_endpoint}</a></div>}
                          {selectedSupplierDetail.auth_type && <div className="flex items-center gap-2 text-gray-300"><Key size={11} className="text-gray-500 shrink-0" /><span>认证: {selectedSupplierDetail.auth_type}</span></div>}
                          {selectedSupplierDetail.models_provided && (
                            <div className="mt-2"><span className="text-gray-500 text-[11px]">提供模型</span>
                              <div className="flex flex-wrap gap-1 mt-1">{selectedSupplierDetail.models_provided.split(',').filter(Boolean).map(m => <span key={m} className="px-1.5 py-0.5 rounded text-[11px] bg-blue-500/10 text-blue-400 font-medium">{m.trim()}</span>)}</div>
                            </div>
                          )}
                          {!selectedSupplierDetail.api_endpoint && !selectedSupplierDetail.auth_type && !selectedSupplierDetail.models_provided && <span className="text-gray-600">暂无技术信息</span>}
                        </div>
                      </div>
                    </div>
                    {selectedSupplierDetail.remarks && (
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-2"><IconBox icon={FileText} size="sm" tone="gray" variant="soft" /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">备注</span></div>
                        <p className="text-xs text-gray-400 whitespace-pre-wrap">{selectedSupplierDetail.remarks}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 关联项目 */}
                {supplierDetailTab === 'projects' && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <IconBox icon={Briefcase} size="sm" tone="orange" variant="soft" />
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">关联项目</span>
                      <span className="text-[11px] text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-full">{supplierProjects.projects.length}个</span>
                    </div>
                    {supplierProjects.projects.length === 0 ? (
                      <EmptyState icon={Briefcase} title="暂无关联项目" description="在成本利润模块录入成本时关联该供应商" tone="gray" size="sm" />
                    ) : (
                      <div className="space-y-2">
                        {supplierProjects.projects.map(p => (
                          <button key={p.project_id} onClick={() => navigate('/projects')}
                            className="w-full text-left rounded-xl bg-bg-input/50 border border-border/40 p-3 hover:border-border/80 hover:bg-bg-input transition-all group">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center text-[11px] font-bold text-white shrink-0">{p.project_name.slice(0, 1)}</div>
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-white truncate">{p.project_name}</div>
                                  <div className="text-[11px] text-gray-500 truncate">{p.customer_name} · {p.currency}{p.sales_person && ` · ${p.sales_person}`}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right">
                                  <div className="text-xs font-bold text-amber-400 tabular-nums">{fmtAmt(p.total_cost, p.currency)}</div>
                                  {p.gross_margin != null && <div className={`text-[11px] tabular-nums ${p.gross_margin >= 30 ? 'text-emerald-400' : p.gross_margin >= 10 ? 'text-amber-400' : 'text-red-400'}`}>毛利率 {p.gross_margin}%</div>}
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
              </div>
            ) : (
              <EmptyState icon={Building2} title="选择供应商查看详情" description="点击左侧列表中的供应商，查看详情与通道" tone="blue" />
            )}
          </div>
        </div>
      )}

      {/* ── 通道总表 ── */}
      {mainTab === 'channels' && (
        <div>
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5 mb-4">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={channelSearch} onChange={e => setChannelSearch(e.target.value)} placeholder="搜索通道名 / 编码 / 模型 / 供应商"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
            </div>
            <select value={channelFilterSupplier} onChange={e => setChannelFilterSupplier(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
              <option value="">全部供应商</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={channelFilterKind} onChange={e => setChannelFilterKind(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
              <option value="">全部类型</option>
              {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={channelFilterModel} onChange={e => setChannelFilterModel(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
              <option value="">全部模型</option>
              {modelTypes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={channelFilterStatus} onChange={e => setChannelFilterStatus(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
              <option value="">全部状态</option>
              {CHANNEL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {hasPermission('upstream:edit') && (
              <button onClick={() => openCreateChannel()}
                className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg hover:opacity-90">
                <Plus size={14} /> 新建通道
              </button>
            )}
          </div>

          <div className={`grid gap-4 ${selectedChannelId ? 'grid-cols-12' : ''}`}>
            <div className={selectedChannelId ? 'col-span-12 lg:col-span-7 space-y-2' : 'space-y-2'}>
              {filteredChannels.length === 0 ? (
                <EmptyState icon={Network} title="暂无通道" description="新建通道或调整筛选条件" tone="cyan" />
              ) : filteredChannels.map(c => {
                const sup = supplierMap[c.supplier_id]
                const kindC = KIND_COLORS[c.kind] || KIND_COLORS['其他']
                const statusC = CHANNEL_STATUS_COLORS[c.status] || CHANNEL_STATUS_COLORS['合作中']
                const active = selectedChannelId === c.id
                return (
                  <button key={c.id} onClick={() => setSelectedChannelId(active ? null : c.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${active ? 'bg-cyan-500/10 border-cyan-500/40 shadow-lg shadow-cyan-500/5' : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'}`}>
                    <div className="flex items-start gap-3">
                      <IconBox icon={Cpu} size="md" tone="cyan" variant="soft" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white">{c.name}</span>
                          {c.code && <span className="text-[11px] text-gray-500 font-mono">#{c.code}</span>}
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: kindC.bg, color: kindC.text }}>{c.kind}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: statusC.bg, color: statusC.text }}>{c.status}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
                          <span className="inline-flex items-center gap-1"><Building2 size={11} />{sup?.name || '—'}</span>
                          {c.model_type && <span className="inline-flex items-center gap-1"><Hash size={11} />{c.model_type}</span>}
                          <span className="inline-flex items-center gap-1 text-blue-300/80"><Percent size={11} />折扣率 {(c.discount_rate * 100).toFixed(0)}%</span>
                          <span className="inline-flex items-center gap-1"><Activity size={11} />{c.active_projects} 个活跃项目</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className={`text-gray-600 transition-transform ${active ? 'rotate-90 text-cyan-400' : ''}`} />
                    </div>
                  </button>
                )
              })}
            </div>

            {selectedChannelId && selectedChannel && (
              <div className="col-span-12 lg:col-span-5">
                <ChannelDetailPanel
                  channel={selectedChannel}
                  supplier={supplierMap[selectedChannel.supplier_id]}
                  prices={prices}
                  onEdit={() => openEditChannel(selectedChannel)}
                  onDelete={() => handleDeleteChannel(selectedChannel.id)}
                  deleting={deletingChannelId === selectedChannel.id}
                  onClose={() => setSelectedChannelId(null)}
                  onSubmitApproval={() => handleSubmitChannelApproval(selectedChannel)}
                  submittingApproval={submittingChannelApproval}
                  onApprovalChanged={loadChannels}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 统计分析 ── */}
      {mainTab === 'stats' && (
        <StatsView
          suppliers={suppliers}
          supplierSummaries={supplierSummaries}
          channels={channels}
          channelSummaries={channelSummaries}
          channelStats={channelStats}
          costByCurrency={costByCurrency}
          prices={prices}
        />
      )}

      {/* 供应商表单 */}
      {showSupplierForm && (
        <Modal icon={editingSupplier ? Edit3 : Plus} title={editingSupplier ? '编辑供应商' : '新增供应商'}
          subtitle="基础信息 · 联系信息 · 商务条款 · 技术对接" tone="blue" size="2xl" onClose={() => setShowSupplierForm(false)}>
          <div className="space-y-5">
            <div>
              <SectionLabel>基本信息</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="名称" required><input value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="如 OpenAI" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                <Field label="简码" hint="英文字母+数字"><input value={supplierForm.code} onChange={e => setSupplierForm(f => ({ ...f, code: e.target.value }))} placeholder="如 openai" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                <Field label="类型"><select value={supplierForm.category} onChange={e => setSupplierForm(f => ({ ...f, category: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all">{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
                <Field label="状态"><select value={supplierForm.status} onChange={e => setSupplierForm(f => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all">{SUPPLIER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
              </div>
            </div>
            <div>
              <SectionLabel>联系信息</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="对接人" full><input value={supplierForm.contact_person} onChange={e => setSupplierForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="对接人姓名" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                <Field label="邮箱"><input type="email" value={supplierForm.contact_email} onChange={e => setSupplierForm(f => ({ ...f, contact_email: e.target.value }))} placeholder="email@example.com" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                <Field label="电话"><input value={supplierForm.contact_phone} onChange={e => setSupplierForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="联系电话" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
              </div>
            </div>
            <div>
              <SectionLabel>商务信息</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <Field label="结算币种"><select value={supplierForm.settlement_currency} onChange={e => setSupplierForm(f => ({ ...f, settlement_currency: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all">{CURRENCIES.map(c => <option key={c} value={c}>{c} - {CURRENCY_META[c]?.name || c}</option>)}</select></Field>
                <Field label="付款条件"><input value={supplierForm.payment_terms} onChange={e => setSupplierForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="如 月结30天" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                <Field label="合同起始"><input type="month" value={supplierForm.contract_start} onChange={e => setSupplierForm(f => ({ ...f, contract_start: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                <Field label="合同终止"><input type="month" value={supplierForm.contract_end} onChange={e => setSupplierForm(f => ({ ...f, contract_end: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
              </div>
            </div>
            <div>
              <SectionLabel>技术对接</SectionLabel>
              <div className="space-y-3">
                <Field label="API 入口" full hint="完整 URL，含 https://"><input value={supplierForm.api_endpoint} onChange={e => setSupplierForm(f => ({ ...f, api_endpoint: e.target.value }))} placeholder="https://api.openai.com" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="提供模型" hint="逗号分隔"><input value={supplierForm.models_provided} onChange={e => setSupplierForm(f => ({ ...f, models_provided: e.target.value }))} placeholder="GPT-4o,Claude-3.5" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all" /></Field>
                  <Field label="认证方式"><select value={supplierForm.auth_type} onChange={e => setSupplierForm(f => ({ ...f, auth_type: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all"><option value="">请选择</option>{AUTH_TYPES.map(a => <option key={a} value={a}>{a}</option>)}</select></Field>
                </div>
              </div>
            </div>
            <Field label="备注" full><textarea value={supplierForm.remarks} onChange={e => setSupplierForm(f => ({ ...f, remarks: e.target.value }))} placeholder="其他备注信息" rows={2} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/15 transition-all resize-none" /></Field>
          </div>
          <ModalFooter onClose={() => setShowSupplierForm(false)} onSave={handleSaveSupplier} saving={savingSupplier} tone="blue"
            saveText={editingSupplier ? '保存修改' : '创建供应商'} saveDisabled={!supplierForm.name}
            leftHint={editingSupplier ? `编辑供应商：${editingSupplier.name}` : '新增供应商，创建后可添加关联通道'} />
        </Modal>
      )}

      {/* 通道表单 */}
      {showChannelForm && (
        <ChannelFormModal form={channelForm} setForm={setChannelForm} suppliers={suppliers}
          editing={editingChannel} saving={savingChannel} onClose={() => setShowChannelForm(false)} onSave={handleSaveChannel} />
      )}
    </div>
  )
}

/* ──── 通道详情面板 ──── */
function ChannelDetailPanel({ channel, supplier, prices, onEdit, onDelete, deleting, onClose, onSubmitApproval, submittingApproval, onApprovalChanged }: {
  channel: Channel; supplier: Supplier | undefined; prices: ModelCatalogItem[]
  onEdit: () => void; onDelete: () => void; deleting: boolean; onClose: () => void
  onSubmitApproval: () => void; submittingApproval: boolean; onApprovalChanged: () => void
}) {
  const sla = parseSla(channel.sla_json)
  const provider = matchProvider(channel.model_type)
  const familyPrices = prices.filter(p => provider && p.provider === provider && (p.input_price != null || p.output_price != null)).slice(0, 4)

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.04] to-blue-500/[0.04] p-4 sticky top-4">
      <div className="flex items-start justify-between mb-3">
        <SectionHeader icon={Cpu} title={channel.name} description={`${supplier?.name || '—'} · ${channel.kind}`} tone="cyan" />
        <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <StatBox label="折扣率" value={`${(channel.discount_rate * 100).toFixed(0)}%`} sub="相较官网定价" tone="blue" />
        <StatBox label="建议加价" value={`+${(channel.suggested_markup * 100).toFixed(0)}%`} tone="orange" />
        <StatBox label="库存/在库" value={`${channel.inventory_available}/${channel.inventory_total}`} tone="green" />
        <StatBox label="活跃项目" value={`${channel.active_projects}`} tone="purple" />
        <StatBox label="当月成本" value={`$${channel.monthly_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`} tone="red" />
      </div>
      <div className="space-y-2 text-xs">
        {channel.model_type && <div className="flex items-center gap-2"><Hash size={12} className="text-gray-500" /><span className="text-gray-500">模型族</span><span className="text-white font-medium">{channel.model_type}</span></div>}
        {channel.code && <div className="flex items-center gap-2"><Key size={12} className="text-gray-500" /><span className="text-gray-500">通道编码</span><span className="text-white font-medium">{channel.code}</span></div>}
        {channel.contract_start && <div className="flex items-center gap-2"><Calendar size={12} className="text-gray-500" /><span className="text-gray-500">合同期</span><span className="text-white font-medium">{channel.contract_start} ~ {channel.contract_end || '至今'}</span></div>}
      </div>
      {familyPrices.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <BookOpen size={12} />官方价格 × {(channel.discount_rate * 100).toFixed(0)}% 参考成本
          </div>
          <div className="space-y-1.5">
            {familyPrices.map(p => (
              <div key={p.id} className="flex items-center justify-between text-[11px] py-1 px-2 rounded-lg bg-black/20">
                <span className="text-gray-300 font-medium truncate max-w-[110px]">{p.name}</span>
                <div className="flex gap-3 text-[11px] tabular-nums shrink-0">
                  {p.input_price != null && <span className="text-emerald-400">输入 {fmtUSD(p.input_price * channel.discount_rate)}/1M</span>}
                  {p.output_price != null && <span className="text-orange-400">输出 {fmtUSD(p.output_price * channel.discount_rate)}/1M</span>}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-600">官网价 × 折扣率，仅作成本估算参考</p>
        </div>
      )}
      {(sla.cache_hit_rate != null || sla.tpm != null || sla.rpm != null || sla.avg_latency_ms != null) && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1"><Activity size={12} />SLA & 技术指标</div>
          <div className="grid grid-cols-2 gap-2">
            {sla.cache_hit_rate != null && <SlaBox label="缓存命中率" value={`${(sla.cache_hit_rate * 100).toFixed(1)}%`} tone="green" />}
            {sla.tpm != null && <SlaBox label="TPM" value={sla.tpm.toLocaleString()} tone="blue" />}
            {sla.rpm != null && <SlaBox label="RPM" value={sla.rpm.toLocaleString()} tone="purple" />}
            {sla.avg_latency_ms != null && <SlaBox label="平均延迟" value={`${sla.avg_latency_ms} ms`} tone="orange" />}
          </div>
        </div>
      )}
      {channel.remarks && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><FileText size={12} />备注</div>
          <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{channel.remarks}</p>
        </div>
      )}
      {channel.status === '待确认' && (
        <div className="mt-3"><ApprovalTimeline targetType="channel" targetId={channel.id} onChanged={onApprovalChanged} /></div>
      )}
      <div className="mt-4 pt-3 border-t border-white/5 flex gap-2 flex-wrap">
        {channel.status === '合作中' && (
          <button onClick={onSubmitApproval} disabled={submittingApproval}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg disabled:opacity-50">
            {submittingApproval ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />}提交价格变更审批
          </button>
        )}
        <button onClick={onEdit} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 rounded-lg">
          <Edit3 size={13} />编辑
        </button>
        <button onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg disabled:opacity-50">
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}删除
        </button>
      </div>
    </div>
  )
}

/* ──── 统计视图 ──── */
function StatsView({ suppliers, supplierSummaries, channels, channelSummaries, channelStats, costByCurrency, prices }: {
  suppliers: Supplier[]; supplierSummaries: SupplierSummary[]; channels: Channel[]; channelSummaries: ChannelSummary[]
  channelStats: { byKind: Record<string, number>; byStatus: Record<string, number>; totalActive: number; totalMonthly: number }
  costByCurrency: Record<string, { cost: number; count: number; projects: number }>; prices: ModelCatalogItem[]
}) {
  const [providerFilter, setProviderFilter] = useState('all')
  const activeSuppliers = suppliers.filter(s => s.status === '合作中').length
  const totalModels = suppliers.reduce((sum, s) => sum + ((s.models_provided || '').split(',').filter(Boolean).length), 0)
  const multiCurrency = Object.keys(costByCurrency).length > 1

  const priced = useMemo(() => prices.filter(p => p.input_price != null || p.output_price != null), [prices])
  const providerList = useMemo(() => { const s = new Set<string>(); priced.forEach(p => p.provider && s.add(p.provider)); return Array.from(s).sort() }, [priced])
  const displayed = useMemo(() => providerFilter === 'all' ? priced : priced.filter(p => p.provider === providerFilter), [priced, providerFilter])
  const grouped = useMemo(() => { const g: Record<string, ModelCatalogItem[]> = {}; displayed.forEach(p => { const k = p.provider || '其他'; if (!g[k]) g[k] = []; g[k].push(p) }); return g }, [displayed])
  const channelsByProvider = useMemo(() => { const m: Record<string, Channel[]> = {}; channels.forEach(c => { const prov = matchProvider(c.model_type); if (prov) { if (!m[prov]) m[prov] = []; m[prov].push(c) } }); return m }, [channels])

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Building2} label="供应商总数" value={suppliers.length} sub={`合作中 ${activeSuppliers} 家`} color="#3B82F6" gradient="radial-gradient(circle, #3B82F6 0%, transparent 70%)" />
        <KpiCard icon={Network} label="通道总数" value={channels.length} sub={`活跃 ${channels.filter(c => c.status === '合作中').length} 条`} color="#06B6D4" gradient="radial-gradient(circle, #06B6D4 0%, transparent 70%)" />
        <KpiCard icon={Activity} label="活跃项目" value={channelStats.totalActive} sub="有通道的活跃项目" color="#10B981" gradient="radial-gradient(circle, #10B981 0%, transparent 70%)" />
        <KpiCard icon={Cpu} label="模型数" value={totalModels} sub="所有供应商提供的模型" color="#8B5CF6" gradient="radial-gradient(circle, #8B5CF6 0%, transparent 70%)" />
      </div>

      {/* 按币种成本 */}
      {Object.keys(costByCurrency).length > 0 && (
        <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <IconBox icon={DollarSign} size="sm" tone="orange" variant="soft" />
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">按结算币种分布</h4>
            {multiCurrency && <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">多币种</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(costByCurrency).map(([cur, data]) => {
              const meta = CURRENCY_META[cur] || { symbol: cur, name: cur }
              return (
                <div key={cur} className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-400 flex items-center justify-center text-xs font-bold text-white">{meta.symbol}</div>
                      <div><div className="text-sm font-bold text-white">{cur}</div><div className="text-[11px] text-gray-500">{meta.name}</div></div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-amber-400 tabular-nums">{fmtAmt(data.cost, cur)}</div>
                      <div className="text-[11px] text-gray-500">{data.count}家 · {data.projects}个项目</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {multiCurrency && <p className="mt-3 text-[11px] text-gray-500 flex items-start gap-1.5"><AlertTriangle size={11} className="text-amber-400 mt-0.5 shrink-0" />不同供应商采用不同结算币种，跨币种简单求和不代表实际总额，请按币种查看。</p>}
        </div>
      )}

      {/* 通道分布 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1"><Network size={12} />按通道类型</div>
          <div className="space-y-2">
            {Object.entries(channelStats.byKind).map(([k, n]) => {
              const c = KIND_COLORS[k] || KIND_COLORS['其他']; const pct = channels.length > 0 ? n / channels.length * 100 : 0
              return (<div key={k}><div className="flex items-center justify-between text-xs mb-1"><span style={{ color: c.text }} className="font-semibold">{k}</span><span className="text-gray-500 tabular-nums">{n} ({pct.toFixed(0)}%)</span></div><div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.text }} /></div></div>)
            })}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1"><Activity size={12} />按状态</div>
          <div className="space-y-2">
            {Object.entries(channelStats.byStatus).map(([s, n]) => {
              const c = CHANNEL_STATUS_COLORS[s] || CHANNEL_STATUS_COLORS['合作中']; const pct = channels.length > 0 ? n / channels.length * 100 : 0
              return (<div key={s}><div className="flex items-center justify-between text-xs mb-1"><span style={{ color: c.text }} className="font-semibold">{s}</span><span className="text-gray-500 tabular-nums">{n} ({pct.toFixed(0)}%)</span></div><div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.text }} /></div></div>)
            })}
          </div>
        </div>
      </div>

      {/* 官方参考价格 */}
      {priced.length > 0 && (
        <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
            <div className="text-[11px] text-blue-300/80"><span className="font-bold text-blue-300">价格来源：</span>官网公开定价（USD/1M tokens），在「管理后台 → 模型管理」中维护。</div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button onClick={() => setProviderFilter('all')} className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors border ${providerFilter === 'all' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'text-gray-500 hover:text-gray-300 border-transparent'}`}>全部</button>
              {providerList.map(prov => <button key={prov} onClick={() => setProviderFilter(prov)} className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors border ${providerFilter === prov ? 'bg-white/10 text-white border-white/20' : 'text-gray-500 hover:text-gray-300 border-transparent'}`}>{prov}</button>)}
            </div>
          </div>
          <div className="space-y-6">
            {Object.entries(grouped).map(([prov, models]) => {
              const linkedChannels = channelsByProvider[prov] || []
              return (
                <div key={prov}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2"><span className="text-sm font-bold text-white">{prov}</span><span className="text-[11px] text-gray-600 px-2 py-0.5 rounded-full bg-white/5">{models.length} 个模型</span></div>
                    {linkedChannels.length > 0 && <span className="text-[11px] text-gray-500 flex items-center gap-1 flex-wrap"><Network size={10} />{linkedChannels.length} 条关联通道：{linkedChannels.map(c => <span key={c.id} className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-cyan-500/10 text-cyan-300">{c.name} {(c.discount_rate * 100).toFixed(0)}%折</span>)}</span>}
                  </div>
                  <div className="rounded-xl border border-white/10 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-[11px] text-gray-500 uppercase tracking-wider bg-white/[0.02]">
                          <th className="px-4 py-2.5 font-semibold">模型</th>
                          <th className="px-4 py-2.5 font-semibold text-right">输入 $/1M</th>
                          <th className="px-4 py-2.5 font-semibold text-right">输出 $/1M</th>
                          <th className="px-4 py-2.5 font-semibold text-right">缓存读取</th>
                          <th className="px-4 py-2.5 font-semibold text-right">缓存写入</th>
                          {linkedChannels.map(c => <th key={c.id} className="px-4 py-2.5 font-semibold text-right text-cyan-400">{c.name}<br /><span className="text-[11px] font-normal text-gray-500">×{(c.discount_rate * 100).toFixed(0)}%</span></th>)}
                        </tr></thead>
                        <tbody>
                          {models.map((m, i) => (
                            <tr key={m.id} className={`border-t ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`} style={{ borderColor: '#ffffff08' }}>
                              <td className="px-4 py-2.5"><div className="font-semibold text-white">{m.name}</div>{m.version_id && <div className="text-[11px] text-gray-600 font-mono">{m.version_id}</div>}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 font-semibold">{fmtUSD(m.input_price)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-orange-400 font-semibold">{fmtUSD(m.output_price)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-blue-400">{m.cache_read_price != null ? fmtUSD(m.cache_read_price) : '—'}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-violet-400">{m.cache_write_price != null ? fmtUSD(m.cache_write_price) : '—'}</td>
                              {linkedChannels.map(c => (
                                <td key={c.id} className="px-4 py-2.5 text-right tabular-nums">
                                  {m.input_price != null && <div className="text-emerald-300/80 text-[11px]">↑ {fmtUSD(m.input_price * c.discount_rate)}</div>}
                                  {m.output_price != null && <div className="text-orange-300/80 text-[11px]">↓ {fmtUSD(m.output_price * c.discount_rate)}</div>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ──── 通道表单弹窗 ──── */
function ChannelFormModal({ form, setForm, suppliers, editing, saving, onClose, onSave }: {
  form: typeof EMPTY_CHANNEL_FORM; setForm: (f: typeof EMPTY_CHANNEL_FORM) => void
  suppliers: Supplier[]; editing: Channel | null; saving: boolean; onClose: () => void; onSave: () => void
}) {
  const upd = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })
  return (
    <Modal icon={Network} title={editing ? '编辑通道' : '新建通道'} subtitle="MaaS 模型供给通道 · 折扣率 / 合同 / SLA 一站配置" tone="cyan" size="3xl" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <SectionLabel>基本信息</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="所属供应商" required><select value={form.supplier_id} onChange={e => upd({ supplier_id: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all"><option value={0}>请选择…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="通道名称" required><input value={form.name} onChange={e => upd({ name: e.target.value })} placeholder="如 AWS 通道 / CC 号池" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
            <Field label="通道编码" hint="如 AWS-01"><input value={form.code} onChange={e => upd({ code: e.target.value })} placeholder="AWS-01" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
            <Field label="模型族"><input value={form.model_type} onChange={e => upd({ model_type: e.target.value })} placeholder="Anthropic Claude / OpenAI GPT" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
            <Field label="通道类型"><select value={form.kind} onChange={e => upd({ kind: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all">{KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></Field>
            <Field label="状态"><select value={form.status} onChange={e => upd({ status: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all">{CHANNEL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          </div>
        </div>
        <div>
          <SectionLabel>价格与商务</SectionLabel>
          <div className="mb-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[11px] text-blue-300/80">通道成本 = 官方模型定价 × 折扣率（见「统计分析 → 官方参考价格」），无需手动填写单价。</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="折扣率" hint="0~1，如 0.85 表示 85 折"><input type="number" step="0.01" min="0" max="1" value={form.discount_rate} onChange={e => upd({ discount_rate: parseFloat(e.target.value) || 1 })} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
            <Field label="建议加价率" hint="如 0.2 = 在成本上加 20%"><input type="number" step="0.01" value={form.suggested_markup} onChange={e => upd({ suggested_markup: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <SectionLabel>合同期</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始" hint="YYYY-MM"><input value={form.contract_start} onChange={e => upd({ contract_start: e.target.value })} placeholder="2026-01" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
              <Field label="结束" hint="YYYY-MM"><input value={form.contract_end} onChange={e => upd({ contract_end: e.target.value })} placeholder="2026-12" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
            </div>
          </div>
          <div>
            <SectionLabel>SLA & 技术指标</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="缓存命中率" hint="0~1"><input value={form.cache_hit_rate} onChange={e => upd({ cache_hit_rate: e.target.value })} placeholder="0.7" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
              <Field label="TPM"><input value={form.tpm} onChange={e => upd({ tpm: e.target.value })} placeholder="10000" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
              <Field label="RPM"><input value={form.rpm} onChange={e => upd({ rpm: e.target.value })} placeholder="60" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
              <Field label="平均延迟" hint="ms"><input value={form.avg_latency_ms} onChange={e => upd({ avg_latency_ms: e.target.value })} placeholder="800" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" /></Field>
            </div>
          </div>
        </div>
        {editing && (
          <div>
            <SectionLabel><AlertTriangle size={11} className="text-orange-400" />库存（聚合字段，由交付/归还自动更新）</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="库存总数"><input type="number" value={editing.inventory_total} disabled className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-500 cursor-not-allowed" /></Field>
              <Field label="在库可用数"><input type="number" value={editing.inventory_available} disabled className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-500 cursor-not-allowed" /></Field>
            </div>
          </div>
        )}
        <Field label="备注" full hint="稳定性、SLA 等级、风控要点等"><textarea value={form.remarks} onChange={e => upd({ remarks: e.target.value })} rows={2} placeholder="补充说明" className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all resize-none" /></Field>
      </div>
      <ModalFooter onClose={onClose} onSave={onSave} saving={saving} tone="cyan"
        saveText={editing ? '保存修改' : '创建通道'} saveDisabled={!form.name.trim() || !form.supplier_id}
        leftHint={editing ? `编辑通道：${editing.name}` : '成本 = 官方定价 × 折扣率，无需手动填写单价'} />
    </Modal>
  )
}

/* ──── 小组件 ──── */
function MetricBox({ label, value, tone }: { label: string; value: React.ReactNode; tone: string }) {
  const TONE_MAP: Record<string, { bg: string; border: string; text: string }> = {
    blue:   { bg: '#3B82F608', border: '#3B82F620', text: '#60A5FA' },
    green:  { bg: '#10B98108', border: '#10B98120', text: '#34D399' },
    cyan:   { bg: '#06B6D408', border: '#06B6D420', text: '#22D3EE' },
    orange: { bg: '#F59E0B08', border: '#F59E0B20', text: '#FBBF24' },
    red:    { bg: '#EF444408', border: '#EF444420', text: '#F87171' },
    purple: { bg: '#8B5CF608', border: '#8B5CF620', text: '#A78BFA' },
  }
  const t = TONE_MAP[tone] || TONE_MAP.blue
  return (
    <div className="rounded-xl p-3" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
      <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: t.text }}>{value}</div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color, gradient }: {
  icon: typeof Building2; label: string; value: number | string; sub?: string; color: string; gradient: string
}) {
  return (
    <div className="group relative overflow-hidden flex flex-col rounded-2xl bg-bg-card border border-border/80 p-4 md:p-5 hover:border-border transition-all">
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-[0.08] group-hover:opacity-[0.15] transition-opacity blur-2xl" style={{ background: gradient }} />
      <div className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-3 w-fit" style={{ background: `${color}12` }}>
        <Icon size={14} style={{ color }} strokeWidth={2.4} />
        <span className="text-[11px] text-gray-400 font-medium">{label}</span>
      </div>
      <div className="relative text-2xl md:text-[28px] font-black text-white leading-none tabular-nums">{value}</div>
      {sub && <p className="relative text-[11px] text-gray-500 mt-1.5">{sub}</p>}
      <div className="relative h-0.5 mt-3 rounded-full opacity-50 group-hover:opacity-100 transition-opacity" style={{ background: `linear-gradient(to right, ${color}, transparent)` }} />
    </div>
  )
}

function StatBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'cyan' | 'blue' | 'green' | 'orange' | 'purple' | 'red' }) {
  const colors: Record<string, string> = {
    cyan: 'from-cyan-500/10 to-cyan-500/0 border-cyan-500/20 text-cyan-300',
    blue: 'from-blue-500/10 to-blue-500/0 border-blue-500/20 text-blue-300',
    green: 'from-emerald-500/10 to-emerald-500/0 border-emerald-500/20 text-emerald-300',
    orange: 'from-orange-500/10 to-orange-500/0 border-orange-500/20 text-orange-300',
    purple: 'from-violet-500/10 to-violet-500/0 border-violet-500/20 text-violet-300',
    red: 'from-rose-500/10 to-rose-500/0 border-rose-500/20 text-rose-300',
  }
  const textCls = colors[tone].split(' ').pop()!
  return (
    <div className={`rounded-lg p-2.5 bg-gradient-to-br ${colors[tone]} border`}>
      <div className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${textCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function SlaBox({ label, value, tone }: { label: string; value: string; tone: 'green' | 'blue' | 'purple' | 'orange' }) {
  const colors: Record<string, string> = { green: 'text-emerald-400', blue: 'text-blue-400', purple: 'text-violet-400', orange: 'text-orange-400' }
  return (
    <div className="rounded-md p-2 bg-black/20">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${colors[tone]}`}>{value}</div>
    </div>
  )
}
