import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Search, Plus, X, Loader2, Trash2, FileText, Download, Sparkles, ChevronDown, ChevronRight, Pencil, Eye, AlertTriangle, Calendar, RefreshCw, CreditCard, FileSignature, Upload, Building2, AtSign, Briefcase, Banknote, Coins, ScrollText } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import TeamViewSwitcher from '../components/TeamViewSwitcher'
import SearchableSelect from '../components/SearchableSelect'
import { PageHeader, EmptyState } from '../components/design-system'

interface ContractRecord {
  id: number
  user_id: number
  customer_id: number
  project_id: number | null
  title: string
  contract_no: string
  file_path: string
  file_name: string
  file_type: string
  file_size: number
  sign_date: string | null
  start_date: string | null
  end_date: string | null
  party_a: string
  party_b: string
  contract_amount: number | null
  currency: string
  payment_terms: string | null
  key_clauses: string | null
  summary: string | null
  status: string
  remarks: string | null
  // 阶段 1+2：业务字段
  contract_type: string
  effective_term: string
  auto_renew: string
  penalty_clause: string
  acceptance_terms: string
  payment_schedule: string  // JSON 字符串
  ip_clause: string
  dispute_resolution: string
  governing_law: string
  notice_clause: string
  // 解析元数据
  parse_status: string
  parse_error: string
  parsed_at: string | null
  extraction_meta: string  // JSON 字符串
  created_at: string
  updated_at: string
}

interface PaymentNode { phase?: string; percent?: number; condition?: string; [k: string]: any }
interface ExtractionMeta { confidence?: number; source_text?: string; [k: string]: any }

interface CustomerSimple { id: number; name: string }
interface ProjectSimple { id: number; name: string; customer_id: number | null }

const STATUS_OPTIONS = ['生效中', '即将到期', '已到期', '已终止']
const STATUS_COLORS: Record<string, string> = {
  '生效中': 'text-green-400 bg-green-500/10 border-green-500/30',
  '即将到期': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  '已到期': 'text-red-400 bg-red-500/10 border-red-500/30',
  '已终止': 'text-gray-400 bg-gray-500/10 border-gray-500/30',
}

const CURRENCY_LABELS: Record<string, string> = {
  'CNY': '人民币',
  'USD': '美元',
  'EUR': '欧元',
  'JPY': '日元',
  'HKD': '港币',
}

function formatAmount(amount: number | null, currency: string) {
  if (!amount && amount !== 0) return ''
  const label = CURRENCY_LABELS[currency] || currency
  return `${amount} 万元 (${label})`
}

const PARSE_STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  parsing: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  success: 'text-green-400 bg-green-500/10 border-green-500/30',
  failed: 'text-red-400 bg-red-500/10 border-red-500/30',
}
const PARSE_STATUS_LABELS: Record<string, string> = {
  pending: '待解析',
  parsing: '解析中',
  success: '已解析',
  failed: '解析失败',
}

const CONTRACT_TYPE_COLORS: Record<string, string> = {
  '销售合同': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  '采购合同': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  '服务合同': 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  '租赁合同': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  '劳动合同': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  '保密协议': 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  '技术合同': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  '咨询合同': 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  '合作协议': 'bg-teal-500/10 text-teal-400 border-teal-500/30',
  '其他': 'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

function confidenceColor(c?: number): string {
  if (c == null) return 'text-gray-600'
  if (c >= 0.85) return 'text-green-400'
  if (c >= 0.6) return 'text-yellow-400'
  return 'text-red-400'
}

function safeJsonParse<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

export default function ContractsPage() {
  const { hasPermission } = useAuth()
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [customers, setCustomers] = useState<CustomerSimple[]>([])
  const [projects, setProjects] = useState<ProjectSimple[]>([])
  const [loading, setLoading] = useState(true)
  
  // 成员数据联动选择
  const [memberList, setMemberList] = useState<any[]>([])
  const [viewMode, setViewMode] = useState<'personal' | 'team'>('personal')
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '', contract_no: '', customer_id: 0, project_id: 0,
    sign_date: '', start_date: '', end_date: '',
    party_a: '', party_b: '', contract_amount: '', currency: 'CNY',
    payment_terms: '', remarks: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [parsingId, setParsingId] = useState<number | null>(null)
  const [showDetail, setShowDetail] = useState<ContractRecord | null>(null)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewName, setPreviewName] = useState('')
  const [previewType, setPreviewType] = useState('')

  const loadContracts = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (keyword) params.set('keyword', keyword)
    if (viewMode === 'team' && selectedUserIds.length > 0) {
      params.set('user_ids', selectedUserIds.join(','))
    } else if (viewMode === 'team') {
      params.set('user_ids', memberList.map((m: any) => m.id).join(','))
    }
    fetch(`/api/v1/contracts?${params.toString()}`)
      .then(r => r.json()).then(data => { setContracts(data || []); setLoading(false) }).catch(() => setLoading(false))
  }, [statusFilter, keyword, viewMode, selectedUserIds, memberList])

  useEffect(() => { loadContracts() }, [loadContracts])

  // 阶段 1+2：轮询解析状态 - 任何合同处于 parsing 状态时，每 2 秒检查一次
  useEffect(() => {
    const parsing = contracts.filter(c => c.parse_status === 'parsing')
    if (parsing.length === 0) return
    let active = true
    const poll = async () => {
      if (!active) return
      const updates = await Promise.all(
        parsing.map(async (c) => {
          try {
            const res = await fetch(`/api/v1/contracts/${c.id}/parse-status`)
            if (!res.ok) return null
            const status = await res.json()
            // 拉到完整合同，更新本地状态
            const full = await fetch(`/api/v1/contracts/${c.id}`)
            if (!full.ok) return null
            return await full.json()
          } catch {
            return null
          }
        })
      )
      if (!active) return
      const succeeded: number[] = []
      const failed: number[] = []
      setContracts(prev => {
        const next = [...prev]
        updates.forEach((updated, idx) => {
          if (!updated) return
          const i = next.findIndex(x => x.id === updated.id)
          if (i < 0) return
          const wasStatus = next[i].parse_status
          next[i] = updated
          if (wasStatus === 'parsing' && updated.parse_status === 'success') succeeded.push(updated.id)
          if (wasStatus === 'parsing' && updated.parse_status === 'failed') failed.push(updated.id)
        })
        return next
      })
      if (succeeded.length > 0) showToast(`合同解析完成（${succeeded.length} 份）`, 'success')
      if (failed.length > 0) showToast(`${failed.length} 份合同解析失败，点击「重新解析」重试`, 'error')
    }
    const timer = setInterval(poll, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [contracts, showToast])

  useEffect(() => {
    fetch('/api/v1/users/simple')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setMemberList(d) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/v1/customers')
      .then(r => r.json()).then(data => setCustomers(data || [])).catch(() => {})

    fetch('/api/v1/projects')
      .then(r => r.json()).then(data => setProjects(data || [])).catch(() => {})
  }, [])

  const resetForm = () => {
    setForm({ title: '', contract_no: '', customer_id: 0, project_id: 0, sign_date: '', start_date: '', end_date: '', party_a: '', party_b: '', contract_amount: '', currency: 'CNY', payment_terms: '', remarks: '' })
    setFile(null)
    setEditingId(null)
  }

  const handleSubmit = async () => {
    if (!form.title || !form.customer_id) { showToast('请填写合同名称和选择客户', 'error'); return }
    setSaving(true)
    const method = editingId ? 'PUT' : 'POST'
    const url = editingId ? `/api/v1/contracts/${editingId}` : '/api/v1/contracts'

    if (editingId) {
      // 编辑模式：发送 JSON
      const body: Record<string, any> = {
        title: form.title, contract_no: form.contract_no,
        project_id: form.project_id || null,
        sign_date: form.sign_date || null, start_date: form.start_date || null, end_date: form.end_date || null,
        party_a: form.party_a, party_b: form.party_b,
        contract_amount: form.contract_amount ? parseFloat(form.contract_amount) : null,
        currency: form.currency, payment_terms: form.payment_terms || null, remarks: form.remarks || null,
      }
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        showToast('合同已更新', 'success')
        setShowForm(false); resetForm(); loadContracts()
      } else {
        const err = await res.json()
        showToast(err.detail || '保存失败', 'error')
      }
    } else {
      // 新建模式：发送 FormData（支持文件上传）
      const fd = new FormData()
      fd.append('title', form.title)
      fd.append('contract_no', form.contract_no)
      fd.append('customer_id', String(form.customer_id))
      if (form.project_id) fd.append('project_id', String(form.project_id))
      if (form.sign_date) fd.append('sign_date', form.sign_date)
      if (form.start_date) fd.append('start_date', form.start_date)
      if (form.end_date) fd.append('end_date', form.end_date)
      fd.append('party_a', form.party_a)
      fd.append('party_b', form.party_b)
      if (form.contract_amount) fd.append('contract_amount', form.contract_amount)
      fd.append('currency', form.currency)
      if (form.payment_terms) fd.append('payment_terms', form.payment_terms)
      if (form.remarks) fd.append('remarks', form.remarks)
      if (file) fd.append('file', file)

      const res = await fetch(url, {
        method,
        body: fd,
      })
      if (res.ok) {
        showToast('合同添加成功', 'success')
        setShowForm(false); resetForm(); loadContracts()
      } else {
        const err = await res.json()
        showToast(err.detail || '添加失败', 'error')
      }
    }
    setSaving(false)
  }

  const startEdit = (c: ContractRecord) => {
    setForm({
      title: c.title, contract_no: c.contract_no,
      customer_id: c.customer_id, project_id: c.project_id || 0,
      sign_date: c.sign_date || '', start_date: c.start_date || '', end_date: c.end_date || '',
      party_a: c.party_a, party_b: c.party_b,
      contract_amount: c.contract_amount != null ? String(c.contract_amount) : '',
      currency: c.currency, payment_terms: c.payment_terms || '', remarks: c.remarks || '',
    })
    setFile(null)
    setEditingId(c.id)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    const ok = await showConfirm('确定删除此合同？相关文件也会被删除。')
    if (!ok) return
    const res = await fetch(`/api/v1/contracts/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) { showToast('已删除', 'success'); loadContracts() }
  }

  const handleDownload = async (id: number, fileName: string) => {
    const res = await fetch(`/api/v1/contracts/${id}/file`)
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName || 'contract'
      a.click()
      URL.revokeObjectURL(url)
    } else {
      showToast('下载失败，请稍后重试', 'error')
    }
  }

  const handleParse = async (id: number) => {
    setParsingId(id)
    const res = await fetch(`/api/v1/contracts/${id}/parse`, {
      method: 'POST',
    })
    if (res.ok) {
      const data = await res.json()
      setContracts(prev => prev.map(c => c.id === id ? data : c))
      if (showDetail?.id === id) setShowDetail(data)
      showToast('AI解析完成', 'success')
    } else {
      showToast('解析失败，请确认已上传合同文件且模型配置正确', 'error')
    }
    setParsingId(null)
  }

  // 阶段 1+2：手动重解析（清空旧结果重新走后台任务，前端轮询会自动跟进）
  const handleReparse = async (id: number) => {
    const res = await fetch(`/api/v1/contracts/${id}/reparse`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      setContracts(prev => prev.map(c => c.id === id ? data : c))
      if (showDetail?.id === id) setShowDetail(data)
      showToast('已重新启动解析', 'info')
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.detail || '重解析启动失败', 'error')
    }
  }

  const handlePreview = async (id: number, fileName: string, fileType: string) => {
    setPreviewId(id)
    setPreviewLoading(true)
    setPreviewName(fileName)
    setPreviewType(fileType)

    const lowerType = fileType.toLowerCase()
    const isPdf = lowerType === '.pdf'
    const isOffice = lowerType === '.doc' || lowerType === '.docx'

    try {
      if (isPdf) {
        // PDF：获取文件 blob，用浏览器内置查看器渲染
        const res = await fetch(`/api/v1/contracts/${id}/file?preview=true`)
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(url)
          setPreviewText('')
          return
        }
        showToast('加载文件失败', 'error')
        closePreview()
        return
      }

      if (isOffice) {
        // DOC/DOCX：优先让后端 LibreOffice 转 PDF，再用 iframe 渲染（与 PDF 一致的体验）
        const res = await fetch(`/api/v1/contracts/${id}/file?preview=true&convert=pdf`)
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(url)
          setPreviewText('')
          return
        }
        // 503 = LibreOffice 未安装/转换失败；其他错误：fallback 到纯文本
        let errDetail = ''
        try { errDetail = (await res.json())?.detail || '' } catch { /* ignore */ }
        if (res.status === 503) {
          showToast(errDetail || '原件预览不可用，已切换为文本预览', 'warning')
        } else {
          showToast('原件转 PDF 失败，已切换为文本预览', 'warning')
        }
        // fallback：拉取提取的纯文本
        const fallback = await fetch(`/api/v1/contracts/${id}/preview-text`)
        if (fallback.ok) {
          const data = await fallback.json()
          setPreviewText(data.text || '')
          setPreviewUrl('')
        } else {
          showToast('无法提取文档内容', 'error')
          closePreview()
        }
        return
      }

      // 其他类型：纯文本预览
      const res = await fetch(`/api/v1/contracts/${id}/preview-text`)
      if (res.ok) {
        const data = await res.json()
        setPreviewText(data.text || '')
        setPreviewUrl('')
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '无法提取文档内容', 'error')
        closePreview()
      }
    } catch {
      showToast('加载文件失败', 'error')
      closePreview()
    } finally {
      // 关键：无论 try/catch 怎么走，loading 都必须清，否则弹窗永远只显示转圈
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreviewId(null)
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl('') }
    setPreviewText('')
    setPreviewName('')
    setPreviewType('')
  }

  const getCustomerName = (id: number) => customers.find(c => c.id === id)?.name || ''
  const customersProjects = projects.filter(p => p.customer_id === form.customer_id)

  return (
    <div>
      <PageHeader
        icon={FileText}
        title="合同管理"
        description="管理所有合同文件、查看 AI 解析结果"
        tone="orange"
        stats={[{ label: '合同', value: contracts.length }]}
        right={
          <>
            <TeamViewSwitcher
              memberList={memberList}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              selectedUserIds={selectedUserIds}
              onSelectedUserIdsChange={setSelectedUserIds}
            />
            {hasPermission('contract:create') && (
              <button onClick={() => { setShowForm(true); resetForm() }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#3B82F6] text-[#fff] text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer">
                <Plus size={14} strokeWidth={2.5} /><span>新建合同</span>
              </button>
            )}
          </>
        }
      />

      <div className="flex items-center gap-3 mb-5 overflow-x-auto">
        <div className="relative flex-1 max-w-sm min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索合同..." className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-card border border-border text-sm text-gray-300 outline-none focus:border-[#3B82F6]" />
        </div>
        {STATUS_OPTIONS.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusFilter === s ? 'bg-[#3B82F6]/20 text-[#3B82F6] border-[#3B82F6]/40' : 'text-gray-400 border-border hover:text-gray-200'}`}>
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 size={24} className="mx-auto animate-spin text-gray-500" /></div>
      ) : contracts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="还没有合同"
          description="上传第一个合同，AI 会自动解析关键信息"
          actionLabel="新建合同"
          onAction={() => { setShowForm(true); resetForm() }}
          tone="orange"
          className="mb-8"
        />
      ) : (
        <div className="space-y-2">
          {contracts.map(c => {
            const ps = c.parse_status || 'pending'
            const isParsing = ps === 'parsing'
            const meta = safeJsonParse<Record<string, ExtractionMeta>>(c.extraction_meta, {})
            return (
            <div key={c.id} className="rounded-xl bg-bg-card border border-border overflow-hidden">
              <button className="w-full text-left px-4 md:px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover/50 transition-colors"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                <FileText size={18} className="text-[#3B82F6] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{c.title}</span>
                    {c.contract_no && <span className="text-[10px] text-gray-500">#{c.contract_no}</span>}
                    {c.contract_type && (
                      <span className={`text-[10px] px-1.5 py-px rounded border ${CONTRACT_TYPE_COLORS[c.contract_type] || CONTRACT_TYPE_COLORS['其他']}`}>
                        {c.contract_type}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-gray-500">{getCustomerName(c.customer_id)}</span>
                    {c.contract_amount && <span className="text-[10px] text-gray-500">{formatAmount(c.contract_amount, c.currency)}</span>}
                    {c.sign_date && <span className="text-[10px] text-gray-500">{c.sign_date}</span>}
                    {c.start_date && c.end_date && (
                      <span className="text-[10px] text-gray-500">{c.start_date} → {c.end_date}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[c.status] || STATUS_COLORS['生效中']}`}>{c.status}</span>
                  {/* 阶段 1+2：解析状态徽章 */}
                  <span
                    title={c.parse_error || ''}
                    className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${PARSE_STATUS_COLORS[ps] || PARSE_STATUS_COLORS.pending}`}>
                    {isParsing && <Loader2 size={9} className="animate-spin" />}
                    {PARSE_STATUS_LABELS[ps] || ps}
                  </span>
                  {c.file_path && !isParsing && ps !== 'success' && (
                    <button onClick={(e) => { e.stopPropagation(); ps === 'failed' ? handleReparse(c.id) : handleParse(c.id) }} disabled={parsingId === c.id}
                      className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${ps === 'failed' ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/30' : 'bg-[#8B5CF6]/10 text-[#8B5CF6] hover:bg-[#8B5CF6]/20 border-[#8B5CF6]/20'} disabled:opacity-50`}>
                      {parsingId === c.id ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
                      {ps === 'failed' ? '重解析' : 'AI解析'}
                    </button>
                  )}
                  {expandedId === c.id ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                </div>
              </button>
              {expandedId === c.id && (
                <div className="px-4 md:px-5 pb-4 border-t border-border/50 pt-3 space-y-3">
                  {/* 解析失败时的高优先提示 */}
                  {ps === 'failed' && c.parse_error && (
                    <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 flex items-start gap-2">
                      <AlertTriangle size={14} className="text-red-400 shrink-0 mt-px" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-red-300">解析失败</p>
                        <p className="text-[11px] text-red-400/80 mt-0.5 break-all">{c.parse_error}</p>
                      </div>
                      <button onClick={() => handleReparse(c.id)} className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 shrink-0">
                        重新解析
                      </button>
                    </div>
                  )}

                  {/* 关键日期 - 第一行最显眼 */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <span className="text-[10px] text-gray-500">签订日期</span>
                      <p className="text-xs text-gray-200">{c.sign_date || '-'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-500">开始日期</span>
                      <p className="text-xs text-gray-200">{c.start_date || '-'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-500">截止日期</span>
                      <p className="text-xs text-gray-200">{c.end_date || '-'}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-500">合同金额</span>
                      <p className="text-xs text-gray-200">{c.contract_amount ? formatAmount(c.contract_amount, c.currency) : '-'}</p>
                    </div>
                  </div>

                  {/* 期限原文 + 续约条款（高优）*/}
                  {(c.effective_term || c.auto_renew) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {c.effective_term && (
                        <div className="p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20">
                          <span className="text-[10px] text-blue-400 flex items-center gap-1"><Calendar size={10} />合同期限</span>
                          <p className="text-xs text-gray-200 mt-1">{c.effective_term}</p>
                        </div>
                      )}
                      {c.auto_renew && (
                        <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                          <span className="text-[10px] text-amber-400 flex items-center gap-1"><RefreshCw size={10} />续约条款</span>
                          <p className="text-xs text-gray-200 mt-1">{c.auto_renew}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 双方主体 */}
                  {(c.party_a || c.party_b) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {c.party_a && (
                        <div>
                          <span className="text-[10px] text-gray-500">甲方</span>
                          <p className="text-xs text-gray-200">{c.party_a}</p>
                        </div>
                      )}
                      {c.party_b && (
                        <div>
                          <span className="text-[10px] text-gray-500">乙方</span>
                          <p className="text-xs text-gray-200">{c.party_b}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 付款节点 */}
                  {c.payment_schedule && (() => {
                    const nodes = safeJsonParse<PaymentNode[]>(c.payment_schedule, [])
                    if (!Array.isArray(nodes) || nodes.length === 0) return null
                    return (
                      <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1 mb-1.5"><CreditCard size={10} />付款节点</span>
                        <div className="space-y-1">
                          {nodes.map((n, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs text-gray-200">
                              <span className="text-emerald-400 font-mono text-[11px]">{idx + 1}.</span>
                              <span className="font-medium">{n.phase || '-'}</span>
                              {n.percent != null && <span className="text-emerald-400 text-[11px]">· {n.percent}%</span>}
                              {n.condition && <span className="text-gray-400 text-[11px] truncate">· {n.condition}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* 关键条款 - 标签云 */}
                  {(() => {
                    const items: Array<[string, string, string]> = []
                    if (c.penalty_clause) items.push(['违约金条款', c.penalty_clause, 'F59E0B'])
                    if (c.acceptance_terms) items.push(['验收条款', c.acceptance_terms, '10B981'])
                    if (c.dispute_resolution) items.push(['争议解决', c.dispute_resolution, 'EC4899'])
                    if (c.governing_law) items.push(['适用法律', c.governing_law, '6366F1'])
                    if (c.ip_clause) items.push(['知识产权', c.ip_clause, '8B5CF6'])
                    if (c.notice_clause) items.push(['通知送达', c.notice_clause, '06B6D4'])
                    if (items.length === 0) return null
                    return (
                      <div className="space-y-2">
                        {items.map(([label, content, color], idx) => (
                          <details key={idx} className="group">
                            <summary style={{ color: `#${color}` }} className="cursor-pointer text-[11px] flex items-center gap-1 list-none">
                              <ChevronRight size={10} className="group-open:rotate-90 transition-transform" />
                              <span className="font-medium">{label}</span>
                              <span className="text-gray-500 truncate">· {content.slice(0, 40)}{content.length > 40 ? '...' : ''}</span>
                            </summary>
                            <p className="text-xs text-gray-200 mt-1 ml-4 leading-relaxed whitespace-pre-wrap">{content}</p>
                          </details>
                        ))}
                      </div>
                    )
                  })()}

                  {/* AI 摘要 */}
                  {c.summary && (
                    <div className="p-3 rounded-lg bg-[#3B82F6]/5 border border-[#3B82F6]/20">
                      <span className="text-[10px] text-[#3B82F6] flex items-center gap-1 mb-1"><Sparkles size={10} />AI 摘要</span>
                      <p className="text-xs text-gray-200 leading-relaxed">{c.summary}</p>
                    </div>
                  )}

                  {/* 关键条款原文 */}
                  {c.key_clauses && (
                    <div className="p-3 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/20">
                      <span className="text-[10px] text-[#F59E0B] mb-1 block">关键条款原文</span>
                      <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{c.key_clauses}</p>
                    </div>
                  )}

                  {/* 解析置信度面板（高阶功能） */}
                  {ps === 'success' && Object.keys(meta).length > 0 && (
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-gray-500 hover:text-gray-300 flex items-center gap-1">
                        <ChevronRight size={10} className="inline" />查看 AI 抽取质量（confidence + 原文引用）
                      </summary>
                      <div className="mt-2 space-y-1.5 p-2 rounded bg-bg-input/50">
                        {Object.entries(meta).filter(([k]) => k !== 'title').slice(0, 8).map(([k, v]) => (
                          <div key={k} className="flex items-start gap-2">
                            <span className={`shrink-0 font-mono text-[10px] ${confidenceColor(v?.confidence)}`}>
                              {v?.confidence != null ? `${(v.confidence * 100).toFixed(0)}%` : '   '}
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className="text-gray-400">{k}:</span>
                              {v?.source_text && <p className="text-gray-500 text-[10px] italic truncate" title={v.source_text}>「{v.source_text}」</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    {c.file_path && (
                      <>
                        <button onClick={() => handlePreview(c.id, c.file_name, c.file_type)}
                          className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 border border-[#3B82F6]/20">
                          <Eye size={10} />预览
                        </button>
                        <button onClick={() => handleDownload(c.id, c.file_name)}
                          className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg bg-bg-input text-gray-300 hover:text-white border border-border">
                          <Download size={10} />下载文件
                        </button>
                      </>
                    )}
                     {hasPermission('contract:edit') && (
                      <button onClick={() => startEdit(c)}
                        className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-bg-hover border border-border">
                        <Pencil size={10} />编辑
                      </button>
                    )}
                    {hasPermission('contract:delete') && (
                      <button onClick={() => handleDelete(c.id)}
                        className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-border ml-auto">
                        <Trash2 size={10} />删除
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {showForm && createPortal(
        <ContractFormModal
          editingId={editingId}
          form={form}
          setForm={setForm}
          file={file}
          setFile={setFile}
          customers={customers}
          customersProjects={customersProjects}
          saving={saving}
          onClose={() => { setShowForm(false); resetForm() }}
          onSubmit={handleSubmit}
        />,
        document.body
      )}

      {/* 文件预览弹窗 */}
      {previewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={closePreview}>
          <div className="w-full max-w-6xl mx-0 md:mx-4 h-[90vh] rounded-none md:rounded-2xl bg-bg-card border border-border shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="text-[#3B82F6] shrink-0" />
                <span className="text-sm font-medium text-white truncate">{previewName}</span>
                {previewType && <span className="text-[10px] text-gray-500 bg-bg-hover px-1.5 py-0.5 rounded shrink-0">{previewType.toUpperCase().replace('.', '')}</span>}
              </div>
              <button onClick={closePreview} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* 预览内容 */}
            <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900">
              {previewLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={28} className="animate-spin text-gray-400" />
                </div>
              ) : previewUrl ? (
                // PDF 原件 / DOC/DOCX 转换出的 PDF 都用 iframe 渲染
                <iframe src={previewUrl} className="w-full h-full border-0" title={previewName} />
              ) : previewText ? (
                <div className="h-full overflow-y-auto p-4 md:p-6">
                  <div className="max-w-4xl mx-auto">
                    <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
                      <AlertTriangle size={14} />
                      <span>以下为 AI 提取的文字内容，可能与原件存在偏差，仅供参考。重要信息请以原件为准。</span>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-border p-4 md:p-8 shadow-sm">
                      <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-gray-800 dark:text-gray-200">
                        {previewText}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
                  <FileText size={48} className="opacity-30" />
                  <p className="text-sm">无法加载文件内容</p>
                  <p className="text-xs text-gray-600">请尝试下载文件后在本地查看</p>
                  <button onClick={() => {
                    const c = contracts.find(ct => ct.id === previewId)
                    if (c) handleDownload(c.id, c.file_name)
                  }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] text-sm hover:bg-[#3B82F6]/20 border border-[#3B82F6]/20">
                    <Download size={14} />下载文件
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// === 合同录入弹窗：单页布局（上传 + AI 解析 + 字段回填） ===
interface ContractFormModalProps {
  editingId: number | null
  form: any
  setForm: (f: any) => void
  file: File | null
  setFile: (f: File | null) => void
  customers: CustomerSimple[]
  customersProjects: ProjectSimple[]
  saving: boolean
  onClose: () => void
  onSubmit: () => void
}

function ContractFormModal({
  editingId, form, setForm, file, setFile, customers, customersProjects, saving, onClose, onSubmit,
}: ContractFormModalProps) {
  const updateField = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm({ ...form, [key]: value })
  }, [form, setForm])

  const basicsValid = !!form.title?.trim() && !!form.customer_id

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="px-6 pt-4 pb-3 border-b border-gray-200 dark:border-border/15 shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#3B82F6] flex items-center justify-center text-[#fff] shadow-sm shrink-0">
              <FileSignature size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">{editingId ? '编辑合同' : '新建合同'}</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5 truncate">
                {editingId ? '修改合同基本信息' : '上传合同文件，AI 自动识别关键字段'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer shrink-0"><X size={16} /></button>
        </div>

        {/* 表体 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 文件上传区（新建模式核心） */}
          {!editingId && (
            <label className={`flex items-center gap-4 px-4 py-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors group ${
              file
                ? 'border-[#3B82F6] bg-[#3B82F6]/5'
                : 'border-gray-200 dark:border-border/30 hover:border-[#3B82F6] hover:bg-[#3B82F6]/5'
            }`}>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                file ? 'bg-[#3B82F6] text-[#fff]' : 'bg-[#3B82F6]/10 text-[#3B82F6] group-hover:bg-[#3B82F6]/15'
              }`}>
                <Upload size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-200 truncate">
                    {file ? file.name : '拖拽或点击上传合同文件'}
                  </p>
                  {file && <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">· {(file.size / 1024).toFixed(1)} KB</span>}
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5 flex items-center gap-1.5">
                  <Sparkles size={10} className="text-[#3B82F6]" />
                  <span>支持 PDF / DOC / DOCX · 上传后系统将自动 AI 解析并填充下方字段</span>
                </p>
              </div>
              {file && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setFile(null) }}
                  className="px-2.5 py-1 rounded-md text-[11px] text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                >
                  移除
                </button>
              )}
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f) }}
              />
            </label>
          )}

          {/* 合同基础 */}
          <SectionTitle icon={FileSignature} title="合同基础" subtitle="合同名称、编号、关联的客户与项目" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="合同名称" required icon={AtSign} hint="便于在合同列表中识别">
              <input
                value={form.title}
                onChange={e => updateField('title', e.target.value)}
                className="form-input"
                placeholder="如：2025 年度云服务合同"
                autoFocus
              />
            </FormField>
            <FormField label="合同编号" icon={AtSign} hint="如不填，系统将按规则自动生成" optional>
              <input
                value={form.contract_no}
                onChange={e => updateField('contract_no', e.target.value)}
                className="form-input font-mono"
                placeholder="CON-2025-001"
              />
            </FormField>
            <FormField label="关联客户" required icon={Building2}>
              <SearchableSelect
                options={[
                  { id: 0, label: '请选择客户' },
                  ...customers.map(c => ({ id: c.id, label: c.name })),
                ]}
                value={form.customer_id || 0}
                onChange={(v) => setForm({ ...form, customer_id: (v as number) || 0, project_id: 0 })}
                placeholder="选择关联客户"
                searchPlaceholder="按客户名称搜索..."
                emptyText="没有匹配客户"
              />
            </FormField>
            {customersProjects.length > 0 && (
              <FormField label="关联项目" icon={Briefcase} hint="可关联到该客户下的具体项目" optional>
                <SearchableSelect
                  options={[
                    { id: 0, label: '不关联项目' },
                    ...customersProjects.map(p => ({ id: p.id, label: p.name })),
                  ]}
                  value={form.project_id || 0}
                  onChange={(v) => updateField('project_id', (v as number) || 0)}
                  placeholder="选择关联项目"
                  searchPlaceholder="按项目名称搜索..."
                  emptyText="该项目下暂无项目"
                />
              </FormField>
            )}
          </div>

          {/* 合同日期 */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar size={11} className="text-gray-400 dark:text-gray-500" />
              <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">合同日期</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <DateField label="签订日期" value={form.sign_date} onChange={v => updateField('sign_date', v)} />
              <DateField label="开始日期" value={form.start_date} onChange={v => updateField('start_date', v)} />
              <DateField label="截止日期" value={form.end_date} onChange={v => updateField('end_date', v)} />
            </div>
          </div>

          {/* 商务条款 */}
          <SectionTitle icon={FileSignature} title="商务条款" subtitle="双方、金额、付款方式（AI 解析会优先回填）" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="甲方" icon={Building2} hint="通常为我方公司" optional>
              <input
                value={form.party_a}
                onChange={e => updateField('party_a', e.target.value)}
                className="form-input"
                placeholder="我方公司"
              />
            </FormField>
            <FormField label="乙方" icon={Building2} hint="通常为对方公司" optional>
              <input
                value={form.party_b}
                onChange={e => updateField('party_b', e.target.value)}
                className="form-input"
                placeholder="对方公司"
              />
            </FormField>
            <FormField label="合同金额" icon={Banknote} hint="以万元为单位" optional>
              <input
                type="number"
                step="0.01"
                value={form.contract_amount}
                onChange={e => updateField('contract_amount', e.target.value)}
                className="form-input font-mono"
                placeholder="0.00"
              />
            </FormField>
            <FormField label="币种" icon={Coins}>
              <SearchableSelect
                options={[
                  { id: 'CNY', label: 'CNY 人民币' },
                  { id: 'USD', label: 'USD 美元' },
                  { id: 'EUR', label: 'EUR 欧元' },
                  { id: 'JPY', label: 'JPY 日元' },
                  { id: 'HKD', label: 'HKD 港币' },
                ]}
                value={form.currency}
                onChange={(v) => updateField('currency', v as string)}
                placeholder="选择币种"
                searchable={false}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="付款方式" icon={Banknote} hint="如：分期付款、一次性付清" optional>
              <input
                value={form.payment_terms}
                onChange={e => updateField('payment_terms', e.target.value)}
                className="form-input"
                placeholder="可填写付款方式"
              />
            </FormField>
            <FormField label="备注" icon={ScrollText} hint="其它需要记录的信息" optional>
              <input
                value={form.remarks}
                onChange={e => updateField('remarks', e.target.value)}
                className="form-input"
                placeholder="可填写备注"
              />
            </FormField>
          </div>
        </div>

        {/* 页脚 */}
        <div className="px-6 py-3.5 border-t border-gray-200 dark:border-border/15 shrink-0 bg-gray-50/50 dark:bg-bg-hover/10 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-card hover:bg-gray-100 dark:hover:bg-bg-hover text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold">取消</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving || !basicsValid}
            className="px-4 py-2 rounded-lg bg-[#3B82F6] text-[#fff] text-xs font-bold hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all cursor-pointer"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {saving ? '保存中...' : (editingId ? '更新合同' : '保存并 AI 解析')}
          </button>
        </div>
      </div>
    </div>
  )
}

// === 内部小组件 ===
function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof FileSignature; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center text-[#3B82F6]">
        <Icon size={14} />
      </div>
      <div>
        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h4>
        {subtitle && <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function FormField({
  label, required, icon: Icon, hint, optional, children,
}: {
  label: string; required?: boolean; icon?: typeof FileSignature; hint?: string; optional?: boolean; children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={11} className="text-gray-400 dark:text-gray-500" />}
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}{optional && <span className="text-gray-400 dark:text-gray-600 ml-1 font-normal">(可选)</span>}
        </span>
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 dark:text-gray-500 mb-1">{label}</label>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="form-input text-xs"
      />
    </div>
  )
}
