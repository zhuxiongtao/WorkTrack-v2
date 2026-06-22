import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Network, Plus, X, Edit3, Trash2, Loader2, Search,
  Cpu, DollarSign, BarChart3, Building2, Activity, Key, Calendar,
  ChevronRight, FileText, AlertTriangle, Hash, BookOpen, Percent, GitBranch,
} from 'lucide-react'
import { PageHeader, IconBox, EmptyState, SectionHeader, Modal, ModalFooter, SectionLabel, Field } from '../components/design-system'
import { useToast } from '../contexts/ToastContext'
import { apiFetch, apiPost, apiPut, apiDelete } from '../services/api'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

/* ──── 类型 ──── */
export interface Channel {
  id: number
  supplier_id: number
  model_type: string
  name: string
  code: string
  kind: string
  status: string
  cost_price: number
  price_unit: string
  discount_rate: number
  suggested_markup: number
  contract_start: string | null
  contract_end: string | null
  sla_json: string | null
  inventory_total: number
  inventory_available: number
  active_projects: number
  monthly_cost: number
  remarks: string | null
  created_at: string
  updated_at: string
}
interface ChannelSummary {
  channel_id: number
  supplier_id: number
  supplier_name: string
  model_type: string
  name: string
  kind: string
  status: string
  cost_price: number
  price_unit: string
  discount_rate: number
  inventory_available: number
  active_projects: number
  monthly_cost: number
}
interface Supplier {
  id: number
  name: string
  code: string
  status: string
  settlement_currency: string
}
interface ModelCatalogItem {
  id: number
  name: string
  version_id: string | null
  provider: string | null
  region: string
  modality: string | null
  input_price: number | null
  output_price: number | null
  cache_read_price: number | null
  cache_write_price: number | null
}

const KINDS = ['官网通道', '号池', '逆向', '官方聚合', '其他']
const STATUSES = ['合作中', '暂停', '已终止']

const KIND_COLORS: Record<string, { bg: string; text: string }> = {
  '官网通道': { bg: '#3B82F615', text: '#60A5FA' },
  '号池': { bg: '#F59E0B15', text: '#FBBF24' },
  '逆向': { bg: '#EF444415', text: '#F87171' },
  '官方聚合': { bg: '#8B5CF615', text: '#A78BFA' },
  '其他': { bg: '#6B728015', text: '#9CA3AF' },
}
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  '合作中': { bg: '#10B98115', text: '#34D399' },
  '暂停': { bg: '#F59E0B15', text: '#FBBF24' },
  '已终止': { bg: '#EF444415', text: '#F87171' },
  '待确认': { bg: '#8B5CF615', text: '#A78BFA' },
}


/** 根据 channel.model_type 匹配 ModelCatalog 中的 provider 名称 */
function matchProvider(modelType: string): string | null {
  const t = modelType.toLowerCase()
  if (t.includes('claude') || t.includes('anthropic')) return 'Anthropic'
  if (t.includes('gpt') || t.includes('openai') || t.includes('o1') || t.includes('o3') || t.includes('o4')) return 'OpenAI'
  if (t.includes('gemini') || t.includes('google')) return 'Google'
  if (t.includes('deepseek')) return 'DeepSeek'
  return null
}

function fmtUSD(v: number | null | undefined) {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
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
export default function ChannelsPage() {
  const { toast: showToast } = useToast()
  const [tab, setTab] = useState<'list' | 'summary' | 'prices'>('list')
  const [channels, setChannels] = useState<Channel[]>([])
  const [summaries, setSummaries] = useState<ChannelSummary[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [prices, setPrices] = useState<ModelCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [filterKind, setFilterKind] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterModel, setFilterModel] = useState<string>('')
  const [filterSupplier, setFilterSupplier] = useState<string>('')

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Channel | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)
  const [form, setForm] = useState({
    supplier_id: 0, model_type: '', name: '', code: '',
    kind: '官网通道', status: '合作中',
    discount_rate: 1, suggested_markup: 0.2,
    contract_start: '', contract_end: '',
    cache_hit_rate: '', tpm: '', rpm: '', avg_latency_ms: '',
    inventory_total: 0, inventory_available: 0,
    remarks: '',
  })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [chRes, sumRes, supRes, priceRes] = await Promise.all([
        apiFetch<Channel[]>('/api/v1/channels'),
        apiFetch<ChannelSummary[]>('/api/v1/channels/summary/all'),
        apiFetch<Supplier[]>('/api/v1/suppliers'),
        apiFetch<ModelCatalogItem[]>('/api/v1/models'),
      ])
      setChannels(Array.isArray(chRes) ? chRes : [])
      setSummaries(Array.isArray(sumRes) ? sumRes : [])
      setSuppliers(Array.isArray(supRes) ? supRes : [])
      setPrices(Array.isArray(priceRes) ? priceRes : [])
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (selectedId == null) { setSelected(null); return }
    setSelected(channels.find(c => c.id === selectedId) || null)
  }, [selectedId, channels])

  const supplierMap = useMemo(() => {
    const m: Record<number, Supplier> = {}
    suppliers.forEach(s => { m[s.id] = s })
    return m
  }, [suppliers])

  const modelTypes = useMemo(() => {
    const set = new Set<string>()
    channels.forEach(c => { if (c.model_type) set.add(c.model_type) })
    return Array.from(set).sort()
  }, [channels])

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return channels.filter(c => {
      if (filterKind && c.kind !== filterKind) return false
      if (filterStatus && c.status !== filterStatus) return false
      if (filterModel && c.model_type !== filterModel) return false
      if (filterSupplier && String(c.supplier_id) !== filterSupplier) return false
      if (q) {
        const sup = supplierMap[c.supplier_id]
        const hay = `${c.name} ${c.code} ${c.model_type} ${sup?.name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [channels, filterKind, filterStatus, filterModel, filterSupplier, searchText, supplierMap])

  const summaryStats = useMemo(() => {
    const byKind: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    let totalInventory = 0, totalActive = 0, totalMonthly = 0
    channels.forEach(c => {
      byKind[c.kind] = (byKind[c.kind] || 0) + 1
      byStatus[c.status] = (byStatus[c.status] || 0) + 1
      totalInventory += c.inventory_total
      totalActive += c.active_projects
      totalMonthly += c.monthly_cost
    })
    return { byKind, byStatus, totalInventory, totalActive, totalMonthly }
  }, [channels])

  const openCreate = () => {
    setEditing(null)
    setForm({
      supplier_id: suppliers[0]?.id || 0,
      model_type: '', name: '', code: '',
      kind: '官网通道', status: '合作中',
      discount_rate: 1, suggested_markup: 0.2,
      contract_start: '', contract_end: '',
      cache_hit_rate: '', tpm: '', rpm: '', avg_latency_ms: '',
      inventory_total: 0, inventory_available: 0,
      remarks: '',
    })
    setShowForm(true)
  }

  const openEdit = (c: Channel) => {
    setEditing(c)
    const sla = parseSla(c.sla_json)
    setForm({
      supplier_id: c.supplier_id,
      model_type: c.model_type, name: c.name, code: c.code,
      kind: c.kind, status: c.status,
      discount_rate: c.discount_rate, suggested_markup: c.suggested_markup,
      contract_start: c.contract_start || '', contract_end: c.contract_end || '',
      cache_hit_rate: sla.cache_hit_rate?.toString() || '',
      tpm: sla.tpm?.toString() || '',
      rpm: sla.rpm?.toString() || '',
      avg_latency_ms: sla.avg_latency_ms?.toString() || '',
      inventory_total: c.inventory_total,
      inventory_available: c.inventory_available,
      remarks: c.remarks || '',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('请填写通道名称', 'error'); return }
    if (!form.supplier_id) { showToast('请选择所属供应商', 'error'); return }
    setSaving(true)
    try {
      const slaObj: Record<string, number> = {}
      const cacheHit = parseFloat(form.cache_hit_rate)
      const tpm = parseFloat(form.tpm)
      const rpm = parseFloat(form.rpm)
      const latency = parseFloat(form.avg_latency_ms)
      if (!isNaN(cacheHit)) slaObj.cache_hit_rate = cacheHit
      if (!isNaN(tpm)) slaObj.tpm = tpm
      if (!isNaN(rpm)) slaObj.rpm = rpm
      if (!isNaN(latency)) slaObj.avg_latency_ms = latency

      const payload = {
        supplier_id: form.supplier_id,
        model_type: form.model_type,
        name: form.name,
        code: form.code,
        kind: form.kind,
        status: form.status,
        discount_rate: form.discount_rate,
        suggested_markup: form.suggested_markup,
        contract_start: form.contract_start || null,
        contract_end: form.contract_end || null,
        sla_json: Object.keys(slaObj).length > 0 ? JSON.stringify(slaObj) : null,
        remarks: form.remarks || null,
      }
      if (editing) {
        await apiPut(`/api/v1/channels/${editing.id}`, payload)
        showToast('通道已更新', 'success')
      } else {
        await apiPost('/api/v1/channels', payload)
        showToast('通道已创建', 'success')
      }
      setShowForm(false)
      await loadAll()
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除该通道？删除后无法恢复。')) return
    setDeletingId(id)
    try {
      await apiDelete(`/api/v1/channels/${id}`)
      showToast('已删除', 'success')
      if (selectedId === id) setSelectedId(null)
      await loadAll()
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const [submittingApproval, setSubmittingApproval] = useState(false)
  const handleSubmitPriceApproval = async (channel: Channel) => {
    setSubmittingApproval(true)
    try {
      const res = await fetch(`/api/v1/channels/${channel.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); showToast(e.detail || '提交失败', 'error'); return }
      showToast('已提交价格变更审批', 'success')
      await loadAll()
    } catch { showToast('提交失败', 'error') } finally { setSubmittingApproval(false) }
  }

  return (
    <div className="px-6 py-5">
      <PageHeader
        icon={Network}
        title="通道管理"
        description="MaaS 平台所有模型通道的统一管理：官网通道 / 号池 / 逆向 / 官方聚合，价格以官网定价为基准，通道管理折扣率"
        tone="cyan"
        stats={[
          { label: '通道', value: channels.length },
          { label: '供应商', value: suppliers.length },
          { label: '活跃项目', value: summaryStats.totalActive, tone: 'green' },
          { label: '参考模型', value: prices.length, tone: 'purple' },
        ]}
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4 border-b border-white/5">
        {[
          { key: 'list' as const, label: '通道列表', icon: Network },
          { key: 'summary' as const, label: '汇总统计', icon: BarChart3 },
          { key: 'prices' as const, label: '官方参考价格', icon: BookOpen },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              tab === t.key ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <t.icon size={14} />
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <div className="grid grid-cols-12 gap-4">
          {/* 左：筛选 + 列表 */}
          <div className={`${selectedId ? 'col-span-12 lg:col-span-7' : 'col-span-12'} space-y-3`}>
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5">
              <div className="relative flex-1 min-w-[160px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="搜索通道名 / 编码 / 模型 / 供应商"
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
                className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                <option value="">全部供应商</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={filterKind} onChange={e => setFilterKind(e.target.value)}
                className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                <option value="">全部类型</option>
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <select value={filterModel} onChange={e => setFilterModel(e.target.value)}
                className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                <option value="">全部模型</option>
                {modelTypes.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                <option value="">全部状态</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={openCreate}
                className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg hover:opacity-90">
                <Plus size={14} /> 新建通道
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-500">
                <Loader2 size={18} className="animate-spin mr-2" />加载中…
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Network}
                title="还没有通道"
                description="新建第一条通道，开始管理你的 MaaS 模型供给"
                actionLabel="新建通道"
                onAction={openCreate}
                tone="cyan"
              />
            ) : (
              <div className="space-y-2">
                {filtered.map(c => {
                  const sup = supplierMap[c.supplier_id]
                  const kindC = KIND_COLORS[c.kind] || KIND_COLORS['其他']
                  const statusC = STATUS_COLORS[c.status] || STATUS_COLORS['合作中']
                  const active = selectedId === c.id
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(active ? null : c.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        active
                          ? 'bg-cyan-500/10 border-cyan-500/40 shadow-lg shadow-cyan-500/5'
                          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <IconBox icon={Cpu} size="md" tone="cyan" variant="soft" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-white">{c.name}</span>
                            {c.code && <span className="text-[11px] text-gray-500 font-mono">#{c.code}</span>}
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: kindC.bg, color: kindC.text }}>{c.kind}</span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: statusC.bg, color: statusC.text }}>{c.status}</span>
                          </div>
                          <div className="mt-1.5 text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <Building2 size={11} />{sup?.name || '—'}
                            </span>
                            {c.model_type && (
                              <span className="inline-flex items-center gap-1">
                                <Hash size={11} />{c.model_type}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-blue-300/80">
                              <Percent size={11} />折扣率 {(c.discount_rate * 100).toFixed(0)}%
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Activity size={11} />{c.active_projects} 个活跃项目
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={16} className={`text-gray-600 transition-transform ${active ? 'rotate-90 text-cyan-400' : ''}`} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 右：详情 */}
          {selectedId && selected && (
            <div className="col-span-12 lg:col-span-5">
              <ChannelDetailPanel
                channel={selected}
                supplier={supplierMap[selected.supplier_id]}
                prices={prices}
                onEdit={() => openEdit(selected)}
                onDelete={() => handleDelete(selected.id)}
                deleting={deletingId === selected.id}
                onClose={() => setSelectedId(null)}
                onSubmitApproval={() => handleSubmitPriceApproval(selected)}
                submittingApproval={submittingApproval}
                onApprovalChanged={loadAll}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'summary' && (
        <SummaryView summaries={summaries} channels={channels} stats={summaryStats} />
      )}

      {tab === 'prices' && (
        <PriceRefTab prices={prices} channels={channels} loading={loading} />
      )}

      {showForm && (
        <ChannelFormModal
          form={form}
          setForm={setForm}
          suppliers={suppliers}
          editing={editing}
          saving={saving}
          onClose={() => setShowForm(false)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

/* ──── 详情面板 ──── */
function ChannelDetailPanel({
  channel, supplier, prices, onEdit, onDelete, deleting, onClose, onSubmitApproval, submittingApproval, onApprovalChanged,
}: {
  channel: Channel
  supplier: Supplier | undefined
  prices: ModelCatalogItem[]
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
  onClose: () => void
  onSubmitApproval: () => void
  submittingApproval: boolean
  onApprovalChanged: () => void
}) {
  const sla = parseSla(channel.sla_json)

  // 匹配该通道对应的模型族价格（只展示有定价的模型）
  const provider = matchProvider(channel.model_type)
  const familyPrices = prices
    .filter(p => provider && p.provider === provider && (p.input_price != null || p.output_price != null))
    .slice(0, 4)

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.04] to-blue-500/[0.04] p-4 sticky top-4">
      <div className="flex items-start justify-between mb-3">
        <SectionHeader
          icon={Cpu}
          title={channel.name}
          description={`${supplier?.name || '—'} · ${channel.kind}`}
          tone="cyan"
        />
        <button onClick={onClose} className="text-gray-500 hover:text-white">
          <X size={16} />
        </button>
      </div>

      {/* 关键指标 */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <StatBox label="折扣率" value={`${(channel.discount_rate * 100).toFixed(0)}%`} sub="相较官网定价" tone="blue" />
        <StatBox label="建议加价" value={`+${(channel.suggested_markup * 100).toFixed(0)}%`} sub="含成本后加价率" tone="orange" />
        <StatBox label="库存/在库" value={`${channel.inventory_available}/${channel.inventory_total}`} tone="green" />
        <StatBox label="活跃项目" value={`${channel.active_projects}`} tone="purple" />
        <StatBox label="当月成本" value={`$${channel.monthly_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`} tone="red" />
      </div>

      {/* 模型族 / 编码 */}
      <div className="space-y-2 text-xs">
        {channel.model_type && <InfoRow icon={Hash} label="模型族" value={channel.model_type} />}
        {channel.code && <InfoRow icon={Key} label="通道编码" value={channel.code} />}
        {channel.contract_start && (
          <InfoRow icon={Calendar} label="合同期" value={`${channel.contract_start} ~ ${channel.contract_end || '至今'}`} />
        )}
      </div>

      {/* 该族官方价格 × 折扣率 参考 */}
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
                  {p.input_price != null && (
                    <span className="text-emerald-400">
                      输入 {fmtUSD(p.input_price * channel.discount_rate)}/1M
                    </span>
                  )}
                  {p.output_price != null && (
                    <span className="text-orange-400">
                      输出 {fmtUSD(p.output_price * channel.discount_rate)}/1M
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-600">官网价 × 折扣率，仅作成本估算参考</p>
        </div>
      )}

      {/* SLA */}
      {(sla.cache_hit_rate != null || sla.tpm != null || sla.rpm != null || sla.avg_latency_ms != null) && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Activity size={12} />SLA & 技术指标
          </div>
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
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <FileText size={12} />备注
          </div>
          <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{channel.remarks}</p>
        </div>
      )}

      {/* 审批进度（价格变更待确认状态） */}
      {channel.status === '待确认' && (
        <div className="mt-3">
          <ApprovalTimeline
            targetType="channel"
            targetId={channel.id}
            onChanged={onApprovalChanged}
          />
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-white/5 flex gap-2 flex-wrap">
        {channel.status === '合作中' && (
          <button
            onClick={onSubmitApproval}
            disabled={submittingApproval}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg disabled:opacity-50"
          >
            {submittingApproval ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />}
            提交价格变更审批
          </button>
        )}
        <button onClick={onEdit}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 rounded-lg">
          <Edit3 size={13} />编辑
        </button>
        <button onClick={onDelete} disabled={deleting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg disabled:opacity-50">
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          删除
        </button>
      </div>
    </div>
  )
}

/* ──── 官方参考价格 Tab ──── */
function PriceRefTab({ prices, channels, loading }: {
  prices: ModelCatalogItem[]
  channels: Channel[]
  loading: boolean
}) {
  const [providerFilter, setProviderFilter] = useState<string>('all')

  // 只显示有定价的模型
  const priced = useMemo(() =>
    prices.filter(p => p.input_price != null || p.output_price != null),
    [prices]
  )

  const providers = useMemo(() => {
    const set = new Set<string>()
    priced.forEach(p => p.provider && set.add(p.provider))
    return Array.from(set).sort()
  }, [priced])

  const displayed = useMemo(() =>
    providerFilter === 'all' ? priced : priced.filter(p => p.provider === providerFilter),
    [priced, providerFilter]
  )

  // 按 provider 分组
  const grouped = useMemo(() => {
    const g: Record<string, ModelCatalogItem[]> = {}
    displayed.forEach(p => {
      const key = p.provider || '其他'
      if (!g[key]) g[key] = []
      g[key].push(p)
    })
    return g
  }, [displayed])

  // 每个 provider 对应的关联通道
  const channelsByProvider = useMemo(() => {
    const m: Record<string, Channel[]> = {}
    channels.forEach(c => {
      const prov = matchProvider(c.model_type)
      if (prov) {
        if (!m[prov]) m[prov] = []
        m[prov].push(c)
      }
    })
    return m
  }, [channels])

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 size={18} className="animate-spin mr-2" />加载中…</div>
  }
  if (priced.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="暂无定价信息"
        description="请前往「管理后台 → 模型管理」激活模型并编辑官网定价（输入价 / 输出价）"
        tone="cyan"
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 说明 + 筛选 */}
      <div className="flex items-center justify-between flex-wrap gap-3 p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
        <div className="text-[11px] text-blue-300/80 leading-relaxed">
          <span className="font-bold text-blue-300">价格来源：</span>
          官网公开定价（USD/1M tokens），在「管理后台 → 模型管理」中手动维护。通道折扣率 × 官网价 = 预估采购成本。
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={() => setProviderFilter('all')}
            className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors border ${providerFilter === 'all' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'text-gray-500 hover:text-gray-300 border-transparent'}`}
          >全部</button>
          {providers.map(prov => (
            <button
              key={prov}
              onClick={() => setProviderFilter(prov)}
              className={`px-3 py-1 text-xs rounded-lg font-semibold transition-colors border ${providerFilter === prov ? 'bg-white/10 text-white border-white/20' : 'text-gray-500 hover:text-gray-300 border-transparent'}`}
            >{prov}</button>
          ))}
        </div>
      </div>

      {/* 按 provider 分组展示 */}
      <div className="space-y-6">
        {Object.entries(grouped).map(([prov, models]) => {
          const linkedChannels = channelsByProvider[prov] || []
          return (
            <div key={prov}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{prov}</span>
                  <span className="text-[11px] text-gray-600 px-2 py-0.5 rounded-full bg-white/5">{models.length} 个模型</span>
                </div>
                {linkedChannels.length > 0 && (
                  <span className="text-[11px] text-gray-500 flex items-center gap-1 flex-wrap">
                    <Network size={10} />{linkedChannels.length} 条通道关联：
                    {linkedChannels.map(c => (
                      <span key={c.id} className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-cyan-500/10 text-cyan-300">
                        {c.name} {(c.discount_rate * 100).toFixed(0)}%折
                      </span>
                    ))}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wider bg-white/[0.02]">
                        <th className="px-4 py-2.5 font-semibold">模型</th>
                        <th className="px-4 py-2.5 font-semibold text-right">输入 $/1M</th>
                        <th className="px-4 py-2.5 font-semibold text-right">输出 $/1M</th>
                        <th className="px-4 py-2.5 font-semibold text-right">缓存读取</th>
                        <th className="px-4 py-2.5 font-semibold text-right">缓存写入</th>
                        {linkedChannels.map(c => (
                          <th key={c.id} className="px-4 py-2.5 font-semibold text-right text-cyan-400">
                            {c.name}<br />
                            <span className="text-[11px] font-normal text-gray-500">×{(c.discount_rate * 100).toFixed(0)}%</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((m, i) => (
                        <tr key={m.id} className={`border-t ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`} style={{ borderColor: '#ffffff08' }}>
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-white">{m.name}</div>
                            {m.version_id && <div className="text-[11px] text-gray-600 font-mono">{m.version_id}</div>}
                          </td>
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
  )
}

/* ──── 汇总视图 ──── */
function SummaryView({
  summaries, channels, stats,
}: {
  summaries: ChannelSummary[]
  channels: Channel[]
  stats: { byKind: Record<string, number>; byStatus: Record<string, number>; totalInventory: number; totalActive: number; totalMonthly: number }
}) {
  if (channels.length === 0) {
    return <EmptyState icon={BarChart3} title="暂无汇总数据" description="新建通道后将自动生成汇总统计" tone="cyan" />
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BigStat label="通道总数" value={channels.length} tone="cyan" icon={Network} />
        <BigStat label="在库总位" value={stats.totalInventory} tone="blue" icon={Activity} />
        <BigStat label="活跃项目" value={stats.totalActive} tone="green" icon={BarChart3} />
        <BigStat label="当月总成本" value={`$${stats.totalMonthly.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`} tone="orange" icon={DollarSign} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1">
            <Network size={12} />按通道类型
          </div>
          <div className="space-y-2">
            {Object.entries(stats.byKind).map(([k, n]) => {
              const c = KIND_COLORS[k] || KIND_COLORS['其他']
              const pct = channels.length > 0 ? (n / channels.length * 100) : 0
              return (
                <div key={k}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: c.text }} className="font-semibold">{k}</span>
                    <span className="text-gray-500 tabular-nums">{n} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.text }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1">
            <Activity size={12} />按状态
          </div>
          <div className="space-y-2">
            {Object.entries(stats.byStatus).map(([s, n]) => {
              const c = STATUS_COLORS[s] || STATUS_COLORS['合作中']
              const pct = channels.length > 0 ? (n / channels.length * 100) : 0
              return (
                <div key={s}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: c.text }} className="font-semibold">{s}</span>
                    <span className="text-gray-500 tabular-nums">{n} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.text }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <Cpu size={12} />通道明细
          </div>
          <span className="text-[11px] text-gray-600">共 {summaries.length} 条</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2 font-semibold">通道</th>
                <th className="px-3 py-2 font-semibold">供应商</th>
                <th className="px-3 py-2 font-semibold">类型</th>
                <th className="px-3 py-2 font-semibold">模型</th>
                <th className="px-3 py-2 font-semibold text-right">折扣率</th>
                <th className="px-3 py-2 font-semibold text-right">在库</th>
                <th className="px-3 py-2 font-semibold text-right">活跃</th>
                <th className="px-3 py-2 font-semibold text-right">当月成本</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => {
                const kindC = KIND_COLORS[s.kind] || KIND_COLORS['其他']
                return (
                  <tr key={s.channel_id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-white font-semibold">{s.name}</td>
                    <td className="px-3 py-2 text-gray-400">{s.supplier_name}</td>
                    <td className="px-3 py-2">
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: kindC.bg, color: kindC.text }}>{s.kind}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-400">{s.model_type || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-300">{(s.discount_rate * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{s.inventory_available}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-violet-300">{s.active_projects}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-300">${s.monthly_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ──── 小组件 ──── */
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
  const colors: Record<string, string> = {
    green: 'text-emerald-400', blue: 'text-blue-400', purple: 'text-violet-400', orange: 'text-orange-400',
  }
  return (
    <div className="rounded-md p-2 bg-black/20">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${colors[tone]}`}>{value}</div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className="text-gray-500" />
      <span className="text-gray-500">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  )
}

function BigStat({ label, value, tone, icon: Icon }: { label: string; value: string | number; tone: 'cyan' | 'blue' | 'green' | 'orange'; icon: typeof Network }) {
  const colors: Record<string, string> = {
    cyan: 'from-cyan-500/10 to-cyan-500/0 border-cyan-500/20',
    blue: 'from-blue-500/10 to-blue-500/0 border-blue-500/20',
    green: 'from-emerald-500/10 to-emerald-500/0 border-emerald-500/20',
    orange: 'from-orange-500/10 to-orange-500/0 border-orange-500/20',
  }
  const textColor: Record<string, string> = {
    cyan: 'text-cyan-400', blue: 'text-blue-400', green: 'text-emerald-400', orange: 'text-orange-400',
  }
  return (
    <div className={`relative overflow-hidden rounded-xl p-4 bg-gradient-to-br ${colors[tone]} border`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={textColor[tone]} />
        <span className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${textColor[tone]}`}>{value}</div>
    </div>
  )
}

/* ──── 表单弹窗 ──── */
function ChannelFormModal({
  form, setForm, suppliers, editing, saving, onClose, onSave,
}: {
  form: any
  setForm: (f: any) => void
  suppliers: Supplier[]
  editing: Channel | null
  saving: boolean
  onClose: () => void
  onSave: () => void
}) {
  const upd = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })

  return (
    <Modal
      icon={Network}
      title={editing ? '编辑通道' : '新建通道'}
      subtitle="MaaS 模型供给通道 · 折扣率 / 合同 / SLA 一站配置"
      tone="cyan"
      size="3xl"
      onClose={onClose}
    >
      <div className="space-y-5">
        {/* 基本信息 */}
        <div>
          <SectionLabel>基本信息</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="所属供应商" required>
              <select value={form.supplier_id} onChange={e => upd({ supplier_id: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all">
                <option value={0}>请选择…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="通道名称" required>
              <input value={form.name} onChange={e => upd({ name: e.target.value })}
                placeholder="如 AWS 通道 / CC 号池"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
            </Field>
            <Field label="通道编码" hint="如 AWS-01">
              <input value={form.code} onChange={e => upd({ code: e.target.value })}
                placeholder="AWS-01"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
            </Field>
            <Field label="模型族" hint="如 Anthropic Claude / OpenAI GPT">
              <input value={form.model_type} onChange={e => upd({ model_type: e.target.value })}
                placeholder="Anthropic Claude / OpenAI GPT"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
            </Field>
            <Field label="通道类型">
              <select value={form.kind} onChange={e => upd({ kind: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all">
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="状态">
              <select value={form.status} onChange={e => upd({ status: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {/* 价格与商务：只保留折扣率和加价率 */}
        <div>
          <SectionLabel>价格与商务</SectionLabel>
          <div className="mb-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[11px] text-blue-300/80">
            通道成本 = 官方模型定价 × 折扣率（见「官方参考价格」页签），无需手动填写单价。
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="折扣率" hint="0~1，如 0.85 表示 85 折">
              <input type="number" step="0.01" min="0" max="1" value={form.discount_rate}
                onChange={e => upd({ discount_rate: parseFloat(e.target.value) || 1 })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
            </Field>
            <Field label="建议加价率" hint="如 0.2 = 在成本上加 20%">
              <input type="number" step="0.01" value={form.suggested_markup}
                onChange={e => upd({ suggested_markup: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
            </Field>
          </div>
        </div>

        {/* 合同 & SLA */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <SectionLabel>合同期</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始" hint="YYYY-MM">
                <input value={form.contract_start} onChange={e => upd({ contract_start: e.target.value })}
                  placeholder="2026-01"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
              </Field>
              <Field label="结束" hint="YYYY-MM">
                <input value={form.contract_end} onChange={e => upd({ contract_end: e.target.value })}
                  placeholder="2026-12"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
              </Field>
            </div>
          </div>
          <div>
            <SectionLabel>SLA & 技术指标</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="缓存命中率" hint="0~1">
                <input value={form.cache_hit_rate} onChange={e => upd({ cache_hit_rate: e.target.value })}
                  placeholder="0.7"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
              </Field>
              <Field label="TPM">
                <input value={form.tpm} onChange={e => upd({ tpm: e.target.value })}
                  placeholder="10000"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
              </Field>
              <Field label="RPM">
                <input value={form.rpm} onChange={e => upd({ rpm: e.target.value })}
                  placeholder="60"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
              </Field>
              <Field label="平均延迟" hint="ms">
                <input value={form.avg_latency_ms} onChange={e => upd({ avg_latency_ms: e.target.value })}
                  placeholder="800"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all" />
              </Field>
            </div>
          </div>
        </div>

        {/* 库存（仅编辑时只读展示） */}
        {editing && (
          <div>
            <SectionLabel>
              <AlertTriangle size={11} className="text-orange-400" />
              库存（聚合字段，由交付/归还自动更新）
            </SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <Field label="库存总数">
                <input type="number" value={editing.inventory_total} disabled
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-500 cursor-not-allowed" />
              </Field>
              <Field label="在库可用数">
                <input type="number" value={editing.inventory_available} disabled
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-500 cursor-not-allowed" />
              </Field>
            </div>
          </div>
        )}

        <Field label="备注" full hint="补充说明：稳定性、SLA 等级、风控要点等">
          <textarea value={form.remarks} onChange={e => upd({ remarks: e.target.value })} rows={2}
            placeholder="补充说明：稳定性、SLA 等级、风控要点等"
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-[#06B6D4] focus:ring-2 focus:ring-[#06B6D4]/15 transition-all resize-none" />
        </Field>
      </div>

      <ModalFooter
        onClose={onClose}
        onSave={onSave}
        saving={saving}
        tone="cyan"
        saveText={editing ? '保存修改' : '创建通道'}
        saveDisabled={!form.name.trim() || !form.supplier_id}
        leftHint={editing ? `编辑通道：${editing.name}` : '成本 = 官方定价 × 折扣率，无需手动填写单价'}
      />
    </Modal>
  )
}
