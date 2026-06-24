import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Plus, X, Loader2, Trash2, FileText, Download, Sparkles, ChevronDown, ChevronRight,
  Pencil, Eye, AlertTriangle, Calendar, RefreshCw, CreditCard, FileSignature, Upload, Building2,
  AtSign, Briefcase, Banknote, Coins, ScrollText, GitBranch, Printer, Stamp, CheckCircle2,
  LayoutTemplate, FileUp, RotateCcw, XCircle,
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import SearchableSelect from '../components/SearchableSelect'
import { PageHeader, EmptyState } from '../components/design-system'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'
import ContractDocEditor from '../components/ContractDocEditor'

interface ContractRecord {
  id: number
  user_id: number
  customer_id: number | null
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
  amount_unit: string
  currency: string
  payment_terms: string | null
  key_clauses: string | null
  summary: string | null
  status: string
  remarks: string | null
  contract_type: string
  effective_term: string
  auto_renew: string
  penalty_clause: string
  acceptance_terms: string
  payment_schedule: string
  ip_clause: string
  dispute_resolution: string
  governing_law: string
  notice_clause: string
  parse_status: string
  parse_error: string
  parsed_at: string | null
  extraction_meta: string
  // 来源与模板
  source: string
  template_id: number | null
  content_html: string | null
  // 签章归档
  signed_file_path: string
  signed_file_name: string
  // 用章申请
  seal_types_requested: string
  // 历史归档
  is_historical: boolean
  created_at: string
  updated_at: string
}

interface ContractTemplate {
  id: number
  name: string
  description: string | null
  category: string
  content: string
}

interface PaymentNode { phase?: string; percent?: number; condition?: string }
interface ExtractionMeta { confidence?: number; source_text?: string }

interface CustomerSimple { id: number; name: string }
interface ProjectSimple { id: number; name: string; customer_id: number | null }

const STATUS_OPTIONS = ['草稿', '审批中', '已驳回', '生效中', '即将到期', '已到期', '已终止']
const STATUS_COLORS: Record<string, string> = {
  '草稿': 'text-gray-500 dark:text-gray-400 bg-gray-500/10 border-gray-500/30',
  '审批中': 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
  '已驳回': 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30',
  '生效中': 'text-emerald-700 dark:text-green-400 bg-green-500/10 border-green-500/30',
  '即将到期': 'text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  '已到期': 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30',
  '已终止': 'text-gray-500 dark:text-gray-400 bg-gray-500/10 border-gray-500/30',
}

const CURRENCY_LABELS: Record<string, string> = {
  'CNY': '人民币', 'USD': '美元', 'EUR': '欧元', 'JPY': '日元', 'HKD': '港币',
}

function formatAmount(amount: number | null, currency: string, unit = '万元') {
  if (!amount && amount !== 0) return ''
  return `${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${unit} (${CURRENCY_LABELS[currency] || currency})`
}

const PARSE_STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-500 dark:text-gray-400 bg-gray-500/10 border-gray-500/20',
  parsing: 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/30',
  success: 'text-emerald-700 dark:text-green-400 bg-green-500/10 border-green-500/30',
  failed: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30',
}
const PARSE_STATUS_LABELS: Record<string, string> = {
  pending: '待解析', parsing: '解析中', success: '已解析', failed: '解析失败',
}

const CONTRACT_TYPE_COLORS: Record<string, string> = {
  '销售合同': 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  '采购合同': 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  '服务合同': 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  '租赁合同': 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
  '劳动合同': 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30',
  '保密协议': 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/30',
  '技术合同': 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30',
  '咨询合同': 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30',
  '合作协议': 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30',
  '框架协议': 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
  '委托协议': 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30',
  '补充协议': 'bg-lime-500/10 text-lime-700 dark:text-lime-400 border-lime-500/30',
  '战略合作协议': 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  '股权/投资协议': 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  '其他': 'bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/30',
}

interface TypeConfig {
  showCustomer: boolean
  showProject: boolean
  showAmount: boolean
  partyALabel?: string
  partyBLabel?: string
  defaultSeals: string[]
}
const CONTRACT_TYPE_CONFIG: Record<string, TypeConfig> = {
  '销售合同':     { showCustomer: true,  showProject: true,  showAmount: true,  defaultSeals: ['合同章'] },
  '采购合同':     { showCustomer: true,  showProject: false, showAmount: true,  defaultSeals: ['合同章', '财务章'] },
  '服务合同':     { showCustomer: true,  showProject: true,  showAmount: true,  defaultSeals: ['合同章'] },
  '租赁合同':     { showCustomer: false, showProject: false, showAmount: true,  defaultSeals: ['公章'] },
  '劳动合同':     { showCustomer: false, showProject: false, showAmount: false, partyALabel: '用人单位', partyBLabel: '劳动者', defaultSeals: ['公章', '法人章'] },
  '保密协议':     { showCustomer: true,  showProject: true,  showAmount: false, defaultSeals: ['合同章'] },
  '技术合同':     { showCustomer: true,  showProject: true,  showAmount: true,  defaultSeals: ['合同章'] },
  '咨询合同':     { showCustomer: true,  showProject: false, showAmount: true,  defaultSeals: ['合同章'] },
  '合作协议':     { showCustomer: true,  showProject: false, showAmount: false, defaultSeals: ['公章'] },
  '框架协议':     { showCustomer: true,  showProject: false, showAmount: false, defaultSeals: ['合同章'] },
  '委托协议':     { showCustomer: true,  showProject: false, showAmount: true,  defaultSeals: ['合同章'] },
  '补充协议':     { showCustomer: true,  showProject: true,  showAmount: true,  defaultSeals: ['合同章'] },
  '战略合作协议': { showCustomer: true,  showProject: false, showAmount: false, defaultSeals: ['公章', '法人章'] },
  '股权/投资协议':{ showCustomer: false, showProject: false, showAmount: true,  defaultSeals: ['法人章', '公章'] },
  '其他':         { showCustomer: true,  showProject: false, showAmount: true,  defaultSeals: ['公章'] },
}
const DEFAULT_TYPE_CONFIG: TypeConfig = { showCustomer: true, showProject: true, showAmount: true, defaultSeals: ['公章'] }

const ALL_SEAL_TYPES = ['公章', '法人章', '财务章', '合同章', '人事章']

const CONTRACT_TYPE_OPTIONS = [
  '销售合同', '采购合同', '服务合同', '租赁合同', '劳动合同',
  '保密协议', '技术合同', '咨询合同', '合作协议', '框架协议',
  '委托协议', '补充协议', '战略合作协议', '股权/投资协议', '其他',
]

function confidenceColor(c?: number): string {
  if (c == null) return 'text-gray-600'
  if (c >= 0.85) return 'text-green-600 dark:text-green-400'
  if (c >= 0.6) return 'text-yellow-700 dark:text-yellow-400'
  return 'text-red-600 dark:text-red-400'
}

function safeJsonParse<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

// 打印合同内容（直接调系统打印对话框）
function printContractHtml(html: string, title: string) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: SimSun, serif; }
      @media print { @page { margin: 20mm; } }
    </style>
  </head><body>${html}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); w.close() }, 300)
}

export default function ContractsPage() {
  const { hasPermission } = useAuth()
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [customers, setCustomers] = useState<CustomerSimple[]>([])
  const [projects, setProjects] = useState<ProjectSimple[]>([])
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingContract, setEditingContract] = useState<ContractRecord | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [parsingId, setParsingId] = useState<number | null>(null)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewName, setPreviewName] = useState('')
  const [previewType, setPreviewType] = useState('')
  const [submitPreview, setSubmitPreview] = useState<{
    contractId: number
    nodes: { name: string; approver_type: string; approver_names: string[]; node_kind?: string }[]
    noFlow?: boolean
  } | null>(null)
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  // 签章上传
  const [signedUploadId, setSignedUploadId] = useState<number | null>(null)
  const [signedFile, setSignedFile] = useState<File | null>(null)
  const [uploadingSign, setUploadingSign] = useState(false)
  // 历史归档
  const [showArchiveForm, setShowArchiveForm] = useState(false)

  const loadContracts = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (keyword) params.set('keyword', keyword)
    fetch(`/api/v1/contracts?${params.toString()}`)
      .then(r => r.json())
      .then(data => { setContracts(data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [statusFilter, keyword])

  useEffect(() => { loadContracts() }, [loadContracts])

  // 轮询解析状态
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
            const full = await fetch(`/api/v1/contracts/${c.id}`)
            if (!full.ok) return null
            return await full.json()
          } catch { return null }
        })
      )
      if (!active) return
      const succeeded: number[] = []
      const failed: number[] = []
      setContracts(prev => {
        const next = [...prev]
        updates.forEach((updated) => {
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
      if (failed.length > 0) showToast(`${failed.length} 份合同解析失败`, 'error')
    }
    const timer = setInterval(poll, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [contracts, showToast])

  useEffect(() => {
    fetch('/api/v1/customers/selector').then(r => r.ok ? r.json() : []).then(data => setCustomers(Array.isArray(data) ? data : [])).catch(() => {})
    fetch('/api/v1/projects/selector').then(r => r.ok ? r.json() : []).then(data => setProjects(Array.isArray(data) ? data : [])).catch(() => {})
    fetch('/api/v1/contract-templates').then(r => r.ok ? r.json() : []).then(data => setTemplates(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  const handleDelete = async (id: number) => {
    const ok = await showConfirm('确定删除此合同？相关文件也会被删除。')
    if (!ok) return
    const res = await fetch(`/api/v1/contracts/${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('已删除', 'success'); loadContracts() }
    else { let d = '删除失败'; try { const e = await res.json(); d = e.detail || d } catch {} showToast(d, 'error') }
  }

  const handleRevokeApproval = async (id: number) => {
    const ok = await showConfirm('确定撤回该合同的审批申请？撤回后合同恢复草稿状态，可重新修改后提交。')
    if (!ok) return
    const res = await fetch(`/api/v1/contracts/${id}/revoke-approval`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) { showToast(data.message || '审批已撤回', 'success'); loadContracts() }
    else showToast(data.detail || '撤回失败', 'error')
  }

  const handleSubmitApproval = async (id: number) => {
    try {
      const res = await fetch(`/api/v1/contracts/${id}/approval-preview`)
      const data = res.ok ? await res.json() : { nodes: [], no_flow: false }
      setSubmitPreview({ contractId: id, nodes: data.nodes ?? [], noFlow: data.no_flow })
    } catch {
      setSubmitPreview({ contractId: id, nodes: [] })
    }
  }

  const confirmSubmitApproval = async () => {
    if (!submitPreview) return
    setSubmittingId(submitPreview.contractId)
    try {
      const res = await fetch(`/api/v1/contracts/${submitPreview.contractId}/submit-approval`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        showToast(data.message || '已提交审批', 'success')
        setSubmitPreview(null)
        loadContracts()
      } else {
        showToast(data.detail || '提交审批失败', 'error')
      }
    } catch { showToast('提交失败，请检查网络', 'error') }
    finally { setSubmittingId(null) }
  }

  const handleDownload = async (id: number, fileName: string) => {
    const res = await fetch(`/api/v1/contracts/${id}/file`)
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fileName || 'contract'; a.click()
      URL.revokeObjectURL(url)
    } else {
      showToast('下载失败，请稍后重试', 'error')
    }
  }

  const handleDownloadSigned = async (id: number, fileName: string) => {
    const res = await fetch(`/api/v1/contracts/${id}/signed-file`)
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fileName || 'signed_contract'; a.click()
      URL.revokeObjectURL(url)
    } else {
      showToast('签章文件下载失败', 'error')
    }
  }

  const handleUploadSigned = async () => {
    if (!signedFile || !signedUploadId) return
    setUploadingSign(true)
    const fd = new FormData()
    fd.append('file', signedFile)
    const res = await fetch(`/api/v1/contracts/${signedUploadId}/upload-signed`, { method: 'POST', body: fd })
    if (res.ok) {
      showToast('签章版已上传归档', 'success')
      setSignedUploadId(null)
      setSignedFile(null)
      loadContracts()
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.detail || '上传失败', 'error')
    }
    setUploadingSign(false)
  }

  const handleReparse = async (id: number) => {
    const res = await fetch(`/api/v1/contracts/${id}/reparse`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      setContracts(prev => prev.map(c => c.id === id ? data : c))
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
        const res = await fetch(`/api/v1/contracts/${id}/file?preview=true`)
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(url); setPreviewText('')
          return
        }
        closePreview(); return
      }
      if (isOffice) {
        const res = await fetch(`/api/v1/contracts/${id}/file?preview=true&convert=pdf`)
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(url); setPreviewText('')
          return
        }
        const fallback = await fetch(`/api/v1/contracts/${id}/preview-text`)
        if (fallback.ok) {
          const data = await fallback.json()
          setPreviewText(data.text || ''); setPreviewUrl('')
        } else {
          closePreview()
        }
        return
      }
      const res = await fetch(`/api/v1/contracts/${id}/preview-text`)
      if (res.ok) {
        const data = await res.json()
        setPreviewText(data.text || ''); setPreviewUrl('')
      } else {
        closePreview()
      }
    } catch { closePreview() }
    finally { setPreviewLoading(false) }
  }

  const closePreview = () => {
    setPreviewId(null)
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl('') }
    setPreviewText(''); setPreviewName(''); setPreviewType('')
  }

  const getCustomerName = (id: number) => customers.find(c => c.id === id)?.name || ''

  return (
    <div>
      <PageHeader
        icon={FileText}
        title="合同管理"
        description="管理所有合同文件，支持从模板创建或上传对方合同"
        tone="orange"
        stats={[{ label: '合同', value: contracts.length }]}
        right={
          <div className="flex items-center gap-2">
            {hasPermission('contract:archive') && (
              <button onClick={() => setShowArchiveForm(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-border bg-bg-card text-gray-600 dark:text-gray-400 text-xs font-bold hover:border-[#3B82F6]/50 hover:text-[#3B82F6] transition-all cursor-pointer">
                <Upload size={14} strokeWidth={2.5} /><span>历史归档</span>
              </button>
            )}
            {hasPermission('contract:create') && (
              <button onClick={() => { setShowForm(true); setEditingContract(null) }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#3B82F6] text-[#fff] text-xs font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all cursor-pointer">
                <Plus size={14} strokeWidth={2.5} /><span>新建合同</span>
              </button>
            )}
          </div>
        }
      />

      {/* 搜索 + 状态筛选 */}
      <div className="flex items-center gap-3 mb-5 overflow-x-auto">
        <div className="relative flex-1 max-w-sm min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索合同..." className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-card border border-border text-sm text-gray-800 dark:text-gray-300 outline-none focus:border-[#3B82F6]" />
        </div>
        {STATUS_OPTIONS.map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusFilter === s ? 'bg-[#3B82F6]/20 text-[#3B82F6] border-[#3B82F6]/40' : 'text-gray-600 dark:text-gray-400 border-border hover:text-gray-900 dark:hover:text-gray-200'}`}>
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
          description="从模板创建合同，或上传对方发来的合同文件"
          actionLabel="新建合同"
          onAction={() => { setShowForm(true); setEditingContract(null) }}
          tone="orange"
          className="mb-8"
        />
      ) : (
        <div className="space-y-2">
          {contracts.map(c => {
            const ps = c.parse_status || 'pending'
            const isParsing = ps === 'parsing'
            const meta = safeJsonParse<Record<string, ExtractionMeta>>(c.extraction_meta, {})
            const isSelfMade = c.source === 'self_made'
            const hasSignedCopy = !!c.signed_file_path
            const canPrintOrSign = c.status === '生效中'
            const isHistorical = !!c.is_historical
            return (
              <div key={c.id} className="rounded-xl bg-bg-card border border-border overflow-hidden">
                <button className="w-full text-left px-4 md:px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover/50 transition-colors"
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isSelfMade ? 'bg-indigo-500/15' : 'bg-[#3B82F6]/15'}`}>
                    {isSelfMade
                      ? <LayoutTemplate size={14} className="text-indigo-400" />
                      : <FileUp size={14} className="text-[#3B82F6]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{c.title}</span>
                      {c.contract_no && <span className="text-[11px] text-gray-500">#{c.contract_no}</span>}
                      {c.contract_type && (
                        <span className={`text-[11px] px-1.5 py-px rounded border ${CONTRACT_TYPE_COLORS[c.contract_type] || CONTRACT_TYPE_COLORS['其他']}`}>
                          {c.contract_type}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[11px] text-gray-500">{getCustomerName(c.customer_id)}</span>
                      {c.contract_amount && <span className="text-[11px] text-gray-500">{formatAmount(c.contract_amount, c.currency, c.amount_unit)}</span>}
                      {c.sign_date && <span className="text-[11px] text-gray-500">{c.sign_date}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[c.status] || STATUS_COLORS['生效中']}`}>{c.status}</span>
                    {hasSignedCopy && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 size={9} />已归档
                      </span>
                    )}
                    {!isSelfMade && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${PARSE_STATUS_COLORS[ps] || PARSE_STATUS_COLORS.pending}`}>
                        {isParsing && <Loader2 size={9} className="animate-spin" />}
                        {PARSE_STATUS_LABELS[ps] || ps}
                      </span>
                    )}
                    {expandedId === c.id ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                  </div>
                </button>

                {expandedId === c.id && (
                  <div className="px-4 md:px-5 pb-4 border-t border-border/50 pt-3 space-y-3">
                    {/* 已驳回提示 */}
                    {c.status === '已驳回' && (
                      <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 flex items-start gap-2">
                        <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0 mt-px" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-red-600 dark:text-red-300 font-medium">审批已驳回</p>
                          <p className="text-[11px] text-red-500 dark:text-red-400/80 mt-0.5">您的审批申请已被驳回，请修改合同内容后重新提交审批。</p>
                        </div>
                        {hasPermission('contract:edit') && (
                          <button onClick={() => { setEditingContract(c); setShowForm(true) }}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-600 dark:text-red-300 hover:bg-red-500/25 border border-red-500/30 shrink-0">
                            <Pencil size={9} />修改重提
                          </button>
                        )}
                      </div>
                    )}

                    {/* 解析失败提示（仅外部合同） */}
                    {!isSelfMade && ps === 'failed' && c.parse_error && (
                      <div className="p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 flex items-start gap-2">
                        <AlertTriangle size={14} className="text-red-600 dark:text-red-400 shrink-0 mt-px" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-red-600 dark:text-red-300">解析失败</p>
                          <p className="text-[11px] text-red-500 dark:text-red-400/80 mt-0.5 break-all">{c.parse_error}</p>
                        </div>
                        <button onClick={() => handleReparse(c.id)} className="text-[11px] px-2 py-1 rounded bg-red-500/20 text-red-600 dark:text-red-300 hover:bg-red-500/30 shrink-0">
                          重新解析
                        </button>
                      </div>
                    )}

                    {/* 关键日期 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div><span className="text-[11px] text-gray-500">签订日期</span><p className="text-xs text-gray-200">{c.sign_date || '-'}</p></div>
                      <div><span className="text-[11px] text-gray-500">开始日期</span><p className="text-xs text-gray-200">{c.start_date || '-'}</p></div>
                      <div><span className="text-[11px] text-gray-500">截止日期</span><p className="text-xs text-gray-200">{c.end_date || '-'}</p></div>
                      <div><span className="text-[11px] text-gray-500">合同金额</span><p className="text-xs text-gray-200">{c.contract_amount ? formatAmount(c.contract_amount, c.currency, c.amount_unit) : '-'}</p></div>
                    </div>

                    {/* 申请用章（历史归档合同已盖章，无需显示） */}
                    {!isHistorical && c.seal_types_requested && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-gray-500 shrink-0">申请用章</span>
                        {c.seal_types_requested.split(',').filter(Boolean).map(s => (
                          <span key={s} className="text-[11px] px-2 py-0.5 rounded border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30">{s}</span>
                        ))}
                      </div>
                    )}

                    {/* 续约期限（外部合同 AI 解析出的） */}
                    {(c.effective_term || c.auto_renew) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {c.effective_term && (
                          <div className="p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20">
                            <span className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1"><Calendar size={10} />合同期限</span>
                            <p className="text-xs text-gray-200 mt-1">{c.effective_term}</p>
                          </div>
                        )}
                        {c.auto_renew && (
                          <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                            <span className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1"><RefreshCw size={10} />续约条款</span>
                            <p className="text-xs text-gray-200 mt-1">{c.auto_renew}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 双方主体 */}
                    {(c.party_a || c.party_b) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {c.party_a && <div><span className="text-[11px] text-gray-500">甲方</span><p className="text-xs text-gray-200">{c.party_a}</p></div>}
                        {c.party_b && <div><span className="text-[11px] text-gray-500">乙方</span><p className="text-xs text-gray-200">{c.party_b}</p></div>}
                      </div>
                    )}

                    {/* 付款节点 */}
                    {c.payment_schedule && (() => {
                      const nodes = safeJsonParse<PaymentNode[]>(c.payment_schedule, [])
                      if (!Array.isArray(nodes) || nodes.length === 0) return null
                      return (
                        <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1 mb-1.5"><CreditCard size={10} />付款节点</span>
                          <div className="space-y-1">
                            {nodes.map((n, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
                                <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">{idx + 1}.</span>
                                <span className="font-medium">{n.phase || '-'}</span>
                                {n.percent != null && <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">· {n.percent}%</span>}
                                {n.condition && <span className="text-gray-400 text-[11px] truncate">· {n.condition}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* 关键条款折叠 */}
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
                        <span className="text-[11px] text-[#3B82F6] flex items-center gap-1 mb-1"><Sparkles size={10} />AI 摘要</span>
                        <p className="text-xs text-gray-200 leading-relaxed">{c.summary}</p>
                      </div>
                    )}

                    {/* 签章归档状态 */}
                    {hasSignedCopy ? (
                      <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-3">
                        <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">签章版已归档</p>
                          <p className="text-[11px] text-gray-500 truncate">{c.signed_file_name}</p>
                        </div>
                        <button onClick={() => handleDownloadSigned(c.id, c.signed_file_name)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 shrink-0">
                          <Download size={10} />下载归档
                        </button>
                        {hasPermission('contract:edit') && (
                          <button onClick={() => setSignedUploadId(c.id)}
                            className="text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 shrink-0">重新上传</button>
                        )}
                      </div>
                    ) : canPrintOrSign && (
                      <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium mb-1.5 flex items-center gap-1.5">
                          <Stamp size={11} />待签章归档
                        </p>
                        <p className="text-[11px] text-gray-500 mb-2">合同已通过审批，请打印盖章后上传签章版留底。</p>
                        {hasPermission('contract:edit') && (
                          <button onClick={() => setSignedUploadId(c.id)}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 border border-amber-500/30">
                            <Upload size={10} />上传签章版
                          </button>
                        )}
                      </div>
                    )}

                    {/* 操作按钮区 */}
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {/* 原始文件（外部合同） */}
                      {c.file_path && !isSelfMade && (
                        <>
                          <button onClick={() => handlePreview(c.id, c.file_name, c.file_type)}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 border border-[#3B82F6]/20">
                            <Eye size={10} />预览原件
                          </button>
                          <button onClick={() => handleDownload(c.id, c.file_name)}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-bg-input text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-border">
                            <Download size={10} />下载原件
                          </button>
                        </>
                      )}
                      {/* 打印合同（仅自建合同有 HTML 内容时显示） */}
                      {canPrintOrSign && isSelfMade && c.content_html && (
                        <button onClick={() => printContractHtml(c.content_html!, c.title)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20">
                          <Printer size={10} />打印合同
                        </button>
                      )}
                      {/* 编辑（自建合同且未审批中） */}
                      {hasPermission('contract:edit') && c.status !== '审批中' && (
                        <button onClick={() => { setEditingContract(c); setShowForm(true) }}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-bg-hover border border-border">
                          <Pencil size={10} />编辑
                        </button>
                      )}
                      {/* 提交审批 */}
                      {hasPermission('contract:edit') && c.status !== '审批中' && c.status !== '生效中' && (
                        <button onClick={() => handleSubmitApproval(c.id)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/20">
                          <FileSignature size={10} />提交审批
                        </button>
                      )}
                      {c.status === '审批中' && (
                        <>
                          <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-semibold">
                            <GitBranch size={10} />审批中
                          </span>
                          {hasPermission('contract:edit') && (
                            <button onClick={() => handleRevokeApproval(c.id)}
                              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-gray-500/10 text-gray-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/10 border border-border hover:border-red-500/20 transition-colors">
                              <RotateCcw size={10} />撤回申请
                            </button>
                          )}
                        </>
                      )}
                      {/* 外部合同重解析 */}
                      {!isSelfMade && c.file_path && ps === 'failed' && (
                        <button onClick={() => handleReparse(c.id)}
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border border-red-500/30">
                          <RefreshCw size={9} />重解析
                        </button>
                      )}
                      {hasPermission('contract:delete') && (
                        <button onClick={() => handleDelete(c.id)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-border ml-auto">
                          <Trash2 size={10} />删除
                        </button>
                      )}
                    </div>

                    {/* 审批时间线 */}
                    <ApprovalTimeline targetType="contract" targetId={c.id} onChanged={loadContracts} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 历史归档弹窗 */}
      {showArchiveForm && createPortal(
        <ArchiveFormModal
          customers={customers}
          onClose={() => setShowArchiveForm(false)}
          onSaved={() => { setShowArchiveForm(false); loadContracts() }}
        />,
        document.body
      )}

      {/* 新建/编辑合同弹窗 */}
      {showForm && createPortal(
        <ContractFormModal
          editing={editingContract}
          customers={customers}
          projects={projects}
          templates={templates}
          onClose={() => { setShowForm(false); setEditingContract(null) }}
          onSaved={() => { setShowForm(false); setEditingContract(null); loadContracts() }}
        />,
        document.body
      )}

      {/* 提交审批预览弹窗 */}
      {submitPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSubmitPreview(null)}>
          <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                <GitBranch size={15} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>确认提交审批</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">提交后审批完成前不可编辑</p>
              </div>
            </div>
            <div className="px-5 py-4">
              {submitPreview.noFlow ? (
                <p className="text-[11px] text-gray-600">该合同类型无需审批，提交后将直接生效。</p>
              ) : submitPreview.nodes.length > 0 ? (
                <>
                  <p className="text-[11px] text-gray-600 mb-3">该合同将经过以下审批节点：</p>
                  <div className="space-y-2">
                    {submitPreview.nodes.map((node: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-2.5">
                        <div className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">{idx + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{node.name}</span>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {node.approver_names?.length
                              ? node.approver_names.join('、')
                              : node.approver_type === 'leader' ? '直属上级（待提交时解析）'
                              : node.approver_type === 'dept_manager' ? '部门主管（待提交时解析）'
                              : '（无可用审批人，将自动通过）'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-gray-600">未配置审批节点，提交后将直接生效。</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              <button onClick={() => setSubmitPreview(null)} className="px-4 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 border border-border rounded-lg transition-colors">取消</button>
              <button onClick={confirmSubmitApproval} disabled={submittingId === submitPreview.contractId}
                className="px-4 py-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-400 disabled:opacity-50 rounded-lg flex items-center gap-1.5 transition-colors">
                {submittingId === submitPreview.contractId && <Loader2 size={11} className="animate-spin" />}
                确认提交
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 签章版上传弹窗 */}
      {signedUploadId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => { setSignedUploadId(null); setSignedFile(null) }}>
          <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                <Stamp size={15} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>上传签章版留底</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">上传盖章后的扫描版合同（PDF/JPG/PNG）</p>
              </div>
              <button onClick={() => { setSignedUploadId(null); setSignedFile(null) }} className="ml-auto p-1.5 rounded-lg hover:bg-bg-hover text-gray-400"><X size={16} /></button>
            </div>
            <div className="px-5 py-5">
              <label className={`flex flex-col items-center gap-3 px-4 py-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${signedFile ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border hover:border-emerald-500/40 hover:bg-emerald-500/5'}`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${signedFile ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-bg-hover text-gray-500'}`}>
                  <Upload size={20} />
                </div>
                {signedFile ? (
                  <div className="text-center">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{signedFile.name}</p>
                    <p className="text-xs text-gray-500 mt-1">{(signedFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm text-gray-700 dark:text-gray-300">拖拽或点击选择文件</p>
                    <p className="text-xs text-gray-500 mt-1">支持 PDF、JPG、PNG</p>
                  </div>
                )}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setSignedFile(f) }} />
              </label>
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              <button onClick={() => { setSignedUploadId(null); setSignedFile(null) }} className="px-4 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 border border-border rounded-lg">取消</button>
              <button onClick={handleUploadSigned} disabled={!signedFile || uploadingSign}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg flex items-center gap-1.5">
                {uploadingSign ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                {uploadingSign ? '上传中...' : '确认上传'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 文件预览弹窗 */}
      {previewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={closePreview}>
          <div className="w-full max-w-6xl mx-0 md:mx-4 h-[90vh] rounded-none md:rounded-2xl bg-bg-card border border-border shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="text-[#3B82F6] shrink-0" />
                <span className="text-sm font-medium text-white truncate">{previewName}</span>
              </div>
              <button onClick={closePreview} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900">
              {previewLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={28} className="animate-spin text-gray-400" />
                </div>
              ) : previewUrl ? (
                <iframe src={previewUrl} className="w-full h-full border-0" title={previewName} />
              ) : previewText ? (
                <div className="h-full overflow-y-auto p-4 md:p-6">
                  <div className="max-w-4xl mx-auto">
                    <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center gap-2">
                      <AlertTriangle size={14} />
                      <span>以下为 AI 提取的文字内容，仅供参考。重要信息请以原件为准。</span>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-border p-4 md:p-8">
                      <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
                        {previewText}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
                  <FileText size={48} className="opacity-30" />
                  <p className="text-sm">无法加载文件内容</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// 历史合同归档弹窗
// ============================================================
interface ArchiveFormModalProps {
  customers: CustomerSimple[]
  onClose: () => void
  onSaved: () => void
}

function ArchiveFormModal({ customers, onClose, onSaved }: ArchiveFormModalProps) {
  const { toast: showToast } = useToast()
  const [form, setForm] = useState({
    title: '',
    customer_id: 0,
    contract_no: '',
    contract_type: '',
    sign_date: '',
    start_date: '',
    end_date: '',
    party_a: '',
    party_b: '',
    contract_amount: '',
    amount_unit: '万元',
    currency: 'CNY',
    remarks: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const valid = !!form.title.trim() && !!file
  const archiveTypeConfig = CONTRACT_TYPE_CONFIG[form.contract_type] ?? DEFAULT_TYPE_CONFIG

  const handleSubmit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('title', form.title.trim())
      if (form.customer_id) fd.append('customer_id', String(form.customer_id))
      fd.append('contract_no', form.contract_no)
      fd.append('contract_type', form.contract_type)
      if (form.sign_date) fd.append('sign_date', form.sign_date)
      if (form.start_date) fd.append('start_date', form.start_date)
      if (form.end_date) fd.append('end_date', form.end_date)
      fd.append('party_a', form.party_a)
      fd.append('party_b', form.party_b)
      if (form.contract_amount) fd.append('contract_amount', form.contract_amount)
      fd.append('amount_unit', form.amount_unit)
      fd.append('currency', form.currency)
      if (form.remarks) fd.append('remarks', form.remarks)
      fd.append('file', file!)
      const res = await fetch('/api/v1/contracts/archive', { method: 'POST', body: fd })
      if (res.ok) {
        showToast('历史合同归档成功，AI 解析已在后台启动', 'success')
        onSaved()
      } else {
        let detail = '归档失败'
        try { const err = await res.json(); detail = err.detail || detail } catch { /* noop */ }
        showToast(`归档失败（${res.status}）：${detail}`, 'error')
      }
    } catch (e) {
      showToast('网络错误，请检查连接后重试', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
            <Upload size={15} className="text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-white">历史合同归档</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">上传平台上线前已签署的有效合同，归档后直接进入生效状态，无需审批</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-400 hover:text-white transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* 文件上传区 */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">合同文件 <span className="text-red-400">*</span></label>
            <label
              className={`flex flex-col items-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${file ? 'border-purple-500/50 bg-purple-500/5' : 'border-border hover:border-purple-500/40 hover:bg-purple-500/5'}`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${file ? 'bg-purple-500/20 text-purple-400' : 'bg-bg-hover text-gray-400'}`}>
                <FileText size={18} />
              </div>
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-purple-300">{file.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-xs text-gray-300">点击选择已签署的合同文件</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">支持 PDF、Word、JPG、PNG</p>
                </div>
              )}
              <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f) }} />
            </label>
          </div>

          {/* 合同类型 */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">合同类型</label>
            <SearchableSelect
              options={[{ id: '', label: '不指定类型' }, ...CONTRACT_TYPE_OPTIONS.map(t => ({ id: t, label: t }))]}
              value={form.contract_type}
              onChange={v => setForm(p => ({ ...p, contract_type: v === 0 ? '' : String(v) }))}
              clearValue=""
              placeholder="请选择类型"
            />
          </div>

          {/* 合同名称 + 编号 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">合同名称 <span className="text-red-400">*</span></label>
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="例如：XXX 公司 MaaS 平台服务合同"
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg-input border border-border/60 text-sm text-gray-200 outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/15 transition-all placeholder-gray-600" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">合同编号</label>
              <input value={form.contract_no} onChange={e => setForm(p => ({ ...p, contract_no: e.target.value }))}
                placeholder="选填，原合同编号"
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg-input border border-border/60 text-sm text-gray-200 outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/15 transition-all placeholder-gray-600" />
            </div>
            {archiveTypeConfig.showCustomer && (
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">关联客户</label>
                <SearchableSelect
                  options={[{ id: 0, label: '不关联客户' }, ...customers.map(c => ({ id: c.id, label: c.name }))]}
                  value={form.customer_id}
                  onChange={v => setForm(p => ({ ...p, customer_id: (v as number) || 0 }))}
                  placeholder="选择客户（选填）"
                />
              </div>
            )}
          </div>

          {/* 日期 */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'sign_date', label: '签订日期' },
              { key: 'start_date', label: '生效日期' },
              { key: 'end_date', label: '到期日期' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{label}</label>
                <input type="date" value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-bg-input border border-border/60 text-sm text-gray-200 outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/15 transition-all" />
              </div>
            ))}
          </div>

          {/* 甲乙方 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{archiveTypeConfig.partyALabel || '甲方'}</label>
              <input value={form.party_a} onChange={e => setForm(p => ({ ...p, party_a: e.target.value }))}
                placeholder={`${archiveTypeConfig.partyALabel || '甲方'}名称`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg-input border border-border/60 text-sm text-gray-200 outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/15 transition-all placeholder-gray-600" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">{archiveTypeConfig.partyBLabel || '乙方'}</label>
              <input value={form.party_b} onChange={e => setForm(p => ({ ...p, party_b: e.target.value }))}
                placeholder={`${archiveTypeConfig.partyBLabel || '乙方'}名称`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-bg-input border border-border/60 text-sm text-gray-200 outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/15 transition-all placeholder-gray-600" />
            </div>
          </div>

          {/* 金额（类型不需要金额时隐藏） */}
          {archiveTypeConfig.showAmount && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">合同金额</label>
                <div className="flex gap-2">
                  <input type="number" value={form.contract_amount} onChange={e => setForm(p => ({ ...p, contract_amount: e.target.value }))}
                    placeholder="0.00"
                    className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-bg-input border border-border/60 text-sm text-gray-200 outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/15 transition-all placeholder-gray-600" />
                  <div className="flex rounded-xl overflow-hidden border border-border/60 shrink-0 text-xs">
                    {(['万元', '元'] as const).map(u => (
                      <button key={u} type="button" onClick={() => setForm(p => ({ ...p, amount_unit: u }))}
                        className={`px-2.5 py-2 transition-colors ${form.amount_unit === u ? 'bg-purple-600 text-white' : 'bg-bg-input text-gray-600 dark:text-gray-400 hover:bg-bg-hover'}`}>{u}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">货币</label>
                <SearchableSelect
                  options={[
                    { id: 'CNY', label: '人民币 CNY' },
                    { id: 'USD', label: '美元 USD' },
                    { id: 'EUR', label: '欧元 EUR' },
                    { id: 'JPY', label: '日元 JPY' },
                    { id: 'HKD', label: '港币 HKD' },
                  ]}
                  value={form.currency}
                  onChange={v => setForm(p => ({ ...p, currency: v === 0 ? 'CNY' : String(v) }))}
                  clearValue="CNY"
                />
              </div>
            </div>
          )}

          {/* 备注 */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">备注</label>
            <textarea value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))}
              placeholder="归档原因、补充说明等（选填）"
              rows={2}
              className="w-full px-3.5 py-2 rounded-xl bg-bg-input border border-border/60 text-sm text-gray-200 outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/15 transition-all placeholder-gray-600 resize-none" />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 border border-border rounded-lg transition-colors">取消</button>
          <button onClick={handleSubmit} disabled={!valid || saving}
            className="px-5 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg flex items-center gap-1.5 transition-colors">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {saving ? '归档中...' : '确认归档'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 新建/编辑合同弹窗（支持：从模板创建 | 上传外部合同）
// ============================================================
interface ContractFormModalProps {
  editing: ContractRecord | null
  customers: CustomerSimple[]
  projects: ProjectSimple[]
  templates: ContractTemplate[]
  onClose: () => void
  onSaved: () => void
}

function ContractFormModal({ editing, customers, projects, templates, onClose, onSaved }: ContractFormModalProps) {
  const { toast: showToast } = useToast()
  const [source, setSource] = useState<'self_made' | 'external'>(
    editing ? (editing.source as 'self_made' | 'external') : 'self_made'
  )
  const [step, setStep] = useState<'source' | 'template_pick' | 'edit'>(editing ? 'edit' : 'source')
  const [selectedTemplate, setSelectedTemplate] = useState<ContractTemplate | null>(null)
  const [form, setForm] = useState({
    title: editing?.title || '',
    contract_no: editing?.contract_no || '',
    contract_type: editing?.contract_type || '',
    customer_id: editing?.customer_id || 0,
    project_id: editing?.project_id || 0,
    sign_date: editing?.sign_date || '',
    start_date: editing?.start_date || '',
    end_date: editing?.end_date || '',
    party_a: editing?.party_a || '',
    party_b: editing?.party_b || '',
    contract_amount: editing?.contract_amount != null ? String(editing.contract_amount) : '',
    amount_unit: editing?.amount_unit || '万元',
    currency: editing?.currency || 'CNY',
    payment_terms: editing?.payment_terms || '',
    remarks: editing?.remarks || '',
    seal_types_requested: editing?.seal_types_requested
      ? editing.seal_types_requested.split(',').filter(Boolean)
      : [] as string[],
  })
  const [contentHtml, setContentHtml] = useState(editing?.content_html || '')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  // 自动从文档 H1 标题同步合同名称（仅新建时，手动编辑后停止）
  const titleManuallyEdited = useRef(!!editing)
  const lastAutoTitle = useRef('')
  useEffect(() => {
    if (titleManuallyEdited.current || source !== 'self_made') return
    const match = contentHtml.match(/<h1[^>]*>(.*?)<\/h1>/i)
    if (match) {
      const h1 = match[1].replace(/<[^>]+>/g, '').trim()
      if (h1 && h1 !== lastAutoTitle.current) {
        lastAutoTitle.current = h1
        setForm(prev => ({ ...prev, title: h1 }))
      }
    }
  }, [contentHtml, source])

  const customersProjects = projects.filter(p => p.customer_id === form.customer_id)
  const basicsValid = !!form.title?.trim()
  const typeConfig = CONTRACT_TYPE_CONFIG[form.contract_type] ?? DEFAULT_TYPE_CONFIG

  const pickTemplate = (tpl: ContractTemplate) => {
    setSelectedTemplate(tpl)
    setContentHtml(tpl.content)
    setStep('edit')
  }

  const handleSave = async () => {
    if (!basicsValid) { showToast('请填写合同名称', 'error'); return }
    setSaving(true)

    if (editing) {
      // 编辑模式：JSON PUT
      const body: Record<string, any> = {
        title: form.title, contract_no: form.contract_no,
        contract_type: form.contract_type,
        customer_id: form.customer_id || null,
        project_id: form.project_id || null,
        sign_date: form.sign_date || null, start_date: form.start_date || null, end_date: form.end_date || null,
        party_a: form.party_a, party_b: form.party_b,
        contract_amount: form.contract_amount ? parseFloat(form.contract_amount) : null,
        amount_unit: form.amount_unit,
        currency: form.currency, payment_terms: form.payment_terms || null, remarks: form.remarks || null,
        content_html: contentHtml || null,
        seal_types_requested: form.seal_types_requested.join(','),
      }
      const res = await fetch(`/api/v1/contracts/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (res.ok) { showToast('合同已更新', 'success'); onSaved() }
      else { const err = await res.json(); showToast(err.detail || '保存失败', 'error') }
    } else {
      // 新建模式：FormData POST
      const fd = new FormData()
      fd.append('title', form.title)
      fd.append('contract_no', form.contract_no)
      fd.append('contract_type', form.contract_type)
      if (form.customer_id) fd.append('customer_id', String(form.customer_id))
      if (form.project_id) fd.append('project_id', String(form.project_id))
      if (form.sign_date) fd.append('sign_date', form.sign_date)
      if (form.start_date) fd.append('start_date', form.start_date)
      if (form.end_date) fd.append('end_date', form.end_date)
      fd.append('party_a', form.party_a)
      fd.append('party_b', form.party_b)
      if (form.contract_amount) fd.append('contract_amount', form.contract_amount)
      fd.append('amount_unit', form.amount_unit)
      fd.append('currency', form.currency)
      if (form.payment_terms) fd.append('payment_terms', form.payment_terms)
      if (form.remarks) fd.append('remarks', form.remarks)
      fd.append('seal_types_requested', form.seal_types_requested.join(','))
      fd.append('source', source)
      if (selectedTemplate) fd.append('template_id', String(selectedTemplate.id))
      if (source === 'self_made' && contentHtml) fd.append('content_html', contentHtml)
      if (source === 'external' && file) fd.append('file', file)

      const res = await fetch('/api/v1/contracts', { method: 'POST', body: fd })
      if (res.ok) {
        showToast(source === 'self_made' ? '合同已创建' : '合同上传成功，AI 解析中…', 'success')
        onSaved()
      } else {
        const err = await res.json()
        showToast(err.detail || '创建失败', 'error')
      }
    }
    setSaving(false)
  }

  const isDocMode = step === 'edit' && source === 'self_made'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div
        className={`w-full ${isDocMode ? 'max-w-[1200px] max-h-[97vh]' : 'max-w-3xl max-h-[92vh]'} rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden animate-scaleIn`}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-6 pt-4 pb-3 border-b border-border/15 shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#3B82F6] flex items-center justify-center text-white shadow-sm shrink-0">
              <FileSignature size={17} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                {editing ? '编辑合同' : step === 'source' ? '新建合同' : step === 'template_pick' ? '选择合同模板' : source === 'self_made' ? '编辑合同内容' : '上传外部合同'}
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {editing ? '修改合同信息' : step === 'source' ? '选择合同来源方式' : step === 'template_pick' ? '选择一个模板开始编写' : source === 'self_made' ? '编辑合同正文和基本信息' : '上传对方发来的合同文件'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors cursor-pointer shrink-0"><X size={16} /></button>
        </div>

        {/* 正文区 */}
        <div className={`flex-1 min-h-0 ${isDocMode ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
          {/* 步骤 1：选来源（仅新建时显示） */}
          {step === 'source' && !editing && (
            <div className="p-8 space-y-6">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">合同类型 <span className="text-[11px] font-normal text-gray-500">（可选，后续可修改）</span></label>
                <div className="flex flex-wrap gap-2">
                  {CONTRACT_TYPE_OPTIONS.map(t => (
                    <button key={t} type="button"
                      onClick={() => setForm(prev => {
                        const cfg = CONTRACT_TYPE_CONFIG[t] ?? DEFAULT_TYPE_CONFIG
                        return { ...prev, contract_type: t, seal_types_requested: cfg.defaultSeals }
                      })}
                      style={form.contract_type === t ? { background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' } : {}}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${form.contract_type === t ? '' : 'border-gray-300 dark:border-border text-gray-700 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-700 dark:hover:border-indigo-500/50 dark:hover:text-gray-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => { setSource('self_made'); setStep('template_pick') }}
                className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-border hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-indigo-500/15 flex items-center justify-center group-hover:bg-indigo-500/25 transition-colors">
                  <LayoutTemplate size={22} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>从模板创建</h4>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">我方制作合同：选择模板 → 编辑内容 → 提交审批 → 打印盖章</p>
                </div>
              </button>
              <button
                onClick={() => { setSource('external'); setStep('edit') }}
                className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-border hover:border-[#3B82F6]/50 hover:bg-[#3B82F6]/5 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-[#3B82F6]/15 flex items-center justify-center group-hover:bg-[#3B82F6]/25 transition-colors">
                  <FileUp size={22} className="text-blue-600 dark:text-[#3B82F6]" />
                </div>
                <div>
                  <h4 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>上传外部合同</h4>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">对方发来的合同：上传文件 → AI 解析 → 审批 → 打印盖章归档</p>
                </div>
              </button>
              </div>
            </div>
          )}

          {/* 步骤 2：选模板 */}
          {step === 'template_pick' && (
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                选择一个合同模板，选择后可自由编辑内容。
                {form.contract_type && <span className="ml-1 text-indigo-600 dark:text-indigo-400">已筛选：{form.contract_type}</span>}
              </p>
              {templates.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <LayoutTemplate size={36} className="mx-auto mb-3 opacity-30" />
                  <p>暂无可用模板</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(form.contract_type
                    ? templates.filter(t => !t.category || t.name.includes(form.contract_type) || t.category.includes(form.contract_type))
                    : templates
                  ).map(t => (
                    <button key={t.id} onClick={() => pickTemplate(t)}
                      className="flex items-start gap-3 p-4 rounded-xl border border-border hover:border-indigo-500/40 hover:bg-indigo-500/5 text-left transition-all group">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0 group-hover:bg-indigo-500/20">
                        <FileText size={14} className="text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                        {t.category && <p className="text-[11px] text-gray-500 mt-0.5">{t.category}</p>}
                        {t.description && <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{t.description}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="pt-2">
                <button onClick={() => setStep('source')} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-300">← 返回</button>
              </div>
            </div>
          )}

          {/* 步骤 3：填写表单 + 编辑内容 */}
          {step === 'edit' && (
            <div className={isDocMode ? 'flex flex-col flex-1 min-h-0' : 'p-6 space-y-5'}>
              {/* 自建合同：合同元数据 + A4 文档编辑器 */}
              {source === 'self_made' && (
                <>
                  {/* 合同元数据条 — 紧凑呈现，与编辑器一体感 */}
                  {/* A4 文档编辑器（主体，填满空间） */}
                  <div className="flex-1 min-h-0 flex flex-col">
                    <ContractDocEditor
                      value={contentHtml}
                      onChange={setContentHtml}
                      title={form.title || selectedTemplate?.name || '合同'}
                    />
                  </div>
                  {/* 合同系统字段（默认收起，辅助管理用，不影响正文） */}
                  <div className="shrink-0 border-t border-border/40">
                    <details className="group">
                      <summary className="flex items-center gap-2 px-5 py-2 cursor-pointer list-none hover:bg-bg-hover/30 transition-colors select-none">
                        <ChevronRight size={11} className="text-gray-500 group-open:rotate-90 transition-transform shrink-0" />
                        <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">合同系统字段</span>
                        <span className="text-[11px] text-gray-600">— 用于平台检索管理，不影响合同正文</span>
                        {form.title && (
                          <span className="text-[11px] text-indigo-600 dark:text-indigo-400 ml-2 flex items-center gap-1">
                            <FileText size={9} />
                            {form.title}{!titleManuallyEdited.current && <span className="text-gray-600">（已从文档标题同步）</span>}
                          </span>
                        )}
                        {!editing && selectedTemplate && (
                          <button onClick={(e) => { e.preventDefault(); setStep('template_pick') }}
                            className="ml-auto text-[11px] text-gray-600 hover:text-gray-800 dark:hover:text-gray-300 transition-colors">← 重选模板</button>
                        )}
                      </summary>
                      <div className="px-5 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: '360px' }}>
                        {/* 合同类型 */}
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">合同类型</label>
                          <div className="flex flex-wrap gap-1.5">
                            {CONTRACT_TYPE_OPTIONS.map(t => (
                              <button key={t} type="button"
                                onClick={() => {
                                  const cfg = CONTRACT_TYPE_CONFIG[t] ?? DEFAULT_TYPE_CONFIG
                                  setForm(prev => ({ ...prev, contract_type: t, seal_types_requested: cfg.defaultSeals }))
                                }}
                                style={form.contract_type === t ? { background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' } : {}}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${form.contract_type === t ? '' : 'border-border/60 text-gray-500 hover:border-indigo-500/50 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <FormField label="合同名称" required icon={AtSign}>
                            <input value={form.title}
                              onChange={e => { titleManuallyEdited.current = true; setForm({ ...form, title: e.target.value }) }}
                              className="form-input" placeholder="如：2025 年度商务服务合同"
                              title="新建时自动从文档 H1 标题提取，也可手动填写" />
                          </FormField>
                          {typeConfig.showCustomer && (
                            <FormField label="关联客户" icon={Building2} optional>
                              <SearchableSelect
                                options={[{ id: 0, label: '不关联客户' }, ...customers.map(c => ({ id: c.id, label: c.name }))]}
                                value={form.customer_id || 0}
                                onChange={(v) => setForm({ ...form, customer_id: (v as number) || 0, project_id: 0 })}
                                placeholder="选择关联客户" searchPlaceholder="搜索客户..." emptyText="没有匹配客户"
                              />
                            </FormField>
                          )}
                          <FormField label="合同编号" icon={AtSign} optional>
                            <input value={form.contract_no} onChange={e => setForm({ ...form, contract_no: e.target.value })}
                              className="form-input font-mono" placeholder="CON-2025-001" />
                          </FormField>
                          <FormField label={typeConfig.partyALabel || '甲方'} icon={Building2} optional>
                            <input value={form.party_a} onChange={e => setForm({ ...form, party_a: e.target.value })}
                              className="form-input" placeholder="我方公司" />
                          </FormField>
                          <FormField label={typeConfig.partyBLabel || '乙方'} icon={Building2} optional>
                            <input value={form.party_b} onChange={e => setForm({ ...form, party_b: e.target.value })}
                              className="form-input" placeholder="对方公司" />
                          </FormField>
                          {typeConfig.showAmount && (
                            <FormField label="合同金额" icon={Banknote} optional>
                              <div className="flex gap-2">
                                <input type="number" step="0.01" value={form.contract_amount}
                                  onChange={e => setForm({ ...form, contract_amount: e.target.value })}
                                  className="form-input font-mono flex-1 min-w-0" placeholder="0.00" />
                                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-border/60 shrink-0 text-xs">
                                  {(['万元', '元'] as const).map(u => (
                                    <button key={u} type="button" onClick={() => setForm({ ...form, amount_unit: u })}
                                      className={`px-2.5 py-2 transition-colors ${form.amount_unit === u ? 'bg-accent-blue text-white' : 'bg-white dark:bg-bg-input text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-bg-hover'}`}>{u}</button>
                                  ))}
                                </div>
                              </div>
                            </FormField>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <DateField label="签订日期" value={form.sign_date} onChange={v => setForm({ ...form, sign_date: v })} />
                          <DateField label="开始日期" value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} />
                          <DateField label="截止日期" value={form.end_date} onChange={v => setForm({ ...form, end_date: v })} />
                        </div>
                        {/* 用章申请 */}
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-400 mb-1.5">申请用章 <span className="text-gray-600 font-normal">（可多选）</span></label>
                          <div className="flex flex-wrap gap-2">
                            {ALL_SEAL_TYPES.map(s => {
                              const checked = form.seal_types_requested.includes(s)
                              return (
                                <button key={s} type="button"
                                  onClick={() => setForm(prev => ({
                                    ...prev,
                                    seal_types_requested: checked
                                      ? prev.seal_types_requested.filter(x => x !== s)
                                      : [...prev.seal_types_requested, s]
                                  }))}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${checked ? 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300' : 'border-border/60 text-gray-500 hover:border-amber-500/40 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                                  {checked && <span className="text-amber-700 dark:text-amber-400">✓</span>}
                                  {s}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="付款方式" icon={Banknote} optional>
                            <input value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })}
                              className="form-input" placeholder="分期付款、一次性付清…" />
                          </FormField>
                          <FormField label="备注" icon={ScrollText} optional>
                            <input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}
                              className="form-input" placeholder="可填写备注" />
                          </FormField>
                        </div>
                      </div>
                    </details>
                  </div>
                </>
              )}

              {/* 外部合同：文件上传 + 基础信息 */}
              {source === 'external' && (
                <>
                  {!editing && (
                    <div>
                      <label className={`flex items-center gap-4 px-4 py-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${file ? 'border-[#3B82F6] bg-[#3B82F6]/5' : 'border-border/30 hover:border-[#3B82F6] hover:bg-[#3B82F6]/5'}`}>
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${file ? 'bg-[#3B82F6] text-white' : 'bg-[#3B82F6]/10 text-[#3B82F6]'}`}>
                          <Upload size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-200 truncate">{file ? file.name : '拖拽或点击上传合同文件'}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                            <Sparkles size={10} className="text-[#3B82F6]" />
                            支持 PDF / DOC / DOCX · 上传后 AI 自动解析关键信息
                          </p>
                        </div>
                        {file && (
                          <button type="button" onClick={(e) => { e.preventDefault(); setFile(null) }}
                            className="text-[11px] text-gray-500 hover:text-red-400 shrink-0">移除</button>
                        )}
                        <input type="file" accept=".pdf,.doc,.docx" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f) }} />
                      </label>
                    </div>
                  )}

                  <hr className="border-border/30" />

                  {/* 合同类型选择器 */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">合同类型</label>
                    <div className="flex flex-wrap gap-1.5">
                      {CONTRACT_TYPE_OPTIONS.map(t => (
                        <button key={t} type="button"
                          onClick={() => {
                            const cfg = CONTRACT_TYPE_CONFIG[t] ?? DEFAULT_TYPE_CONFIG
                            setForm(prev => ({ ...prev, contract_type: t, seal_types_requested: cfg.defaultSeals }))
                          }}
                          style={form.contract_type === t ? { background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' } : {}}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${form.contract_type === t ? '' : 'border-border/60 text-gray-500 hover:border-indigo-500/50 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="合同名称" required icon={AtSign}>
                      <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                        className="form-input" placeholder="如：2025 年度云服务合同" autoFocus />
                    </FormField>
                    <FormField label="合同编号" icon={AtSign} optional>
                      <input value={form.contract_no} onChange={e => setForm({ ...form, contract_no: e.target.value })}
                        className="form-input font-mono" placeholder="CON-2025-001" />
                    </FormField>
                    {typeConfig.showCustomer && (
                      <FormField label="关联客户" icon={Building2} optional>
                        <SearchableSelect
                          options={[{ id: 0, label: '不关联客户' }, ...customers.map(c => ({ id: c.id, label: c.name }))]}
                          value={form.customer_id || 0}
                          onChange={(v) => setForm({ ...form, customer_id: (v as number) || 0, project_id: 0 })}
                          placeholder="选择关联客户" searchPlaceholder="按客户名称搜索..." emptyText="没有匹配客户"
                        />
                      </FormField>
                    )}
                    {typeConfig.showProject && customersProjects.length > 0 && (
                      <FormField label="关联项目" icon={Briefcase} optional>
                        <SearchableSelect
                          options={[{ id: 0, label: '不关联项目' }, ...customersProjects.map(p => ({ id: p.id, label: p.name }))]}
                          value={form.project_id || 0}
                          onChange={(v) => setForm({ ...form, project_id: (v as number) || 0 })}
                          placeholder="选择关联项目" searchPlaceholder="按项目名称搜索..." emptyText="该客户下暂无项目"
                        />
                      </FormField>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <DateField label="签订日期" value={form.sign_date} onChange={v => setForm({ ...form, sign_date: v })} />
                    <DateField label="开始日期" value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} />
                    <DateField label="截止日期" value={form.end_date} onChange={v => setForm({ ...form, end_date: v })} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label={typeConfig.partyALabel || '甲方'} icon={Building2} optional>
                      <input value={form.party_a} onChange={e => setForm({ ...form, party_a: e.target.value })}
                        className="form-input" placeholder="我方公司" />
                    </FormField>
                    <FormField label={typeConfig.partyBLabel || '乙方'} icon={Building2} optional>
                      <input value={form.party_b} onChange={e => setForm({ ...form, party_b: e.target.value })}
                        className="form-input" placeholder="对方公司" />
                    </FormField>
                    {typeConfig.showAmount && (
                      <FormField label="合同金额" icon={Banknote} optional>
                        <div className="flex gap-2">
                          <input type="number" step="0.01" value={form.contract_amount}
                            onChange={e => setForm({ ...form, contract_amount: e.target.value })}
                            className="form-input font-mono flex-1 min-w-0" placeholder="0.00" />
                          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-border/60 shrink-0 text-xs">
                            {(['万元', '元'] as const).map(u => (
                              <button key={u} type="button" onClick={() => setForm({ ...form, amount_unit: u })}
                                className={`px-2.5 py-2 transition-colors ${form.amount_unit === u ? 'bg-accent-blue text-white' : 'bg-white dark:bg-bg-input text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-bg-hover'}`}>{u}</button>
                            ))}
                          </div>
                        </div>
                      </FormField>
                    )}
                    <FormField label="币种" icon={Coins}>
                      <SearchableSelect
                        options={[{ id: 'CNY', label: 'CNY 人民币' }, { id: 'USD', label: 'USD 美元' }, { id: 'EUR', label: 'EUR 欧元' }, { id: 'JPY', label: 'JPY 日元' }, { id: 'HKD', label: 'HKD 港币' }]}
                        value={form.currency}
                        onChange={(v) => setForm({ ...form, currency: v as string })}
                        placeholder="选择币种" searchable={false}
                      />
                    </FormField>
                    <FormField label="付款方式" icon={Banknote} optional>
                      <input value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })}
                        className="form-input" placeholder="如：分期付款、一次性付清" />
                    </FormField>
                    <FormField label="备注" icon={ScrollText} optional>
                      <input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}
                        className="form-input" placeholder="可填写备注" />
                    </FormField>
                  </div>

                  {/* 用章申请 */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">申请用章 <span className="text-[11px] font-normal text-gray-600">（可多选）</span></label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_SEAL_TYPES.map(s => {
                        const checked = form.seal_types_requested.includes(s)
                        return (
                          <button key={s} type="button"
                            onClick={() => setForm(prev => ({
                              ...prev,
                              seal_types_requested: checked
                                ? prev.seal_types_requested.filter(x => x !== s)
                                : [...prev.seal_types_requested, s]
                            }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${checked ? 'bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-300' : 'border-border/60 text-gray-500 hover:border-amber-500/40 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                            {checked && <span className="text-amber-700 dark:text-amber-400">✓</span>}
                            {s}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {!editing && (
                    <button onClick={() => setStep('source')} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-300">← 返回</button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 页脚 */}
        {(step === 'edit' || editing) && (
          <div className="px-6 py-3.5 border-t border-border/15 shrink-0 bg-bg-hover/10 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-card hover:bg-bg-hover text-xs text-gray-400 border border-border/30 transition-colors cursor-pointer font-semibold">取消</button>
            <button onClick={handleSave} disabled={saving || !basicsValid}
              className="px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-xs font-bold hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all cursor-pointer">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <FileSignature size={13} />}
              {saving ? '保存中...' : (editing ? '更新合同' : source === 'self_made' ? '保存合同' : '保存并 AI 解析')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// 内部小组件
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
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}{optional && <span className="text-gray-400 ml-1 font-normal">(可选)</span>}
        </span>
      </label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <input type="date" value={value} onChange={e => onChange(e.target.value)} className="form-input text-xs" />
    </div>
  )
}
