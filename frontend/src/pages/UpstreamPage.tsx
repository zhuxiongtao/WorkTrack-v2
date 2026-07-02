import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Building2, Network, Plus, Edit3, Trash2, Loader2, Search,
  DollarSign, Briefcase, Globe, Phone, Mail,
  ChevronRight, BarChart3, Key, Cpu, FileText, AlertTriangle,
  ExternalLink, Activity, Hash, BookOpen, Percent,
  Layers, X, Calendar,
} from 'lucide-react'
import { PageHeader, IconBox, EmptyState, SectionHeader, Modal, ModalFooter, SectionLabel, Field } from '../components/design-system'
import SearchableSelect from '../components/SearchableSelect'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

/* ──── 类型 ──── */
interface Supplier {
  id: number; name: string; code: string; category: string; status: string
  contact_person: string | null; contact_email: string | null; contact_phone: string | null; im_group: string | null
  settlement_currency: string; payment_terms: string | null
  settlement_method: string | null; settlement_cycle_days: number | null
  prepaid_balance: number | null; credit_limit: number | null; current_month_consumed: number | null
  contract_start: string | null; contract_end: string | null
  api_endpoint: string | null; api_doc_url: string | null; models_provided: string | null; auth_type: string | null
  total_cost: number | null; project_count: number | null; remarks: string | null
  created_at: string; updated_at: string
}
interface SupplierSummary {
  supplier_id: number; supplier_name: string; supplier_code: string; category: string
  status: string; settlement_currency: string; total_cost: number; project_count: number; models: string[]
  prepaid_balance: number | null; current_month_consumed: number | null
}
interface SupplierProject {
  project_id: number; project_name: string; customer_name: string; currency: string
  deal_amount: number | null; status: string; sales_person: string | null
  total_cost: number; gross_profit: number | null; gross_margin: number | null; cost_count: number
}
interface Channel {
  id: number; supplier_id: number; name: string; code: string
  api_protocol: string; status: string; computed_status: string
  cost_discount: number | null; markup: number | null; cost_source: string
  scope_type: string; model_family: string | null; model_id: number | null
  sla_json: string | null
  inventory_total: number; inventory_available: number; active_projects: number
  monthly_cost: number; remarks: string | null; created_at: string; updated_at: string
}
interface ChannelSummary {
  channel_id: number; supplier_id: number; supplier_name: string
  name: string; api_protocol: string; status: string; computed_status: string
  cost_discount: number | null; scope_type: string; model_family: string | null
  inventory_available: number; active_projects: number; monthly_cost: number
}
interface ModelCatalogItem {
  id: number; name: string; version_id: string | null; provider: string | null; region: string
  modality: string | null; input_price: number | null; output_price: number | null
  cache_read_price: number | null; cache_write_price: number | null
  price_currency: string | null; price_unit: string | null
  price_tiers: string | null; suppliers_list: string | null
}

/* ──── 常量 ──── */
const CATEGORIES = ['模型厂商', '云服务商', '代理商', '渠道代理', '其他']
const SUPPLIER_STATUSES = ['合作中', '暂停', '已终止']
const CHANNEL_MANUAL_STATUSES = ['合作中', '暂停', '已终止']
const API_PROTOCOLS = ['openai_compat', 'native', 'proxy', 'other']
const API_PROTOCOL_LABELS: Record<string, string> = {
  openai_compat: 'OpenAI 兼容', native: '原生 API', proxy: '代理转发', other: '其他',
}
const SCOPE_TYPES = ['all', 'family', 'single']
const SCOPE_TYPE_LABELS: Record<string, string> = {
  all: '全部模型', family: '按模型系列', single: '单个模型',
}
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
const API_PROTOCOL_COLORS: Record<string, { bg: string; text: string }> = {
  openai_compat: { bg: '#3B82F615', text: '#60A5FA' },
  native:        { bg: '#8B5CF615', text: '#A78BFA' },
  proxy:         { bg: '#F59E0B15', text: '#FBBF24' },
  other:         { bg: '#6B728015', text: '#9CA3AF' },
}
const COMPUTED_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  '长期有效': { bg: '#10B98115', text: '#34D399' },
  '生效中':   { bg: '#10B98115', text: '#34D399' },
  '即将到期': { bg: '#F59E0B15', text: '#FBBF24' },
  '已过期':   { bg: '#EF444415', text: '#F87171' },
  '未生效':   { bg: '#6B728015', text: '#9CA3AF' },
  '已暂停':   { bg: '#F59E0B15', text: '#FBBF24' },
  '暂停':     { bg: '#F59E0B15', text: '#FBBF24' },
  '已终止':   { bg: '#EF444415', text: '#F87171' },
  '待确认':   { bg: '#8B5CF615', text: '#A78BFA' },
}
const CURRENCY_META: Record<string, { symbol: string; name: string }> = {
  USD: { symbol: '$', name: '美元' }, CNY: { symbol: '¥', name: '人民币' },
  EUR: { symbol: '€', name: '欧元' }, JPY: { symbol: '¥', name: '日元' },
}

const SETTLEMENT_METHODS = ['预付', '月结', '授信']

const EMPTY_SUPPLIER_FORM = {
  name: '', code: '', category: '模型厂商', status: '合作中',
  contact_person: '', contact_email: '', contact_phone: '', im_group: '',
  settlement_currency: 'USD', payment_terms: '',
  settlement_method: '', settlement_cycle_days: '',
  prepaid_balance: '', credit_limit: '',
  contract_start: '', contract_end: '',
  api_endpoint: '', api_doc_url: '', models_provided: '', auth_type: '', remarks: '',
}
const EMPTY_CHANNEL_FORM = {
  supplier_id: 0, name: '', code: '',
  api_protocol: 'openai_compat', status: '合作中',
  cost_discount: '', markup: '', cost_source: 'manual',
  scope_type: 'all', model_family: '', model_id: 0,
  cache_hit_rate: '', tpm: '', rpm: '', avg_latency_ms: '',
  access_url: '', usage_url: '',
  remarks: '',
}

/* ──── 工具函数 ──── */
function fmtAmt(v: number | null | undefined, currency?: string) {
  if (v == null) return '—'
  const m = CURRENCY_META[currency || 'CNY'] || CURRENCY_META.CNY
  return `${m.symbol}${v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} 万`
}
function fmtUSD(v: number | null | undefined, currency?: string | null) {
  if (v == null) return '—'
  const symbol = currency ? (CURRENCY_META[currency]?.symbol ?? `${currency} `) : '$'
  return `${symbol}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}
function getContractStatus(_start: string | null, end: string | null) {
  if (!end) return { state: 'none' as const, label: '—', color: { bg: '#6B728015', text: '#6B7280' } }
  const days = Math.ceil((new Date(end + '-01').getTime() - Date.now()) / 86400000)
  if (days < 0) return { state: 'expired' as const, label: `已过期 ${Math.abs(days)} 天`, color: { bg: '#EF444415', text: '#F87171' } }
  if (days <= 30) return { state: 'expiring' as const, label: `${days} 天后到期`, color: { bg: '#F59E0B15', text: '#FBBF24' } }
  return { state: 'normal' as const, label: end, color: { bg: '#10B98115', text: '#34D399' } }
}
function matchProvider(text: string | null | undefined): string | null {
  if (!text) return null
  const t = text.toLowerCase()
  if (t.includes('claude') || t.includes('anthropic')) return 'Anthropic'
  if (t.includes('gpt') || t.includes('openai') || t.includes('o1') || t.includes('o3') || t.includes('o4')) return 'OpenAI'
  if (t.includes('gemini') || t.includes('google')) return 'Google'
  if (t.includes('deepseek')) return 'DeepSeek'
  return null
}
function channelProvider(c: Channel, prices: ModelCatalogItem[]): string | null {
  if (c.scope_type === 'single' && c.model_id) {
    const m = prices.find(p => p.id === c.model_id)
    return m?.provider || null
  }
  return matchProvider(c.model_family)
}
function fmtDiscount(d: number | null): string {
  if (d == null) return '—'
  return `${parseFloat((d * 10).toFixed(1))}折`
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
  const { hasPermission, fetchWithAuth, isAdmin } = useAuth()
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

  // 批量导入
  const [showImport, setShowImport] = useState(false)
  const [importType, setImportType] = useState<'suppliers' | 'models'>('suppliers')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{ dry_run: boolean; stats: Record<string, Record<string, number>>; errors: Array<{ sheet: string; row?: number; supplier?: string; model?: string; reason: string }>; message: string } | null>(null)
  const [importLoading, setImportLoading] = useState(false)

  // 页内确认对话框（替代 confirm()）
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  /* ── 数据加载 ── */
  const loadSuppliers = useCallback(async () => {
    try {
      const [supRes, sumRes] = await Promise.all([fetchWithAuth('/api/v1/suppliers'), fetchWithAuth('/api/v1/suppliers/summary/all')])
      if (supRes.ok) setSuppliers(await supRes.json())
      if (sumRes.ok) setSupplierSummaries(await sumRes.json())
    } catch { /* ignore */ }
  }, [fetchWithAuth])

  const loadChannels = useCallback(async () => {
    try {
      const [chRes, sumRes, priceRes] = await Promise.all([
        fetchWithAuth('/api/v1/channels'), fetchWithAuth('/api/v1/channels/summary/all'), fetchWithAuth('/api/v1/models'),
      ])
      if (chRes.ok) setChannels(await chRes.json())
      if (sumRes.ok) setChannelSummaries(await sumRes.json())
      if (priceRes.ok) setPrices(await priceRes.json())
    } catch { /* ignore */ }
  }, [fetchWithAuth])

  const loadSupplierDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const [detailRes, projectsRes, channelsRes] = await Promise.all([
        fetchWithAuth(`/api/v1/suppliers/${id}`),
        fetchWithAuth(`/api/v1/suppliers/${id}/projects`),
        fetchWithAuth(`/api/v1/channels?supplier_id=${id}`).catch(() => null),
      ])
      if (detailRes.ok) setSelectedSupplierDetail(await detailRes.json())
      else setSelectedSupplierDetail(null)
      if (projectsRes.ok) setSupplierProjects(await projectsRes.json())
      else setSupplierProjects(null)
      if (channelsRes?.ok) { const chs = await channelsRes.json(); setSupplierChannels(Array.isArray(chs) ? chs : []) }
      else setSupplierChannels([])
    } catch { setSelectedSupplierDetail(null); setSupplierProjects(null); setSupplierChannels([]) }
    finally { setDetailLoading(false) }
  }, [fetchWithAuth])

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
      contact_person: s.contact_person || '', contact_email: s.contact_email || '',
      contact_phone: s.contact_phone || '', im_group: s.im_group || '',
      settlement_currency: s.settlement_currency, payment_terms: s.payment_terms || '',
      settlement_method: s.settlement_method || '',
      settlement_cycle_days: s.settlement_cycle_days != null ? String(s.settlement_cycle_days) : '',
      prepaid_balance: s.prepaid_balance != null ? String(s.prepaid_balance) : '',
      credit_limit: s.credit_limit != null ? String(s.credit_limit) : '',
      contract_start: s.contract_start || '', contract_end: s.contract_end || '',
      api_endpoint: s.api_endpoint || '', api_doc_url: s.api_doc_url || '',
      models_provided: s.models_provided || '', auth_type: s.auth_type || '',
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
        contact_phone: supplierForm.contact_phone || null, im_group: supplierForm.im_group || null,
        payment_terms: supplierForm.payment_terms || null,
        settlement_method: supplierForm.settlement_method || null,
        settlement_cycle_days: supplierForm.settlement_cycle_days ? Number(supplierForm.settlement_cycle_days) : null,
        prepaid_balance: supplierForm.prepaid_balance !== '' ? Number(supplierForm.prepaid_balance) : null,
        credit_limit: supplierForm.credit_limit !== '' ? Number(supplierForm.credit_limit) : null,
        contract_start: supplierForm.contract_start || null, contract_end: supplierForm.contract_end || null,
        api_endpoint: supplierForm.api_endpoint || null, api_doc_url: supplierForm.api_doc_url || null,
        models_provided: supplierForm.models_provided || null,
        auth_type: supplierForm.auth_type || null, remarks: supplierForm.remarks || null,
      }
      const url = editingSupplier ? `/api/v1/suppliers/${editingSupplier.id}` : '/api/v1/suppliers'
      const res = await fetchWithAuth(url, { method: editingSupplier ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      if (res.ok) {
        setShowSupplierForm(false); await loadSuppliers()
        if (selectedSupplierId) await loadSupplierDetail(selectedSupplierId)
        showToast(editingSupplier ? '供应商已更新' : '供应商已创建', 'success')
      } else { const err = await res.json().catch(() => ({})); showToast(err.detail || '操作失败', 'error') }
    } finally { setSavingSupplier(false) }
  }
  const handleDeleteSupplier = (s: Supplier) => {
    setConfirmDialog({
      title: `删除供应商「${s.name}」`,
      message: '已关联成本将无法删除，此操作不可恢复。',
      onConfirm: async () => {
        setConfirmDialog(null)
        const res = await fetchWithAuth(`/api/v1/suppliers/${s.id}`, { method: 'DELETE' })
        if (res.ok) { if (selectedSupplierId === s.id) setSelectedSupplierId(null); await loadSuppliers(); showToast('已删除', 'success') }
        else { const err = await res.json().catch(() => ({})); showToast(err.detail || '删除失败', 'error') }
      },
    })
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
      supplier_id: c.supplier_id, name: c.name, code: c.code,
      api_protocol: c.api_protocol, status: c.status,
      cost_discount: c.cost_discount != null ? parseFloat((c.cost_discount * 10).toFixed(1)).toString() : '',
      markup: c.markup != null ? parseFloat((c.markup * 10).toFixed(1)).toString() : '',
      cost_source: c.cost_source,
      scope_type: c.scope_type, model_family: c.model_family || '', model_id: c.model_id || 0,
      cache_hit_rate: sla.cache_hit_rate?.toString() || '', tpm: sla.tpm?.toString() || '',
      rpm: sla.rpm?.toString() || '', avg_latency_ms: sla.avg_latency_ms?.toString() || '',
      access_url: c.access_url || '', usage_url: c.usage_url || '',
      remarks: c.remarks || '',
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
      const discountFold = cv(channelForm.cost_discount as string)
      const markupFold = cv(channelForm.markup as string)
      const payload = {
        supplier_id: channelForm.supplier_id,
        name: channelForm.name, code: channelForm.code,
        api_protocol: channelForm.api_protocol, status: channelForm.status,
        cost_discount: discountFold != null ? discountFold / 10 : null,
        markup: markupFold != null ? markupFold / 10 : null,
        cost_source: 'manual',
        scope_type: channelForm.scope_type,
        model_family: channelForm.scope_type === 'family' ? (channelForm.model_family || null) : null,
        model_id: channelForm.scope_type === 'single' ? (channelForm.model_id || null) : null,
        sla_json: Object.keys(slaObj).length > 0 ? JSON.stringify(slaObj) : null,
        access_url: channelForm.access_url || null,
        usage_url: channelForm.usage_url || null,
        remarks: channelForm.remarks || null,
      }
      const url = editingChannel ? `/api/v1/channels/${editingChannel.id}` : '/api/v1/channels'
      const res = await fetchWithAuth(url, { method: editingChannel ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      if (res.ok) {
        setShowChannelForm(false)
        await Promise.all([loadChannels(), selectedSupplierId ? loadSupplierDetail(selectedSupplierId) : Promise.resolve()])
        showToast(editingChannel ? '通道已更新' : '通道已创建', 'success')
      } else { const err = await res.json().catch(() => ({})); showToast(err.detail || '操作失败', 'error') }
    } finally { setSavingChannel(false) }
  }
  const handleDeleteChannel = (id: number) => {
    setConfirmDialog({
      title: '删除通道',
      message: '确认删除该通道？删除后无法恢复。',
      onConfirm: async () => {
        setConfirmDialog(null)
        setDeletingChannelId(id)
        try {
          const res = await fetchWithAuth(`/api/v1/channels/${id}`, { method: 'DELETE' })
          if (res.ok) {
            showToast('已删除', 'success')
            if (selectedChannelId === id) setSelectedChannelId(null)
            await Promise.all([loadChannels(), selectedSupplierId ? loadSupplierDetail(selectedSupplierId) : Promise.resolve()])
          } else { const err = await res.json().catch(() => ({})); showToast(err.detail || '删除失败', 'error') }
        } finally { setDeletingChannelId(null) }
      },
    })
  }
  /* ── 导入处理 ── */
  const handleImportRun = async (dry: boolean) => {
    if (!importFile) return
    setImportLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      const endpoint = importType === 'suppliers' ? '/api/v1/suppliers/import' : '/api/v1/models/import'
      const res = await fetchWithAuth(`${endpoint}?dry_run=${dry}`, { method: 'POST', body: fd })
      let data: Record<string, unknown>
      try { data = await res.json() } catch { showToast(`服务器错误 (${res.status})`, 'error'); return }
      if (!res.ok) { showToast((data.detail as string) || '操作失败', 'error'); return }
      setImportResult(data as ImportResult)
      if (!dry) {
        showToast((data.message as string) || '导入完成', 'success')
        await Promise.all([loadSuppliers(), loadChannels()])
        setShowImport(false); setImportFile(null); setImportResult(null)
      }
    } catch (e) { showToast(e instanceof Error ? e.message : '网络错误', 'error') } finally { setImportLoading(false) }
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

  const filteredChannels = useMemo(() => {
    const q = channelSearch.trim().toLowerCase()
    return channels.filter(c => {
      if (channelFilterKind && c.api_protocol !== channelFilterKind) return false
      if (channelFilterStatus && c.computed_status !== channelFilterStatus) return false
      if (channelFilterModel && c.model_family !== channelFilterModel) return false
      if (channelFilterSupplier && String(c.supplier_id) !== channelFilterSupplier) return false
      if (q) { const sup = supplierMap[c.supplier_id]; return `${c.name} ${c.code} ${c.model_family || ''} ${sup?.name || ''}`.toLowerCase().includes(q) }
      return true
    })
  }, [channels, channelFilterKind, channelFilterStatus, channelFilterModel, channelFilterSupplier, channelSearch, supplierMap])

  const channelStats = useMemo(() => {
    let totalActive = 0, totalMonthly = 0
    const byKind: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    channels.forEach(c => {
      totalActive += c.active_projects; totalMonthly += c.monthly_cost
      byKind[c.api_protocol] = (byKind[c.api_protocol] || 0) + 1
      byStatus[c.computed_status] = (byStatus[c.computed_status] || 0) + 1
    })
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
            <div className="flex items-center gap-2">
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-400 text-xs font-medium hover:border-accent-blue/50 hover:text-accent-blue transition-all cursor-pointer">
                批量导入
              </button>
              <button onClick={openCreateSupplier}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer">
                <Plus size={14} strokeWidth={2.5} />新增供应商
              </button>
            </div>
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
            className={`relative px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${mainTab === t.key ? 'text-accent-blue' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'}`}>
            <t.icon size={13} />{t.label}
            {mainTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-blue rounded-t" />}
          </button>
        ))}
      </div>

      {/* ── 供应商视图 ── */}
      {mainTab === 'suppliers' && (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
          {/* 左：供应商列表 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 flex flex-col">
            <div className="px-4 py-3 border-b border-border/50 bg-bg-card/50 space-y-2 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <IconBox icon={Building2} size="sm" tone="blue" variant="soft" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">供应商</span>
                <span className="text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full ml-auto">{filteredSuppliers.length}</span>
              </div>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
                <input type="text" placeholder="搜索名称/简码/模型..." value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-200 outline-none focus:border-[#3B82F6] transition-colors placeholder-gray-600" />
              </div>
              <div className="flex gap-2">
                <SearchableSelect
                  className="flex-1"
                  options={[{ value: '', label: '全部状态' }, ...SUPPLIER_STATUSES.map(s => ({ value: s, label: s }))]}
                  value={supplierFilterStatus}
                  onChange={(v) => setSupplierFilterStatus(v === null ? '' : String(v))}
                />
                <SearchableSelect
                  className="flex-1"
                  options={[{ value: '', label: '全部类型' }, ...CATEGORIES.map(c => ({ value: c, label: c }))]}
                  value={supplierFilterCategory}
                  onChange={(v) => setSupplierFilterCategory(v === null ? '' : String(v))}
                />
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
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.name}</span>
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
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">{selectedSupplierDetail.name}</h3>
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
                      <button onClick={() => openCreateChannel(selectedSupplierId!)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-border bg-bg-card text-gray-600 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue transition-colors">
                        <Plus size={11} />新增通道
                      </button>
                      <button onClick={() => openEditSupplier(selectedSupplierDetail)} className="p-1.5 rounded-lg text-gray-500 hover:text-accent-blue hover:bg-accent-blue/10 transition-colors"><Edit3 size={14} /></button>
                      <button onClick={() => handleDeleteSupplier(selectedSupplierDetail)} className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>

                {/* 指标条 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

                {/* 详情 Tab */}
                <div className="flex items-center gap-0 border-b border-border/40">
                  {([
                    { key: 'channels' as const, label: '通道列表', icon: Network, count: supplierChannels.length },
                    { key: 'info' as const, label: '基本信息', icon: FileText },
                    { key: 'projects' as const, label: '关联项目', icon: Briefcase, count: supplierProjects?.projects.length || 0 },
                  ]).map(t => (
                    <button key={t.key} onClick={() => setSupplierDetailTab(t.key)}
                      className={`relative px-3 py-2 text-xs font-semibold flex items-center gap-1.5 transition-colors ${supplierDetailTab === t.key ? 'text-accent-blue' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'}`}>
                      <t.icon size={13} />{t.label}
                      {'count' in t && (t as { count?: number }).count! > 0 && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-bold">{(t as { count?: number }).count}</span>
                      )}
                      {supplierDetailTab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-blue rounded-t" />}
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
                        const protocolC = API_PROTOCOL_COLORS[c.api_protocol] || API_PROTOCOL_COLORS['other']
                        const statusC = COMPUTED_STATUS_COLORS[c.computed_status] || COMPUTED_STATUS_COLORS['长期有效']
                        return (
                          <div key={c.id} className="rounded-xl bg-bg-input/50 border border-border/40 p-3 hover:border-accent-blue/20 transition-all group">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                <IconBox icon={Cpu} size="sm" tone="cyan" variant="soft" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-semibold text-gray-900 dark:text-white">{c.name}</span>
                                    {c.code && <span className="text-[11px] text-gray-500 font-mono">#{c.code}</span>}
                                    <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: protocolC.bg, color: protocolC.text }}>{API_PROTOCOL_LABELS[c.api_protocol] || c.api_protocol}</span>
                                    <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: statusC.bg, color: statusC.text }}>{c.computed_status}</span>
                                  </div>
                                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                                    {c.scope_type === 'family' && c.model_family && <span>{c.model_family}</span>}
                                    {c.scope_type === 'all' && <span>全部模型</span>}
                                    {c.cost_discount != null && <span>通道成本 {fmtDiscount(c.cost_discount)}</span>}
                                    <span>{c.active_projects} 个项目</span>
                                    {c.monthly_cost > 0 && <span className="text-rose-600 dark:text-rose-400">${c.monthly_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}/月</span>}
                                  </div>
                                </div>
                              </div>
                              {hasPermission('upstream:edit') && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => openEditChannel(c)} className="p-1.5 rounded-lg text-gray-500 hover:text-accent-blue hover:bg-accent-blue/10 transition-colors"><Edit3 size={13} /></button>
                                  <button onClick={() => handleDeleteChannel(c.id)} disabled={deletingChannelId === c.id}
                                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50">
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
                          {selectedSupplierDetail.contact_person && <div className="flex items-start gap-1.5 min-w-0"><span className="text-gray-400 dark:text-gray-500 shrink-0 w-[4em]">对接人</span><span className="text-gray-700 dark:text-gray-200 flex-1 min-w-0">{selectedSupplierDetail.contact_person}</span></div>}
                          {selectedSupplierDetail.contact_email && <div className="flex items-start gap-1.5 min-w-0"><Mail size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" /><a href={`mailto:${selectedSupplierDetail.contact_email}`} className="text-gray-700 dark:text-gray-200 hover:text-blue-400 truncate flex-1 min-w-0">{selectedSupplierDetail.contact_email}</a></div>}
                          {selectedSupplierDetail.contact_phone && <div className="flex items-start gap-1.5 min-w-0"><Phone size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" /><span className="text-gray-700 dark:text-gray-200">{selectedSupplierDetail.contact_phone}</span></div>}
                          {selectedSupplierDetail.im_group && <div className="flex items-start gap-1.5 min-w-0"><Hash size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" /><span className="text-gray-700 dark:text-gray-200">{selectedSupplierDetail.im_group}</span></div>}
                          {!selectedSupplierDetail.contact_person && !selectedSupplierDetail.contact_email && !selectedSupplierDetail.contact_phone && !selectedSupplierDetail.im_group && <span className="text-gray-500 dark:text-gray-600">暂无联系信息</span>}
                        </div>
                      </div>
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-3"><IconBox icon={Cpu} size="sm" tone="blue" variant="soft" /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">技术信息</span></div>
                        <div className="space-y-2 text-xs">
                          {selectedSupplierDetail.api_endpoint && <div className="flex items-start gap-1.5 min-w-0"><Globe size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" /><a href={selectedSupplierDetail.api_endpoint} target="_blank" rel="noopener noreferrer" className="text-gray-700 dark:text-gray-200 hover:text-blue-400 truncate flex-1 min-w-0">{selectedSupplierDetail.api_endpoint}</a></div>}
                          {selectedSupplierDetail.api_doc_url && <div className="flex items-start gap-1.5 min-w-0"><BookOpen size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" /><a href={selectedSupplierDetail.api_doc_url} target="_blank" rel="noopener noreferrer" className="text-gray-700 dark:text-gray-200 hover:text-blue-400 truncate flex-1 min-w-0">API 文档</a></div>}
                          {selectedSupplierDetail.auth_type && <div className="flex items-start gap-1.5 min-w-0"><Key size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" /><span className="text-gray-700 dark:text-gray-200">认证: {selectedSupplierDetail.auth_type}</span></div>}
                          {selectedSupplierDetail.models_provided && (
                            <div className="mt-2"><span className="text-gray-500 text-[11px]">提供模型</span>
                              <div className="flex flex-wrap gap-1 mt-1">{selectedSupplierDetail.models_provided.split(',').filter(Boolean).map(m => <span key={m} className="px-1.5 py-0.5 rounded text-[11px] bg-blue-500/10 text-blue-400 font-medium">{m.trim()}</span>)}</div>
                            </div>
                          )}
                          {!selectedSupplierDetail.api_endpoint && !selectedSupplierDetail.api_doc_url && !selectedSupplierDetail.auth_type && !selectedSupplierDetail.models_provided && <span className="text-gray-500 dark:text-gray-600">暂无技术信息</span>}
                        </div>
                      </div>
                    </div>
                    {/* 财务账户 */}
                    {(selectedSupplierDetail.settlement_method || selectedSupplierDetail.prepaid_balance != null || selectedSupplierDetail.credit_limit != null || selectedSupplierDetail.current_month_consumed != null) && (
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-3"><IconBox icon={DollarSign} size="sm" tone="orange" variant="soft" /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">财务账户</span></div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                          {selectedSupplierDetail.settlement_method && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-500 dark:text-gray-400 text-[11px]">结算方式</span>
                              <span className="text-gray-700 dark:text-gray-200 font-medium">{selectedSupplierDetail.settlement_method}{selectedSupplierDetail.settlement_cycle_days ? `·${selectedSupplierDetail.settlement_cycle_days}天` : ''}</span>
                            </div>
                          )}
                          {selectedSupplierDetail.prepaid_balance != null && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-500 dark:text-gray-400 text-[11px]">预付余额</span>
                              <span className="text-gray-700 dark:text-gray-200 font-medium tabular-nums">${selectedSupplierDetail.prepaid_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {selectedSupplierDetail.credit_limit != null && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-500 dark:text-gray-400 text-[11px]">授信额度</span>
                              <span className="text-gray-700 dark:text-gray-200 font-medium tabular-nums">${selectedSupplierDetail.credit_limit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {selectedSupplierDetail.current_month_consumed != null && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-gray-500 dark:text-gray-400 text-[11px]">本月消费</span>
                              <span className="text-rose-600 dark:text-rose-400 font-medium tabular-nums">${selectedSupplierDetail.current_month_consumed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-gray-400 text-[11px] font-normal ml-1">自动核算</span></span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {selectedSupplierDetail.remarks && (
                      <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                        <div className="flex items-center gap-2 mb-2"><IconBox icon={FileText} size="sm" tone="gray" variant="soft" /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">备注</span></div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{selectedSupplierDetail.remarks}</p>
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
                                  <div className="text-xs font-medium text-gray-900 dark:text-white truncate">{p.project_name}</div>
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
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-bg-hover/30 border border-border mb-4">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={channelSearch} onChange={e => setChannelSearch(e.target.value)} placeholder="搜索通道名 / 编码 / 模型 / 供应商"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-hover/30 border border-border rounded-lg text-gray-700 dark:text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
            </div>
            <SearchableSelect
              options={[{ value: '', label: '全部供应商' }, ...suppliers.map(s => ({ value: String(s.id), label: s.name }))]}
              value={channelFilterSupplier}
              onChange={(v) => setChannelFilterSupplier(v === null ? '' : String(v))}
            />
            <SearchableSelect
              options={[{ value: '', label: '全部协议' }, ...API_PROTOCOLS.map(k => ({ value: k, label: API_PROTOCOL_LABELS[k] }))]}
              value={channelFilterKind}
              onChange={(v) => setChannelFilterKind(v === null ? '' : String(v))}
            />
            <SearchableSelect
              options={[{ value: '', label: '全部状态' }, ...Object.keys(COMPUTED_STATUS_COLORS).map(s => ({ value: s, label: s }))]}
              value={channelFilterStatus}
              onChange={(v) => setChannelFilterStatus(v === null ? '' : String(v))}
            />
            {hasPermission('upstream:edit') && (
              <button onClick={() => openCreateChannel()}
                className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-accent-blue rounded-lg hover:bg-blue-600 transition-colors">
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
                const protocolC = API_PROTOCOL_COLORS[c.api_protocol] || API_PROTOCOL_COLORS['other']
                const statusC = COMPUTED_STATUS_COLORS[c.computed_status] || COMPUTED_STATUS_COLORS['长期有效']
                const active = selectedChannelId === c.id
                return (
                  <button key={c.id} onClick={() => setSelectedChannelId(active ? null : c.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${active ? 'bg-accent-blue/10 border-accent-blue/30' : 'bg-bg-hover/30 border-border hover:bg-bg-hover/50 hover:border-border'}`}>
                    <div className="flex items-start gap-3">
                      <IconBox icon={Cpu} size="md" tone="cyan" variant="soft" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</span>
                          {c.code && <span className="text-[11px] text-gray-500 font-mono">#{c.code}</span>}
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: protocolC.bg, color: protocolC.text }}>{API_PROTOCOL_LABELS[c.api_protocol] || c.api_protocol}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: statusC.bg, color: statusC.text }}>{c.computed_status}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
                          <span className="inline-flex items-center gap-1"><Building2 size={11} />{sup?.name || '—'}</span>
                          {c.scope_type === 'family' && c.model_family && <span className="inline-flex items-center gap-1"><Hash size={11} />{c.model_family}</span>}
                          {c.scope_type === 'all' && <span className="inline-flex items-center gap-1"><Hash size={11} />全部模型</span>}
                          {c.cost_discount != null && <span className="inline-flex items-center gap-1"><Percent size={11} />通道成本 {fmtDiscount(c.cost_discount)}</span>}
                          <span className="inline-flex items-center gap-1"><Activity size={11} />{c.active_projects} 个活跃项目</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className={`text-gray-600 transition-transform ${active ? 'rotate-90 text-accent-blue' : ''}`} />
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
          subtitle="基本信息 · 联系方式 · 财务账户 · 技术对接" tone="blue" size="2xl" onClose={() => setShowSupplierForm(false)}>
          {(() => {
            const si = 'w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-900 dark:text-white outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all'
            const sf = (patch: Partial<typeof supplierForm>) => setSupplierForm(f => ({ ...f, ...patch }))
            return (
              <div className="space-y-5">

                {/* ── 基本信息 ── */}
                <div>
                  <SectionLabel>基本信息</SectionLabel>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="供应商名称" required className="col-span-2">
                      <input value={supplierForm.name} onChange={e => sf({ name: e.target.value })} placeholder="如 Anthropic" className={si} />
                    </Field>
                    <Field label="简码" hint="英文+数字">
                      <input value={supplierForm.code} onChange={e => sf({ code: e.target.value })} placeholder="如 ant" className={si} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <Field label="类型">
                      <SearchableSelect options={CATEGORIES.map(c => ({ value: c, label: c }))} value={supplierForm.category} onChange={v => sf({ category: v === null ? '' : String(v) })} />
                    </Field>
                    <Field label="合作状态">
                      <SearchableSelect options={SUPPLIER_STATUSES.map(s => ({ value: s, label: s }))} value={supplierForm.status} onChange={v => sf({ status: v === null ? '' : String(v) })} />
                    </Field>
                  </div>
                </div>

                {/* ── 联系方式 ── */}
                <div>
                  <SectionLabel>联系方式</SectionLabel>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="对接人">
                      <input value={supplierForm.contact_person} onChange={e => sf({ contact_person: e.target.value })} placeholder="对接人姓名" className={si} />
                    </Field>
                    <Field label="邮箱">
                      <input type="email" value={supplierForm.contact_email} onChange={e => sf({ contact_email: e.target.value })} placeholder="email@example.com" className={si} />
                    </Field>
                    <Field label="电话">
                      <input value={supplierForm.contact_phone} onChange={e => sf({ contact_phone: e.target.value })} placeholder="联系电话" className={si} />
                    </Field>
                    <Field label="微信 / 飞书群">
                      <input value={supplierForm.im_group} onChange={e => sf({ im_group: e.target.value })} placeholder="群名或群链接" className={si} />
                    </Field>
                  </div>
                </div>

                {/* ── 财务账户 ── */}
                <div>
                  <SectionLabel>财务账户</SectionLabel>
                  {/* 结算三要素 */}
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="结算方式">
                      <SearchableSelect options={[{ value: '', label: '不指定' }, ...SETTLEMENT_METHODS.map(m => ({ value: m, label: m }))]} value={supplierForm.settlement_method} onChange={v => sf({ settlement_method: v === null ? '' : String(v) })} />
                    </Field>
                    <Field label="结算周期（天）">
                      <input type="number" min={0} value={supplierForm.settlement_cycle_days} onChange={e => sf({ settlement_cycle_days: e.target.value })} placeholder="30" className={si} />
                    </Field>
                    <Field label="结算币种">
                      <SearchableSelect options={CURRENCIES.map(c => ({ value: c, label: `${c} - ${CURRENCY_META[c]?.name || c}` }))} value={supplierForm.settlement_currency} onChange={v => sf({ settlement_currency: v === null ? '' : String(v) })} />
                    </Field>
                  </div>
                  {/* 余额 */}
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <Field label="预付余额（元）" hint="手动维护">
                      <input type="number" min={0} value={supplierForm.prepaid_balance} onChange={e => sf({ prepaid_balance: e.target.value })} placeholder="0.00" className={si} />
                    </Field>
                    <Field label="信用额度（元）">
                      <input type="number" min={0} value={supplierForm.credit_limit} onChange={e => sf({ credit_limit: e.target.value })} placeholder="0.00" className={si} />
                    </Field>
                  </div>
                  {/* 合同 + 付款条款 */}
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <Field label="合同起始">
                      <input type="month" value={supplierForm.contract_start} onChange={e => sf({ contract_start: e.target.value })} className={si} />
                    </Field>
                    <Field label="合同终止">
                      <input type="month" value={supplierForm.contract_end} onChange={e => sf({ contract_end: e.target.value })} className={si} />
                    </Field>
                    <Field label="付款条款" hint="如：月结30天">
                      <input value={supplierForm.payment_terms || ''} onChange={e => sf({ payment_terms: e.target.value })} placeholder="月结30天" className={si} />
                    </Field>
                  </div>
                </div>

                {/* ── 技术对接 ── */}
                <div>
                  <SectionLabel>技术对接</SectionLabel>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="API 入口" hint="Base URL">
                      <input value={supplierForm.api_endpoint} onChange={e => sf({ api_endpoint: e.target.value })} placeholder="https://api.example.com" className={si} />
                    </Field>
                    <Field label="API 文档地址">
                      <input value={supplierForm.api_doc_url} onChange={e => sf({ api_doc_url: e.target.value })} placeholder="https://docs.example.com" className={si} />
                    </Field>
                    <Field label="提供模型" hint="逗号分隔">
                      <input value={supplierForm.models_provided} onChange={e => sf({ models_provided: e.target.value })} placeholder="GPT-4o, Claude-3.5" className={si} />
                    </Field>
                    <Field label="认证方式">
                      <SearchableSelect options={[{ value: '', label: '请选择' }, ...AUTH_TYPES.map(a => ({ value: a, label: a }))]} value={supplierForm.auth_type} onChange={v => sf({ auth_type: v === null ? '' : String(v) })} />
                    </Field>
                  </div>
                </div>

                {/* ── 备注 ── */}
                <Field label="备注" full>
                  <textarea value={supplierForm.remarks} onChange={e => sf({ remarks: e.target.value })} placeholder="其他补充信息" rows={2} className={`${si} resize-none`} />
                </Field>

              </div>
            )
          })()}
          <ModalFooter onClose={() => setShowSupplierForm(false)} onSave={handleSaveSupplier} saving={savingSupplier} tone="blue"
            saveText={editingSupplier ? '保存修改' : '创建供应商'} saveDisabled={!supplierForm.name}
            leftHint={editingSupplier ? `编辑供应商：${editingSupplier.name}` : '新增供应商，创建后可添加关联通道'} />
        </Modal>
      )}

      {/* 通道表单 */}
      {showChannelForm && (
        <ChannelFormModal form={channelForm} setForm={setChannelForm} suppliers={suppliers} prices={prices}
          editing={editingChannel} saving={savingChannel} onClose={() => setShowChannelForm(false)} onSave={handleSaveChannel} />
      )}

      {/* 页内确认对话框 */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmDialog(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-bg-card border border-border shadow-xl p-6">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">{confirmDialog.title}</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-5">{confirmDialog.message}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDialog(null)}
                className="px-4 py-1.5 text-xs font-semibold border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg hover:border-accent-blue/50 hover:text-accent-blue transition-colors">
                取消
              </button>
              <button onClick={confirmDialog.onConfirm}
                className="px-4 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量导入弹窗 */}
      {showImport && (
        <ImportModal
          isAdmin={isAdmin}
          importType={importType} setImportType={setImportType}
          importFile={importFile} setImportFile={setImportFile}
          importResult={importResult} setImportResult={setImportResult}
          loading={importLoading}
          onDryRun={() => handleImportRun(true)}
          onConfirm={() => handleImportRun(false)}
          onClose={() => { setShowImport(false); setImportFile(null); setImportResult(null) }}
        />
      )}
    </div>
  )
}

/* ──── 通道详情面板 ──── */
function ChannelDetailPanel({ channel, supplier, prices, onEdit, onDelete, deleting, onClose }: {
  channel: Channel; supplier: Supplier | undefined; prices: ModelCatalogItem[]
  onEdit: () => void; onDelete: () => void; deleting: boolean; onClose: () => void
}) {
  const sla = parseSla(channel.sla_json)
  const provider = channelProvider(channel, prices)
  const statusC = COMPUTED_STATUS_COLORS[channel.computed_status] || COMPUTED_STATUS_COLORS['长期有效']
  const protocolC = API_PROTOCOL_COLORS[channel.api_protocol] || API_PROTOCOL_COLORS['other']

  // 成本实算：找绑定模型的官方价格
  const costPrices = (() => {
    if (channel.scope_type === 'single' && channel.model_id) {
      return prices.filter(p => p.id === channel.model_id && (p.input_price != null || p.output_price != null))
    }
    if (channel.scope_type === 'family' || channel.scope_type === 'all') {
      return prices.filter(p => provider && p.provider === provider && (p.input_price != null || p.output_price != null)).slice(0, 5)
    }
    return []
  })()

  const scopeLabel = channel.scope_type === 'single'
    ? (prices.find(p => p.id === channel.model_id)?.name || `模型 #${channel.model_id}`)
    : channel.scope_type === 'family' ? (channel.model_family || '—') : '全部模型'

  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4 sticky top-4">
      <div className="flex items-start justify-between mb-3">
        <SectionHeader icon={Cpu} title={channel.name} description={`${supplier?.name || '—'} · ${API_PROTOCOL_LABELS[channel.api_protocol] || channel.api_protocol}`} tone="cyan" />
        <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"><X size={16} /></button>
      </div>

      {/* 状态 badge 行 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: statusC.bg, color: statusC.text }}>{channel.computed_status}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: protocolC.bg, color: protocolC.text }}>{API_PROTOCOL_LABELS[channel.api_protocol] || channel.api_protocol}</span>
        {channel.cost_discount != null && (
          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-accent-blue/10 text-accent-blue">
            成本 {fmtDiscount(channel.cost_discount)}
            {channel.markup != null && channel.markup > 0 && (
              <> → 售价 {fmtDiscount(channel.cost_discount + channel.markup)}</>
            )}
          </span>
        )}
      </div>

      {/* KPI 格子 */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <StatBox label="绑定模型" value={SCOPE_TYPE_LABELS[channel.scope_type]} tone="blue" />
        <StatBox label="库存/在库" value={`${channel.inventory_available}/${channel.inventory_total}`} tone="green" />
        <StatBox label="活跃项目" value={`${channel.active_projects}`} tone="purple" />
        <StatBox label="当月成本" value={`$${channel.monthly_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`} tone="red" />
      </div>

      {/* 基本信息 */}
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-2"><Hash size={12} className="text-gray-500" /><span className="text-gray-500">覆盖范围</span><span className="text-gray-900 dark:text-white font-medium">{scopeLabel}</span></div>
        {channel.code && <div className="flex items-center gap-2"><Key size={12} className="text-gray-500" /><span className="text-gray-500">通道编码</span><span className="text-gray-900 dark:text-white font-medium">{channel.code}</span></div>}
        {channel.cost_source && channel.cost_discount != null && (
          <div className="flex items-center gap-2"><DollarSign size={12} className="text-gray-500" /><span className="text-gray-500">成本来源</span><span className="text-gray-900 dark:text-white font-medium">{channel.cost_source === 'import' ? '表格导入' : '手动录入'}</span></div>
        )}
      </div>

      {/* 成本 & 售价实算表 */}
      {channel.cost_discount != null && costPrices.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <BookOpen size={12} />价格实算（基于官方原价）
          </div>
          <div className="space-y-1.5">
            {costPrices.map(p => {
              const sellRate = channel.cost_discount! + (channel.markup ?? 0)
              return (
                <div key={p.id} className="text-[11px] py-1.5 px-2 rounded-lg bg-bg-hover/50 space-y-1">
                  <span className="text-gray-700 dark:text-gray-200 font-medium block truncate">{p.name}</span>
                  <div className="flex gap-4 tabular-nums flex-wrap">
                    <span className="text-gray-500">成本{fmtDiscount(channel.cost_discount)}：
                      {p.input_price != null && <span className="text-emerald-600 dark:text-emerald-400 ml-1">↑{fmtUSD(p.input_price * channel.cost_discount!, p.price_currency)}</span>}
                      {p.output_price != null && <span className="text-orange-500 dark:text-orange-400 ml-1">↓{fmtUSD(p.output_price * channel.cost_discount!, p.price_currency)}</span>}
                    </span>
                    {channel.markup != null && channel.markup > 0 && (
                      <span className="text-gray-500">售价{fmtDiscount(sellRate)}：
                        {p.input_price != null && <span className="text-blue-600 dark:text-blue-400 ml-1">↑{fmtUSD(p.input_price * sellRate, p.price_currency)}</span>}
                        {p.output_price != null && <span className="text-purple-600 dark:text-purple-400 ml-1">↓{fmtUSD(p.output_price * sellRate, p.price_currency)}</span>}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">单位：官网原价币种/1M tokens，仅作估算参考</p>
        </div>
      )}

      {/* SLA */}
      {(sla.cache_hit_rate != null || sla.tpm != null || sla.rpm != null || sla.avg_latency_ms != null) && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1"><Activity size={12} />SLA & 技术指标</div>
          <div className="grid grid-cols-2 gap-2">
            {sla.cache_hit_rate != null && <SlaBox label="缓存命中率" value={`${(sla.cache_hit_rate * 100).toFixed(1)}%`} tone="green" />}
            {sla.tpm != null && <SlaBox label="TPM" value={sla.tpm.toLocaleString()} tone="blue" />}
            {sla.rpm != null && <SlaBox label="RPM" value={sla.rpm.toLocaleString()} tone="purple" />}
            {sla.avg_latency_ms != null && <SlaBox label="平均延迟" value={`${sla.avg_latency_ms} ms`} tone="orange" />}
          </div>
        </div>
      )}

      {/* 备注 */}
      {channel.remarks && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1"><FileText size={12} />备注</div>
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">{channel.remarks}</p>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="mt-4 pt-3 border-t border-border flex gap-2 flex-wrap">
        <button onClick={onEdit} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border bg-bg-card text-gray-600 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue rounded-lg">
          <Edit3 size={13} />编辑
        </button>
        <button onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg disabled:opacity-50">
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}删除
        </button>
      </div>
    </div>
  )
}

/* ──── 统计视图 ──── */
function StatsView({ suppliers, channels, channelStats, costByCurrency, prices }: {
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
  const channelsByProvider = useMemo(() => { const m: Record<string, Channel[]> = {}; channels.forEach(c => { const prov = matchProvider(c.model_family); if (prov) { if (!m[prov]) m[prov] = []; m[prov].push(c) } }); return m }, [channels])

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Building2} label="供应商总数" value={suppliers.length} sub={`合作中 ${activeSuppliers} 家`} color="#3B82F6" gradient="radial-gradient(circle, #3B82F6 0%, transparent 70%)" />
        <KpiCard icon={Network} label="通道总数" value={channels.length} sub={`生效 ${channels.filter(c => c.computed_status === '生效中' || c.computed_status === '长期有效').length} 条`} color="#06B6D4" gradient="radial-gradient(circle, #06B6D4 0%, transparent 70%)" />
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
                      <div><div className="text-sm font-bold text-gray-900 dark:text-white">{cur}</div><div className="text-[11px] text-gray-500">{meta.name}</div></div>
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
              const c = API_PROTOCOL_COLORS[k] || API_PROTOCOL_COLORS['other']; const pct = channels.length > 0 ? n / channels.length * 100 : 0
              return (<div key={k}><div className="flex items-center justify-between text-xs mb-1"><span style={{ color: c.text }} className="font-semibold">{API_PROTOCOL_LABELS[k] || k}</span><span className="text-gray-500 tabular-nums">{n} ({pct.toFixed(0)}%)</span></div><div className="h-1.5 bg-bg-hover rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.text }} /></div></div>)
            })}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1"><Activity size={12} />按状态</div>
          <div className="space-y-2">
            {Object.entries(channelStats.byStatus).map(([s, n]) => {
              const c = COMPUTED_STATUS_COLORS[s] || COMPUTED_STATUS_COLORS['长期有效']; const pct = channels.length > 0 ? n / channels.length * 100 : 0
              return (<div key={s}><div className="flex items-center justify-between text-xs mb-1"><span style={{ color: c.text }} className="font-semibold">{s}</span><span className="text-gray-500 tabular-nums">{n} ({pct.toFixed(0)}%)</span></div><div className="h-1.5 bg-bg-hover rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.text }} /></div></div>)
            })}
          </div>
        </div>
      </div>

      {/* 官方参考价格 */}
      {priced.length > 0 && (
        <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
            <div className="text-[11px] text-gray-600 dark:text-gray-400"><span className="font-bold text-gray-700 dark:text-gray-300">价格来源：</span>官网公开定价（USD/1M tokens），在「管理后台 → 模型管理」中维护。</div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button onClick={() => setProviderFilter('all')} className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors border ${providerFilter === 'all' ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white border-transparent'}`}>全部</button>
              {providerList.map(prov => <button key={prov} onClick={() => setProviderFilter(prov)} className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors border ${providerFilter === prov ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white border-transparent'}`}>{prov}</button>)}
            </div>
          </div>
          <div className="space-y-6">
            {Object.entries(grouped).map(([prov, models]) => {
              const linkedChannels = channelsByProvider[prov] || []
              return (
                <div key={prov}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2"><span className="text-sm font-bold text-gray-900 dark:text-white">{prov}</span><span className="text-[11px] text-gray-600 px-2 py-0.5 rounded-full bg-bg-hover">{models.length} 个模型</span></div>
                    {linkedChannels.length > 0 && <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 flex-wrap"><Network size={10} />{linkedChannels.length} 条关联通道：{linkedChannels.map(c => <span key={c.id} className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-accent-blue/10 text-accent-blue">{c.name}{c.cost_discount != null ? ` ${fmtDiscount(c.cost_discount)}` : ''}</span>)}</span>}
                  </div>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-[11px] text-gray-500 uppercase tracking-wider bg-bg-hover/30">
                          <th className="px-4 py-2.5 font-semibold">模型</th>
                          <th className="px-4 py-2.5 font-semibold text-right">输入价/1M</th>
                          <th className="px-4 py-2.5 font-semibold text-right">输出价/1M</th>
                          <th className="px-4 py-2.5 font-semibold text-right">缓存读取</th>
                          <th className="px-4 py-2.5 font-semibold text-right">缓存写入</th>
                          {linkedChannels.map(c => <th key={c.id} className="px-4 py-2.5 font-semibold text-right text-accent-blue">{c.name}<br /><span className="text-[11px] font-normal text-gray-500">{c.cost_discount != null ? fmtDiscount(c.cost_discount) : '—'}</span></th>)}
                        </tr></thead>
                        <tbody>
                          {models.map((m, i) => {
                            let tiers: Array<{ threshold: string; input: number | null; output: number | null }> = []
                            try { if (m.price_tiers) tiers = JSON.parse(m.price_tiers) } catch { /* ignore */ }
                            return (
                              <tr key={m.id} className={`border-t border-border ${i % 2 === 0 ? 'bg-bg-hover/30' : ''}`}>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-gray-900 dark:text-white">{m.name}</span>
                                    {tiers.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-semibold">阶梯</span>}
                                  </div>
                                  {m.version_id && <div className="text-[11px] text-gray-600 font-mono">{m.version_id}</div>}
                                  {tiers.length > 0 && (
                                    <div className="mt-1 space-y-0.5">
                                      {tiers.map((t, ti) => (
                                        <div key={ti} className="text-[10px] text-gray-500 flex items-center gap-1.5">
                                          <span className="font-mono bg-bg-hover px-1 py-0.5 rounded text-violet-400">{t.threshold}</span>
                                          <span className="text-emerald-600 dark:text-emerald-400">↑{fmtUSD(t.input, m.price_currency)}</span>
                                          <span className="text-orange-600 dark:text-orange-400">↓{fmtUSD(t.output, m.price_currency)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400 font-semibold">{fmtUSD(m.input_price, m.price_currency)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-orange-400 font-semibold">{fmtUSD(m.output_price, m.price_currency)}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-blue-400">{m.cache_read_price != null ? fmtUSD(m.cache_read_price, m.price_currency) : '—'}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-violet-400">{m.cache_write_price != null ? fmtUSD(m.cache_write_price, m.price_currency) : '—'}</td>
                                {linkedChannels.map(c => (
                                  <td key={c.id} className="px-4 py-2.5 text-right tabular-nums">
                                    {c.cost_discount != null && m.input_price != null && <div className="text-emerald-600 dark:text-emerald-400 text-[11px]">↑ {fmtUSD(m.input_price * c.cost_discount, m.price_currency)}</div>}
                                    {c.cost_discount != null && m.output_price != null && <div className="text-orange-600 dark:text-orange-400 text-[11px]">↓ {fmtUSD(m.output_price * c.cost_discount, m.price_currency)}</div>}
                                    {c.cost_discount == null && <span className="text-gray-500">—</span>}
                                  </td>
                                ))}
                              </tr>
                            )
                          })}
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

/* ──── 批量导入弹窗 ──── */
type ImportResult = { dry_run: boolean; stats: Record<string, Record<string, number>>; errors: Array<{ sheet: string; row?: number; supplier?: string; model?: string; reason: string }>; message: string }

function ImportModal({ isAdmin, importType, setImportType, importFile, setImportFile, importResult, setImportResult, loading, onDryRun, onConfirm, onClose }: {
  isAdmin: boolean
  importType: 'suppliers' | 'models'; setImportType: (t: 'suppliers' | 'models') => void
  importFile: File | null; setImportFile: (f: File | null) => void
  importResult: ImportResult | null; setImportResult: (r: ImportResult | null) => void
  loading: boolean; onDryRun: () => void; onConfirm: () => void; onClose: () => void
}) {
  const templateUrl = importType === 'suppliers' ? '/api/v1/suppliers/import/template' : '/api/v1/models/import/template'
  const hasResult = importResult != null
  const availableTypes = (isAdmin ? ['suppliers', 'models'] : ['suppliers']) as Array<'suppliers' | 'models'>

  return (
    <Modal icon={Layers} title="批量导入" subtitle="支持供应商台账与模型基础列表，先预检再确认写入" tone="blue" size="2xl" onClose={onClose}>
      <div className="space-y-4">
        {/* 类型选择 */}
        <div>
          <SectionLabel>导入类型</SectionLabel>
          <div className="flex gap-2">
            {availableTypes.map(t => (
              <button key={t} onClick={() => { setImportType(t); setImportFile(null); setImportResult(null) }}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${importType === t ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30' : 'bg-bg-input border-border text-gray-500 hover:border-accent-blue/30'}`}>
                {t === 'suppliers' ? '供应商 + 通道' : '模型基础列表'}
              </button>
            ))}
          </div>
          {!isAdmin && <p className="mt-1.5 text-[11px] text-gray-500">模型基础列表导入仅管理员可操作</p>}
        </div>

        {/* 文件上传 + 模板下载 */}
        <div>
          <SectionLabel>选择文件</SectionLabel>
          <div className="flex items-center gap-2">
            <label className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-bg-input border border-dashed border-border hover:border-accent-blue/50 cursor-pointer text-xs transition-all">
              <input type="file" accept=".xlsx" className="hidden" onChange={e => { setImportFile(e.target.files?.[0] || null); setImportResult(null) }} />
              <span className="text-gray-500">{importFile ? importFile.name : '点击选择 .xlsx 文件'}</span>
              {importFile && <X size={13} className="ml-auto text-gray-400 hover:text-red-400" onClick={e => { e.preventDefault(); setImportFile(null); setImportResult(null) }} />}
            </label>
            <a href={templateUrl} download className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-400 text-xs hover:border-accent-blue/50 hover:text-accent-blue transition-all">
              <BookOpen size={13} />模板
            </a>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-500">列头格式请以模板为准，Sheet 名须完整保留；多档阶梯计价同名模型多行即可自动合并。</p>
        </div>

        {/* 预检结果 */}
        {hasResult && importResult && (
          <div className="rounded-xl border border-border/60 bg-bg-hover/20 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">预检结果</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${importResult.errors.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {importResult.errors.length > 0 ? `${importResult.errors.length} 条错误` : '无错误'}
              </span>
            </div>
            {/* 统计摘要 */}
            <div className="p-3 grid grid-cols-2 gap-2">
              {Object.entries(importResult.stats).map(([sheet, counts]) => (
                Object.entries(counts).map(([action, count]) => (
                  <div key={`${sheet}-${action}`} className="flex items-center justify-between text-xs rounded-lg bg-bg-input/50 px-2.5 py-2">
                    <span className="text-gray-500">{sheet === 'suppliers' ? '供应商' : sheet === 'channels' ? '通道' : sheet === 'models' ? '模型' : sheet} · {action === 'create' ? '新增' : '更新'}</span>
                    <span className={`font-bold tabular-nums ${action === 'create' ? 'text-emerald-400' : 'text-blue-400'}`}>{count}</span>
                  </div>
                ))
              ))}
            </div>
            {/* 错误列表 */}
            {importResult.errors.length > 0 && (
              <div className="px-3 pb-3">
                <div className="text-[11px] font-semibold text-red-400 mb-1.5">错误明细</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {importResult.errors.map((e, i) => (
                    <div key={i} className="text-[11px] text-red-300 bg-red-500/5 border border-red-500/10 rounded px-2 py-1">
                      [{e.sheet}]{e.row != null ? ` 第${e.row}行` : ''}{e.supplier ? ` ${e.supplier}` : ''}{e.model ? ` ${e.model}` : ''}: {e.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <ModalFooter onClose={onClose} saving={loading} tone="blue"
        leftHint={hasResult && importResult?.errors.length === 0 ? '预检通过，点击确认导入写入数据库' : '请先点击「预检」确认无误后再写入'}
        rightExtra={
          <button onClick={onDryRun} disabled={!importFile || loading}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-400 text-xs font-semibold hover:border-accent-blue/50 hover:text-accent-blue transition-all disabled:opacity-40">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}预检
          </button>
        }
        onSave={onConfirm}
        saveText="确认导入"
        saveDisabled={!importFile || loading || !hasResult || (importResult?.errors.length ?? 0) > 0}
      />
    </Modal>
  )
}

/* ──── 通道表单弹窗 ──── */
function ChannelFormModal({ form, setForm, suppliers, prices, editing, saving, onClose, onSave }: {
  form: typeof EMPTY_CHANNEL_FORM; setForm: (f: typeof EMPTY_CHANNEL_FORM) => void
  suppliers: Supplier[]; prices: ModelCatalogItem[]; editing: Channel | null; saving: boolean; onClose: () => void; onSave: () => void
}) {
  const upd = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })
  const inp = 'w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all'

  // 单模型选择列表
  const modelOptions = prices.filter(p => p.input_price != null || p.output_price != null)
    .map(p => ({ value: p.id, label: `${p.name}${p.provider ? ` (${p.provider})` : ''}` }))

  // 模型系列（provider）下拉：从 catalog 提取去重
  const providerOptions = [...new Set(prices.map(p => p.provider).filter(Boolean))]
    .sort()
    .map(p => ({ value: p as string, label: p as string }))

  return (
    <Modal icon={Network} title={editing ? '编辑通道' : '新建通道'} subtitle="基本信息 · 接入配置 · 成本定价 · 绑定模型 · SLA" tone="cyan" size="3xl" onClose={onClose}>
      <div className="space-y-5">

        {/* ── 基本信息 ── */}
        <div>
          <SectionLabel>基本信息</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="所属供应商" required>
              <SearchableSelect options={[{ value: 0, label: '请选择…' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} value={form.supplier_id || 0} onChange={v => upd({ supplier_id: (v as number) || 0 })} />
            </Field>
            <Field label="通道名称" required>
              <input value={form.name} onChange={e => upd({ name: e.target.value })} placeholder="如 Claude 官方通道" className={inp} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Field label="通道编码" hint="唯一简码，如 ANT-01">
              <input value={form.code} onChange={e => upd({ code: e.target.value })} placeholder="ANT-01" className={inp} />
            </Field>
            <Field label="接入协议">
              <SearchableSelect options={API_PROTOCOLS.map(k => ({ value: k, label: API_PROTOCOL_LABELS[k] }))} value={form.api_protocol} onChange={v => upd({ api_protocol: v === null ? 'other' : String(v) })} />
            </Field>
            <Field label="手动状态" hint="有效期状态由供应商合同自动推算">
              <SearchableSelect options={CHANNEL_MANUAL_STATUSES.map(s => ({ value: s, label: s }))} value={form.status} onChange={v => upd({ status: v === null ? '合作中' : String(v) })} />
            </Field>
          </div>
        </div>

        {/* ── 接入配置 ── */}
        <div>
          <SectionLabel>接入配置</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="接入地址" hint="API Base URL">
              <input value={form.access_url} onChange={e => upd({ access_url: e.target.value })} placeholder="https://api.example.com/v1" className={inp} />
            </Field>
            <Field label="用量记录" hint="账单/用量查看页面">
              <input value={form.usage_url} onChange={e => upd({ usage_url: e.target.value })} placeholder="https://console.example.com/usage" className={inp} />
            </Field>
          </div>
        </div>

        {/* ── 通道成本与售价 ── */}
        <div>
          <SectionLabel>通道成本与售价</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="上游成本（折）" hint="基于官方原价，如 5 = 5折">
              <input type="number" step="0.1" min="0.1" max="10" value={form.cost_discount} onChange={e => upd({ cost_discount: e.target.value })} placeholder="5" className={inp} />
            </Field>
            <Field label="加价（折）" hint="叠加在成本上，如 1 = 加1折">
              <input type="number" step="0.1" min="0" max="10" value={form.markup} onChange={e => upd({ markup: e.target.value })} placeholder="0" className={inp} />
            </Field>
          </div>
          {(() => {
            const cost = parseFloat(form.cost_discount as string)
            const mkup = parseFloat(form.markup as string)
            if (!isNaN(cost) && cost > 0) {
              const sell = cost + (isNaN(mkup) ? 0 : mkup)
              return (
                <div className="mt-2 px-3 py-2 rounded-lg bg-accent-blue/5 border border-accent-blue/20 text-[11px] text-gray-600 dark:text-gray-400 flex items-center gap-2">
                  <span>成本 <span className="font-semibold text-gray-800 dark:text-gray-200">{cost}折</span></span>
                  {!isNaN(mkup) && mkup > 0 && <><span className="text-gray-400">+</span><span>加价 <span className="font-semibold text-gray-800 dark:text-gray-200">{mkup}折</span></span></>}
                  <span className="text-gray-400">=</span>
                  <span>对外售价 <span className="font-semibold text-accent-blue">{parseFloat(sell.toFixed(1))}折</span></span>
                </div>
              )
            }
            return null
          })()}
        </div>

        {/* ── 绑定模型 ── */}
        <div>
          <SectionLabel>绑定模型</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="覆盖范围">
              <SearchableSelect options={SCOPE_TYPES.map(t => ({ value: t, label: SCOPE_TYPE_LABELS[t] }))} value={form.scope_type} onChange={v => upd({ scope_type: v === null ? 'all' : String(v), model_family: '', model_id: 0 })} />
            </Field>
            {form.scope_type === 'family' && (
              <Field label="模型系列">
                <SearchableSelect
                  options={[{ value: '', label: '请选择模型系列…' }, ...providerOptions]}
                  value={form.model_family || null}
                  onChange={v => upd({ model_family: v === null ? '' : String(v) })}
                  placeholder="选择供应商/模型系列…"
                />
              </Field>
            )}
            {form.scope_type === 'single' && (
              <Field label="绑定模型">
                <SearchableSelect options={[{ value: 0, label: '请选择模型…' }, ...modelOptions]} value={form.model_id || 0} onChange={v => upd({ model_id: (v as number) || 0 })} />
              </Field>
            )}
          </div>
        </div>

        {/* ── SLA & 技术指标 ── */}
        <div>
          <SectionLabel>SLA & 技术指标</SectionLabel>
          <div className="grid grid-cols-4 gap-3">
            <Field label="缓存命中率" hint="0~1">
              <input value={form.cache_hit_rate} onChange={e => upd({ cache_hit_rate: e.target.value })} placeholder="0.7" className={inp} />
            </Field>
            <Field label="TPM">
              <input value={form.tpm} onChange={e => upd({ tpm: e.target.value })} placeholder="10000" className={inp} />
            </Field>
            <Field label="RPM">
              <input value={form.rpm} onChange={e => upd({ rpm: e.target.value })} placeholder="60" className={inp} />
            </Field>
            <Field label="平均延迟 (ms)">
              <input value={form.avg_latency_ms} onChange={e => upd({ avg_latency_ms: e.target.value })} placeholder="800" className={inp} />
            </Field>
          </div>
        </div>

        {/* ── 备注 ── */}
        <Field label="备注" full hint="稳定性、风控要点等补充">
          <textarea value={form.remarks} onChange={e => upd({ remarks: e.target.value })} rows={2} placeholder="补充说明" className={`${inp} resize-none`} />
        </Field>

      </div>
      <ModalFooter onClose={onClose} onSave={onSave} saving={saving} tone="cyan"
        saveText={editing ? '保存修改' : '创建通道'} saveDisabled={!form.name.trim() || !form.supplier_id}
        leftHint={editing ? `编辑通道：${editing.name}` : '填写折扣后，详情面板自动实算通道成本'} />
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
      <div className="relative text-2xl md:text-[28px] font-black text-gray-900 dark:text-white leading-none tabular-nums">{value}</div>
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
    <div className="rounded-md p-2 bg-bg-hover/50">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${colors[tone]}`}>{value}</div>
    </div>
  )
}
