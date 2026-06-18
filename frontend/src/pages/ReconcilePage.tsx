import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Calculator, Plus, X, Edit3, Trash2, Loader2, Search,
  TrendingUp, TrendingDown, Briefcase, Network, BarChart3, AlertTriangle,
  FileText, RefreshCw, Calendar, DollarSign, Activity, Hash,
  CheckCircle2, Clock, AlertCircle, FileBarChart,
} from 'lucide-react'
import { PageHeader, IconBox, EmptyState, SectionHeader, Modal, ModalFooter, SectionLabel, Field } from '../components/design-system'
import { useToast } from '../contexts/ToastContext'
import { apiFetch, apiPost, apiPut, apiDelete } from '../services/api'

/* ──── 类型 ──── */
interface Project { id: number; name: string; customer_name?: string | null; currency?: string }
interface Channel { id: number; name: string; supplier_id: number; cost_price: number; price_unit: string; kind: string }
interface Supplier { id: number; name: string; settlement_currency: string }

interface SalesRecord {
  id: number; project_id: number; period: string; customer_name: string
  call_volume: number; call_volume_unit: string
  final_price: number; amount_due: number
  invoice_status: string; diff_amount: number; remarks: string | null
  created_at: string; updated_at: string
}
interface SupplyRecord {
  id: number; channel_id: number; supplier_id: number; period: string
  call_volume: number; call_volume_unit: string
  cost_price: number; amount_payable: number
  bill_status: string; diff_amount: number; remarks: string | null
  created_at: string; updated_at: string
}
interface SummaryRecord {
  id: number; period: string
  total_revenue: number; invoice_count: number
  total_cost: number; paid_count: number; test_cost: number
  gross_profit: number; final_profit: number; gross_margin: number | null
  status: string; finalized_at: string | null; remarks: string | null
  created_at: string; updated_at: string
}
interface DiffRecord {
  id: number; period: string
  project_id: number | null; channel_id: number | null
  diff_type: string
  sales_call_volume: number; supply_call_volume: number
  diff_volume: number; diff_amount: number; diff_pct: number | null
  reason: string | null; resolution: string | null
  status: string; created_at: string; updated_at: string
}
interface OverallSummary {
  period: string
  total_revenue: number; total_cost: number; gross_profit: number; gross_margin: number | null
  invoice_count: number; paid_count: number; diff_count: number; diff_amount_total: number
  by_invoice_status: Record<string, number>
  by_bill_status: Record<string, number>
  by_diff_type: Record<string, number>
}

const SALES_STATUS = ['待开票', '已开票', '已收款', '争议']
const SUPPLY_STATUS = ['待付款', '已收票', '已付款', '争议']
const DIFF_TYPES = ['调用量差异', '报价差异', '厂商账单差异']
const DIFF_STATUS = ['未处理', '已解释', '已处理', '已结案']
const SUMMARY_STATUS = ['草稿', '已复核', '已锁定']

const INVOICE_COLORS: Record<string, { bg: string; text: string }> = {
  '待开票': { bg: '#6B728015', text: '#9CA3AF' },
  '已开票': { bg: '#3B82F615', text: '#60A5FA' },
  '已收款': { bg: '#10B98115', text: '#34D399' },
  '争议': { bg: '#EF444415', text: '#F87171' },
}
const BILL_COLORS: Record<string, { bg: string; text: string }> = {
  '待付款': { bg: '#6B728015', text: '#9CA3AF' },
  '已收票': { bg: '#3B82F615', text: '#60A5FA' },
  '已付款': { bg: '#10B98115', text: '#34D399' },
  '争议': { bg: '#EF444415', text: '#F87171' },
}
const DIFF_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  '未处理': { bg: '#EF444415', text: '#F87171' },
  '已解释': { bg: '#3B82F615', text: '#60A5FA' },
  '已处理': { bg: '#F59E0B15', text: '#FBBF24' },
  '已结案': { bg: '#10B98115', text: '#34D399' },
}
const SUMMARY_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  '草稿': { bg: '#6B728015', text: '#9CA3AF' },
  '已复核': { bg: '#3B82F615', text: '#60A5FA' },
  '已锁定': { bg: '#10B98115', text: '#34D399' },
}

function fmt(v: number | null | undefined) {
  if (v == null) return '—'
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** 计费单位短标签（表格内展示用） */
const UNIT_SHORT: Record<string, string> = {
  per_1k_token: '1K',
  per_1m_token: '1M',
  per_request: '次',
  per_month: '月',
}
function unitLabel(unit: string): string {
  return UNIT_SHORT[unit] || unit
}

/** 提取默认对账月份：上个月 YYYY-MM */
function defaultPeriod(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function periodList(): string[] {
  const out: string[] = []
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    out.push(`${y}-${m}`)
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

/* ──── 主页面 ──── */
type Tab = 'overview' | 'sales' | 'supply' | 'summary' | 'diff'

export default function ReconcilePage() {
  const { toast: showToast } = useToast()
  const [tab, setTab] = useState<Tab>('overview')

  // 全局数据
  const [projects, setProjects] = useState<Project[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [period, setPeriod] = useState<string>(defaultPeriod())
  const [overall, setOverall] = useState<OverallSummary | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)

  // sales / supply / diff 数据
  const [sales, setSales] = useState<SalesRecord[]>([])
  const [supply, setSupply] = useState<SupplyRecord[]>([])
  const [diff, setDiff] = useState<DiffRecord[]>([])
  const [summary, setSummary] = useState<SummaryRecord[]>([])

  const [loading, setLoading] = useState(false)

  // 表单
  const [showSalesForm, setShowSalesForm] = useState(false)
  const [editingSales, setEditingSales] = useState<SalesRecord | null>(null)
  const [showSupplyForm, setShowSupplyForm] = useState(false)
  const [editingSupply, setEditingSupply] = useState<SupplyRecord | null>(null)
  const [showDiffForm, setShowDiffForm] = useState(false)
  const [editingDiff, setEditingDiff] = useState<DiffRecord | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [submittingReview, setSubmittingReview] = useState(false)

  // 加载基础数据
  const loadBase = useCallback(async () => {
    try {
      const [projs, chs, sups, ps] = await Promise.all([
        apiFetch<Project[]>('/api/v1/projects').catch(() => []),
        apiFetch<Channel[]>('/api/v1/channels').catch(() => []),
        apiFetch<Supplier[]>('/api/v1/suppliers').catch(() => []),
        apiFetch<string[]>('/api/v1/reconcile/periods').catch(() => []),
      ])
      setProjects(Array.isArray(projs) ? projs : [])
      setChannels(Array.isArray(chs) ? chs : [])
      setSuppliers(Array.isArray(sups) ? sups : [])
      const periodSet = new Set<string>([...periodList(), ...(Array.isArray(ps) ? ps : [])])
      setPeriods(Array.from(periodSet).sort().reverse())
    } catch { /* ignore */ }
  }, [])

  const loadOverall = useCallback(async () => {
    if (!period) return
    setOverviewLoading(true)
    try {
      const o = await apiFetch<OverallSummary>(`/api/v1/reconcile/overall/${period}`)
      setOverall(o)
    } catch {
      setOverall(null)
    } finally {
      setOverviewLoading(false)
    }
  }, [period])

  const loadSales = useCallback(async () => {
    if (!period) return
    try {
      const list = await apiFetch<SalesRecord[]>(`/api/v1/reconcile/sales?period=${period}`)
      setSales(Array.isArray(list) ? list : [])
    } catch { setSales([]) }
  }, [period])

  const loadSupply = useCallback(async () => {
    if (!period) return
    try {
      const list = await apiFetch<SupplyRecord[]>(`/api/v1/reconcile/supply?period=${period}`)
      setSupply(Array.isArray(list) ? list : [])
    } catch { setSupply([]) }
  }, [period])

  const loadDiff = useCallback(async () => {
    if (!period) return
    try {
      const list = await apiFetch<DiffRecord[]>(`/api/v1/reconcile/diff?period=${period}`)
      setDiff(Array.isArray(list) ? list : [])
    } catch { setDiff([]) }
  }, [period])

  const loadSummary = useCallback(async () => {
    try {
      const list = await apiFetch<SummaryRecord[]>('/api/v1/reconcile/summary')
      setSummary(Array.isArray(list) ? list : [])
    } catch { setSummary([]) }
  }, [])

  useEffect(() => { loadBase() }, [loadBase])
  useEffect(() => { loadOverall(); loadSummary() }, [loadOverall, loadSummary])
  useEffect(() => {
    if (tab === 'overview') loadOverall()
    if (tab === 'sales') loadSales()
    if (tab === 'supply') loadSupply()
    if (tab === 'summary') loadSummary()
    if (tab === 'diff') loadDiff()
  }, [tab, loadOverall, loadSales, loadSupply, loadSummary, loadDiff])

  // 当期总账状态（用于按钮显隐和锁定提示）
  const currentSummary = useMemo(
    () => summary.find(s => s.period === period) ?? null,
    [summary, period]
  )
  const periodLocked = currentSummary ? ['已复核', '已锁定'].includes(currentSummary.status) : false

  // 重新计算
  const handleCalculate = async () => {
    if (!period) return
    setCalculating(true)
    try {
      await apiPost(`/api/v1/reconcile/summary/calculate/${period}`, {})
      showToast(`${period} 总账已重新计算`, 'success')
      loadOverall()
      loadSummary()
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setCalculating(false)
    }
  }

  // 提交月结复核
  const handleSubmitReview = async () => {
    if (!period) return
    setSubmittingReview(true)
    try {
      const res = await apiPost<{ message: string; status: string; approval_instance_id: number | null }>(
        `/api/v1/reconcile/summary/${period}/submit-review`, {}
      )
      showToast(res.message ?? '已提交复核', 'success')
      loadSummary()
      setTab('summary')
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setSubmittingReview(false)
    }
  }

  // 项目 / 通道 / 供应商 索引
  const projectMap = useMemo(() => {
    const m: Record<number, Project> = {}
    projects.forEach(p => { m[p.id] = p })
    return m
  }, [projects])
  const channelMap = useMemo(() => {
    const m: Record<number, Channel> = {}
    channels.forEach(c => { m[c.id] = c })
    return m
  }, [channels])
  const supplierMap = useMemo(() => {
    const m: Record<number, Supplier> = {}
    suppliers.forEach(s => { m[s.id] = s })
    return m
  }, [suppliers])

  return (
    <div className="px-6 py-5">
      <PageHeader
        icon={Calculator}
        title="对账核算"
        description="按月汇总销售应收 / 供应应付 / 财务总账 / 差异分析，达成业务闭环：供应商 → 通道 → 项目 → 交付 → 对账"
        tone="purple"
        right={
          <div className="flex items-center gap-2">
            <select value={period} onChange={e => setPeriod(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
              {periods.length === 0 ? <option value={period}>{period}</option> : periods.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {currentSummary && (
              <span className="inline-flex items-center px-2 py-1 text-[10px] font-bold rounded-md"
                style={{ background: (SUMMARY_STATUS_COLORS[currentSummary.status] || SUMMARY_STATUS_COLORS['草稿']).bg, color: (SUMMARY_STATUS_COLORS[currentSummary.status] || SUMMARY_STATUS_COLORS['草稿']).text }}>
                {currentSummary.status}
              </span>
            )}
            {!periodLocked && (
              <button onClick={handleCalculate} disabled={calculating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-indigo-500 rounded-lg hover:opacity-90 disabled:opacity-50">
                {calculating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                生成 {period} 总账
              </button>
            )}
            {currentSummary && currentSummary.status === '草稿' && (
              <button onClick={handleSubmitReview} disabled={submittingReview}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg hover:opacity-90 disabled:opacity-50">
                {submittingReview ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                提交复核
              </button>
            )}
            {currentSummary && currentSummary.status === '已复核' && (
              <button onClick={() => { window.location.href = '/approvals' }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-300 border border-blue-500/30 bg-blue-500/10 rounded-lg hover:bg-blue-500/20">
                <Clock size={12} />
                查看审批进度
              </button>
            )}
          </div>
        }
        stats={[
          { label: '对账月份', value: period, tone: 'purple' },
          { label: '应收', value: overall ? `$${fmt(overall.total_revenue)}` : '—', tone: 'green' },
          { label: '应付', value: overall ? `$${fmt(overall.total_cost)}` : '—', tone: 'red' },
          { label: '毛利', value: overall ? `$${fmt(overall.gross_profit)}` : '—', tone: overall && overall.gross_profit > 0 ? 'green' : 'red' },
        ]}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-white/5 overflow-x-auto">
        {[
          { key: 'overview' as const, label: '总览', icon: BarChart3 },
          { key: 'sales' as const, label: '销售对账', icon: TrendingUp },
          { key: 'supply' as const, label: '供应对账', icon: TrendingDown },
          { key: 'summary' as const, label: '财务总账', icon: FileBarChart },
          { key: 'diff' as const, label: '差异分析', icon: AlertTriangle },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-3 py-2.5 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              tab === t.key ? 'text-purple-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <t.icon size={14} />
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <OverviewView
          overall={overall}
          period={period}
          loading={overviewLoading}
          sales={sales}
          supply={supply}
          diff={diff}
          projectMap={projectMap}
          channelMap={channelMap}
          supplierMap={supplierMap}
        />
      )}

      {tab === 'sales' && (
        <SalesView
          records={sales}
          period={period}
          projects={projects}
          projectMap={projectMap}
          loading={loading}
          readOnly={periodLocked}
          onAdd={() => { setEditingSales(null); setShowSalesForm(true) }}
          onEdit={(r) => { setEditingSales(r); setShowSalesForm(true) }}
          onDelete={async (id) => {
            if (!confirm('确认删除？')) return
            try { await apiDelete(`/api/v1/reconcile/sales/${id}`); showToast('已删除', 'success'); loadSales(); loadOverall() }
            catch (e) { showToast(String(e), 'error') }
          }}
          form={showSalesForm}
          setForm={setShowSalesForm}
          editing={editingSales}
          onSaved={() => { loadSales(); loadOverall() }}
        />
      )}

      {tab === 'supply' && (
        <SupplyView
          records={supply}
          period={period}
          channels={channels}
          suppliers={suppliers}
          channelMap={channelMap}
          supplierMap={supplierMap}
          loading={loading}
          readOnly={periodLocked}
          onAdd={() => { setEditingSupply(null); setShowSupplyForm(true) }}
          onEdit={(r) => { setEditingSupply(r); setShowSupplyForm(true) }}
          onDelete={async (id) => {
            if (!confirm('确认删除？')) return
            try { await apiDelete(`/api/v1/reconcile/supply/${id}`); showToast('已删除', 'success'); loadSupply(); loadOverall() }
            catch (e) { showToast(String(e), 'error') }
          }}
          form={showSupplyForm}
          setForm={setShowSupplyForm}
          editing={editingSupply}
          onSaved={() => { loadSupply(); loadOverall() }}
        />
      )}

      {tab === 'summary' && (
        <SummaryListView records={summary} />
      )}

      {tab === 'diff' && (
        <DiffView
          records={diff}
          period={period}
          projects={projects}
          channels={channels}
          projectMap={projectMap}
          channelMap={channelMap}
          loading={loading}
          readOnly={periodLocked}
          onAdd={() => { setEditingDiff(null); setShowDiffForm(true) }}
          onEdit={(r) => { setEditingDiff(r); setShowDiffForm(true) }}
          onDelete={async (id) => {
            if (!confirm('确认删除？')) return
            try { await apiDelete(`/api/v1/reconcile/diff/${id}`); showToast('已删除', 'success'); loadDiff(); loadOverall() }
            catch (e) { showToast(String(e), 'error') }
          }}
          form={showDiffForm}
          setForm={setShowDiffForm}
          editing={editingDiff}
          onSaved={() => { loadDiff(); loadOverall() }}
        />
      )}

      {/* 弹窗 */}
      {showSalesForm && (
        <SalesFormModal
          period={period}
          projects={projects}
          projectMap={projectMap}
          editing={editingSales}
          onClose={() => setShowSalesForm(false)}
          onSaved={() => { setShowSalesForm(false); loadSales(); loadOverall() }}
        />
      )}
      {showSupplyForm && (
        <SupplyFormModal
          period={period}
          channels={channels}
          suppliers={suppliers}
          channelMap={channelMap}
          supplierMap={supplierMap}
          editing={editingSupply}
          onClose={() => setShowSupplyForm(false)}
          onSaved={() => { setShowSupplyForm(false); loadSupply(); loadOverall() }}
        />
      )}
      {showDiffForm && (
        <DiffFormModal
          period={period}
          projects={projects}
          channels={channels}
          editing={editingDiff}
          onClose={() => setShowDiffForm(false)}
          onSaved={() => { setShowDiffForm(false); loadDiff(); loadOverall() }}
        />
      )}
    </div>
  )
}

/* ═══════════════════ 总览 ═══════════════════ */
function OverviewView({
  overall, period, loading,
  sales, supply, diff,
  projectMap, channelMap, supplierMap,
}: {
  overall: OverallSummary | null
  period: string
  loading: boolean
  sales: SalesRecord[]
  supply: SupplyRecord[]
  diff: DiffRecord[]
  projectMap: Record<number, Project>
  channelMap: Record<number, Channel>
  supplierMap: Record<number, Supplier>
}) {
  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 size={18} className="animate-spin mr-2" />加载中…</div>
  }
  if (!overall) {
    return (
      <EmptyState
        icon={BarChart3}
        title={`${period} 暂无对账数据`}
        description="先在「销售对账」录入客户应收、在「供应对账」录入厂商应付，然后点击右上角「生成总账」自动汇总"
        tone="purple"
      />
    )
  }

  const margin = overall.gross_margin

  return (
    <div className="space-y-4">
      {/* 关键指标 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BigStat label="销售应收" value={`$${fmt(overall.total_revenue)}`} tone="green" icon={TrendingUp} sub={`${overall.invoice_count} 个项目`} />
        <BigStat label="供应应付" value={`$${fmt(overall.total_cost)}`} tone="red" icon={TrendingDown} sub={`${overall.paid_count} 个通道`} />
        <BigStat label="毛利" value={`$${fmt(overall.gross_profit)}`} tone={overall.gross_profit >= 0 ? 'green' : 'red'} icon={DollarSign} />
        <BigStat label="毛利率" value={margin != null ? `${margin.toFixed(1)}%` : '—'} tone="purple" icon={Activity} />
      </div>

      {/* 状态分布 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatusCard title="应收状态分布" items={overall.by_invoice_status} colorMap={INVOICE_COLORS} total={overall.total_revenue} />
        <StatusCard title="应付状态分布" items={overall.by_bill_status} colorMap={BILL_COLORS} total={overall.total_cost} />
        <StatusCard title="差异类型分布" items={overall.by_diff_type} colorMap={{} as any} total={overall.diff_amount_total} />
      </div>

      {/* 数据预览 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MiniList title="销售对账" icon={TrendingUp} count={sales.length} total={overall.total_revenue} tone="green">
          {sales.slice(0, 5).map(s => {
            const p = projectMap[s.project_id]
            return (
              <div key={s.id} className="flex items-center justify-between text-[11px] py-1.5 border-b border-white/5 last:border-0">
                <span className="text-gray-300 truncate flex-1">{p?.name || `项目 #${s.project_id}`}</span>
                <span className="text-emerald-400 tabular-nums">${fmt(s.amount_due)}</span>
              </div>
            )
          })}
        </MiniList>
        <MiniList title="供应对账" icon={TrendingDown} count={supply.length} total={overall.total_cost} tone="red">
          {supply.slice(0, 5).map(s => {
            const c = channelMap[s.channel_id]
            return (
              <div key={s.id} className="flex items-center justify-between text-[11px] py-1.5 border-b border-white/5 last:border-0">
                <span className="text-gray-300 truncate flex-1">{c?.name || `通道 #${s.channel_id}`}</span>
                <span className="text-rose-400 tabular-nums">${fmt(s.amount_payable)}</span>
              </div>
            )
          })}
        </MiniList>
        <MiniList title="差异记录" icon={AlertTriangle} count={diff.length} total={overall.diff_amount_total} tone="orange">
          {diff.slice(0, 5).map(d => (
            <div key={d.id} className="flex items-center justify-between text-[11px] py-1.5 border-b border-white/5 last:border-0">
              <span className="text-gray-300 truncate flex-1">{d.diff_type}</span>
              <span className="text-orange-400 tabular-nums">${fmt(d.diff_amount)}</span>
            </div>
          ))}
        </MiniList>
      </div>
    </div>
  )
}

function BigStat({ label, value, tone, icon: Icon, sub }: { label: string; value: string; tone: 'green' | 'red' | 'purple' | 'orange' | 'cyan'; icon: typeof TrendingUp; sub?: string }) {
  const colors: Record<string, string> = {
    green: 'from-emerald-500/10 to-emerald-500/0 border-emerald-500/20',
    red: 'from-rose-500/10 to-rose-500/0 border-rose-500/20',
    purple: 'from-violet-500/10 to-violet-500/0 border-violet-500/20',
    orange: 'from-orange-500/10 to-orange-500/0 border-orange-500/20',
    cyan: 'from-cyan-500/10 to-cyan-500/0 border-cyan-500/20',
  }
  const textColor: Record<string, string> = {
    green: 'text-emerald-400', red: 'text-rose-400', purple: 'text-violet-400', orange: 'text-orange-400', cyan: 'text-cyan-400',
  }
  return (
    <div className={`relative overflow-hidden rounded-xl p-4 bg-gradient-to-br ${colors[tone]} border`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={textColor[tone]} />
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${textColor[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-gray-500">{sub}</div>}
    </div>
  )
}

function StatusCard({ title, items, colorMap, total }: { title: string; items: Record<string, number>; colorMap: Record<string, { bg: string; text: string }>; total: number }) {
  const entries = Object.entries(items)
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">{title}</div>
      {entries.length === 0 ? (
        <div className="text-[11px] text-gray-600 text-center py-3">无数据</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([k, v]) => {
            const c = colorMap[k] || { bg: '#6B728015', text: '#9CA3AF' }
            const pct = total > 0 ? (v / total * 100) : 0
            return (
              <div key={k}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: c.text }} className="font-semibold">{k}</span>
                  <span className="text-gray-500 tabular-nums">${fmt(v)} ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.text }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MiniList({ title, icon: Icon, count, total, tone, children }: { title: string; icon: typeof TrendingUp; count: number; total: number; tone: 'green' | 'red' | 'orange'; children: React.ReactNode }) {
  const textColor = { green: 'text-emerald-400', red: 'text-rose-400', orange: 'text-orange-400' }[tone]
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
          <Icon size={12} />{title}
        </div>
        <span className="text-[10px] text-gray-600">{count} 条</span>
      </div>
      <div className={`text-base font-bold tabular-nums ${textColor} mb-2`}>${fmt(total)}</div>
      <div className="max-h-32 overflow-y-auto">
        {count === 0 ? <div className="text-[11px] text-gray-600 text-center py-2">无数据</div> : children}
      </div>
    </div>
  )
}

/* ═══════════════════ 销售对账 ═══════════════════ */
function SalesView({
  records, period, projects, projectMap, loading, readOnly,
  onAdd, onEdit, onDelete, form, setForm, editing, onSaved,
}: {
  records: SalesRecord[]
  period: string
  projects: Project[]
  projectMap: Record<number, Project>
  loading: boolean
  readOnly?: boolean
  onAdd: () => void
  onEdit: (r: SalesRecord) => void
  onDelete: (id: number) => void
  form: boolean
  setForm: (b: boolean) => void
  editing: SalesRecord | null
  onSaved: () => void
}) {
  const total = records.reduce((s, r) => s + r.amount_due, 0)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {period} 销售对账 <span className="text-emerald-400 font-bold ml-2">${fmt(total)}</span> · {records.length} 条
          {readOnly && <span className="ml-2 text-[10px] text-amber-400">（已复核/锁定，只读）</span>}
        </div>
        {!readOnly && (
          <button onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-emerald-500 to-green-500 rounded-lg hover:opacity-90">
            <Plus size={14} />新增销售对账
          </button>
        )}
      </div>
      {records.length === 0 ? (
        <EmptyState icon={TrendingUp} title={`${period} 还没有销售对账记录`} description="录入本期每个项目的实际调用量与应收金额" actionLabel={readOnly ? undefined : "新增"} onAction={readOnly ? undefined : onAdd} tone="green" />
      ) : (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="px-3 py-2 font-semibold">项目</th>
                  <th className="px-3 py-2 font-semibold">客户</th>
                  <th className="px-3 py-2 font-semibold text-right">调用量</th>
                  <th className="px-3 py-2 font-semibold text-right">单价</th>
                  <th className="px-3 py-2 font-semibold text-right">应收</th>
                  <th className="px-3 py-2 font-semibold">状态</th>
                  <th className="px-3 py-2 font-semibold text-right">差异</th>
                  {!readOnly && <th className="px-3 py-2 font-semibold">操作</th>}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const p = projectMap[r.project_id]
                  const c = INVOICE_COLORS[r.invoice_status] || INVOICE_COLORS['待开票']
                  return (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-white font-semibold">{p?.name || `#${r.project_id}`}</td>
                      <td className="px-3 py-2 text-gray-400">{r.customer_name || p?.customer_name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-cyan-300">{fmt(r.call_volume)} {unitLabel(r.call_volume_unit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-300">${fmt(r.final_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-300 font-bold">${fmt(r.amount_due)}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: c.bg, color: c.text }}>{r.invoice_status}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-300">${fmt(r.diff_amount)}</td>
                      {!readOnly && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => onEdit(r)} className="text-gray-400 hover:text-blue-400"><Edit3 size={12} /></button>
                            <button onClick={() => onDelete(r.id)} className="text-gray-400 hover:text-rose-400"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════ 供应对账 ═══════════════════ */
function SupplyView({
  records, period, channels, suppliers, channelMap, supplierMap, loading, readOnly,
  onAdd, onEdit, onDelete, form, setForm, editing, onSaved,
}: {
  records: SupplyRecord[]
  period: string
  channels: Channel[]
  suppliers: Supplier[]
  channelMap: Record<number, Channel>
  supplierMap: Record<number, Supplier>
  loading: boolean
  readOnly?: boolean
  onAdd: () => void
  onEdit: (r: SupplyRecord) => void
  onDelete: (id: number) => void
  form: boolean
  setForm: (b: boolean) => void
  editing: SupplyRecord | null
  onSaved: () => void
}) {
  const total = records.reduce((s, r) => s + r.amount_payable, 0)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {period} 供应对账 <span className="text-rose-400 font-bold ml-2">${fmt(total)}</span> · {records.length} 条
          {readOnly && <span className="ml-2 text-[10px] text-amber-400">（已复核/锁定，只读）</span>}
        </div>
        {!readOnly && (
          <button onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-rose-500 to-red-500 rounded-lg hover:opacity-90">
            <Plus size={14} />新增供应对账
          </button>
        )}
      </div>
      {records.length === 0 ? (
        <EmptyState icon={TrendingDown} title={`${period} 还没有供应对账记录`} description="录入本期每个通道的厂商账单与应付金额" actionLabel={readOnly ? undefined : "新增"} onAction={readOnly ? undefined : onAdd} tone="red" />
      ) : (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="px-3 py-2 font-semibold">通道</th>
                  <th className="px-3 py-2 font-semibold">供应商</th>
                  <th className="px-3 py-2 font-semibold text-right">调用量</th>
                  <th className="px-3 py-2 font-semibold text-right">成本</th>
                  <th className="px-3 py-2 font-semibold text-right">应付</th>
                  <th className="px-3 py-2 font-semibold">付款状态</th>
                  <th className="px-3 py-2 font-semibold text-right">差异</th>
                  {!readOnly && <th className="px-3 py-2 font-semibold">操作</th>}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const c = channelMap[r.channel_id]
                  const sup = supplierMap[r.supplier_id]
                  const bs = BILL_COLORS[r.bill_status] || BILL_COLORS['待付款']
                  return (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-white font-semibold">{c?.name || `#${r.channel_id}`}</td>
                      <td className="px-3 py-2 text-gray-400">{sup?.name || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-cyan-300">{fmt(r.call_volume)} {unitLabel(r.call_volume_unit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-300">${fmt(r.cost_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-300 font-bold">${fmt(r.amount_payable)}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: bs.bg, color: bs.text }}>{r.bill_status}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-300">${fmt(r.diff_amount)}</td>
                      {!readOnly && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => onEdit(r)} className="text-gray-400 hover:text-blue-400"><Edit3 size={12} /></button>
                            <button onClick={() => onDelete(r.id)} className="text-gray-400 hover:text-rose-400"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════ 财务总账 ═══════════════════ */
function SummaryListView({ records }: { records: SummaryRecord[] }) {
  if (records.length === 0) {
    return <EmptyState icon={FileBarChart} title="还没有财务总账" description="完成每月对账后点击右上角「生成总账」自动汇总" tone="purple" />
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {records.map(r => {
          const c = SUMMARY_STATUS_COLORS[r.status] || SUMMARY_STATUS_COLORS['草稿']
          const margin = r.gross_margin
          return (
            <div key={r.id} className="rounded-xl border border-white/5 bg-gradient-to-br from-purple-500/[0.04] to-indigo-500/[0.04] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <IconBox icon={Calendar} size="sm" tone="purple" />
                  <span className="text-sm font-bold text-white">{r.period}</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: c.bg, color: c.text }}>{r.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SummaryItem label="总收入" value={`$${fmt(r.total_revenue)}`} tone="green" />
                <SummaryItem label="总成本" value={`$${fmt(r.total_cost)}`} tone="red" />
                <SummaryItem label="毛利" value={`$${fmt(r.gross_profit)}`} tone={r.gross_profit >= 0 ? 'green' : 'red'} />
                <SummaryItem label="毛利率" value={margin != null ? `${margin.toFixed(1)}%` : '—'} tone="purple" />
                <SummaryItem label="已开票" value={`${r.invoice_count}`} tone="blue" />
                <SummaryItem label="已付款" value={`${r.paid_count}`} tone="cyan" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone: 'green' | 'red' | 'purple' | 'blue' | 'cyan' }) {
  const colors: Record<string, string> = {
    green: 'text-emerald-400', red: 'text-rose-400', purple: 'text-violet-400', blue: 'text-blue-400', cyan: 'text-cyan-400',
  }
  return (
    <div className="rounded-lg p-2 bg-black/20">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${colors[tone]}`}>{value}</div>
    </div>
  )
}

/* ═══════════════════ 差异分析 ═══════════════════ */
function DiffView({
  records, period, projects, channels, projectMap, channelMap, loading, readOnly,
  onAdd, onEdit, onDelete, form, setForm, editing, onSaved,
}: {
  records: DiffRecord[]
  period: string
  projects: Project[]
  channels: Channel[]
  projectMap: Record<number, Project>
  channelMap: Record<number, Channel>
  loading: boolean
  readOnly?: boolean
  onAdd: () => void
  onEdit: (r: DiffRecord) => void
  onDelete: (id: number) => void
  form: boolean
  setForm: (b: boolean) => void
  editing: DiffRecord | null
  onSaved: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {period} 差异记录 · {records.length} 条
          {readOnly && <span className="ml-2 text-[10px] text-amber-400">（已复核/锁定，只读）</span>}
        </div>
        {!readOnly && (
          <button onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-orange-500 to-yellow-500 rounded-lg hover:opacity-90">
            <Plus size={14} />新增差异
          </button>
        )}
      </div>
      {records.length === 0 ? (
        <EmptyState icon={AlertTriangle} title={`${period} 还没有差异记录`} description="记录销售与供应两侧的调用量/金额差异，便于月末复盘" actionLabel={readOnly ? undefined : "新增"} onAction={readOnly ? undefined : onAdd} tone="orange" />
      ) : (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="px-3 py-2 font-semibold">类型</th>
                  <th className="px-3 py-2 font-semibold">关联项目/通道</th>
                  <th className="px-3 py-2 font-semibold text-right">销售/供应</th>
                  <th className="px-3 py-2 font-semibold text-right">差异量</th>
                  <th className="px-3 py-2 font-semibold text-right">差异金额</th>
                  <th className="px-3 py-2 font-semibold text-right">%</th>
                  <th className="px-3 py-2 font-semibold">原因</th>
                  <th className="px-3 py-2 font-semibold">状态</th>
                  {!readOnly && <th className="px-3 py-2 font-semibold">操作</th>}
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const target = r.project_id ? projectMap[r.project_id]?.name : (r.channel_id ? channelMap[r.channel_id]?.name : '—')
                  const c = DIFF_STATUS_COLORS[r.status] || DIFF_STATUS_COLORS['未处理']
                  return (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-white">{r.diff_type}</td>
                      <td className="px-3 py-2 text-gray-400">{target || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-400">{fmt(r.sales_call_volume)} / {fmt(r.supply_call_volume)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-300 font-bold">{fmt(r.diff_volume)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-300 font-bold">${fmt(r.diff_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-300">{r.diff_pct != null ? `${r.diff_pct.toFixed(1)}%` : '—'}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate" title={r.reason || ''}>{r.reason || '—'}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: c.bg, color: c.text }}>{r.status}</span>
                      </td>
                      {!readOnly && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => onEdit(r)} className="text-gray-400 hover:text-blue-400"><Edit3 size={12} /></button>
                            <button onClick={() => onDelete(r.id)} className="text-gray-400 hover:text-rose-400"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════ 表单弹窗 ═══════════════════ */
function SalesFormModal({ period, projects, projectMap, editing, onClose, onSaved }: {
  period: string; projects: Project[]; projectMap: Record<number, Project>
  editing: SalesRecord | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    project_id: editing?.project_id || (projects[0]?.id || 0),
    period: editing?.period || period,
    customer_name: editing?.customer_name || '',
    call_volume: editing?.call_volume || 0,
    call_volume_unit: editing?.call_volume_unit || 'per_1k_token',
    final_price: editing?.final_price || 0,
    amount_due: editing?.amount_due || 0,
    invoice_status: editing?.invoice_status || '待开票',
    diff_amount: editing?.diff_amount || 0,
    remarks: editing?.remarks || '',
  })
  const [saving, setSaving] = useState(false)
  const { toast: showToast } = useToast()

  // 项目变更时自动同步客户名 + 计算应收
  useEffect(() => {
    if (!editing) {
      const p = projectMap[form.project_id]
      if (p?.customer_name && !form.customer_name) {
        setForm(f => ({ ...f, customer_name: p.customer_name || '' }))
      }
    }
  }, [form.project_id, editing, projectMap])

  useEffect(() => {
    if (!editing && form.call_volume > 0 && form.final_price > 0) {
      const v = Math.round(form.call_volume * form.final_price * 100) / 100
      setForm(f => ({ ...f, amount_due: v }))
    }
  }, [form.call_volume, form.final_price, editing])

  const save = async () => {
    if (!form.project_id) { showToast('请选择项目', 'error'); return }
    setSaving(true)
    try {
      const payload = { ...form, project_id: parseInt(String(form.project_id)) }
      if (editing) {
        await apiPut(`/api/v1/reconcile/sales/${editing.id}`, payload)
        showToast('已更新', 'success')
      } else {
        await apiPost('/api/v1/reconcile/sales', payload)
        showToast('已创建', 'success')
      }
      onSaved()
    } catch (e) { showToast(String(e), 'error') }
    finally { setSaving(false) }
  }

  return (
    <Modal
      icon={editing ? Edit3 : Plus}
      title={editing ? '编辑销售对账' : '新增销售对账'}
      subtitle="按月汇总销售侧调用量、单价、应收金额、票面状态"
      tone="green"
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="项目" required>
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: parseInt(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all">
            <option value={0}>请选择…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="对账月份" required>
          <input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all" />
        </Field>
        <Field label="客户名">
          <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })}
            placeholder="自动从项目带入"
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all" />
        </Field>
        <Field label="开票状态">
          <select value={form.invoice_status} onChange={e => setForm({ ...form, invoice_status: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all">
            {SALES_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="调用量">
          <input type="number" step="0.0001" value={form.call_volume} onChange={e => setForm({ ...form, call_volume: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all" />
        </Field>
        <Field label="计费单位">
          <select value={form.call_volume_unit} onChange={e => setForm({ ...form, call_volume_unit: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all">
            <option value="per_1k_token">/ 1K tokens</option>
            <option value="per_1m_token">/ 1M tokens（百万）</option>
            <option value="per_request">/ 次</option>
            <option value="per_month">/ 月</option>
          </select>
        </Field>
        <Field label="成交单价 ($)">
          <input type="number" step="0.0001" value={form.final_price} onChange={e => setForm({ ...form, final_price: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all" />
        </Field>
        <Field label="应收金额 ($)">
          <input type="number" step="0.01" value={form.amount_due} onChange={e => setForm({ ...form, amount_due: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all font-bold" />
        </Field>
        <Field label="与客户报价差异 ($)">
          <input type="number" step="0.01" value={form.diff_amount} onChange={e => setForm({ ...form, diff_amount: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all" />
        </Field>
        <Field label="备注" full>
          <textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} rows={2}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all resize-none" />
        </Field>
      </div>
      <ModalFooter onClose={onClose} saving={saving} onSave={save} tone="green" saveText={editing ? '保存修改' : '创建销售对账'} />
    </Modal>
  )
}

function SupplyFormModal({ period, channels, suppliers, channelMap, supplierMap, editing, onClose, onSaved }: {
  period: string; channels: Channel[]; suppliers: Supplier[]
  channelMap: Record<number, Channel>; supplierMap: Record<number, Supplier>
  editing: SupplyRecord | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    channel_id: editing?.channel_id || (channels[0]?.id || 0),
    supplier_id: editing?.supplier_id || 0,
    period: editing?.period || period,
    call_volume: editing?.call_volume || 0,
    call_volume_unit: editing?.call_volume_unit || 'per_1k_token',
    cost_price: editing?.cost_price || 0,
    amount_payable: editing?.amount_payable || 0,
    bill_status: editing?.bill_status || '待付款',
    diff_amount: editing?.diff_amount || 0,
    remarks: editing?.remarks || '',
  })
  const [saving, setSaving] = useState(false)
  const { toast: showToast } = useToast()

  // 通道变更时自动同步供应商
  useEffect(() => {
    const c = channelMap[form.channel_id]
    if (c?.supplier_id && (!form.supplier_id || form.supplier_id !== c.supplier_id)) {
      setForm(f => ({ ...f, supplier_id: c.supplier_id }))
    }
    if (c?.cost_price && !editing && !form.cost_price) {
      setForm(f => ({ ...f, cost_price: c.cost_price }))
    }
  }, [form.channel_id, channelMap, editing])

  useEffect(() => {
    if (!editing && form.call_volume > 0 && form.cost_price > 0) {
      const v = Math.round(form.call_volume * form.cost_price * 100) / 100
      setForm(f => ({ ...f, amount_payable: v }))
    }
  }, [form.call_volume, form.cost_price, editing])

  const save = async () => {
    if (!form.channel_id || !form.supplier_id) { showToast('请选择通道和供应商', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        channel_id: parseInt(String(form.channel_id)),
        supplier_id: parseInt(String(form.supplier_id)),
      }
      if (editing) {
        await apiPut(`/api/v1/reconcile/supply/${editing.id}`, payload)
        showToast('已更新', 'success')
      } else {
        await apiPost('/api/v1/reconcile/supply', payload)
        showToast('已创建', 'success')
      }
      onSaved()
    } catch (e) { showToast(String(e), 'error') }
    finally { setSaving(false) }
  }

  return (
    <Modal
      icon={editing ? Edit3 : Plus}
      title={editing ? '编辑供应对账' : '新增供应对账'}
      subtitle="按月汇总供应侧调用量、成本单价、应付金额、票面状态"
      tone="red"
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="通道" required>
          <select value={form.channel_id} onChange={e => setForm({ ...form, channel_id: parseInt(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all">
            <option value={0}>请选择…</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="供应商" required>
          <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: parseInt(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all">
            <option value={0}>请选择…</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="对账月份" required>
          <input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all" />
        </Field>
        <Field label="付款状态">
          <select value={form.bill_status} onChange={e => setForm({ ...form, bill_status: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all">
            {SUPPLY_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="调用量">
          <input type="number" step="0.0001" value={form.call_volume} onChange={e => setForm({ ...form, call_volume: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all" />
        </Field>
        <Field label="计费单位">
          <select value={form.call_volume_unit} onChange={e => setForm({ ...form, call_volume_unit: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all">
            <option value="per_1k_token">/ 1K tokens</option>
            <option value="per_1m_token">/ 1M tokens（百万）</option>
            <option value="per_request">/ 次</option>
            <option value="per_month">/ 月</option>
          </select>
        </Field>
        <Field label="成本单价 ($)">
          <input type="number" step="0.0001" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all" />
        </Field>
        <Field label="应付金额 ($)">
          <input type="number" step="0.01" value={form.amount_payable} onChange={e => setForm({ ...form, amount_payable: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all font-bold" />
        </Field>
        <Field label="与厂商账单差异 ($)">
          <input type="number" step="0.01" value={form.diff_amount} onChange={e => setForm({ ...form, diff_amount: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all" />
        </Field>
        <Field label="备注" full>
          <textarea value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} rows={2}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-all resize-none" />
        </Field>
      </div>
      <ModalFooter onClose={onClose} saving={saving} onSave={save} tone="red" saveText={editing ? '保存修改' : '创建供应对账'} />
    </Modal>
  )
}

function DiffFormModal({ period, projects, channels, editing, onClose, onSaved }: {
  period: string; projects: Project[]; channels: Channel[]
  editing: DiffRecord | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    period: editing?.period || period,
    project_id: editing?.project_id || null,
    channel_id: editing?.channel_id || null,
    diff_type: editing?.diff_type || '调用量差异',
    sales_call_volume: editing?.sales_call_volume || 0,
    supply_call_volume: editing?.supply_call_volume || 0,
    diff_volume: editing?.diff_volume || 0,
    diff_amount: editing?.diff_amount || 0,
    reason: editing?.reason || '',
    resolution: editing?.resolution || '',
    status: editing?.status || '未处理',
  })
  const [saving, setSaving] = useState(false)
  const { toast: showToast } = useToast()

  // 自动计算 diff_volume
  useEffect(() => {
    const v = form.sales_call_volume - form.supply_call_volume
    setForm(f => ({ ...f, diff_volume: Math.round(v * 10000) / 10000 }))
  }, [form.sales_call_volume, form.supply_call_volume])

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        project_id: form.project_id ? parseInt(String(form.project_id)) : null,
        channel_id: form.channel_id ? parseInt(String(form.channel_id)) : null,
      }
      if (editing) {
        await apiPut(`/api/v1/reconcile/diff/${editing.id}`, payload)
        showToast('已更新', 'success')
      } else {
        await apiPost('/api/v1/reconcile/diff', payload)
        showToast('已创建', 'success')
      }
      onSaved()
    } catch (e) { showToast(String(e), 'error') }
    finally { setSaving(false) }
  }

  return (
    <Modal
      icon={editing ? Edit3 : Plus}
      title={editing ? '编辑差异记录' : '新增差异记录'}
      subtitle="销售侧与供应侧对账时，自动计算差异量并记录原因/处理结果"
      tone="orange"
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="对账月份" required>
          <input value={form.period} onChange={e => setForm({ ...form, period: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all" />
        </Field>
        <Field label="差异类型">
          <select value={form.diff_type} onChange={e => setForm({ ...form, diff_type: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all">
            {DIFF_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="关联项目">
          <select value={form.project_id || ''} onChange={e => setForm({ ...form, project_id: e.target.value ? parseInt(e.target.value) : null })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all">
            <option value="">无</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="关联通道">
          <select value={form.channel_id || ''} onChange={e => setForm({ ...form, channel_id: e.target.value ? parseInt(e.target.value) : null })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all">
            <option value="">无</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="销售调用量">
          <input type="number" step="0.0001" value={form.sales_call_volume} onChange={e => setForm({ ...form, sales_call_volume: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all" />
        </Field>
        <Field label="供应调用量">
          <input type="number" step="0.0001" value={form.supply_call_volume} onChange={e => setForm({ ...form, supply_call_volume: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all" />
        </Field>
        <Field label="差异量（自动）">
          <input type="number" value={form.diff_volume} disabled
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-orange-500 font-bold cursor-not-allowed" />
        </Field>
        <Field label="差异金额 ($)">
          <input type="number" step="0.01" value={form.diff_amount} onChange={e => setForm({ ...form, diff_amount: parseFloat(e.target.value) || 0 })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all" />
        </Field>
        <Field label="差异原因" full>
          <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows={2}
            placeholder="如：缓存命中率不同 / 客户使用量浮动 / 厂商计费口径差异"
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all resize-none" />
        </Field>
        <Field label="处理结果">
          <input value={form.resolution} onChange={e => setForm({ ...form, resolution: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all" />
        </Field>
        <Field label="状态">
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/15 transition-all">
            {DIFF_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <ModalFooter onClose={onClose} saving={saving} onSave={save} tone="orange" saveText={editing ? '保存修改' : '创建差异记录'} />
    </Modal>
  )
}

/* 通用弹窗 / 字段已统一从 design-system/Modal 引入，移除本地实现以保持风格统一 */
