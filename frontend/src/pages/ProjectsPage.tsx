import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, X, Trash2, Loader2, Briefcase, Edit3, Save, Calendar, User, Building2, Activity, Search, Link2, ExternalLink, Pin, Cloud, Sparkles, RefreshCw, Tag, Filter, ChevronDown, FileText, Target, CheckCircle2 } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import FileUpload from '../components/FileUpload'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useToast } from '../contexts/ToastContext'

interface Project {
  id: number; name: string; opportunity_amount: number | null; deal_amount: number | null; currency: string; customer_name: string; customer_id: number | null
  product: string | null; project_scenario: string | null
  sales_person: string | null; status: string; progress: string | null
  analysis: string | null
  cloud_provider: string | null
  files_json?: string | null
  start_date: string | null; termination_date: string | null; deadline: string | null; created_at: string; updated_at: string
}

interface MeetingLink {
  id: number; title: string; meeting_date: string
}

interface FieldOption {
  id: number; category: string; value: string; sort_order: number
}

export default function ProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [options, setOptions] = useState<Record<string, string[]>>({})
  const [searchText, setSearchText] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [selectedScenario, setSelectedScenario] = useState<string>('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [modalProject, setModalProject] = useState<Project | null>(null)
  const [linkedMeetings, setLinkedMeetings] = useState<MeetingLink[]>([])
  const [allMeetings, setAllMeetings] = useState<MeetingLink[]>([])
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<Set<number>>(new Set())

  // 快捷跟进
  const [quickProgressOpen, setQuickProgressOpen] = useState(false)
  const [quickText, setQuickText] = useState('')
  const [quickDate, setQuickDate] = useState(new Date().toISOString().slice(0, 10))
  const [quickSaving, setQuickSaving] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [selectedClouds, setSelectedClouds] = useState<string[]>([])
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])

  const [form, setForm] = useState({
    name: '', opportunity_amount: '', deal_amount: '', currency: 'CNY', customer_name: '', customer_id: 0, product: '', project_scenario: '', sales_person: '',
    status: '', progress: '', cloud_provider: '', files_json: null as string | null, start_date: '', termination_date: '', deadline: '',
  })

  // 客户列表（用于关联选择）
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([])

  const loadProjects = () => {
    fetch('/api/v1/projects')
      .then((res) => res.json()).then((data) => { setProjects(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

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

  const loadMeetings = async () => {
    try {
      const res = await fetch('/api/v1/meetings')
      const data = await res.json()
      setAllMeetings((data || []).map((m: { id: number; title: string; meeting_date: string }) => ({
        id: m.id, title: m.title, meeting_date: m.meeting_date
      })))
    } catch { /* ignore */ }
  }

  const loadCustomers = () => {
    fetch('/api/v1/customers')
      .then((res) => res.json())
      .then((data) => setCustomers(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => {})
  }

  const loadLinkedMeetings = async (projectId: number) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/meetings`)
      const data = await res.json()
      setLinkedMeetings(Array.isArray(data) ? data : [])
      setSelectedMeetingIds(new Set((Array.isArray(data) ? data : []).map((m: MeetingLink) => m.id)))
    } catch { /* ignore */ }
  }

  useEffect(() => { loadProjects(); loadOptions(); loadMeetings(); loadCustomers() }, [])

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
    setForm({ name: '', opportunity_amount: '', deal_amount: '', currency: 'CNY', customer_name: '', customer_id: 0, product: '', project_scenario: '', sales_person: '',
      status: (options.project_status?.length ? options.project_status[0] : ''), progress: '', cloud_provider: '', files_json: null, start_date: '', termination_date: '', deadline: '' })
    setSelectedClouds([])
    setSelectedProducts([])
    setSelectedMeetingIds(new Set())
    setShowForm(true)
  }

  const openEdit = (p: Project) => {
    setEditingId(p.id)
    setForm({
      name: p.name, opportunity_amount: String(p.opportunity_amount || ''), deal_amount: String(p.deal_amount || ''), currency: p.currency || 'CNY', customer_name: p.customer_name, customer_id: p.customer_id || 0,
      product: p.product || '', project_scenario: p.project_scenario || '',
      sales_person: p.sales_person || '', status: p.status, progress: p.progress || '',
      cloud_provider: p.cloud_provider || '', files_json: p.files_json || null,
      start_date: p.start_date?.slice(0, 10) || '', termination_date: p.termination_date?.slice(0, 10) || '', deadline: p.deadline?.slice(0, 10) || '',
    })
    setSelectedClouds(p.cloud_provider ? p.cloud_provider.split(',').map(s => s.trim()).filter(Boolean) : [])
    setSelectedProducts(p.product ? p.product.split(',').map(s => s.trim()).filter(Boolean) : [])
    loadLinkedMeetings(p.id)
    setShowForm(true)
  }

  const openDetail = (p: Project) => {
    setModalProject(p)
    loadLinkedMeetings(p.id)
  }

  const closeDetail = () => { setModalProject(null); setQuickProgressOpen(false); setQuickText(''); setQuickDate(new Date().toISOString().slice(0, 10)) }

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

  /** 截图粘贴到进展：上传 → 插入 ![](url) Markdown 语法 */
  const handleInlinePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue
        const ext = item.type.split('/')[1] || 'png'
        const file = new File([blob], `paste_${Date.now()}.${ext}`, { type: item.type })
        try {
          const formData = new FormData()
          formData.append('file', file)
          const token = localStorage.getItem('auth_token')
          const res = await fetch('/api/v1/files/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          })
          if (!res.ok) continue
          const uploaded = await res.json() as { url: string }
          const mdImg = `![${file.name}](${uploaded.url})\n`
          setForm(prev => {
            const ta = textareaRef.current
            if (!ta) return { ...prev, progress: (prev.progress || '') + mdImg }
            const start = ta.selectionStart
            const end = ta.selectionEnd
            const cur = prev.progress || ''
            const newContent = cur.slice(0, start) + mdImg + cur.slice(end)
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + mdImg.length
              ta.focus()
            })
            return { ...prev, progress: newContent }
          })
        } catch { /* skip */ }
        break
      }
    }
  }, [])

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...form }
      body.cloud_provider = selectedClouds.join(',')
      body.product = selectedProducts.join(',')
      // 处理商机金额和成交价格
      delete body.opportunity_amount
      delete body.deal_amount
      body.opportunity_amount = form.opportunity_amount ? parseFloat(form.opportunity_amount) : null
      body.deal_amount = form.deal_amount ? parseFloat(form.deal_amount) : null
      if (!body.customer_id) body.customer_id = null
      if (!body.start_date) delete body.start_date
      if (!body.termination_date) delete body.termination_date
      if (!body.deadline) delete body.deadline
      body.meeting_ids = Array.from(selectedMeetingIds)
      if (editingId) {
        await fetch(`/api/v1/projects/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      } else {
        const res = await fetch('/api/v1/projects', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const created = await res.json()
        setShowForm(false)
        loadProjects()
        showToast('项目创建成功', 'success')
        if (created.id) analyzeProject(created.id)
        return // 提前返回，避免重复 setShowForm
      }
      setShowForm(false)
      loadProjects()
      showToast('项目已更新', 'success')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!await showConfirm('确定删除此项目？')) return
    await fetch(`/api/v1/projects/${id}`, { method: 'DELETE' })
    if (modalProject?.id === id) setModalProject(null)
    loadProjects()
    showToast('项目已删除', 'success')
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

  // 状态→顶条颜色映射（用于卡片3D效果）
  const TOP_BAR_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316', '#EC4899', '#14B8A6', '#6366F1']
  const getTopBarColor = (status: string): string => {
    let hash = 0
    for (let i = 0; i < status.length; i++) { hash = ((hash << 5) - hash) + status.charCodeAt(i); hash |= 0 }
    return TOP_BAR_COLORS[Math.abs(hash) % TOP_BAR_COLORS.length]
  }

  const inputClass = "w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
  const labelClass = "block text-xs text-gray-400 mb-1.5"

  return (
    <div>
      {/* 顶部标题行 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white">项目管理</h2>
          <span className="text-xs text-gray-500 bg-bg-hover px-2 py-0.5 rounded-full">{projects.length}</span>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20">
          <Plus size={16} /><span>新建项目</span>
        </button>
      </div>

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
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">状态</div>
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
                            {st}<span className="text-[9px] opacity-50 ml-1">{cnt}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 产品 */}
                {products.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">产品</div>
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
                            {prod}<span className="text-[9px] opacity-50 ml-1">{cnt}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 场景 */}
                {scenarios.length > 0 && (
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">场景</div>
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
                            {sc}<span className="text-[9px] opacity-50 ml-1">{cnt}</span>
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
      ) : (
        <>
          {/* 项目卡片网格（等大卡片 + 3D 立体效果） */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((p) => {
              const barColor = getTopBarColor(p.status)
              return (
                <button
                  key={p.id}
                  onClick={() => openDetail(p)}
                  className="group/card relative flex flex-col text-left rounded-2xl bg-gradient-to-b from-bg-card to-bg-card/80 border border-border/80
                             hover:border-[#3B82F6]/50 hover:shadow-xl hover:shadow-blue-500/5 hover:-translate-y-1
                             transition-all duration-300 ease-out"
                  style={{ borderTopWidth: '3px', borderTopColor: barColor + '60' }}
                >
                  {/* 卡片内容 */}
                  <div className="p-5 flex flex-col flex-1">
                    {/* 标题 + 状态 */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h4 className="text-sm font-bold text-white truncate leading-tight">{p.name}</h4>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 ${getStatusColor(p.status)}`}>{p.status}</span>
                    </div>

                    {/* 信息行 */}
                    <div className="space-y-2 text-xs flex-1">
                      {p.customer_name && (
                        <button
                          onClick={(e) => { e.stopPropagation(); if (p.customer_id) window.open(`/customers?customer=${p.customer_id}`, '_blank') }}
                          className="flex items-center gap-2 text-gray-400 group-hover/card:text-gray-300 hover:text-[#3B82F6] transition-colors cursor-pointer w-full text-left"
                          disabled={!p.customer_id}
                        >
                          <Building2 size={11} className="text-gray-500 flex-shrink-0" />
                          <span className="truncate">{p.customer_name}</span>
                          {p.customer_id && <ExternalLink size={10} className="text-gray-600 flex-shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity" />}
                        </button>
                      )}
                      {p.product && (
                        <div className="flex items-center gap-2 text-gray-400 group-hover/card:text-gray-300 transition-colors">
                          <Pin size={11} className="text-gray-500 flex-shrink-0" />
                          <span className="truncate">{p.product.split(',').map(s => s.trim()).filter(Boolean).join(' / ')}</span>
                        </div>
                      )}
                      {p.project_scenario && (
                        <div className="flex items-center gap-2 text-gray-400 group-hover/card:text-gray-300 transition-colors">
                          <Tag size={11} className="text-gray-500 flex-shrink-0" />
                          <span className="truncate">{p.project_scenario}</span>
                        </div>
                      )}
                      {p.cloud_provider && (
                        <div className="flex items-center gap-2 text-gray-400 group-hover/card:text-gray-300 transition-colors">
                          <Cloud size={11} className="text-gray-500 flex-shrink-0" />
                          <span className="truncate">{p.cloud_provider.split(',').map(s => s.trim()).filter(Boolean).join(' / ')}</span>
                        </div>
                      )}
                      {p.sales_person && (
                        <div className="flex items-center gap-2 text-gray-400 group-hover/card:text-gray-300 transition-colors">
                          <User size={11} className="text-gray-500 flex-shrink-0" />
                          <span className="truncate">{p.sales_person}</span>
                        </div>
                      )}
                      {p.opportunity_amount && (
                        <div className="flex items-center gap-2 text-blue-400/90 group-hover/card:text-blue-400 transition-colors">
                          <Target size={11} className="flex-shrink-0" />
                          <span className="text-xs font-medium truncate">商机 ¥{p.opportunity_amount.toLocaleString()} 万</span>
                        </div>
                      )}
                      {p.deal_amount && (
                        <div className="flex items-center gap-2 text-emerald-400/90 group-hover/card:text-emerald-400 transition-colors">
                          <CheckCircle2 size={11} className="flex-shrink-0" />
                          <span className="text-xs font-medium truncate">成交 ¥{p.deal_amount.toLocaleString()} 万</span>
                        </div>
                      )}
                      {(p.start_date || p.deadline || p.termination_date) && (
                        <div className="flex items-center gap-2 text-gray-500 group-hover/card:text-gray-400 transition-colors">
                          <Calendar size={11} className="flex-shrink-0" />
                          <span>{p.start_date ? new Date(p.start_date).toLocaleDateString('zh-CN') : '—'}</span>
                          {p.termination_date && <span className="text-red-400">→ 终止 {new Date(p.termination_date).toLocaleDateString('zh-CN')}</span>}
                          {p.deadline && <span className="text-gray-600">→ {new Date(p.deadline).toLocaleDateString('zh-CN')}</span>}
                        </div>
                      )}
                    </div>

                    {/* 底部摘要 */}
                    {(p.analysis || p.progress) && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        {p.analysis ? (
                          <div className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">
                            <MarkdownRenderer content={p.analysis} className="text-[11px] text-gray-500 leading-relaxed" />
                          </div>
                        ) : p.progress ? (
                          <div className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">
                            <MarkdownRenderer content={p.progress} className="text-[11px] text-gray-500 leading-relaxed" />
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* 全屏详情弹窗 */}
      {modalProject && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[10vh] pb-10 overflow-y-auto" onClick={closeDetail}>
          <div className="w-full max-w-2xl mx-4 rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-2 px-6 py-4 border-b border-border bg-bg-card rounded-t-2xl">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h3 className="text-lg font-bold text-white truncate">{modalProject.name}</h3>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border flex-shrink-0 ${getStatusColor(modalProject.status)}`}>{modalProject.status}</span>
                  {(modalProject.opportunity_amount || modalProject.deal_amount) && (
                    <div className="flex items-center gap-3 text-[11px] flex-shrink-0">
                      {modalProject.opportunity_amount && (
                        <span className="text-blue-400/80 font-medium">商机 ¥{modalProject.opportunity_amount.toLocaleString()} 万</span>
                      )}
                      {modalProject.deal_amount && (
                        <span className="text-emerald-400/80 font-medium">成交 ¥{modalProject.deal_amount.toLocaleString()} 万</span>
                      )}
                    </div>
                  )}
                </div>
                {/* 紧凑元信息 */}
                <div className="flex items-center gap-2 flex-wrap">
                  {modalProject.customer_name && (
                    <button
                      onClick={() => modalProject.customer_id && window.open(`/customers?customer=${modalProject.customer_id}`, '_blank')}
                      disabled={!modalProject.customer_id}
                      className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-bg-input px-2 py-0.5 rounded-md border border-border hover:text-[#3B82F6] hover:border-[#3B82F6]/40 transition-colors"
                    >
                      <Building2 size={10} className="text-gray-500" />{modalProject.customer_name}
                      {modalProject.customer_id && <ExternalLink size={9} className="text-gray-600" />}
                    </button>
                  )}
                  {modalProject.product && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-bg-input px-2 py-0.5 rounded-md border border-border">
                      <Pin size={10} className="text-gray-500" />{modalProject.product.split(',').map(s => s.trim()).filter(Boolean).join(' / ')}
                    </span>
                  )}
                  {modalProject.project_scenario && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-bg-input px-2 py-0.5 rounded-md border border-border">
                      <Pin size={10} className="text-gray-500" />{modalProject.project_scenario}
                    </span>
                  )}
                  {modalProject.sales_person && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-bg-input px-2 py-0.5 rounded-md border border-border">
                      <User size={10} className="text-gray-500" />{modalProject.sales_person}
                    </span>
                  )}
                  {modalProject.cloud_provider && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-bg-input px-2 py-0.5 rounded-md border border-border">
                      <Cloud size={10} className="text-gray-500" />{modalProject.cloud_provider.split(',').map(s => s.trim()).filter(Boolean).join(' / ')}
                    </span>
                  )}
                  {(modalProject.start_date || modalProject.deadline || modalProject.termination_date) && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-bg-input px-2 py-0.5 rounded-md border border-border">
                      <Calendar size={10} className="text-gray-500" />
                      {modalProject.start_date && new Date(modalProject.start_date).toLocaleDateString('zh-CN')}
                      {modalProject.termination_date && <span className="text-red-400">→ 终止 {new Date(modalProject.termination_date).toLocaleDateString('zh-CN')}</span>}
                      {modalProject.deadline && <span className="text-gray-600">→ {new Date(modalProject.deadline).toLocaleDateString('zh-CN')}</span>}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                <button onClick={() => { closeDetail(); openEdit(modalProject) }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-gray-300 hover:text-white transition-colors border border-border"><Edit3 size={12} className="inline mr-1" />编辑</button>
                <button onClick={() => handleDelete(modalProject.id)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-bg-hover text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors border border-border"><Trash2 size={13} /></button>
                <button onClick={closeDetail} className="p-2 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* AI 项目分析 */}
              <div className="rounded-xl bg-bg-input border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-bg-card/50">
                  <Sparkles size={14} className="text-[#F59E0B]" />
                  <span className="text-xs font-medium text-gray-300">AI 项目分析</span>
                  <button
                    onClick={() => analyzeProject(modalProject.id)}
                    disabled={analyzingId === modalProject.id}
                    className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg border border-transparent text-gray-500 hover:text-gray-300 hover:border-border transition-colors disabled:opacity-50"
                  >
                    {analyzingId === modalProject.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <RefreshCw size={11} />
                    )}
                    {analyzingId === modalProject.id ? '分析中...' : '刷新'}
                  </button>
                </div>
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
              </div>

              {/* Hero: 跟进记录 */}
              <div className="rounded-xl bg-bg-input border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-bg-card/50">
                  <Activity size={14} className="text-[#3B82F6]" />
                  <span className="text-xs font-medium text-gray-300">跟进记录</span>
                  <button
                    onClick={() => { setQuickProgressOpen(!quickProgressOpen); setQuickText(''); setQuickDate(new Date().toISOString().slice(0, 10)) }}
                    className={`ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg border transition-colors ${quickProgressOpen ? 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30' : 'text-gray-500 border-transparent hover:text-gray-300 hover:border-border'}`}
                  >
                    <Plus size={11} />{quickProgressOpen ? '收起' : '新增'}
                  </button>
                </div>

                {/* 快捷输入 */}
                {quickProgressOpen && (
                  <div className="px-4 py-3 border-b border-border bg-bg-input/50">
                    <div className="flex items-center gap-3 mb-2">
                      <label className="text-[10px] text-gray-500 flex-shrink-0">日期</label>
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
                      <span className="text-[10px] text-gray-600">新记录将追加到现有进展之后</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setQuickProgressOpen(false); setQuickText(''); setQuickDate(new Date().toISOString().slice(0, 10)) }}
                          className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white transition-colors"
                        >取消</button>
                        <button
                          onClick={handleQuickProgress}
                          disabled={quickSaving || !quickText.trim()}
                          className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-lg bg-[#3B82F6] text-white hover:bg-blue-600 disabled:opacity-50 transition-all"
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
                                      <span className="text-[9px] text-gray-600 bg-bg-card/50 px-1.5 py-0.5 rounded">
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

              {/* 关联会议 */}
              <div className="pt-4 mt-2 border-t border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 size={12} className="text-[#8B5CF6]" />
                  <span className="text-[11px] font-medium text-gray-400">关联会议</span>
                  <span className="text-[10px] text-[#8B5CF6] bg-[#8B5CF6]/10 px-1.5 py-0.5 rounded-full">{linkedMeetings.length}</span>
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
                        <span className="text-[10px] text-gray-500 bg-bg-hover px-1.5 py-0.5 rounded-full">{files.length}</span>
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

      {/* 创建/编辑项目弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg mx-2 p-6 rounded-2xl bg-bg-card border border-border shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-white">{editingId ? '编辑项目' : '新建项目'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white transition-colors"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>项目名称 *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputClass} placeholder="输入项目名称" autoFocus />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>客户名称</label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <SearchableSelect
                        options={customers.map(c => ({ id: c.id, label: c.name }))}
                        value={form.customer_id || 0}
                        onChange={(val) => {
                          const cid = val as number
                          if (cid) {
                            const c = customers.find(c => c.id === cid)
                            setForm({ ...form, customer_id: cid, customer_name: c?.name || '' })
                          } else {
                            setForm({ ...form, customer_id: 0, customer_name: '' })
                          }
                        }}
                        placeholder="选择客户..."
                        searchPlaceholder="搜索客户..."
                        emptyText="无匹配客户"
                      />
                    </div>
                    <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value, customer_id: 0 })}
                      className={`${inputClass} w-40`} placeholder="手动输入" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>开始时间</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>终止时间</label>
                  <input type="date" value={form.termination_date} onChange={(e) => setForm({ ...form, termination_date: e.target.value })}
                    className={inputClass} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>涉及产品</label>
                  <SearchableSelect
                    multiple
                    options={(options.product || []).map(v => ({ id: v, label: v }))}
                    value={selectedProducts}
                    onChange={(val) => setSelectedProducts(val as string[])}
                    placeholder="选择涉及产品..."
                    searchPlaceholder="搜索产品..."
                    emptyText="无匹配选项"
                  />
                </div>
                <div>
                  <label className={labelClass}>项目场景</label>
                  {options.project_scenario?.length ? (
                    <select value={form.project_scenario} onChange={(e) => setForm({ ...form, project_scenario: e.target.value })}
                      className={inputClass}>
                      <option value="">不选择</option>
                      {options.project_scenario.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input value={form.project_scenario} onChange={(e) => setForm({ ...form, project_scenario: e.target.value })}
                      className={inputClass} placeholder="输入项目场景" />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>销售</label>
                  {options.sales_person?.length ? (
                    <select value={form.sales_person} onChange={(e) => setForm({ ...form, sales_person: e.target.value })}
                      className={inputClass}>
                      <option value="">不选择</option>
                      {options.sales_person.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input value={form.sales_person} onChange={(e) => setForm({ ...form, sales_person: e.target.value })}
                      className={inputClass} placeholder="输入销售姓名" />
                  )}
                </div>
                <div>
                  <label className={labelClass}>状态</label>
                  {options.project_status?.length ? (
                    (() => {
                      const opts = [...options.project_status]
                      if (form.status && !opts.includes(form.status)) opts.unshift(form.status)
                      return (
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className={inputClass}>
                      <option value="">不选择</option>
                      {opts.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                      )
                    })()
                  ) : (
                    <input value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className={inputClass} placeholder="输入项目状态" />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>商机金额（万）</label>
                  <input type="number" step="0.01" min="0" value={form.opportunity_amount} onChange={(e) => setForm({ ...form, opportunity_amount: e.target.value })}
                    className={inputClass} placeholder="输入商机金额" />
                </div>
                <div>
                  <label className={labelClass}>成交价格（万）</label>
                  <input type="number" step="0.01" min="0" value={form.deal_amount} onChange={(e) => setForm({ ...form, deal_amount: e.target.value })}
                    className={inputClass} placeholder="输入成交价格" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>供应商</label>
                  <SearchableSelect
                    multiple
                    options={(options.cloud || []).map(v => ({ id: v, label: v }))}
                    value={selectedClouds}
                    onChange={(val) => setSelectedClouds(val as string[])}
                    placeholder="选择供应商..."
                    searchPlaceholder="搜索供应商..."
                    emptyText="无匹配选项"
                  />
                </div>
                <div>
                  <label className={labelClass}>关联会议</label>
                  <SearchableSelect
                    multiple
                    options={allMeetings.map(m => ({ id: m.id, label: m.title, sub: new Date(m.meeting_date).toLocaleDateString('zh-CN') }))}
                    value={Array.from(selectedMeetingIds)}
                    onChange={(val) => setSelectedMeetingIds(new Set(val as number[]))}
                    placeholder="选择关联会议..."
                    searchPlaceholder="搜索会议..."
                    emptyText="无匹配会议"
                  />
                </div>
              </div>

              {editingId && (
                <div>
                  <label className={labelClass}>进展记录</label>
                  <textarea ref={textareaRef} value={form.progress} onChange={(e) => setForm({ ...form, progress: e.target.value })}
                    onPaste={handleInlinePaste}
                    className={`${inputClass} h-24 resize-none`} placeholder="记录项目进展、备注等信息..." />
                </div>
              )}

            </div>

            <div className="mt-3">
              <label className={labelClass}>附件</label>
              <FileUpload filesJson={form.files_json} onChange={(v) => setForm({ ...form, files_json: v })} />
            </div>

            <button onClick={handleSave} disabled={saving || !form.name.trim()}
              className="w-full mt-5 py-2.5 rounded-xl bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
              {saving && <Loader2 size={16} className="animate-spin" />}
              <Save size={16} />{saving ? '保存中...' : editingId ? '更新项目' : '创建项目'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
