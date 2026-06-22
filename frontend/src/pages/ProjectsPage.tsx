import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Plus, X, Trash2, Loader2, Briefcase, Edit3, Save, Calendar, User, Building2, Activity, Search, Link2, ExternalLink, Pin, Cloud, Sparkles, RefreshCw, Tag, Filter, ChevronDown, FileText, Target, CheckCircle2, Zap, BarChart3, Hash, LayoutGrid, List, TrendingUp, Clock, Wrench, GitBranch, AlertTriangle } from 'lucide-react'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { ProjectFormModal } from '../components/projects/ProjectFormModal'
import { ProjectCard, ProjectRow, formatAmount } from '../components/projects/ProjectCard'
import { PageHeader } from '../components/design-system'

interface Project {
  id: number; name: string; opportunity_amount: number | null; deal_amount: number | null; currency: string; customer_name: string; customer_id: number | null
  product: string | null; project_scenario: string | null
  sales_person: string | null; tech_support_person: string | null; status: string; progress: string | null
  analysis: string | null
  cloud_provider: string | null
  files_json?: string | null
  start_date: string | null; termination_date: string | null; deadline: string | null; created_at: string; updated_at: string
  upstream_channels: string | null
  models: string | null
  monthly_call_volume: string | null
  usage_scenario: string | null
  contract_period: string | null
  discount_rate: number | null
  cost_amount: number | null
  gross_margin: number | null
  contract_count?: number
}

interface LinkedContract {
  id: number; title: string; contract_no: string; status: string
  contract_amount: number | null; currency: string
  sign_date: string | null; start_date: string | null; end_date: string | null
  party_a: string; party_b: string
}

interface MeetingLink {
  id: number; title: string; meeting_date: string
}

interface CostItem {
  id: number; category: string; description: string; amount: number
  cost_month: string | null; supplier_id: number | null
}

interface CostSummary {
  total_cost: number
  gross_profit: number | null
  gross_margin: number | null
  cost_items: CostItem[]
}

interface FieldOption {
  id: number; category: string; value: string; sort_order: number
}

export default function ProjectsPage() {
  const { hasPermission } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  
  const [viewLayout, setViewLayout] = useState<'card' | 'list'>(() => (localStorage.getItem('projectsViewLayout') as 'card' | 'list') || 'card')
  useEffect(() => { localStorage.setItem('projectsViewLayout', viewLayout) }, [viewLayout])
  const [options, setOptions] = useState<Record<string, string[]>>({})
  const [searchText, setSearchText] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [selectedScenario, setSelectedScenario] = useState<string>('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [modalProject, setModalProject] = useState<Project | null>(null)
  const [linkedMeetings, setLinkedMeetings] = useState<MeetingLink[]>([])
  const [linkedContracts, setLinkedContracts] = useState<LinkedContract[]>([])
  const [allMeetings, setAllMeetings] = useState<MeetingLink[]>([])
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<Set<number>>(new Set())
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null)

  // 快捷跟进
  const [quickProgressOpen, setQuickProgressOpen] = useState(false)
  const [quickText, setQuickText] = useState('')
  const [quickDate, setQuickDate] = useState(new Date().toISOString().slice(0, 10))
  const [quickSaving, setQuickSaving] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<number | null>(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [submittingCharter, setSubmittingCharter] = useState(false)

  // 客户列表（用于关联选择）
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([])

  const loadProjects = useCallback(() => {
    setLoading(true)
    fetch('/api/v1/projects')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProjects(data)
        } else {
          console.warn('[loadProjects] non-array response:', data)
        }
        setLoading(false)
      })
      .catch((e) => { console.error('[loadProjects] error:', e); setLoading(false) })
  }, [])

  const loadOptions = () => {
    fetch('/api/v1/settings/field-options')
      .then((res) => res.json()).then((data) => {
        const map: Record<string, string[]> = {}
        ;(data as FieldOption[]).forEach((o) => {
          if (!map[o.category]) map[o.category] = []
          map[o.category].push(o.value)
        })
        setOptions(map)
      })
  }

  const loadMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/meetings')
      const data = await res.json()
      setAllMeetings((data || []).map((m: { id: number; title: string; meeting_date: string }) => ({
        id: m.id, title: m.title, meeting_date: m.meeting_date
      })))
    } catch { /* ignore */ }
  }, [])

  const loadCustomers = useCallback(() => {
    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => setCustomers(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => {})
  }, [])

  const loadLinkedMeetings = async (pid: number) => {
    try {
      const res = await fetch(`/api/v1/projects/${pid}/meetings`)
      const data = await res.json()
      setLinkedMeetings(data || [])
    } catch {
      setLinkedMeetings([])
    }
  }

  const loadLinkedContracts = async (pid: number) => {
    try {
      const res = await fetch(`/api/v1/projects/${pid}/contracts`)
      if (!res.ok) { setLinkedContracts([]); return }
      const data = await res.json()
      setLinkedContracts(Array.isArray(data) ? data : [])
    } catch {
      setLinkedContracts([])
    }
  }

  const loadCostSummary = async (pid: number) => {
    try {
      const res = await fetch(`/api/v1/project-costs/project/${pid}`)
      if (!res.ok) { setCostSummary(null); return }
      const data = await res.json()
      setCostSummary(data)
    } catch {
      setCostSummary(null)
    }
  }

  // 挂载触发监听
  useEffect(() => {
    loadProjects()
    loadOptions()
    loadMeetings()
    loadCustomers()
  }, [loadProjects, loadMeetings, loadCustomers])

  // 从 URL 参数自动打开项目详情
  useEffect(() => {
    const projectId = searchParams.get('project')
    if (projectId && projects.length > 0) {
      const p = projects.find((x) => x.id === Number(projectId))
      if (p) {
        openDetail(p)
        setSearchParams({}, { replace: true })
      }
    }
  }, [projects, searchParams])

  const openCreate = () => {
    setEditingId(null)
    setSelectedMeetingIds(new Set())
    setShowForm(true)
  }

  const openEdit = (p: Project) => {
    setEditingId(p.id)
    loadLinkedMeetings(p.id)
    setShowForm(true)
  }

  const openDetail = (p: Project) => {
    setModalProject(p)
    loadLinkedMeetings(p.id)
    loadLinkedContracts(p.id)
    loadCostSummary(p.id)
  }

  const closeDetail = () => { setModalProject(null); setQuickProgressOpen(false); setQuickText(''); setQuickDate(new Date().toISOString().slice(0, 10)); setCostSummary(null) }

  const handleQuickProgress = async () => {
    if (!quickText.trim() || !modalProject) return
    setQuickSaving(true)
    try {
      const dateStr = new Date(quickDate).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
      const newEntry = `📌 ${dateStr}\n${quickText.trim()}`
      // 新内容追加到现有进展后面
      const updated = modalProject.progress
        ? modalProject.progress + '\n\n---\n\n' + newEntry
        : newEntry
      await fetch(`/api/v1/projects/${modalProject.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: updated }),
      })
      // 更新弹窗数据
      setModalProject({ ...modalProject, progress: updated, updated_at: new Date().toISOString() })
      setQuickText('')
      setQuickDate(new Date().toISOString().slice(0, 10))
      setQuickProgressOpen(false)
      loadProjects()
      showToast('跟进记录已保存', 'success')
      // 自动触发 AI 分析
      analyzeProject(modalProject.id)
    } catch { /* ignore */ }
    finally { setQuickSaving(false) }
  }

  const analyzeProject = async (projectId: number) => {
    setAnalyzingId(projectId)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/ai-analysis`, { method: 'POST' })
      const data = await res.json()
      if (data.analysis) {
        // 更新本地数据
        setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, analysis: data.analysis } : p))
        if (modalProject?.id === projectId) {
          setModalProject({ ...modalProject, analysis: data.analysis })
        }
      }
    } catch { /* ignore */ }
    finally { setAnalyzingId(null) }
  }

  const handleDelete = async (id: number) => {
    if (!await showConfirm('确定删除此项目？')) return
    const res = await fetch(`/api/v1/projects/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      showToast(err.detail || `删除失败 (${res.status})`, 'error')
      return
    }
    if (modalProject?.id === id) setModalProject(null)
    loadProjects()
    showToast('项目已删除', 'success')
  }

  const handleSubmitCharter = async (projectId: number) => {
    setSubmittingCharter(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); showToast(e.detail || '提交失败', 'error'); return }
      const data = await res.json()
      showToast(data.message || '立项申请已提交', 'success')
      loadProjects()
      if (modalProject?.id === projectId) {
        setModalProject(p => p ? { ...p, status: data.status } : p)
      }
    } catch { showToast('提交失败', 'error') } finally { setSubmittingCharter(false) }
  }

  // 动态状态颜色：基于字符串哈希生成，任意自定义状态自动适配
  const STATUS_PALETTES = [
    'text-blue-400 bg-blue-500/10 border-blue-500/20',
    'text-green-400 bg-green-500/10 border-green-500/20',
    'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    'text-red-400 bg-red-500/10 border-red-500/20',
    'text-purple-400 bg-purple-500/10 border-purple-500/20',
    'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    'text-orange-400 bg-orange-500/10 border-orange-500/20',
    'text-pink-400 bg-pink-500/10 border-pink-500/20',
    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  ]

  const getStatusColor = (status: string): string => {
    let hash = 0
    for (let i = 0; i < status.length; i++) {
      hash = ((hash << 5) - hash) + status.charCodeAt(i)
      hash |= 0
    }
    return STATUS_PALETTES[Math.abs(hash) % STATUS_PALETTES.length]
  }

  // 产品 + 状态 + 场景 + 搜索 多维度筛选（搜索支持名称/客户/产品/场景/状态关键词）
  const filtered = projects.filter((p) => {
    const matchSearch = !searchText || p.name.includes(searchText) || p.customer_name.includes(searchText) || (p.product || '').includes(searchText) || (p.project_scenario || '').includes(searchText) || p.status.includes(searchText)
    const matchProduct = !selectedProduct || (p.product || '').split(',').some(v => v.trim() === selectedProduct)
    const matchStatus = !selectedStatus || p.status === selectedStatus
    const matchScenario = !selectedScenario || p.project_scenario === selectedScenario
    return matchSearch && matchProduct && matchStatus && matchScenario
  })

  // 提取标签选项（交叉计数：只显示同维度其他筛选条件下仍有数据的标签）
  const products = [...new Set(projects.flatMap((p) => (p.product || '').split(',').map(s => s.trim()).filter(Boolean)))] as string[]
  const statuses = [...new Set(projects.map((p) => p.status).filter(Boolean))] as string[]
  const scenarios = [...new Set(projects.map((p) => p.project_scenario).filter(Boolean))] as string[]

  // 标签交叉计数：计算每个标签在当前其他筛选条件下的项目数
  const productCounts = (prod: string) => projects.filter((p) =>
    (p.product || '').split(',').some(v => v.trim() === prod) && (!selectedStatus || p.status === selectedStatus) && (!selectedScenario || p.project_scenario === selectedScenario)
  ).length
  const statusCounts = (st: string) => projects.filter((p) =>
    p.status === st && (!selectedProduct || (p.product || '').split(',').some(v => v.trim() === selectedProduct)) && (!selectedScenario || p.project_scenario === selectedScenario)
  ).length
  const scenarioCounts = (sc: string) => projects.filter((p) =>
    p.project_scenario === sc && (!selectedProduct || (p.product || '').split(',').some(v => v.trim() === selectedProduct)) && (!selectedStatus || p.status === selectedStatus)
  ).length

  const hasActiveFilter = selectedProduct || selectedStatus || selectedScenario
  const clearAllFilters = () => { setSelectedProduct(''); setSelectedStatus(''); setSelectedScenario('') }

  const inputClass = "w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
  const labelClass = "block text-xs text-gray-400 mb-1.5"

  return (
    <div>
      {/* 顶部标题行 */}
      <PageHeader
        icon={Briefcase}
        title="项目管理"
        description="管理您负责的所有项目，跟进进度并推动成交"
        tone="blue"
        stats={[{ label: '项目', value: projects.length }]}
        right={
          <>
            {/* 视图切换：列表 / 卡片 */}
            <div className="flex items-center p-0.5 rounded-lg bg-bg-hover/60 border border-border">
              <button
                onClick={() => setViewLayout('card')}
                title="卡片视图"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                  viewLayout === 'card'
                    ? 'bg-bg-card text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <LayoutGrid size={12} />卡片
              </button>
              <button
                onClick={() => setViewLayout('list')}
                title="列表视图"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                  viewLayout === 'list'
                    ? 'bg-bg-card text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <List size={12} />列表
              </button>
            </div>
            {hasPermission('project:create') && (
              <button onClick={openCreate} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#3B82F6] text-[#fff] text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer">
                <Plus size={14} strokeWidth={2.5} /><span>新建项目</span>
              </button>
            )}
          </>
        }
      />

      {/* 一体化搜索+筛选栏 */}
      <div className="relative mb-6">
        <div className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-bg-card border border-border shadow-sm hover:border-[#3B82F6]/40 focus-within:border-[#3B82F6] focus-within:shadow-md transition-all group/bar">
          <Search size={15} className="text-gray-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="搜索项目名称、客户、产品、场景、状态..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="bg-transparent text-sm text-gray-300 outline-none flex-1 min-w-0 placeholder-gray-600"
          />

          {/* 激活的筛选标签 */}
          {selectedStatus && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 animate-in fade-in whitespace-nowrap">
              {selectedStatus}
              <button onClick={() => setSelectedStatus('')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
          {selectedProduct && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30 animate-in fade-in whitespace-nowrap">
              {selectedProduct}
              <button onClick={() => setSelectedProduct('')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}
          {selectedScenario && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 animate-in fade-in whitespace-nowrap">
              {selectedScenario}
              <button onClick={() => setSelectedScenario('')} className="hover:text-white"><X size={10} /></button>
            </span>
          )}

          {/* 筛选按钮 + 下拉 */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                hasActiveFilter
                  ? 'bg-[#3B82F6]/20 text-[#3B82F6] border-[#3B82F6]/40'
                  : 'bg-bg-hover text-gray-400 border-border hover:text-gray-300 hover:border-gray-500'
              }`}
            >
              <Filter size={11} />
              筛选
              <ChevronDown size={10} className={`transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* 筛选弹出面板 */}
            {filterOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 p-4 rounded-xl bg-bg-card border border-border shadow-2xl z-30 animate-in fade-in slide-in-from-top-2">
                {/* 遮罩点击关闭 */}
                <div className="fixed inset-0 z-[-1]" onClick={() => setFilterOpen(false)} />

                {/* 状态 */}
                {statuses.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">状态</div>
                    <div className="flex flex-wrap gap-1.5">
                      {statuses.map((st) => {
                        const cnt = statusCounts(st)
                        if (cnt === 0) return null
                        return (
                          <button
                            key={st}
                            onClick={() => setSelectedStatus(selectedStatus === st ? '' : st)}
                            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                              selectedStatus === st
                                ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                                : 'bg-bg-hover text-gray-400 border-transparent hover:border-border hover:text-gray-300'
                            }`}
                          >
                            {st}<span className="text-[11px] opacity-50 ml-1">{cnt}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 产品 */}
                {products.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">产品</div>
                    <div className="flex flex-wrap gap-1.5">
                      {products.map((prod) => {
                        const cnt = productCounts(prod)
                        if (cnt === 0) return null
                        return (
                          <button
                            key={prod}
                            onClick={() => setSelectedProduct(selectedProduct === prod ? '' : prod)}
                            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                              selectedProduct === prod
                                ? 'bg-[#F59E0B]/20 text-[#FBBF24] border-[#F59E0B]/40'
                                : 'bg-bg-hover text-gray-400 border-transparent hover:border-border hover:text-gray-300'
                            }`}
                          >
                            {prod}<span className="text-[11px] opacity-50 ml-1">{cnt}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 场景 */}
                {scenarios.length > 0 && (
                  <div>
                    <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">场景</div>
                    <div className="flex flex-wrap gap-1.5">
                      {scenarios.map((sc) => {
                        const cnt = scenarioCounts(sc)
                        if (cnt === 0) return null
                        return (
                          <button
                            key={sc}
                            onClick={() => setSelectedScenario(selectedScenario === sc ? '' : sc)}
                            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                              selectedScenario === sc
                                ? 'bg-green-500/20 text-green-400 border-green-500/40'
                                : 'bg-bg-hover text-gray-400 border-transparent hover:border-border hover:text-gray-300'
                            }`}
                          >
                            {sc}<span className="text-[11px] opacity-50 ml-1">{cnt}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 清除按钮 */}
                {hasActiveFilter && (
                  <button onClick={() => { clearAllFilters(); setFilterOpen(false) }}
                    className="mt-4 text-[11px] text-[#3B82F6] hover:underline w-full text-center">
                    清除全部筛选
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 清除搜索 */}
          {(searchText || hasActiveFilter) && (
            <button
              onClick={() => { setSearchText(''); clearAllFilters() }}
              className="p-1 rounded-md hover:bg-bg-hover text-gray-500 hover:text-white transition-colors flex-shrink-0"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500"><Loader2 size={28} className="mx-auto animate-spin mb-3" />加载中...</div>
      ) : filtered.length === 0 && projects.length > 0 ? (
        <div className="text-center py-20">
          <Briefcase size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-3">没有匹配的项目</p>
          <button onClick={() => { setSearchText(''); clearAllFilters() }} className="text-sm text-[#3B82F6] hover:underline">清除筛选</button>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <Briefcase size={48} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 mb-3">暂无项目</p>
          <button onClick={openCreate} className="text-sm text-[#3B82F6] hover:underline">创建第一个项目</button>
        </div>
      ) : viewLayout === 'card' ? (
        <>
          {/* 项目卡片网格（现代设计）*/}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => openDetail(p)}
                onOpenCustomer={(cid) => navigate(`/customers?customer=${cid}`)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          {/* 项目列表视图（紧凑表格）*/}
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1280px]">
                <thead className="bg-bg-hover/50 text-[11px] text-gray-500 uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">项目</th>
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">客户 / 负责人</th>
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">状态</th>
                    <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">商机</th>
                    <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">成交</th>
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">产品 / 模型</th>
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">调用量 / 时间节点</th>
                    <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap">合同</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.map((p) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      onOpen={() => openDetail(p)}
                      onOpenCustomer={(cid) => navigate(`/customers?customer=${cid}`)}
                      onOpenContracts={(pid) => navigate(`/contracts?project=${pid}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 全屏详情弹窗 */}
      {modalProject && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end md:items-start justify-center md:pt-[6vh] pb-0 md:pb-10 overflow-y-auto" onClick={closeDetail}>
          <div className="w-full max-w-2xl mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header —— 精简：项目名 + 状态 + 客户 + 操作 */}
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 md:px-6 py-4 border-b border-border bg-bg-card rounded-t-none md:rounded-t-2xl">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">{modalProject.name}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border flex-shrink-0 ${getStatusColor(modalProject.status)}`}>{modalProject.status}</span>
                </div>
                {modalProject.customer_name && (
                  <button
                    onClick={() => modalProject.customer_id && window.open(`/customers?customer=${modalProject.customer_id}`, '_blank')}
                    disabled={!modalProject.customer_id}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-[#3B82F6] transition-colors"
                  >
                    <Building2 size={11} />{modalProject.customer_name}
                    {modalProject.customer_id && <ExternalLink size={10} />}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                {hasPermission('project:edit') && (modalProject.status === '待立项') && (
                  <button
                    onClick={() => handleSubmitCharter(modalProject.id)}
                    disabled={submittingCharter}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold text-amber-400 border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                  >
                    {submittingCharter ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
                    提交立项
                  </button>
                )}
                {hasPermission('project:edit') && (
                  <button onClick={() => { closeDetail(); openEdit(modalProject) }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white transition-colors border border-border"><Edit3 size={12} className="inline mr-1" />编辑</button>
                )}
                {hasPermission('project:delete') && (
                  <button onClick={() => handleDelete(modalProject.id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border border-border"><Trash2 size={13} /></button>
                )}
                <button onClick={closeDetail} className="p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
              </div>
            </div>

            <div className="p-4 md:p-6 space-y-4">
              {/* ② 财务利润专区（MaaS 核心） */}
              {(() => {
                const op = formatAmount(modalProject.opportunity_amount, modalProject.currency)
                const deal = formatAmount(modalProject.deal_amount, modalProject.currency)
                const cost = formatAmount(modalProject.cost_amount, modalProject.currency)
                const hasAny = op.hasValue || deal.hasValue || cost.hasValue || modalProject.gross_margin != null
                if (!hasAny) return null
                const grossProfit = modalProject.deal_amount != null && modalProject.cost_amount != null
                  ? modalProject.deal_amount - modalProject.cost_amount : null
                const gp = formatAmount(grossProfit, modalProject.currency)
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {op.hasValue && (
                      <div className="rounded-lg bg-blue-50/70 dark:bg-blue-500/5 px-3 py-2.5">
                        <div className="text-[11px] text-blue-600/70 dark:text-blue-400/70 font-medium">商机金额</div>
                        <div className="text-base font-bold text-blue-700 dark:text-blue-300 tabular-nums mt-0.5">{op.symbol}{op.display}<span className="text-[11px] font-normal ml-0.5 opacity-70">{op.unit}</span></div>
                      </div>
                    )}
                    {deal.hasValue && (
                      <div className="rounded-lg bg-emerald-50/70 dark:bg-emerald-500/5 px-3 py-2.5">
                        <div className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 font-medium">成交金额</div>
                        <div className="text-base font-bold text-emerald-700 dark:text-emerald-300 tabular-nums mt-0.5">{deal.symbol}{deal.display}<span className="text-[11px] font-normal ml-0.5 opacity-70">{deal.unit}</span></div>
                      </div>
                    )}
                    {cost.hasValue && (
                      <div className="rounded-lg bg-amber-50/70 dark:bg-amber-500/5 px-3 py-2.5">
                        <div className="text-[11px] text-amber-600/70 dark:text-amber-400/70 font-medium">内部成本</div>
                        <div className="text-base font-bold text-amber-700 dark:text-amber-300 tabular-nums mt-0.5">{cost.symbol}{cost.display}<span className="text-[11px] font-normal ml-0.5 opacity-70">{cost.unit}</span></div>
                      </div>
                    )}
                    {(modalProject.gross_margin != null || gp.hasValue) && (
                      <div className="rounded-lg bg-green-50/70 dark:bg-green-500/5 px-3 py-2.5">
                        <div className="text-[11px] text-green-600/70 dark:text-green-400/70 font-medium flex items-center gap-1">
                          毛利率
                          {modalProject.discount_rate != null && <span className="opacity-70">· 折扣{modalProject.discount_rate}%</span>}
                        </div>
                        <div className="text-base font-bold text-green-700 dark:text-green-300 tabular-nums mt-0.5">
                          {modalProject.gross_margin != null && <span>{modalProject.gross_margin}%</span>}
                          {gp.hasValue && <span className="ml-1.5 text-sm">({gp.symbol}{gp.display}{gp.unit})</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ③ 项目信息网格 */}
              {(() => {
                const split = (s: string | null) => s ? s.split(',').map(x => x.trim()).filter(Boolean) : []
                const products = split(modalProject.product)
                const channels = split(modalProject.upstream_channels)
                const models = split(modalProject.models)
                const clouds = split(modalProject.cloud_provider)
                const items: { icon: any; label: string; value: string }[] = []
                if (modalProject.sales_person) items.push({ icon: User, label: '销售', value: modalProject.sales_person })
                if (modalProject.tech_support_person) items.push({ icon: Wrench, label: '技术支持', value: modalProject.tech_support_person })
                if (products.length) items.push({ icon: Pin, label: '产品', value: products.join(' / ') })
                if (modalProject.project_scenario) items.push({ icon: Target, label: '场景', value: modalProject.project_scenario })
                if (clouds.length) items.push({ icon: Cloud, label: '云厂商', value: clouds.join(' / ') })
                if (channels.length) items.push({ icon: Activity, label: '上游通道', value: channels.join(' / ') })
                if (models.length) items.push({ icon: Zap, label: '模型', value: models.join(' / ') })
                if (modalProject.monthly_call_volume) items.push({ icon: BarChart3, label: '月调用量', value: modalProject.monthly_call_volume })
                if (modalProject.contract_period) items.push({ icon: Hash, label: '合同期', value: modalProject.contract_period })
                if (modalProject.usage_scenario) items.push({ icon: Tag, label: '使用场景', value: modalProject.usage_scenario })
                const dateParts: string[] = []
                if (modalProject.start_date) dateParts.push(new Date(modalProject.start_date).toLocaleDateString('zh-CN'))
                if (modalProject.termination_date) dateParts.push(`→ 终止 ${new Date(modalProject.termination_date).toLocaleDateString('zh-CN')}`)
                else if (modalProject.deadline) dateParts.push(`→ ${new Date(modalProject.deadline).toLocaleDateString('zh-CN')}`)
                if (dateParts.length) items.push({ icon: Calendar, label: '起止', value: dateParts.join(' ') })
                if (!items.length) return null
                return (
                  <div className="rounded-xl bg-bg-input border border-border p-3">
                    <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-2 px-1">项目信息</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                      {items.map((it, i) => {
                        const Icon = it.icon
                        return (
                          <div key={i} className="flex items-start gap-1.5 min-w-0">
                            <Icon size={11} className="text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[11px] text-gray-400 dark:text-gray-500">{it.label} </span>
                              <span className="text-xs text-gray-700 dark:text-gray-200 break-words">{it.value}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* 待立项提示 */}
              {(modalProject.status === '待立项' || modalProject.status === '审批中') && (
                <div className={`rounded-xl p-3 flex items-start gap-3 border ${
                  modalProject.status === '审批中'
                    ? 'bg-blue-500/5 border-blue-500/20'
                    : 'bg-amber-500/5 border-amber-500/20'
                }`}>
                  <AlertTriangle size={14} className={modalProject.status === '审批中' ? 'text-blue-400 mt-0.5 shrink-0' : 'text-amber-400 mt-0.5 shrink-0'} />
                  <div>
                    <p className={`text-xs font-semibold ${modalProject.status === '审批中' ? 'text-blue-300' : 'text-amber-300'}`}>
                      {modalProject.status === '审批中' ? '立项审批中，暂不可协调资源' : '待立项：尚未正式立项，无法协调资源'}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {modalProject.status === '审批中'
                        ? '审批通过后项目自动变为「进行中」状态'
                        : '点击「提交立项」发起审批流，经部门主管、商务、老板审批后正式立项'}
                    </p>
                  </div>
                </div>
              )}

              {/* 审批进度 */}
              {(modalProject.status === '审批中' || modalProject.status === '已驳回') && (
                <ApprovalTimeline
                  targetType="project"
                  targetId={modalProject.id}
                  onChanged={() => {
                    loadProjects()
                    if (modalProject) {
                      fetch(`/api/v1/projects/${modalProject.id}`)
                        .then(r => r.json())
                        .then(p => setModalProject(p))
                        .catch(() => {})
                    }
                  }}
                />
              )}

              {/* ④ 成本明细 */}
              {costSummary && costSummary.cost_items.length > 0 && (
                <div className="rounded-xl bg-bg-input border border-border overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-bg-card/50">
                    <BarChart3 size={13} className="text-amber-400" />
                    <span className="text-xs font-medium text-gray-300">成本明细</span>
                    <span className="ml-auto text-[11px] text-gray-500">
                      合计 <span className="text-amber-400 font-semibold">¥{costSummary.total_cost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
                      {costSummary.gross_margin != null && <span className="ml-2">毛利率 <span className="text-green-400 font-semibold">{costSummary.gross_margin}%</span></span>}
                    </span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {costSummary.cost_items.map((c) => (
                      <div key={c.id} className="px-4 py-2 flex items-center gap-2 text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 text-[11px] shrink-0">{c.category}</span>
                        <span className="text-gray-600 dark:text-gray-400 truncate flex-1">{c.description || '—'}</span>
                        {c.cost_month && <span className="text-gray-500 text-[11px] shrink-0">{c.cost_month}</span>}
                        <span className="text-gray-700 dark:text-gray-200 font-semibold tabular-nums shrink-0">¥{c.amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ⑤ 关联合同 + 关联会议 */}
              {(linkedContracts.length > 0 || linkedMeetings.length > 0) && (
                <div className="rounded-xl bg-bg-input border border-border overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-bg-card/50">
                    <FileText size={13} className="text-blue-400" />
                    <span className="text-xs font-medium text-gray-300">关联合同与会议</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {linkedContracts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { closeDetail(); navigate(`/contracts?project=${c.id}`) }}
                        className="w-full px-4 py-2 flex items-center gap-2 text-xs hover:bg-bg-hover/40 transition-colors text-left"
                      >
                        <FileText size={11} className="text-emerald-400 shrink-0" />
                        <span className="text-gray-300 truncate flex-1">{c.title}</span>
                        <span className="text-gray-500 text-[11px] shrink-0">{c.contract_no}</span>
                        {c.contract_amount != null && <span className="text-emerald-400 font-semibold tabular-nums shrink-0">¥{c.contract_amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>}
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[11px] shrink-0">{c.status}</span>
                      </button>
                    ))}
                    {linkedMeetings.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { closeDetail(); navigate(`/meetings?meeting=${m.id}`) }}
                        className="w-full px-4 py-2 flex items-center gap-2 text-xs hover:bg-bg-hover/40 transition-colors text-left"
                      >
                        <Activity size={11} className="text-purple-400 shrink-0" />
                        <span className="text-gray-300 truncate flex-1">{m.title}</span>
                        <span className="text-gray-500 text-[11px] shrink-0">{m.meeting_date ? new Date(m.meeting_date).toLocaleDateString('zh-CN') : ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AI 项目分析（默认收起） */}
              <div className="rounded-xl bg-bg-input border border-border overflow-hidden">
                <button
                  onClick={() => setAnalysisOpen(!analysisOpen)}
                  className="w-full px-4 py-3 flex items-center gap-2 bg-bg-card/50 hover:bg-bg-hover/30 transition-colors text-left"
                >
                  <Sparkles size={14} className="text-[#F59E0B]" />
                  <span className="text-xs font-medium text-gray-300">AI 项目分析</span>
                  {modalProject.analysis && (
                    <span className="text-[11px] text-gray-500 ml-1">({modalProject.analysis.slice(0, 40).replace(/[#*\n]/g, '').trim()}…)</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); analyzeProject(modalProject.id) }}
                    disabled={analyzingId === modalProject.id}
                    className="ml-auto mr-2 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border border-transparent text-gray-500 hover:text-gray-300 hover:border-border transition-colors disabled:opacity-50"
                  >
                    {analyzingId === modalProject.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <RefreshCw size={11} />
                    )}
                    {analyzingId === modalProject.id ? '分析中...' : '刷新'}
                  </button>
                  <ChevronDown size={14} className={`text-gray-500 transition-transform ${analysisOpen ? 'rotate-180' : ''}`} />
                </button>
                {analysisOpen && (
                  <div className="p-4">
                    {modalProject.analysis ? (
                      <MarkdownRenderer content={modalProject.analysis} className="text-sm text-gray-300 leading-relaxed" />
                    ) : analyzingId === modalProject.id ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                        <Loader2 size={14} className="animate-spin text-[#F59E0B]" />
                        AI 正在分析项目，请稍候...
                      </div>
                    ) : (
                      <div className="text-center py-3">
                        <p className="text-sm text-gray-600 mb-2">暂无 AI 分析</p>
                        <button
                          onClick={() => analyzeProject(modalProject.id)}
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] hover:bg-[#F59E0B]/20 transition-colors"
                        >
                          <Sparkles size={12} />生成分析
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Hero: 跟进记录 */}
              <div className="rounded-xl bg-bg-input border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-bg-card/50">
                  <Activity size={14} className="text-[#3B82F6]" />
                  <span className="text-xs font-medium text-gray-300">跟进记录</span>
                  <button
                    onClick={() => { setQuickProgressOpen(!quickProgressOpen); setQuickText(''); setQuickDate(new Date().toISOString().slice(0, 10)) }}
                    className={`ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg border transition-colors ${quickProgressOpen ? 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30' : 'text-gray-500 border-transparent hover:text-gray-300 hover:border-border'}`}
                  >
                    <Plus size={11} />{quickProgressOpen ? '收起' : '新增'}
                  </button>
                </div>

                {/* 快捷输入 */}
                {quickProgressOpen && (
                  <div className="px-4 py-3 border-b border-border bg-bg-input/50">
                    <div className="flex items-center gap-3 mb-2">
                      <label className="text-[11px] text-gray-500 flex-shrink-0">日期</label>
                      <input
                        type="date"
                        value={quickDate}
                        onChange={(e) => setQuickDate(e.target.value)}
                        className="px-2 py-1 rounded-md bg-bg-card border border-border text-xs text-gray-300 outline-none focus:border-[#3B82F6]"
                      />
                    </div>
                    <textarea
                      value={quickText}
                      onChange={(e) => setQuickText(e.target.value)}
                      placeholder="记录本次跟进内容..."
                      className="w-full h-20 p-3 rounded-lg bg-bg-card border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] resize-none placeholder-gray-600"
                      autoFocus
                    />
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[11px] text-gray-600">新记录将追加到现有进展之后</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setQuickProgressOpen(false); setQuickText(''); setQuickDate(new Date().toISOString().slice(0, 10)) }}
                          className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white transition-colors"
                        >取消</button>
                        <button
                          onClick={handleQuickProgress}
                          disabled={quickSaving || !quickText.trim()}
                          className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg bg-[#3B82F6] text-[#fff] hover:bg-blue-600 disabled:opacity-50 transition-all"
                        >
                          {quickSaving && <Loader2 size={11} className="animate-spin" />}
                          {quickSaving ? '保存中...' : '保存'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="p-4 max-h-96 overflow-y-auto">
                  {modalProject.progress ? (
                    (() => {
                      // 按 --- 分割条目，每段格式: 📌 日期\n内容
                      const entries = modalProject.progress.split(/\n?---\n?/).reduce<{date: string; content: string}[]>((acc, block) => {
                        const trimmed = block.trim()
                        if (!trimmed) return acc
                        const match = trimmed.match(/^📌\s*(.+)/)
                        if (match) {
                          const lines = trimmed.split('\n')
                          acc.push({ date: match[1].trim(), content: lines.slice(1).join('\n').trim() })
                        } else {
                          acc.push({ date: '', content: trimmed })
                        }
                        return acc
                      }, [])
                      // 反转使最新在上
                      entries.reverse()
                      const dotColors = [
                        { dot: '#3B82F6', bg: '#3B82F6', soft: '#3B82F610', border: '#3B82F630' },
                        { dot: '#8B5CF6', bg: '#8B5CF6', soft: '#8B5CF610', border: '#8B5CF630' },
                        { dot: '#10B981', bg: '#10B981', soft: '#10B98110', border: '#10B98130' },
                        { dot: '#F59E0B', bg: '#F59E0B', soft: '#F59E0B10', border: '#F59E0B30' },
                        { dot: '#EC4899', bg: '#EC4899', soft: '#EC489910', border: '#EC489930' },
                      ]
                      return (
                        <div className="relative pl-6">
                          {/* 时间线竖线 */}
                          <div className="absolute left-[11px] top-1 bottom-1 w-0.5 rounded-full bg-gradient-to-b from-[#3B82F6]/40 via-[#8B5CF6]/20 to-transparent" />
                          <div className="space-y-4">
                            {entries.map((entry, i) => {
                              const color = dotColors[i % dotColors.length]
                              const isEmpty = !entry.content
                              return (
                                <div key={i} className="relative group/timeline">
                                  {/* 时间点 */}
                                  <div
                                    className={`absolute -left-6 top-1.5 w-[13px] h-[13px] rounded-full border-2 flex items-center justify-center transition-transform group-hover/timeline:scale-125 ${
                                      isEmpty ? 'border-gray-700 bg-bg-card' : ''
                                    }`}
                                    style={isEmpty ? {} : { borderColor: color.dot, backgroundColor: color.soft }}
                                  >
                                    <div
                                      className="w-[5px] h-[5px] rounded-full"
                                      style={{ backgroundColor: isEmpty ? '#4B5563' : color.bg }}
                                    />
                                  </div>
                                  {/* 卡片内容 */}
                                  <div
                                    className={`rounded-xl border overflow-hidden transition-colors ${
                                      isEmpty
                                        ? 'bg-bg-input/30 border-border/50'
                                        : ''
                                    }`}
                                    style={isEmpty ? {} : { backgroundColor: color.soft, borderColor: color.border }}
                                  >
                                    {/* 日期条 */}
                                    <div className="flex items-center justify-between px-3 py-2 border-b border-bg-card/30">
                                      {entry.date ? (
                                        <span className="text-[11px] font-mono font-medium" style={{ color: color.dot }}>
                                          📅 {entry.date}
                                        </span>
                                      ) : (
                                        <span className="text-[11px] text-gray-600 font-mono">无日期</span>
                                      )}
                                      <span className="text-[11px] text-gray-600 bg-bg-card/50 px-1.5 py-0.5 rounded">
                                        #{entries.length - i}
                                      </span>
                                    </div>
                                    {/* 内容 */}
                                    {entry.content && (
                                      <div className="px-3 py-2.5">
                                        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{entry.content}</p>
                                      </div>
                                    )}
                                    {isEmpty && (
                                      <div className="px-3 py-2">
                                        <p className="text-sm text-gray-600 italic leading-relaxed whitespace-pre-wrap">{entry.content || '(空记录)'}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()
                  ) : (
                    <p className="text-sm text-gray-600 italic">暂无跟进记录，点击右上角「新增」记录第一条</p>
                  )}
                </div>
              </div>

              {/* 关联合同 */}
              <div className="pt-4 mt-2 border-t border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={12} className="text-emerald-400" />
                  <span className="text-[11px] font-medium text-gray-400">关联合同</span>
                  <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">{linkedContracts.length}</span>
                  <button
                    onClick={() => navigate(`/contracts?project=${modalProject.id}`)}
                    className="ml-auto text-[11px] text-[#3B82F6] hover:underline"
                  >查看全部 →</button>
                </div>
                {linkedContracts.length === 0 ? (
                  <p className="text-[11px] text-gray-600 py-1">暂无，去合同页创建时可关联到本项目</p>
                ) : (
                  <div className="space-y-1">
                    {linkedContracts.map((c) => {
                      const amt = c.contract_amount != null ? formatAmount(c.contract_amount, c.currency) : null
                      return (
                        <button
                          key={c.id}
                          onClick={() => { window.open(`/contracts?contract=${c.id}`, '_blank') }}
                          className="w-full text-left flex items-center gap-2 text-[11px] text-gray-300 px-2 py-1.5 rounded-md bg-bg-input/40 hover:bg-bg-hover hover:text-[#3B82F6] transition-colors group/contract"
                        >
                          <FileText size={10} className="text-emerald-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{c.title}</div>
                            <div className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5">
                              {c.contract_no && <span>NO. {c.contract_no}</span>}
                              {c.sign_date && <span>· 签订 {new Date(c.sign_date).toLocaleDateString('zh-CN')}</span>}
                              {amt?.hasValue && <span className="text-emerald-400 font-semibold">· {amt.symbol}{amt.display} {amt.unit}</span>}
                            </div>
                          </div>
                          <ExternalLink size={9} className="text-gray-700 flex-shrink-0 group-hover/contract:text-[#3B82F6]" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 关联会议 */}
              <div className="pt-4 mt-2 border-t border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 size={12} className="text-[#8B5CF6]" />
                  <span className="text-[11px] font-medium text-gray-400">关联会议</span>
                  <span className="text-[11px] text-[#8B5CF6] bg-[#8B5CF6]/10 px-1.5 py-0.5 rounded-full">{linkedMeetings.length}</span>
                </div>
                {linkedMeetings.length === 0 ? (
                  <p className="text-[11px] text-gray-600 py-1">暂无，编辑项目可添加关联</p>
                ) : (
                  <div className="space-y-0.5">
                    {linkedMeetings.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { window.open(`/meetings?meeting=${m.id}`, '_blank') }}
                        className="w-full text-left flex items-center gap-2 text-[11px] text-gray-400 px-2 py-1 rounded-md hover:bg-bg-hover hover:text-[#3B82F6] transition-colors group/meeting"
                      >
                        <span className="text-gray-600 w-16 flex-shrink-0 group-hover/meeting:text-gray-400">{new Date(m.meeting_date).toLocaleDateString('zh-CN')}</span>
                        <span className="truncate flex-1">{m.title}</span>
                        <ExternalLink size={9} className="text-gray-700 flex-shrink-0 group-hover/meeting:text-[#3B82F6]" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 附件 */}
              {modalProject.files_json && (() => {
                try {
                  const files = JSON.parse(modalProject.files_json)
                  return Array.isArray(files) && files.length > 0 && (
                    <div className="pt-4 mt-2 border-t border-border/50">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText size={12} className="text-gray-500" />
                        <span className="text-[11px] font-medium text-gray-400">附件</span>
                        <span className="text-[11px] text-gray-500 bg-bg-hover px-1.5 py-0.5 rounded-full">{files.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {files.map((f: any, idx: number) => (
                          <a key={idx} href={f.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-hover border border-border text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors">
                            {f.type?.startsWith('image/') ? (
                              <img src={f.url} alt={f.name} className="w-5 h-5 rounded object-cover" />
                            ) : null}
                            {f.name}
                          </a>
                        ))}
                      </div>
                    </div>
                  )
                } catch { return null }
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 创建/编辑项目弹窗 - MaaS 平台版本 */}
      <ProjectFormModal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditingId(null) }}
        editingProject={editingId ? projects.find(p => p.id === editingId) : null}
        isSubmitting={saving}
        onSubmit={async (body) => {
          if (!body.name || !String(body.name).trim()) {
            showToast('请填写项目名称', 'warning')
            return
          }
          console.log('[ProjectForm] PUT body keys:', Object.keys(body).sort())
          setSaving(true)
          try {
            if (editingId) {
              const res = await fetch(`/api/v1/projects/${editingId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
              })
              console.log('[ProjectForm] PUT response status:', res.status)
              if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                console.error('[ProjectForm] PUT error body:', err)
                showToast(err.detail || `更新失败 (${res.status})`, 'error')
                return
              }
              // 兼容：如果响应体不是 JSON（后端可能返回了非 JSON 错误体），用 res.text() 兜底
              const text = await res.text()
              let updated: any = null
              try { updated = text ? JSON.parse(text) : null } catch (e) { console.error('[ProjectForm] JSON parse error:', e, 'raw text:', text.slice(0, 200)) }
              console.log('[ProjectForm] PUT updated contract_period:', updated?.contract_period)
              // 即使后端响应解析失败，也用客户端 body 合并到 local state，避免视觉上"保存无效"
              if (updated && typeof updated === 'object') {
                setProjects(prev => prev.map(p => p.id === editingId ? { ...p, ...updated } : p))
              } else {
                // 兜底：用客户端 body 合并
                setProjects(prev => prev.map(p => p.id === editingId ? {
                  ...p, ...body,
                  updated_at: new Date().toISOString(),
                } : p))
              }
              setShowForm(false); setEditingId(null); loadProjects()
              showToast('项目已更新', 'success')
            } else {
              const res = await fetch('/api/v1/projects', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
              })
              const data = await res.json()
              if (!res.ok) {
                showToast(data.detail || `创建失败 (${res.status})`, 'error')
                return
              }
              setShowForm(false); setEditingId(null); loadProjects()
              showToast('项目创建成功', 'success')
              if (data.id) analyzeProject(data.id)
            }
          } catch (e) {
            showToast(e instanceof Error ? e.message : '操作失败，请检查网络', 'error')
          } finally {
            setSaving(false)
          }
        }}
      />
    </div>
  )
}
