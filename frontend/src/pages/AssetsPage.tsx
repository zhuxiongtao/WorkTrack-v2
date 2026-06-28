import { useState, useEffect, useCallback } from 'react'
import {
  Package, Loader2, Plus, X, Pencil, Trash2, Search,
  History, ArrowLeftRight, Wrench, Ban, Undo2, UserCheck, ArrowRight,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import SearchableSelect from '../components/SearchableSelect'

interface AssetItem {
  id: number
  name: string
  asset_no: string | null
  category: string
  spec: string | null
  purchase_date: string | null
  purchase_price: number
  amount_unit: string
  currency: string
  status: string  // 在用 | 闲置 | 维修中 | 已报废
  location: string | null
  user_id: number | null
  user_name: string | null
  supplier_id: number | null
  supplier_name: string | null
  remarks: string | null
  created_at: string
  updated_at: string
}

interface SimpleUser {
  id: number
  name: string
  username: string
  department_id?: number
}

interface SimpleSupplier {
  id: number
  name: string
  short_name: string | null
  category: string | null
}

interface AssetRecordItem {
  id: number
  asset_id: number
  action: string
  from_user_id: number | null
  from_user_name: string | null
  to_user_id: number | null
  to_user_name: string | null
  operator_id: number | null
  operator_name: string | null
  from_status: string | null
  to_status: string | null
  note: string | null
  created_at: string
}

// 流转操作元数据
const ACTION_META: Record<string, { icon: any; cls: string; needUser: boolean; desc: string }> = {
  领用: { icon: UserCheck,       cls: 'text-green-600 dark:text-green-400 border-green-500/40 hover:bg-green-500/10', needUser: true,  desc: '配发给指定员工，状态置「在用」' },
  归还: { icon: Undo2,           cls: 'text-blue-600 dark:text-blue-400 border-blue-500/40 hover:bg-blue-500/10',    needUser: false, desc: '收回资产，状态置「闲置」' },
  调拨: { icon: ArrowLeftRight,  cls: 'text-indigo-600 dark:text-indigo-400 border-indigo-500/40 hover:bg-indigo-500/10', needUser: true, desc: '转交给其他员工' },
  维修: { icon: Wrench,          cls: 'text-orange-600 dark:text-orange-400 border-orange-500/40 hover:bg-orange-500/10', needUser: false, desc: '送修，状态置「维修中」' },
  报废: { icon: Ban,             cls: 'text-red-600 dark:text-red-400 border-red-500/40 hover:bg-red-500/10',      needUser: false, desc: '资产报废，不可再操作' },
}

const DEFAULT_CATEGORIES = ['电子设备', '办公家具', '车辆', '房屋', '软件', '其他']
const DEFAULT_STATUSES = ['在用', '闲置', '维修中', '已报废']

const STATUS_META: Record<string, { label: string; cls: string }> = {
  在用:   { label: '在用',   cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  闲置:   { label: '闲置',   cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  维修中: { label: '维修中', cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20' },
  已报废: { label: '已报废', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' },
}

function fmtAmount(n: number, unit: string): string {
  try { return `${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}` }
  catch { return `${n}${unit}` }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch { return s }
}

function fmtDateTime(s: string): string {
  try {
    const d = new Date(s)
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

const emptyForm = {
  name: '',
  asset_no: '',
  category: '电子设备',
  spec: '',
  purchase_date: '',
  purchase_price: '',
  amount_unit: '元',
  currency: 'CNY',
  status: '在用',
  location: '',
  user_id: '',
  supplier_id: '',
  remarks: '',
}

export default function AssetsPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canManage = hasPermission('asset:manage')

  const [list, setList] = useState<AssetItem[]>([])
  const [loading, setLoading] = useState(true)

  // 筛选
  const [keyword, setKeyword] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterUserId, setFilterUserId] = useState('')

  // 选项
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES)
  const [users, setUsers] = useState<SimpleUser[]>([])
  const [suppliers, setSuppliers] = useState<SimpleSupplier[]>([])

  // 弹窗
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<AssetItem | null>(null)

  // 资产履历
  const [records, setRecords] = useState<AssetRecordItem[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  // 流转操作子表单：null=未展开，否则为当前操作类型
  const [action, setAction] = useState<string | null>(null)
  const [actionUserId, setActionUserId] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [actionBusy, setActionBusy] = useState(false)

  // 加载分类/状态选项
  useEffect(() => {
    fetch('/api/v1/assets/categories')
      .then(r => r.json())
      .then(d => {
        if (d.categories && Array.isArray(d.categories) && d.categories.length > 0) setCategories(d.categories)
        if (d.statuses && Array.isArray(d.statuses) && d.statuses.length > 0) setStatuses(d.statuses)
      })
      .catch(() => {})
  }, [])

  // 加载用户列表
  useEffect(() => {
    fetch('/api/v1/users/simple?scope=all')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setUsers(d) })
      .catch(() => {})
  }, [])

  // 加载供应商列表
  useEffect(() => {
    fetch('/api/v1/purchase-suppliers')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setSuppliers(d) })
      .catch(() => {})
  }, [])

  // 加载资产列表
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (filterCategory) params.set('category', filterCategory)
      if (filterStatus) params.set('status', filterStatus)
      if (filterUserId) params.set('user_id', filterUserId)
      const res = await fetch(`/api/v1/assets?${params}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [keyword, filterCategory, filterStatus, filterUserId])

  useEffect(() => { load() }, [load])

  // 打开详情时加载履历，关闭操作子表单
  const loadRecords = useCallback(async (assetId: number) => {
    setRecordsLoading(true)
    try {
      const res = await fetch(`/api/v1/assets/${assetId}/records`)
      if (res.ok) setRecords(await res.json())
      else setRecords([])
    } catch { setRecords([]) }
    finally { setRecordsLoading(false) }
  }, [])

  useEffect(() => {
    if (detail) { loadRecords(detail.id); setAction(null); setActionUserId(''); setActionNote('') }
    else { setRecords([]) }
  }, [detail, loadRecords])

  // 执行流转操作
  const submitAction = async () => {
    if (!detail || !action) return
    const meta = ACTION_META[action]
    if (meta.needUser && !actionUserId) { showToast(`请选择${action === '领用' ? '领用' : '调拨目标'}员工`, 'warning'); return }
    setActionBusy(true)
    try {
      const res = await fetch(`/api/v1/assets/${detail.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          to_user_id: meta.needUser ? parseInt(actionUserId) : null,
          note: actionNote.trim() || null,
        }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '操作失败') }
      const updated = await res.json()
      showToast(`已${action}`, 'success')
      setDetail(updated)        // 触发 records 重新加载
      setAction(null); setActionUserId(''); setActionNote('')
      load()
    } catch (e: any) { showToast(e.message || '操作失败', 'error') }
    finally { setActionBusy(false) }
  }

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setShowForm(true)
  }

  const openEdit = (a: AssetItem) => {
    setEditingId(a.id)
    setForm({
      name: a.name,
      asset_no: a.asset_no || '',
      category: a.category,
      spec: a.spec || '',
      purchase_date: a.purchase_date ? a.purchase_date.slice(0, 10) : '',
      purchase_price: String(a.purchase_price || ''),
      amount_unit: a.amount_unit || '元',
      currency: a.currency || 'CNY',
      status: a.status,
      location: a.location || '',
      user_id: a.user_id ? String(a.user_id) : '',
      supplier_id: a.supplier_id ? String(a.supplier_id) : '',
      remarks: a.remarks || '',
    })
    setDetail(null)
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name.trim()) { showToast('请填写资产名称', 'warning'); return }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        asset_no: form.asset_no.trim() || null,
        category: form.category,
        spec: form.spec.trim() || null,
        purchase_date: form.purchase_date || null,
        purchase_price: parseFloat(form.purchase_price) || 0,
        amount_unit: form.amount_unit,
        currency: form.currency,
        status: form.status,
        location: form.location.trim() || null,
        user_id: form.user_id ? parseInt(form.user_id) : null,
        supplier_id: form.supplier_id ? parseInt(form.supplier_id) : null,
        remarks: form.remarks.trim() || null,
      }
      const url = editingId ? `/api/v1/assets/${editingId}` : '/api/v1/assets'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '资产已创建', 'success')
      setShowForm(false)
      load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  const remove = async (a: AssetItem) => {
    const ok = await showConfirm(`确认删除资产「${a.name}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/assets/${a.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '删除失败') }
      showToast('已删除', 'success')
      setDetail(null)
      load()
    } catch (e: any) { showToast(e.message || '删除失败', 'error') }
  }

  // 下拉选项
  const userOptions = users.map(u => ({ value: String(u.id), label: u.name || u.username }))
  const supplierOptions = suppliers.map(s => ({ value: String(s.id), label: s.name, hint: s.short_name || undefined }))
  const userFilterOptions = [{ value: '', label: '全部使用人' }, ...userOptions]

  const stats = [
    { label: '总资产', value: list.length },
    { label: '在用', value: list.filter(a => a.status === '在用').length },
    { label: '闲置', value: list.filter(a => a.status === '闲置').length },
  ]

  return (
    <div>
      <PageHeader
        icon={Package}
        title="企业资产"
        description="管理企业固定资产，追踪使用状态与存放位置"
        tone="purple"
        stats={stats}
        right={
          canManage ? (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all"
            >
              <Plus size={16} /> 新建资产
            </button>
          ) : undefined
        }
      />

      {/* 筛选区 */}
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <div className="w-56">
          <Field label="搜索">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="资产名称 / 编号 / 规格型号"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
              />
            </div>
          </Field>
        </div>
        <div className="w-40">
          <Field label="类别">
            <SearchableSelect
              options={[{ value: '', label: '全部类别' }, ...categories.map(c => ({ value: c, label: c }))]}
              value={filterCategory}
              onChange={(v) => setFilterCategory(v === null ? '' : String(v))}
            />
          </Field>
        </div>
        <div className="w-36">
          <Field label="状态">
            <SearchableSelect
              options={[{ value: '', label: '全部状态' }, ...statuses.map(s => ({ value: s, label: s }))]}
              value={filterStatus}
              onChange={(v) => setFilterStatus(v === null ? '' : String(v))}
            />
          </Field>
        </div>
        <div className="w-48">
          <Field label="使用人">
            <SearchableSelect
              options={userFilterOptions}
              value={filterUserId}
              onChange={(v) => setFilterUserId(v === null ? '' : String(v))}
            />
          </Field>
        </div>
      </div>

      {/* 表格列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
      ) : list.length === 0 ? (
        <EmptyState icon={Package} title="暂无资产" description="当前筛选条件下没有资产记录，可点击右上角「新建资产」添加" tone="purple" />
      ) : (
        <div className="rounded-xl bg-bg-card border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">资产编号</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">资产名称</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">类别</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">规格型号</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">状态</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">使用人</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase font-medium px-4 py-3">存放位置</th>
                  <th className="text-right text-[11px] text-gray-400 uppercase font-medium px-4 py-3">购置价格</th>
                  {canManage && <th className="text-right text-[11px] text-gray-400 uppercase font-medium px-4 py-3">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {list.map(a => (
                  <tr
                    key={a.id}
                    onClick={() => setDetail(a)}
                    className="hover:bg-bg-hover/40 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 text-xs text-gray-400 tabular-nums whitespace-nowrap">{a.asset_no || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-200 font-medium whitespace-nowrap">{a.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">{a.category}</td>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[160px] truncate">{a.spec || '—'}</td>
                    <td className="px-4 py-3">{statusBadge(a.status)}</td>
                    <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">{a.user_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{a.location || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-300 text-right tabular-nums whitespace-nowrap">{fmtAmount(a.purchase_price, a.amount_unit)}</td>
                    {canManage && (
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openEdit(a)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover border border-border text-gray-300 text-[11px] font-medium hover:text-purple-400 hover:border-purple-500/50 transition-colors"
                          >
                            <Pencil size={11} /> 编辑
                          </button>
                          <button
                            onClick={() => remove(a)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-hover border border-border text-gray-300 text-[11px] font-medium hover:text-red-400 hover:border-red-500/50 transition-colors"
                          >
                            <Trash2 size={11} /> 删除
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <Modal
          icon={Package}
          title={detail.name}
          subtitle={`${detail.category} · ${detail.asset_no || '无编号'}`}
          tone="purple"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {statusBadge(detail.status)}
              <span className="text-[11px] text-gray-500">{fmtDate(detail.purchase_date)} 购置</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="资产编号" value={detail.asset_no || '—'} />
              <Info label="类别" value={detail.category} />
              <Info label="规格型号" value={detail.spec || '—'} />
              <Info label="存放位置" value={detail.location || '—'} />
              <Info label="使用人" value={detail.user_name || '—'} />
              <Info label="供应商" value={detail.supplier_name || '—'} />
              <Info label="购置价格" value={fmtAmount(detail.purchase_price, detail.amount_unit)} />
              <Info label="币种" value={detail.currency} />
            </div>

            {detail.remarks && (
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">备注</p>
                <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.remarks}</p>
              </div>
            )}

            {/* 流转操作 */}
            {canManage && detail.status !== '已报废' && (
              <div className="pt-1">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1.5"><ArrowLeftRight size={12} /> 流转操作</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ACTION_META).map(([act, meta]) => {
                    // 归还：仅在有使用人时可用
                    const disabled = act === '归还' && !detail.user_id
                    const Icon = meta.icon
                    return (
                      <button
                        key={act}
                        disabled={disabled}
                        onClick={() => { setAction(act); setActionUserId(''); setActionNote('') }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${meta.cls} ${action === act ? 'bg-bg-hover' : ''}`}
                      >
                        <Icon size={13} /> {act}
                      </button>
                    )
                  })}
                </div>

                {/* 操作子表单 */}
                {action && (
                  <div className="mt-3 p-3 rounded-xl bg-bg-hover/50 border border-border space-y-3">
                    <p className="text-[11px] text-gray-600 dark:text-gray-400">{ACTION_META[action].desc}</p>
                    {ACTION_META[action].needUser && (
                      <div>
                        <label className="block text-[11px] text-gray-600 dark:text-gray-400 mb-1.5">{action === '领用' ? '领用员工' : '调拨给'} <span className="text-red-500">*</span></label>
                        <SearchableSelect
                          options={users.map(u => ({ value: String(u.id), label: u.name || u.username }))}
                          value={actionUserId}
                          onChange={(v) => setActionUserId(v === null ? '' : String(v))}
                          placeholder="选择员工"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] text-gray-600 dark:text-gray-400 mb-1.5">备注</label>
                      <input
                        value={actionNote}
                        onChange={e => setActionNote(e.target.value)}
                        placeholder={action === '报废' ? '如：屏幕老化无法使用' : '可选'}
                        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setAction(null)} className="px-3 py-1.5 rounded-lg bg-bg-card border border-border text-gray-600 dark:text-gray-400 text-xs hover:text-gray-900 dark:hover:text-white transition-colors">取消</button>
                      <button
                        onClick={submitAction}
                        disabled={actionBusy}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-50 transition-all"
                      >
                        {actionBusy && <Loader2 size={13} className="animate-spin" />}
                        确认{action}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 流转履历 */}
            <div className="pt-1">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1.5"><History size={12} /> 流转履历</p>
              {recordsLoading ? (
                <div className="flex items-center justify-center py-6"><Loader2 className="animate-spin text-gray-400" size={20} /></div>
              ) : records.length === 0 ? (
                <p className="text-[11px] text-gray-500 py-3 text-center">暂无流转记录</p>
              ) : (
                <div className="space-y-2">
                  {records.map(r => {
                    const meta = ACTION_META[r.action]
                    const Icon = meta?.icon || History
                    return (
                      <div key={r.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-bg-hover/40 border border-border/50">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${meta?.cls || 'text-gray-500'} border`}>
                          <Icon size={12} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-xs flex-wrap">
                            <span className="font-semibold text-gray-800 dark:text-gray-200">{r.action}</span>
                            {(r.from_user_name || r.to_user_name) && (
                              <span className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                                {r.from_user_name || '库房'}
                                <ArrowRight size={10} />
                                {r.to_user_name || '库房'}
                              </span>
                            )}
                            {r.from_status && r.to_status && r.from_status !== r.to_status && (
                              <span className="text-[10px] text-gray-500">（{r.from_status}→{r.to_status}）</span>
                            )}
                          </div>
                          {r.note && <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">{r.note}</p>}
                          <p className="text-[10px] text-gray-500 mt-0.5">{fmtDateTime(r.created_at)} · 操作人 {r.operator_name || '系统'}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {canManage && (
              <div className="flex items-center gap-2 pt-1 border-t border-border/40 mt-1">
                <button
                  onClick={() => openEdit(detail)}
                  className="flex items-center gap-1.5 px-4 py-2 mt-3 rounded-lg bg-bg-hover border border-border text-gray-700 dark:text-gray-300 text-xs font-medium hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  <Pencil size={14} /> 编辑
                </button>
                <button
                  onClick={() => remove(detail)}
                  className="flex items-center gap-1.5 px-4 py-2 mt-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* 创建/编辑弹窗 */}
      {showForm && (
        <Modal
          icon={editingId ? Pencil : Plus}
          title={editingId ? '编辑资产' : '新建资产'}
          subtitle="填写资产基础信息与使用状态"
          tone="purple"
          size="xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="资产名称" required>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  maxLength={200}
                  placeholder="如「MacBook Pro 16寸」"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
                />
              </Field>
              <Field label="资产编号（可选）">
                <input
                  value={form.asset_no}
                  onChange={e => setForm({ ...form, asset_no: e.target.value })}
                  placeholder="如「IT-2024-001」"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
                />
              </Field>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">类别</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {categories.map(c => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, category: c })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.category === c
                        ? 'border-purple-500 text-purple-400 bg-purple-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <Field label="规格型号">
              <input
                value={form.spec}
                onChange={e => setForm({ ...form, spec: e.target.value })}
                placeholder="如「Apple M3 Max / 64GB / 2TB」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="购置日期">
                <input
                  type="date"
                  value={form.purchase_date}
                  onChange={e => setForm({ ...form, purchase_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
                />
              </Field>
              <Field label="存放位置">
                <input
                  value={form.location}
                  onChange={e => setForm({ ...form, location: e.target.value })}
                  placeholder="如「上海办公室 / 3楼工位A12」"
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Field label="购置价格">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={form.purchase_price}
                      onChange={e => setForm({ ...form, purchase_price: e.target.value })}
                      placeholder="0.00"
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500"
                    />
                    <div className="flex rounded-lg overflow-hidden border border-border shrink-0 text-xs">
                      {(['元', '万元'] as const).map(u => (
                        <button key={u} type="button" onClick={() => setForm({ ...form, amount_unit: u })}
                          className={`px-2.5 py-2 transition-colors ${form.amount_unit === u ? 'bg-purple-600 text-white' : 'bg-bg-input text-gray-400 hover:bg-bg-hover'}`}>{u}</button>
                      ))}
                    </div>
                  </div>
                </Field>
              </div>
              <Field label="币种">
                <SearchableSelect
                  options={['CNY', 'USD', 'HKD', 'EUR'].map(c => ({ value: c, label: c }))}
                  value={form.currency}
                  onChange={(v) => setForm({ ...form, currency: v === null ? '' : String(v) })}
                />
              </Field>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">状态</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {statuses.map(s => (
                  <button
                    key={s}
                    onClick={() => setForm({ ...form, status: s })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.status === s
                        ? 'border-purple-500 text-purple-400 bg-purple-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="使用人">
                <SearchableSelect
                  options={userOptions}
                  value={form.user_id}
                  onChange={(v) => setForm({ ...form, user_id: v === null ? '' : String(v) })}
                  placeholder="选择使用人"
                />
              </Field>
              <Field label="采购供应商">
                <SearchableSelect
                  options={supplierOptions}
                  value={form.supplier_id}
                  onChange={(v) => setForm({ ...form, supplier_id: v === null ? '' : String(v) })}
                  placeholder="选择供应商"
                />
              </Field>
            </div>

            <Field label="备注">
              <textarea
                value={form.remarks}
                onChange={e => setForm({ ...form, remarks: e.target.value })}
                rows={3}
                placeholder="资产补充说明，如保修期限、配件清单等"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-purple-500 resize-none"
              />
            </Field>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white transition-colors"
              >
                <X size={14} /> 取消
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-50 transition-all"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? '保存' : '创建资产'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-input/50 px-3 py-2">
      <p className="text-gray-500 mb-0.5">{label}</p>
      <p className="text-gray-200 font-medium break-all">{value}</p>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
