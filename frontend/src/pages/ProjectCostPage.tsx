import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TrendingUp, DollarSign, PieChart, Plus, X, Trash2,
  Loader2, Briefcase, ArrowUpRight, ArrowDownRight, BarChart3,
  Target, Activity, Users, Calendar, Edit3, Building2,
} from 'lucide-react'
import { PageHeader, IconBox, EmptyState } from '../components/design-system'
import SearchableSelect from '../components/SearchableSelect'
import TeamViewSwitcher from '../components/TeamViewSwitcher'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'

/* ──── 类型 ──── */
interface CostItem {
  id: number
  project_id: number
  category: string
  description: string
  amount: number
  cost_month: string | null
  remarks: string | null
  supplier_id: number | null
  created_at: string
  updated_at: string
}
interface ProjectSummary {
  project_id: number
  project_name: string
  customer_name: string
  currency: string
  opportunity_amount: number | null
  deal_amount: number | null
  total_cost: number
  gross_profit: number | null
  gross_margin: number | null
  sales_person: string | null
  status: string
  cost_items: CostItem[]
}
interface CategoryCost { category: string; amount: number; count: number }
interface MonthlyCost { month: string; amount: number; count: number }
interface SalesProfit {
  sales_person: string
  project_count: number
  total_deal: number
  total_cost: number
  gross_profit: number
  gross_margin: number | null
}
interface OverallSummary {
  total_projects: number
  total_deal: number
  total_cost: number
  total_gross_profit: number
  overall_margin: number | null
  by_currency: Record<string, { deal: number; cost: number; profit: number; margin: number | null }>
  by_category: CategoryCost[]
  by_month: MonthlyCost[]
  by_sales: SalesProfit[]
  top_margin_projects: ProjectSummary[]
  low_margin_projects: ProjectSummary[]
}
interface SupplierMini { id: number; name: string; code: string; category: string; status: string; settlement_currency: string }
interface SupplierCostRow {
  supplier_id: number
  supplier_name: string
  supplier_code: string
  category: string
  status: string
  settlement_currency: string
  total_cost: number
  cost_count: number
  project_count: number
}

const CATEGORIES = ['通道费', '人力', '硬件', '软件', '其他']
const CURRENCY_META: Record<string, { symbol: string }> = {
  CNY: { symbol: '¥' },
  USD: { symbol: '$' },
  EUR: { symbol: '€' },
  JPY: { symbol: '¥' },
}

const CATEGORY_COLORS: Record<string, string> = {
  '通道费': '#3B82F6',
  '人力': '#8B5CF6',
  '硬件': '#F59E0B',
  '软件': '#06B6D4',
  '其他': '#6B7280',
}

function fmtAmt(v: number | null | undefined, currency = 'CNY') {
  if (v == null) return '—'
  const m = CURRENCY_META[currency] || CURRENCY_META.CNY
  return `${m.symbol}${v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} 万`
}

function marginColor(v: number | null) {
  if (v == null) return 'text-gray-500'
  if (v >= 30) return 'text-emerald-400'
  if (v >= 10) return 'text-amber-400'
  return 'text-red-400'
}

function marginBg(v: number | null) {
  if (v == null) return 'bg-gray-500/10'
  if (v >= 30) return 'bg-emerald-500/10'
  if (v >= 10) return 'bg-amber-500/10'
  return 'bg-red-500/10'
}

function marginBarColor(v: number | null) {
  if (v == null) return '#6B7280'
  if (v >= 30) return '#10B981'
  if (v >= 10) return '#F59E0B'
  return '#EF4444'
}

/* ──── 主页面 ──── */
export default function ProjectCostPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast } = useToast()
  const [tab, setTab] = useState<'overview' | 'projects' | 'suppliers'>('overview')
  const [overview, setOverview] = useState<OverallSummary | null>(null)
  const [projectList, setProjectList] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null)
  const [searchText, setSearchText] = useState('')

  // 团队视图
  const [memberList, setMemberList] = useState<any[]>([])
  const [viewMode, setViewMode] = useState<'personal' | 'team'>('personal')
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])

  // 新增成本条目弹窗
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ project_id: 0, category: '通道费', supplier_id: 0, description: '', amount: '', cost_month: '', remarks: '' })
  const [saving, setSaving] = useState(false)

  // 编辑成本条目
  const [editingItem, setEditingItem] = useState<CostItem | null>(null)
  const [editForm, setEditForm] = useState({ category: '', supplier_id: 0, description: '', amount: '', cost_month: '', remarks: '' })
  const [editSaving, setEditSaving] = useState(false)

  // 供应商列表（用于成本条目关联供应商）
  const [supplierList, setSupplierList] = useState<SupplierMini[]>([])

  // 按供应商成本分布
  const [supplierCosts, setSupplierCosts] = useState<SupplierCostRow[]>([])

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/project-costs/overview')
      if (!res.ok) return
      setOverview(await res.json())
    } catch { /* ignore */ }
  }, [])

  const loadProjectList = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/projects')
      if (!res.ok) return
      const projects = await res.json()
      const summaries = await Promise.all(
        projects.map(async (p: { id: number; deal_amount: number | null }) => {
          if (!p.deal_amount) return null
          try {
            const r = await fetch(`/api/v1/project-costs/project/${p.id}`)
            if (!r.ok) return null
            return await r.json()
          } catch { return null }
        })
      )
      setProjectList(summaries.filter(Boolean).sort((a: ProjectSummary, b: ProjectSummary) => (b.gross_margin ?? -999) - (a.gross_margin ?? -999)))
    } catch { /* ignore */ }
  }, [])

  const loadProjectDetail = useCallback(async (pid: number) => {
    try {
      const res = await fetch(`/api/v1/project-costs/project/${pid}`)
      if (!res.ok) return
      setSelectedProject(await res.json())
    } catch { /* ignore */ }
  }, [])

  // 从已有 projectList 中的 cost_items 聚合按供应商的成本分布
  const computedSupplierCosts = useMemo<SupplierCostRow[]>(() => {
    const map = new Map<number, SupplierCostRow>()
    for (const p of projectList) {
      for (const item of (p.cost_items || [])) {
        if (!item.supplier_id) continue
        const sid = item.supplier_id
        const sup = supplierList.find(s => s.id === sid)
        const existing = map.get(sid) || {
          supplier_id: sid,
          supplier_name: sup?.name || `#${sid}`,
          supplier_code: sup?.code || '',
          category: sup?.category || '其他',
          status: sup?.status || '合作中',
          settlement_currency: sup?.settlement_currency || p.currency,
          total_cost: 0,
          cost_count: 0,
          project_count: 0,
        }
        existing.total_cost += item.amount
        existing.cost_count += 1
        map.set(sid, existing)
      }
    }
    // 统计 project_count (去重)
    for (const p of projectList) {
      const sids = new Set<number>()
      for (const item of (p.cost_items || [])) {
        if (item.supplier_id) sids.add(item.supplier_id)
      }
      for (const sid of sids) {
        const row = map.get(sid)
        if (row) row.project_count += 1
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total_cost - a.total_cost)
  }, [projectList, supplierList])

  useEffect(() => {
    setSupplierCosts(computedSupplierCosts)
  }, [computedSupplierCosts])

  useEffect(() => {
    fetch('/api/v1/users/simple').then(r => r.json()).then(d => { if (Array.isArray(d)) setMemberList(d) }).catch(() => {})
    fetch('/api/v1/suppliers').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setSupplierList(d.map((s: any) => ({
        id: s.id, name: s.name, code: s.code, category: s.category, status: s.status, settlement_currency: s.settlement_currency,
      })))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadOverview(), loadProjectList()]).finally(() => setLoading(false))
  }, [loadOverview, loadProjectList])

  // 切换 tab 时清空选中的项目（避免 overview tab 仍指向旧项目）
  useEffect(() => {
    if (tab !== 'projects') setSelectedProject(null)
  }, [tab])

  const handleAddCost = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/v1/project-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: addForm.project_id,
          category: addForm.category,
          supplier_id: addForm.supplier_id || null,
          description: addForm.description,
          amount: parseFloat(addForm.amount) || 0,
          cost_month: addForm.cost_month || null,
          remarks: addForm.remarks || null,
        }),
      })
      if (res.ok) {
        setShowAdd(false)
        setAddForm({ project_id: 0, category: '通道费', supplier_id: 0, description: '', amount: '', cost_month: '', remarks: '' })
        loadOverview()
        loadProjectList()
        if (selectedProject) loadProjectDetail(selectedProject.project_id)
        showToast('成本明细已添加', 'success')
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '添加失败', 'error')
      }
    } finally { setSaving(false) }
  }

  const handleDeleteCost = async (item: CostItem) => {
    if (!confirm(`确认删除该成本明细（${fmtAmt(item.amount, selectedProject?.currency)}）？`)) return
    const res = await fetch(`/api/v1/project-costs/items/${item.id}`, { method: 'DELETE' })
    if (res.ok) {
      loadOverview()
      loadProjectList()
      if (selectedProject) loadProjectDetail(selectedProject.project_id)
      showToast('已删除', 'success')
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.detail || '删除失败', 'error')
    }
  }

  const handleEditCost = async () => {
    if (!editingItem) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/v1/project-costs/items/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: editForm.category,
          supplier_id: editForm.supplier_id || null,
          description: editForm.description,
          amount: parseFloat(editForm.amount) || 0,
          cost_month: editForm.cost_month || null,
          remarks: editForm.remarks || null,
        }),
      })
      if (res.ok) {
        setEditingItem(null)
        loadOverview()
        loadProjectList()
        if (selectedProject) loadProjectDetail(selectedProject.project_id)
        showToast('已更新', 'success')
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '更新失败', 'error')
      }
    } finally { setEditSaving(false) }
  }

  const openEditItem = (item: CostItem) => {
    setEditingItem(item)
    setEditForm({
      category: item.category,
      supplier_id: item.supplier_id || 0,
      description: item.description,
      amount: item.amount.toString(),
      cost_month: item.cost_month || '',
      remarks: item.remarks || '',
    })
  }

  // 筛选项目列表
  const filteredProjects = projectList.filter(p =>
    !searchText || p.project_name.includes(searchText) || p.customer_name.includes(searchText) || (p.sales_person || '').includes(searchText)
  )

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
        icon={BarChart3}
        title="成本利润"
        description="项目成本明细录入与利润率分析，掌控每一笔投入产出"
        tone="green"
        stats={overview ? [
          { label: '项目', value: overview.total_projects },
          { label: '毛利率', value: overview.overall_margin != null ? `${overview.overall_margin}%` : '—' },
        ] : []}
        right={
          <div className="flex items-center gap-2">
            <TeamViewSwitcher
              memberList={memberList}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              selectedUserIds={selectedUserIds}
              onSelectedUserIdsChange={setSelectedUserIds}
            />
            {hasPermission('project:edit') && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer"
              >
                <Plus size={14} strokeWidth={2.5} />新增成本
              </button>
            )}
          </div>
        }
      />

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 bg-bg-hover/60 border border-border rounded-lg p-0.5 w-fit mb-5">
        {([
          { key: 'overview' as const, label: '总览', icon: BarChart3 },
          { key: 'projects' as const, label: '按项目', icon: Briefcase },
          { key: 'suppliers' as const, label: '按供应商', icon: Building2 },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === t.key
                ? 'bg-accent-blue/15 text-accent-blue'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <t.icon size={12} />{t.label}
          </button>
        ))}
      </div>

      {/* 总览 Tab */}
      {tab === 'overview' && overview && (
        <div className="space-y-4">
          {/* KPI 卡片行 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Briefcase}
              label="成交项目"
              value={overview.total_projects}
              sub="有成交金额的项目"
              color="#3B82F6"
              gradient="radial-gradient(circle, #3B82F6 0%, transparent 70%)"
            />
            <KpiCard
              icon={Target}
              label="总成交额"
              value={fmtAmt(overview.total_deal)}
              sub={`总成本 ${fmtAmt(overview.total_cost)}`}
              color="#10B981"
              gradient="radial-gradient(circle, #10B981 0%, transparent 70%)"
            />
            <KpiCard
              icon={DollarSign}
              label="毛利润"
              value={fmtAmt(overview.total_gross_profit)}
              sub={`成交 - 成本`}
              color="#F59E0B"
              gradient="radial-gradient(circle, #F59E0B 0%, transparent 70%)"
            />
            <KpiCard
              icon={TrendingUp}
              label="整体毛利率"
              value={overview.overall_margin != null ? `${overview.overall_margin}%` : '—'}
              sub={overview.overall_margin != null ? (overview.overall_margin >= 30 ? '健康' : overview.overall_margin >= 10 ? '一般' : '需关注') : ''}
              color={marginBarColor(overview.overall_margin)}
              gradient={`radial-gradient(circle, ${marginBarColor(overview.overall_margin)} 0%, transparent 70%)`}
            />
          </div>

          {/* 第二行：成本类别分布 + 月度成本趋势 + 销售利润 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 成本类别分布 */}
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center gap-2.5 mb-4">
                <IconBox icon={PieChart} size="sm" tone="blue" variant="soft" />
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">成本类别分布</h4>
              </div>
              {overview.by_category.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6">暂无成本数据</p>
              ) : (
                <div className="space-y-3">
                  {overview.by_category.map(cat => {
                    const totalCat = overview.by_category.reduce((s, c) => s + c.amount, 0)
                    const pct = totalCat > 0 ? (cat.amount / totalCat * 100) : 0
                    const color = CATEGORY_COLORS[cat.category] || '#6B7280'
                    return (
                      <div key={cat.category}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                            <span className="text-xs text-gray-300 font-medium">{cat.category}</span>
                            <span className="text-[11px] text-gray-600">{cat.count}笔</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white tabular-nums">{fmtAmt(cat.amount)}</span>
                            <span className="text-[11px] text-gray-500 tabular-nums">{pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 月度成本趋势 */}
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center gap-2.5 mb-4">
                <IconBox icon={Calendar} size="sm" tone="orange" variant="soft" />
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">月度成本趋势</h4>
              </div>
              {overview.by_month.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6">暂无月度数据</p>
              ) : (
                <div className="space-y-2">
                  {overview.by_month.slice(-8).map(m => {
                    const maxAmt = Math.max(...overview.by_month.map(x => x.amount), 1)
                    const pct = (m.amount / maxAmt * 100)
                    return (
                      <div key={m.month} className="flex items-center gap-3">
                        <span className="text-[11px] text-gray-500 w-16 tabular-nums shrink-0">{m.month}</span>
                        <div className="flex-1 h-5 rounded-md bg-bg-hover overflow-hidden relative">
                          <div className="h-full rounded-md transition-all" style={{ width: `${Math.max(3, pct)}%`, background: 'linear-gradient(90deg, #F59E0B, #FBBF24)' }} />
                          <span className="absolute right-2 top-0.5 text-[11px] font-bold text-white tabular-nums">{fmtAmt(m.amount)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 销售利润排行 */}
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center gap-2.5 mb-4">
                <IconBox icon={Users} size="sm" tone="green" variant="soft" />
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">销售利润排行</h4>
              </div>
              {overview.by_sales.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6">暂无数据</p>
              ) : (
                <div className="space-y-2">
                  {overview.by_sales.slice(0, 6).map(s => (
                    <div key={s.sales_person} className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/8 transition-colors">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                        {s.sales_person.slice(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-white truncate">{s.sales_person}</span>
                          <span className={`text-[11px] font-bold tabular-nums ${marginColor(s.gross_margin)}`}>
                            {s.gross_margin != null ? `${s.gross_margin}%` : '—'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                          <span>{s.project_count}个项目</span>
                          <span>成交 {fmtAmt(s.total_deal)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 第三行：高/低毛利率排行 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-teal-400 rounded-lg blur-md opacity-50" />
                    <div className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 text-[#fff]">
                      <ArrowUpRight size={15} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">高毛利率 TOP5</h4>
                    <p className="text-[11px] text-gray-500">利润率最高的项目</p>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {overview.top_margin_projects.map(p => (
                  <ProjectRankRow key={p.project_id} summary={p} onClick={() => { setTab('projects'); loadProjectDetail(p.project_id) }} />
                ))}
                {overview.top_margin_projects.length === 0 && <p className="text-xs text-gray-600 text-center py-4">暂无数据</p>}
              </div>
            </div>
            <div className="rounded-2xl bg-bg-card border border-border/50 p-5 hover:border-border/80 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-red-500 to-orange-400 rounded-lg blur-md opacity-50" />
                    <div className="relative inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-orange-400 text-[#fff]">
                      <ArrowDownRight size={15} strokeWidth={2.5} />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">低毛利率 TOP5</h4>
                    <p className="text-[11px] text-gray-500">需要关注成本的项目</p>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {overview.low_margin_projects.map(p => (
                  <ProjectRankRow key={p.project_id} summary={p} onClick={() => { setTab('projects'); loadProjectDetail(p.project_id) }} />
                ))}
                {overview.low_margin_projects.length === 0 && <p className="text-xs text-gray-600 text-center py-4">暂无数据</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 按项目 Tab */}
      {tab === 'projects' && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          {/* 左：项目列表 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 bg-bg-card/50">
              <div className="flex items-center gap-2 mb-2">
                <IconBox icon={Briefcase} size="sm" tone="blue" variant="soft" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">项目列表</span>
                <span className="text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full ml-auto">{filteredProjects.length}</span>
              </div>
              <input
                type="text"
                placeholder="搜索项目/客户/销售..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6] transition-colors placeholder-gray-600"
              />
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {filteredProjects.map(p => (
                <button
                  key={p.project_id}
                  onClick={() => loadProjectDetail(p.project_id)}
                  className={`w-full text-left px-4 py-3 border-b border-border/20 hover:bg-bg-hover/40 transition-colors ${
                    selectedProject?.project_id === p.project_id ? 'bg-bg-hover/60' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white truncate">{p.project_name}</div>
                      <div className="text-[11px] text-gray-500 truncate mt-0.5">
                        {p.customer_name}
                        {p.sales_person && <span className="ml-1.5">· {p.sales_person}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-2">
                      <span className={`text-xs font-bold tabular-nums ${marginColor(p.gross_margin)}`}>
                        {p.gross_margin != null ? `${p.gross_margin}%` : '—'}
                      </span>
                      <span className="text-[11px] text-gray-500 tabular-nums">{fmtAmt(p.deal_amount, p.currency)}</span>
                    </div>
                  </div>
                </button>
              ))}
              {filteredProjects.length === 0 && (
                <EmptyState icon={Briefcase} title="暂无项目" description="暂无有成交额的项目数据" tone="gray" size="sm" />
              )}
            </div>
          </div>

          {/* 右：项目详情 */}
          <div className="rounded-2xl bg-bg-card border border-border/50 p-5">
            {selectedProject ? (
              <div className="space-y-5">
                {/* 项目头部 */}
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-teal-400 rounded-xl blur-md opacity-50" />
                      <div className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 text-[#fff]">
                        <Briefcase size={18} strokeWidth={2.5} />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">{selectedProject.project_name}</h3>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500 flex-wrap">
                        <span>{selectedProject.customer_name}</span>
                        <span>· {selectedProject.currency}</span>
                        {selectedProject.sales_person && <span>· 销售 {selectedProject.sales_person}</span>}
                        {selectedProject.status && (
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${marginBg(selectedProject.gross_margin)} ${marginColor(selectedProject.gross_margin)}`}>
                            {selectedProject.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-black tabular-nums ${marginColor(selectedProject.gross_margin)}`}>
                      {selectedProject.gross_margin != null ? `${selectedProject.gross_margin}%` : '—'}
                    </div>
                    <div className="text-[11px] text-gray-500">毛利率</div>
                  </div>
                </div>

                {/* 指标条 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricBox label="商机" value={fmtAmt(selectedProject.opportunity_amount, selectedProject.currency)} tone="blue" />
                  <MetricBox label="成交" value={fmtAmt(selectedProject.deal_amount, selectedProject.currency)} tone="green" />
                  <MetricBox label="总成本" value={fmtAmt(selectedProject.total_cost, selectedProject.currency)} tone="orange" />
                  <MetricBox label="毛利润" value={fmtAmt(selectedProject.gross_profit, selectedProject.currency)} tone={selectedProject.gross_margin != null && selectedProject.gross_margin >= 30 ? 'green' : selectedProject.gross_margin != null && selectedProject.gross_margin >= 10 ? 'amber' : 'red'} />
                </div>

                {/* 毛利率进度条 */}
                {selectedProject.gross_margin != null && (
                  <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">毛利率进度</span>
                      <span className={`text-xs font-bold ${marginColor(selectedProject.gross_margin)}`}>{selectedProject.gross_margin}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-bg-hover overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, Math.max(2, selectedProject.gross_margin))}%`,
                          background: `linear-gradient(90deg, ${marginBarColor(selectedProject.gross_margin)}, ${marginBarColor(selectedProject.gross_margin)}88)`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-600">
                      <span>0%</span>
                      <span className={marginColor(10)}>10% 警戒线</span>
                      <span className={marginColor(30)}>30% 健康</span>
                      <span>100%</span>
                    </div>
                  </div>
                )}

                {/* 成本明细表 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <IconBox icon={Activity} size="sm" tone="orange" variant="soft" />
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">成本明细</span>
                      <span className="text-[11px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">{selectedProject.cost_items.length}笔</span>
                    </div>
                    {hasPermission('project:edit') && (
                      <button
                        onClick={() => { setAddForm(f => ({ ...f, project_id: selectedProject.project_id })); setShowAdd(true) }}
                        className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                      ><Plus size={10} />新增</button>
                    )}
                  </div>
                  {selectedProject.cost_items.length === 0 ? (
                    <EmptyState icon={DollarSign} title="暂无成本明细" description="点击新增按钮录入成本" tone="gray" size="sm" />
                  ) : (
                    <div className="rounded-xl border border-border/40 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 bg-bg-hover/30">
                            <th className="text-left py-2.5 px-3 font-medium">类别</th>
                            <th className="text-left py-2.5 px-3 font-medium">供应商</th>
                            <th className="text-left py-2.5 px-3 font-medium">描述</th>
                            <th className="text-left py-2.5 px-3 font-medium">月份</th>
                            <th className="text-right py-2.5 px-3 font-medium">金额</th>
                            <th className="text-right py-2.5 px-3 font-medium w-16">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedProject.cost_items.map(item => (
                            <tr key={item.id} className="border-t border-border/20 hover:bg-bg-hover/20 transition-colors">
                              <td className="py-2.5 px-3">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: `${CATEGORY_COLORS[item.category] || '#6B7280'}15`, color: CATEGORY_COLORS[item.category] || '#6B7280' }}>
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[item.category] || '#6B7280' }} />
                                  {item.category}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-gray-300">
                                {item.supplier_id ? (supplierList.find(s => s.id === item.supplier_id)?.name || `#${item.supplier_id}`) : <span className="text-gray-600">—</span>}
                              </td>
                              <td className="py-2.5 px-3 text-gray-300">{item.description || <span className="text-gray-600">—</span>}</td>
                              <td className="py-2.5 px-3 text-gray-500 tabular-nums">{item.cost_month || <span className="text-gray-600">—</span>}</td>
                              <td className="py-2.5 px-3 text-right font-medium text-white tabular-nums">{fmtAmt(item.amount, selectedProject.currency)}</td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => openEditItem(item)} className="p-1 rounded hover:bg-bg-hover text-gray-500 hover:text-blue-400 transition-colors"><Edit3 size={11} /></button>
                                  {hasPermission('project:delete') && (
                                    <button onClick={() => handleDeleteCost(item)} className="p-1 rounded hover:bg-bg-hover text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-bg-hover/20 font-semibold">
                            <td colSpan={4} className="py-2.5 px-3 text-gray-400">合计</td>
                            <td className="py-2.5 px-3 text-right text-white tabular-nums">{fmtAmt(selectedProject.total_cost, selectedProject.currency)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState icon={BarChart3} title="选择项目查看详情" description="点击左侧项目，查看成本利润分析与明细" tone="green" />
            )}
          </div>
        </div>
      )}

      {/* 按供应商 Tab */}
      {tab === 'suppliers' && (
        <div className="space-y-4">
          {supplierCosts.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="暂无供应商成本数据"
              description="在成本明细中关联供应商后，可在此处查看各供应商的成本占比"
              tone="blue"
            />
          ) : (
            <>
              {/* KPI 卡片 */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={Building2} label="合作供应商" value={supplierCosts.length} sub="已发生成本" color="#3B82F6" gradient="radial-gradient(circle, #3B82F6 0%, transparent 70%)" />
                <KpiCard icon={DollarSign} label="累计通道费" value={fmtAmt(supplierCosts.reduce((s, r) => s + r.total_cost, 0))} sub="混合币种，独立结算" color="#F59E0B" gradient="radial-gradient(circle, #F59E0B 0%, transparent 70%)" />
                <KpiCard icon={Briefcase} label="涉及项目" value={new Set(supplierCosts.flatMap(r => Array.from({ length: r.project_count }, () => r.supplier_id))).size} sub="有供应商成本的项目" color="#10B981" gradient="radial-gradient(circle, #10B981 0%, transparent 70%)" />
                <KpiCard icon={Activity} label="成本笔数" value={supplierCosts.reduce((s, r) => s + r.cost_count, 0)} sub="所有供应商成本条目" color="#8B5CF6" gradient="radial-gradient(circle, #8B5CF6 0%, transparent 70%)" />
              </div>

              {/* 供应商成本分布（按币种分组） */}
              {(() => {
                const byCurrency: Record<string, SupplierCostRow[]> = {}
                for (const row of supplierCosts) {
                  const cur = row.settlement_currency
                  if (!byCurrency[cur]) byCurrency[cur] = []
                  byCurrency[cur].push(row)
                }
                const currencies = Object.keys(byCurrency)
                return currencies.map(cur => {
                  const rows = byCurrency[cur].sort((a, b) => b.total_cost - a.total_cost)
                  const total = rows.reduce((s, r) => s + r.total_cost, 0)
                  return (
                    <div key={cur} className="rounded-2xl bg-bg-card border border-border/50 p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                          <IconBox icon={Building2} size="sm" tone="blue" variant="soft" />
                          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">供应商成本分布</h4>
                          <span className="text-[11px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">{cur}</span>
                          <span className="text-[11px] text-gray-600">{rows.length}家供应商</span>
                        </div>
                        <div className="text-xs text-gray-500">合计 <span className="text-amber-400 font-bold tabular-nums">{fmtAmt(total, cur)}</span></div>
                      </div>
                      <div className="space-y-2.5">
                        {rows.map(row => {
                          const pct = total > 0 ? (row.total_cost / total * 100) : 0
                          return (
                            <button
                              key={row.supplier_id}
                              onClick={() => { setTab('projects'); /* 切到项目 tab 左侧可看到该供应商关联的项目 */ }}
                              className="w-full text-left p-3 rounded-xl bg-bg-input/50 border border-border/40 hover:border-border/80 hover:bg-bg-input transition-all"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
                                  {row.supplier_name.slice(0, 1)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="text-sm font-medium text-white truncate">{row.supplier_name}</span>
                                      {row.supplier_code && <span className="text-[11px] text-gray-600 shrink-0">{row.supplier_code}</span>}
                                    </div>
                                    <div className="text-right shrink-0">
                                      <span className="text-sm font-bold text-amber-400 tabular-nums">{fmtAmt(row.total_cost, cur)}</span>
                                      <span className="text-[11px] text-gray-500 ml-2">{pct.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <div className="flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all"
                                        style={{
                                          width: `${Math.max(2, pct)}%`,
                                          background: `linear-gradient(90deg, #3B82F6, #06B6D4)`,
                                        }}
                                      />
                                    </div>
                                    <span className="text-[11px] text-gray-500 shrink-0">{row.cost_count}笔 · {row.project_count}个项目</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              })()}
            </>
          )}
        </div>
      )}

      {/* 新增成本弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <IconBox icon={Plus} size="sm" tone="green" variant="solid" />
                <h3 className="text-sm font-bold text-white">新增成本明细</h3>
              </div>
              <button onClick={() => setShowAdd(false)} className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-bg-hover transition-colors"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">项目 *</label>
                <SearchableSelect
                  options={[{ value: 0, label: '选择项目' }, ...projectList.map(p => ({ value: p.project_id, label: p.project_name }))]}
                  value={addForm.project_id || 0}
                  onChange={(v) => setAddForm(f => ({ ...f, project_id: (v as number) || 0 }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">类别</label>
                  <SearchableSelect
                    options={CATEGORIES.map(c => ({ value: c, label: c }))}
                    value={addForm.category}
                    onChange={(v) => setAddForm(f => ({ ...f, category: v === null ? '' : String(v) }))}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">供应商</label>
                  <SearchableSelect
                    options={[{ value: 0, label: '选择供应商' }, ...supplierList.filter(s => s.status === '合作中').map(s => ({ value: s.id, label: s.name }))]}
                    value={addForm.supplier_id || 0}
                    onChange={(v) => setAddForm(f => ({ ...f, supplier_id: (v as number) || 0 }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">金额（万元）*</label>
                <input
                  type="number" min="0" step="0.01"
                  value={addForm.amount}
                  onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">描述</label>
                <input
                  type="text"
                  value={addForm.description}
                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="如：GPT-4o 通道费"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">月份</label>
                  <input
                    type="month"
                    value={addForm.cost_month}
                    onChange={e => setAddForm(f => ({ ...f, cost_month: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">备注</label>
                  <input
                    type="text"
                    value={addForm.remarks}
                    onChange={e => setAddForm(f => ({ ...f, remarks: e.target.value }))}
                    placeholder="可选"
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-border transition-colors">取消</button>
              <button
                onClick={handleAddCost}
                disabled={!addForm.project_id || !addForm.amount || saving}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50 transition-colors"
              >{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑成本弹窗 */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditingItem(null)}>
          <div className="bg-bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <IconBox icon={Edit3} size="sm" tone="blue" variant="solid" />
                <h3 className="text-sm font-bold text-white">编辑成本明细</h3>
              </div>
              <button onClick={() => setEditingItem(null)} className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-bg-hover transition-colors"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">类别</label>
                  <SearchableSelect
                    options={CATEGORIES.map(c => ({ value: c, label: c }))}
                    value={editForm.category}
                    onChange={(v) => setEditForm(f => ({ ...f, category: v === null ? '' : String(v) }))}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">供应商</label>
                  <SearchableSelect
                    options={[{ value: 0, label: '选择供应商' }, ...supplierList.map(s => ({ value: s.id, label: s.status !== '合作中' ? `${s.name} (${s.status})` : s.name }))]}
                    value={editForm.supplier_id || 0}
                    onChange={(v) => setEditForm(f => ({ ...f, supplier_id: (v as number) || 0 }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">金额（万元）</label>
                <input
                  type="number" min="0" step="0.01"
                  value={editForm.amount}
                  onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">描述</label>
                <input
                  type="text"
                  value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">月份</label>
                  <input
                    type="month"
                    value={editForm.cost_month}
                    onChange={e => setEditForm(f => ({ ...f, cost_month: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">备注</label>
                  <input
                    type="text"
                    value={editForm.remarks}
                    onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditingItem(null)} className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-border transition-colors">取消</button>
              <button
                onClick={handleEditCost}
                disabled={editSaving}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 transition-colors"
              >{editSaving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ──── 子组件 ──── */

function KpiCard({ icon: Icon, label, value, sub, color, gradient }: {
  icon: typeof BarChart3; label: string; value: number | string; sub?: string; color: string; gradient: string
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

function MetricBox({ label, value, tone }: { label: string; value: string; tone: string }) {
  const TONE_MAP: Record<string, { bg: string; border: string; text: string }> = {
    blue:   { bg: '#3B82F608', border: '#3B82F620', text: '#60A5FA' },
    green:  { bg: '#10B98108', border: '#10B98120', text: '#34D399' },
    amber:  { bg: '#F59E0B08', border: '#F59E0B20', text: '#FBBF24' },
    red:    { bg: '#EF444408', border: '#EF444420', text: '#F87171' },
  }
  const t = TONE_MAP[tone] || TONE_MAP.blue
  return (
    <div className="rounded-xl p-3" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
      <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color: t.text }}>{value}</div>
    </div>
  )
}

function ProjectRankRow({ summary, onClick }: { summary: ProjectSummary; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-bg-hover/40 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-300 truncate group-hover:text-white transition-colors">{summary.project_name}</div>
        <div className="text-[11px] text-gray-600 mt-0.5">
          {summary.customer_name} · {fmtAmt(summary.deal_amount, summary.currency)}
          {summary.sales_person && <span className="ml-1">· {summary.sales_person}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-16 h-1.5 rounded-full bg-bg-hover overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(2, summary.gross_margin || 0))}%`,
              background: marginBarColor(summary.gross_margin),
            }}
          />
        </div>
        <span className={`text-xs font-bold tabular-nums w-10 text-right ${marginColor(summary.gross_margin)}`}>
          {summary.gross_margin != null ? `${summary.gross_margin}%` : '—'}
        </span>
      </div>
    </button>
  )
}
