import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Network, Plus, X, Edit3, Trash2, Loader2, Search,
  Cpu, DollarSign, BarChart3, Building2, Activity, Key, Calendar,
  ChevronRight, ExternalLink, FileText, AlertTriangle, Hash,
} from 'lucide-react'
import { PageHeader, IconBox, EmptyState, SectionHeader, StatusBadge } from '../components/design-system'
import { useToast } from '../contexts/ToastContext'
import { apiFetch, apiPost, apiPut, apiDelete } from '../services/api'

/* ──── 类型（共享给其他页面使用） ──── */
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

const KINDS = ['官网通道', '号池', '逆向', '官方聚合', '其他']
const STATUSES = ['合作中', '暂停', '已终止']
const PRICE_UNITS: { value: string; label: string }[] = [
  { value: 'per_1k_token', label: '¥/1K tokens' },
  { value: 'per_request', label: '¥/次' },
  { value: 'per_month', label: '¥/月' },
]

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
}

const PRICE_UNIT_LABEL: Record<string, string> = {
  per_1k_token: '1K tokens',
  per_request: '次',
  per_month: '月',
}

function fmtAmt(v: number | null | undefined, unit = 'per_1k_token') {
  if (v == null) return '—'
  return `$${v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })}/${PRICE_UNIT_LABEL[unit] || unit}`
}

/** 解析 SLA JSON 字符串 */
function parseSla(json: string | null): {
  cache_hit_rate: number | null
  tpm: number | null
  rpm: number | null
  avg_latency_ms: number | null
} {
  if (!json) return { cache_hit_rate: null, tpm: null, rpm: null, avg_latency_ms: null }
  try {
    const o = JSON.parse(json)
    return {
      cache_hit_rate: typeof o.cache_hit_rate === 'number' ? o.cache_hit_rate : null,
      tpm: typeof o.tpm === 'number' ? o.tpm : null,
      rpm: typeof o.rpm === 'number' ? o.rpm : null,
      avg_latency_ms: typeof o.avg_latency_ms === 'number' ? o.avg_latency_ms : null,
    }
  } catch {
    return { cache_hit_rate: null, tpm: null, rpm: null, avg_latency_ms: null }
  }
}

/* ──── 主页面 ──── */
export default function ChannelsPage() {
  const { toast: showToast } = useToast()
  const [tab, setTab] = useState<'list' | 'summary'>('list')
  const [channels, setChannels] = useState<Channel[]>([])
  const [summaries, setSummaries] = useState<ChannelSummary[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [filterKind, setFilterKind] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterModel, setFilterModel] = useState<string>('')
  const [filterSupplier, setFilterSupplier] = useState<string>('')

  // 详情
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Channel | null>(null)

  // 表单
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)
  const [form, setForm] = useState({
    supplier_id: 0, model_type: '', name: '', code: '',
    kind: '官网通道', status: '合作中',
    cost_price: 0, price_unit: 'per_1k_token',
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
      const [chRes, sumRes, supRes] = await Promise.all([
        apiFetch<Channel[]>('/api/v1/channels'),
        apiFetch<ChannelSummary[]>('/api/v1/channels/summary/all'),
        apiFetch<Supplier[]>('/api/v1/suppliers'),
      ])
      setChannels(Array.isArray(chRes) ? chRes : [])
      setSummaries(Array.isArray(sumRes) ? sumRes : [])
      setSuppliers(Array.isArray(supRes) ? supRes : [])
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { loadAll() }, [loadAll])

  // 选中详情
  useEffect(() => {
    if (selectedId == null) { setSelected(null); return }
    const found = channels.find(c => c.id === selectedId) || null
    setSelected(found)
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

  /* ── 汇总统计 ── */
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
      cost_price: 0, price_unit: 'per_1k_token',
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
      cost_price: c.cost_price, price_unit: c.price_unit,
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
        cost_price: form.cost_price,
        price_unit: form.price_unit,
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

  return (
    <div className="px-6 py-5">
      <PageHeader
        icon={Network}
        title="通道管理"
        description="MaaS 平台所有模型通道的统一管理：官网通道 / 号池 / 逆向 / 官方聚合，支持价格、SLA、库存与活跃项目联动"
        tone="cyan"
        stats={[
          { label: '通道', value: channels.length },
          { label: '供应商', value: suppliers.length },
          { label: '活跃项目', value: summaryStats.totalActive, tone: 'green' },
        ]}
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4 border-b border-white/5">
        {[
          { key: 'list' as const, label: '通道列表', icon: Network },
          { key: 'summary' as const, label: '汇总统计', icon: BarChart3 },
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
            {/* 筛选条 */}
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

            {/* 列表 */}
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
                            {c.code && <span className="text-[10px] text-gray-500 font-mono">#{c.code}</span>}
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: kindC.bg, color: kindC.text }}>{c.kind}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: statusC.bg, color: statusC.text }}>{c.status}</span>
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
                            <span className="inline-flex items-center gap-1">
                              <DollarSign size={11} />{fmtAmt(c.cost_price, c.price_unit)}
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
                onEdit={() => openEdit(selected)}
                onDelete={() => handleDelete(selected.id)}
                deleting={deletingId === selected.id}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'summary' && (
        <SummaryView summaries={summaries} channels={channels} stats={summaryStats} />
      )}

      {/* 表单弹窗 */}
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
  channel, supplier, onEdit, onDelete, deleting, onClose,
}: {
  channel: Channel
  supplier: Supplier | undefined
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
  onClose: () => void
}) {
  const sla = parseSla(channel.sla_json)
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
        <StatBox label="成本单价" value={fmtAmt(channel.cost_price, channel.price_unit)} tone="cyan" />
        <StatBox label="折扣率" value={`${(channel.discount_rate * 100).toFixed(0)} 折`} tone="blue" />
        <StatBox label="建议加价" value={`+${(channel.suggested_markup * 100).toFixed(0)}%`} tone="orange" />
        <StatBox label="库存/在库" value={`${channel.inventory_available}/${channel.inventory_total}`} tone="green" />
        <StatBox label="活跃项目" value={`${channel.active_projects}`} tone="purple" />
        <StatBox label="当月成本" value={`$${channel.monthly_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`} tone="red" />
      </div>

      {/* 模型族 / 编码 */}
      <div className="space-y-2 text-xs">
        {channel.model_type && (
          <InfoRow icon={Hash} label="模型族" value={channel.model_type} />
        )}
        {channel.code && <InfoRow icon={Key} label="通道编码" value={channel.code} />}
        {channel.contract_start && (
          <InfoRow icon={Calendar} label="合同期" value={`${channel.contract_start} ~ ${channel.contract_end || '至今'}`} />
        )}
      </div>

      {/* SLA */}
      {(sla.cache_hit_rate != null || sla.tpm != null || sla.rpm != null || sla.avg_latency_ms != null) && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Activity size={12} />SLA & 技术指标
          </div>
          <div className="grid grid-cols-2 gap-2">
            {sla.cache_hit_rate != null && (
              <SlaBox label="缓存命中率" value={`${(sla.cache_hit_rate * 100).toFixed(1)}%`} tone="green" />
            )}
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

      {/* 操作 */}
      <div className="mt-4 pt-3 border-t border-white/5 flex gap-2">
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

function StatBox({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'blue' | 'green' | 'orange' | 'purple' | 'red' }) {
  const colors: Record<string, string> = {
    cyan: 'from-cyan-500/10 to-cyan-500/0 border-cyan-500/20 text-cyan-300',
    blue: 'from-blue-500/10 to-blue-500/0 border-blue-500/20 text-blue-300',
    green: 'from-emerald-500/10 to-emerald-500/0 border-emerald-500/20 text-emerald-300',
    orange: 'from-orange-500/10 to-orange-500/0 border-orange-500/20 text-orange-300',
    purple: 'from-violet-500/10 to-violet-500/0 border-violet-500/20 text-violet-300',
    red: 'from-rose-500/10 to-rose-500/0 border-rose-500/20 text-rose-300',
  }
  return (
    <div className={`rounded-lg p-2.5 bg-gradient-to-br ${colors[tone]} border`}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 text-base font-bold tabular-nums ${colors[tone].split(' ').pop()}`}>{value}</div>
    </div>
  )
}

function SlaBox({ label, value, tone }: { label: string; value: string; tone: 'green' | 'blue' | 'purple' | 'orange' }) {
  const colors: Record<string, string> = {
    green: 'text-emerald-400 bg-emerald-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    purple: 'text-violet-400 bg-violet-500/10',
    orange: 'text-orange-400 bg-orange-500/10',
  }
  return (
    <div className="rounded-md p-2 bg-black/20">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${colors[tone].split(' ')[0]}`}>{value}</div>
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
      {/* 总览卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BigStat label="通道总数" value={channels.length} tone="cyan" icon={Network} />
        <BigStat label="在库总位" value={stats.totalInventory} tone="blue" icon={Activity} />
        <BigStat label="活跃项目" value={stats.totalActive} tone="green" icon={BarChart3} />
        <BigStat label="当月总成本" value={`$${stats.totalMonthly.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`} tone="orange" icon={DollarSign} />
      </div>

      {/* 按类型分布 */}
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

      {/* 通道明细 */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <Cpu size={12} />通道明细
          </div>
          <span className="text-[10px] text-gray-600">共 {summaries.length} 条</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2 font-semibold">通道</th>
                <th className="px-3 py-2 font-semibold">供应商</th>
                <th className="px-3 py-2 font-semibold">类型</th>
                <th className="px-3 py-2 font-semibold">模型</th>
                <th className="px-3 py-2 font-semibold text-right">成本</th>
                <th className="px-3 py-2 font-semibold text-right">折扣</th>
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
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: kindC.bg, color: kindC.text }}>{s.kind}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-400">{s.model_type || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-cyan-300">{fmtAmt(s.cost_price, s.price_unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-300">{(s.discount_rate * 100).toFixed(0)} 折</td>
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
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-gray-900 to-gray-950 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-white/5 bg-gradient-to-r from-cyan-500/10 to-blue-500/10">
          <div className="flex items-center gap-2">
            <IconBox icon={Network} size="md" tone="cyan" />
            <div>
              <h3 className="text-sm font-bold text-white">{editing ? '编辑通道' : '新建通道'}</h3>
              <p className="text-[10px] text-gray-500">MaaS 模型供给通道</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* 基本信息 */}
          <div>
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">基本信息</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="所属供应商" required>
                <select value={form.supplier_id} onChange={e => upd({ supplier_id: parseInt(e.target.value) || 0 })}
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                  <option value={0}>请选择…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="通道名称" required>
                <input value={form.name} onChange={e => upd({ name: e.target.value })}
                  placeholder="如 AWS 通道 / CC 号池"
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
              </Field>
              <Field label="通道编码">
                <input value={form.code} onChange={e => upd({ code: e.target.value })}
                  placeholder="如 AWS-01"
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
              </Field>
              <Field label="模型族">
                <input value={form.model_type} onChange={e => upd({ model_type: e.target.value })}
                  placeholder="如 Anthropic Claude / OpenAI GPT"
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
              </Field>
              <Field label="通道类型">
                <select value={form.kind} onChange={e => upd({ kind: e.target.value })}
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                  {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="状态">
                <select value={form.status} onChange={e => upd({ status: e.target.value })}
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* 价格 */}
          <div>
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">价格与商务</div>
            <div className="grid grid-cols-4 gap-3">
              <Field label="成本单价">
                <input type="number" step="0.0001" value={form.cost_price} onChange={e => upd({ cost_price: parseFloat(e.target.value) || 0 })}
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50" />
              </Field>
              <Field label="计费单位">
                <select value={form.price_unit} onChange={e => upd({ price_unit: e.target.value })}
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50">
                  {PRICE_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </Field>
              <Field label="折扣率 (0~1)">
                <input type="number" step="0.01" min="0" max="1" value={form.discount_rate} onChange={e => upd({ discount_rate: parseFloat(e.target.value) || 1 })}
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50" />
              </Field>
              <Field label="建议加价率">
                <input type="number" step="0.01" value={form.suggested_markup} onChange={e => upd({ suggested_markup: parseFloat(e.target.value) || 0 })}
                  className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-cyan-500/50" />
              </Field>
            </div>
          </div>

          {/* 合同 & SLA */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">合同期</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="开始 (YYYY-MM)">
                  <input value={form.contract_start} onChange={e => upd({ contract_start: e.target.value })}
                    placeholder="2026-01"
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                </Field>
                <Field label="结束 (YYYY-MM)">
                  <input value={form.contract_end} onChange={e => upd({ contract_end: e.target.value })}
                    placeholder="2026-12"
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                </Field>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">SLA & 技术指标</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="缓存命中率 (0~1)">
                  <input value={form.cache_hit_rate} onChange={e => upd({ cache_hit_rate: e.target.value })}
                    placeholder="0.7"
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                </Field>
                <Field label="TPM">
                  <input value={form.tpm} onChange={e => upd({ tpm: e.target.value })}
                    placeholder="10000"
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                </Field>
                <Field label="RPM">
                  <input value={form.rpm} onChange={e => upd({ rpm: e.target.value })}
                    placeholder="60"
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                </Field>
                <Field label="平均延迟 (ms)">
                  <input value={form.avg_latency_ms} onChange={e => upd({ avg_latency_ms: e.target.value })}
                    placeholder="800"
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                </Field>
              </div>
            </div>
          </div>

          {/* 库存（仅编辑时） */}
          {editing && (
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <AlertTriangle size={11} className="text-orange-400" />库存（聚合字段，由交付/归还自动更新）
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="库存总数">
                  <input type="number" value={editing.inventory_total} disabled
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-gray-500" />
                </Field>
                <Field label="在库可用数">
                  <input type="number" value={editing.inventory_available} disabled
                    className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-gray-500" />
                </Field>
              </div>
            </div>
          )}

          {/* 备注 */}
          <Field label="备注">
            <textarea value={form.remarks} onChange={e => upd({ remarks: e.target.value })} rows={2}
              placeholder="补充说明：稳定性、SLA 等级、风控要点等"
              className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 resize-none" />
          </Field>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 p-4 border-t border-white/5 bg-gray-950/80 backdrop-blur">
          <button onClick={onClose}
            className="px-4 py-1.5 text-xs text-gray-400 hover:text-white">取消</button>
          <button onClick={onSave} disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 size={12} className="animate-spin" />}
            {editing ? '保存修改' : '创建通道'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500 mb-1 block">
        {label}{required && <span className="text-rose-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}
