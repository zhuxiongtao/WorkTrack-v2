import { useState, useEffect } from 'react'
import { Search, Plus, X, Loader2, Trash2, FileText, Download, Sparkles, DollarSign, ChevronDown, ChevronRight } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'

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
  created_at: string
  updated_at: string
}

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

export default function ContractsPage() {
  const { confirm: showConfirm, toast: showToast } = useToast()
  const [contracts, setContracts] = useState<ContractRecord[]>([])
  const [customers, setCustomers] = useState<CustomerSimple[]>([])
  const [projects, setProjects] = useState<ProjectSimple[]>([])
  const [loading, setLoading] = useState(true)
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

  const loadContracts = () => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (keyword) params.set('keyword', keyword)
    fetch(`/api/v1/contracts?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    }).then(r => r.json()).then(data => { setContracts(data || []); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => { loadContracts() }, [statusFilter, keyword])
  useEffect(() => {
    fetch('/api/v1/customers', { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } })
      .then(r => r.json()).then(data => setCustomers(data || [])).catch(() => {})
    fetch('/api/v1/projects', { headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } })
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

    const res = await fetch('/api/v1/contracts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
      body: fd,
    })
    if (res.ok) {
      showToast('合同添加成功', 'success')
      setShowForm(false); resetForm(); loadContracts()
    } else {
      const err = await res.json()
      showToast(err.detail || '添加失败', 'error')
    }
    setSaving(false)
  }

  const handleDelete = async (id: number) => {
    const ok = await showConfirm('确定删除此合同？相关文件也会被删除。')
    if (!ok) return
    const res = await fetch(`/api/v1/contracts/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    })
    if (res.ok) { showToast('已删除', 'success'); loadContracts() }
  }

  const handleDownload = async (id: number, fileName: string) => {
    const res = await fetch(`/api/v1/contracts/${id}/file`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    })
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
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
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

  const getCustomerName = (id: number) => customers.find(c => c.id === id)?.name || ''
  const getProjectName = (id: number | null) => id ? projects.find(p => p.id === id)?.name || '' : ''
  const customersProjects = projects.filter(p => p.customer_id === form.customer_id)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white">合同管理</h2>
          <span className="text-xs text-gray-500 bg-bg-hover px-2 py-0.5 rounded-full">{contracts.length}</span>
        </div>
        <button onClick={() => { setShowForm(true); resetForm() }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20">
          <Plus size={16} /><span>新建合同</span>
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
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
        <div className="text-center py-16 text-gray-500">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">暂无合同，点击「新建合同」开始</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map(c => (
            <div key={c.id} className="rounded-xl bg-bg-card border border-border overflow-hidden">
              <button className="w-full text-left px-5 py-3.5 flex items-center gap-4 hover:bg-bg-hover/50 transition-colors"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                <FileText size={18} className="text-[#3B82F6] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">{c.title}</span>
                    {c.contract_no && <span className="text-[10px] text-gray-500">#{c.contract_no}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-gray-500">{getCustomerName(c.customer_id)}</span>
                    {c.contract_amount && <span className="text-[10px] text-gray-500">{formatAmount(c.contract_amount, c.currency)}</span>}
                    {c.sign_date && <span className="text-[10px] text-gray-500">{c.sign_date}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_COLORS[c.status] || STATUS_COLORS['生效中']}`}>{c.status}</span>
                  {c.file_path ? (
                    <button onClick={(e) => { e.stopPropagation(); handleParse(c.id) }} disabled={parsingId === c.id}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6] hover:bg-[#8B5CF6]/20 border border-[#8B5CF6]/20 disabled:opacity-50">
                      {parsingId === c.id ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
                      {parsingId === c.id ? '解析中' : 'AI解析'}
                    </button>
                  ) : (
                    <span className="text-[9px] text-gray-600" title="需要先上传合同文件">未上传文件</span>
                  )}
                  {expandedId === c.id ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                </div>
              </button>
              {expandedId === c.id && (
                <div className="px-5 pb-4 border-t border-border/50 pt-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {c.sign_date && <div><span className="text-[10px] text-gray-500">签订日期</span><p className="text-xs text-gray-200">{c.sign_date}</p></div>}
                    {c.start_date && <div><span className="text-[10px] text-gray-500">开始日期</span><p className="text-xs text-gray-200">{c.start_date}</p></div>}
                    {c.end_date && <div><span className="text-[10px] text-gray-500">截止日期</span><p className="text-xs text-gray-200">{c.end_date}</p></div>}
                    {c.contract_amount && <div><span className="text-[10px] text-gray-500">合同金额</span><p className="text-xs text-gray-200">{formatAmount(c.contract_amount, c.currency)}</p></div>}
                  </div>
                  {c.party_a && <div><span className="text-[10px] text-gray-500">甲方</span><p className="text-xs text-gray-200">{c.party_a}</p></div>}
                  {c.party_b && <div><span className="text-[10px] text-gray-500">乙方</span><p className="text-xs text-gray-200">{c.party_b}</p></div>}
                  {c.payment_terms && <div><span className="text-[10px] text-gray-500">付款方式</span><p className="text-xs text-gray-200">{c.payment_terms}</p></div>}
                  {c.summary && (
                    <div className="p-3 rounded-lg bg-[#3B82F6]/5 border border-[#3B82F6]/20">
                      <span className="text-[10px] text-[#3B82F6] flex items-center gap-1 mb-1"><Sparkles size={10} />AI 摘要</span>
                      <p className="text-xs text-gray-200 leading-relaxed">{c.summary}</p>
                    </div>
                  )}
                  {c.key_clauses && (
                    <div className="p-3 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/20">
                      <span className="text-[10px] text-[#F59E0B] mb-1 block">关键条款</span>
                      <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{c.key_clauses}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {c.file_path && (
                      <button onClick={() => handleDownload(c.id, c.file_name)}
                        className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg bg-bg-input text-gray-300 hover:text-white border border-border">
                        <Download size={10} />下载文件
                      </button>
                    )}
                    <button onClick={() => handleDelete(c.id)}
                      className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-border ml-auto">
                      <Trash2 size={10} />删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowForm(false); resetForm() }}>
          <div className="w-full max-w-lg mx-4 p-6 rounded-2xl bg-bg-card border border-border shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-medium text-white">新建合同</h3>
              <button onClick={() => { setShowForm(false); resetForm() }} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">合同名称 *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]" placeholder="如：2025年度云服务合同" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">合同编号</label>
                <input value={form.contract_no} onChange={(e) => setForm({ ...form, contract_no: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]" placeholder="CON-2025-001" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">关联客户 *</label>
                <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: Number(e.target.value), project_id: 0 })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]">
                  <option value={0}>选择客户</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {customersProjects.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">关联项目</label>
                  <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]">
                    <option value={0}>不关联</option>
                    {customersProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">签订日期</label>
                  <input type="date" value={form.sign_date} onChange={(e) => setForm({ ...form, sign_date: e.target.value })}
                    className="w-full px-2 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">开始日期</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-2 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">截止日期</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className="w-full px-2 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-200 outline-none focus:border-[#3B82F6]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">甲方</label>
                  <input value={form.party_a} onChange={(e) => setForm({ ...form, party_a: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]" placeholder="我方公司" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">乙方</label>
                  <input value={form.party_b} onChange={(e) => setForm({ ...form, party_b: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]" placeholder="对方公司" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">合同金额（万元）</label>
                  <input type="number" step="0.01" value={form.contract_amount} onChange={(e) => setForm({ ...form, contract_amount: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">币种</label>
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]">
                    <option value="CNY">CNY 人民币</option>
                    <option value="USD">USD 美元</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">付款方式</label>
                <input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6]" placeholder="如：分期付款、一次性付清" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">备注</label>
                <textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-200 outline-none focus:border-[#3B82F6] resize-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-2">上传合同文件</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="cursor-pointer px-4 py-2.5 rounded-lg bg-bg-input border border-dashed border-border hover:border-[#3B82F6] text-xs text-gray-400 hover:text-gray-200 transition-colors">
                    <FileText size={14} className="inline mr-1" />{file ? file.name : '选择文件 (PDF/DOCX)'}
                    <input type="file" accept=".pdf,.doc,.docx" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f) }} />
                  </label>
                  {file && <span className="text-[10px] text-gray-500">{(file.size / 1024).toFixed(1)} KB</span>}
                </div>
                <p className="text-[10px] text-gray-600 mt-1">上传后保存合同，系统将在后台自动进行AI解析</p>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleSubmit} disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50">
                  {saving ? '保存中...' : '保存合同'}
                </button>
                <button onClick={() => { setShowForm(false); resetForm() }}
                  className="px-5 py-2.5 rounded-lg bg-bg-hover text-gray-400 text-sm hover:text-white">取消</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
