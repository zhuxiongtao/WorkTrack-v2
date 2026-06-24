import { useState, useEffect, useCallback } from 'react'
import {
  ShoppingCart, Loader2, Plus, Send, Trash2, Pencil, RotateCcw, X,
  PackageCheck, Warehouse,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import FileUpload from '../components/FileUpload'
import SearchableSelect from '../components/SearchableSelect'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'

interface PurchaseItem {
  id: number
  user_id: number
  user_name: string | null
  title: string
  purchase_type: string
  supplier_id: number | null
  supplier_name: string | null
  items: string | null  // JSON 数组,每项含 name/spec/qty/unit_price/amount
  total_amount: number
  amount_unit: string
  currency: string
  reason: string
  expected_date: string | null
  attachments: string | null
  status: string  // 草稿 | 审批中 | 已批准 | 已驳回 | 已撤回 | 已采购 | 已入库
  purchased_at: string | null
  stored_at: string | null
  created_at: string
  updated_at: string
}

interface Supplier {
  id: number
  name: string
}

interface FormItem {
  name: string
  spec: string
  qty: string
  unit_price: string
}

const DEFAULT_TYPES = ['办公用品', '设备', '服务', '其他']

const STATUS_META: Record<string, { label: string; cls: string }> = {
  草稿:   { label: '草稿',   cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  审批中: { label: '审批中', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  已批准: { label: '已批准', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  已驳回: { label: '已驳回', cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  已撤回: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
  已采购: { label: '已采购', cls: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  已入库: { label: '已入库', cls: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
}

function fmtAmount(n: number, c: string, unit = '元'): string {
  try { return `${c} ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}` }
  catch { return `${c} ${n} ${unit}` }
}
function fmtDate(s: string): string {
  try { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  catch { return s }
}
function fmtDateOnly(s: string): string {
  try { const d = new Date(s); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  catch { return s }
}
function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

function parseItems(json: string | null): Array<{ name: string; spec: string; qty: number; unit_price: number; amount: number }> {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr
  } catch { return [] }
}

const emptyForm = {
  title: '',
  purchase_type: '办公用品',
  supplier_id: null as number | null,
  items: [{ name: '', spec: '', qty: '', unit_price: '' }] as FormItem[],
  amount_unit: '元',
  currency: 'CNY',
  reason: '',
  expected_date: '',
  attachments: null as string | null,
}

export default function PurchasesPage() {
  const { hasPermission } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canViewAll = hasPermission('purchase:view_all')
  const canManage = hasPermission('purchase:manage')

  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<PurchaseItem[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<PurchaseItem | null>(null)
  const [acting, setActing] = useState(false)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [types, setTypes] = useState<string[]>(DEFAULT_TYPES)

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/purchase-suppliers')
      if (res.ok) {
        const data = await res.json()
        setSuppliers(Array.isArray(data) ? data.map((s: any) => ({ id: s.id, name: s.name })) : [])
      }
    } catch { /* ignore */ }
  }, [])

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/purchases/types')
      if (res.ok) {
        const data = await res.json()
        if (data.types && Array.isArray(data.types)) setTypes(data.types)
      }
    } catch { /* ignore */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/purchases?scope=${scope}`)
      if (res.ok) setList(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [scope])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadSuppliers(); loadTypes() }, [loadSuppliers, loadTypes])

  // ── 明细计算 ──
  const calcAmount = (it: FormItem): number => {
    const qty = parseFloat(it.qty) || 0
    const unit_price = parseFloat(it.unit_price) || 0
    return qty * unit_price
  }
  const calcTotal = (): number => form.items.reduce((s, it) => s + calcAmount(it), 0)

  const addRow = () => {
    setForm({ ...form, items: [...form.items, { name: '', spec: '', qty: '', unit_price: '' }] })
  }
  const removeRow = (idx: number) => {
    const next = form.items.filter((_, i) => i !== idx)
    setForm({ ...form, items: next.length ? next : [{ name: '', spec: '', qty: '', unit_price: '' }] })
  }
  const updateRow = (idx: number, field: keyof FormItem, value: string) => {
    const next = form.items.map((it, i) => i === idx ? { ...it, [field]: value } : it)
    setForm({ ...form, items: next })
  }

  const openCreate = () => {
    setEditingId(null); setForm({ ...emptyForm, items: [{ name: '', spec: '', qty: '', unit_price: '' }] }); setShowForm(true)
  }
  const openEdit = (p: PurchaseItem) => {
    const parsed = parseItems(p.items)
    const formItems: FormItem[] = parsed.length
      ? parsed.map(it => ({ name: it.name || '', spec: it.spec || '', qty: String(it.qty || ''), unit_price: String(it.unit_price || '') }))
      : [{ name: '', spec: '', qty: '', unit_price: '' }]
    setEditingId(p.id)
    setForm({
      title: p.title,
      purchase_type: p.purchase_type,
      supplier_id: p.supplier_id,
      items: formItems,
      amount_unit: p.amount_unit || '元',
      currency: p.currency,
      reason: p.reason,
      expected_date: p.expected_date ? fmtDateOnly(p.expected_date) : '',
      attachments: p.attachments,
    })
    setDetail(null); setShowForm(true)
  }

  const save = async () => {
    if (!form.title.trim()) { showToast('请填写采购标题', 'warning'); return }
    setSaving(true)
    try {
      const cleanItems = form.items
        .filter(it => it.name.trim())
        .map(it => {
          const qty = parseFloat(it.qty) || 0
          const unit_price = parseFloat(it.unit_price) || 0
          return { name: it.name.trim(), spec: it.spec.trim(), qty, unit_price, amount: qty * unit_price }
        })
      const total_amount = cleanItems.reduce((s, it) => s + it.amount, 0)
      const body = {
        title: form.title.trim(),
        purchase_type: form.purchase_type,
        supplier_id: form.supplier_id,
        items: cleanItems.length ? JSON.stringify(cleanItems) : null,
        total_amount,
        amount_unit: form.amount_unit,
        currency: form.currency,
        reason: form.reason.trim(),
        expected_date: form.expected_date ? `${form.expected_date}T00:00:00` : null,
        attachments: form.attachments,
      }
      const url = editingId ? `/api/v1/purchases/${editingId}` : '/api/v1/purchases'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '保存失败') }
      showToast(editingId ? '已保存' : '采购申请已创建', 'success')
      setShowForm(false); load()
    } catch (e: any) { showToast(e.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  const submitApproval = async (p: PurchaseItem) => {
    const ok = await showConfirm('提交后将进入审批流程，期间不可编辑。确认提交？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/purchases/${p.id}/submit-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '提交失败') }
      showToast('已提交审批', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '提交失败', 'error') }
    finally { setActing(false) }
  }

  const revoke = async (p: PurchaseItem) => {
    const ok = await showConfirm('撤回后采购申请回到草稿，可重新编辑。确认撤回？')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/purchases/${p.id}/revoke-approval`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '撤回失败') }
      showToast('已撤回', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '撤回失败', 'error') }
    finally { setActing(false) }
  }

  const procure = async (p: PurchaseItem) => {
    const ok = await showConfirm('确认执行采购？此操作将记录采购时间。')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/purchases/${p.id}/procure`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '操作失败') }
      showToast('已执行采购', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '操作失败', 'error') }
    finally { setActing(false) }
  }

  const store = async (p: PurchaseItem) => {
    const ok = await showConfirm('确认执行入库？此操作将记录入库时间。')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/purchases/${p.id}/store`, { method: 'POST' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '操作失败') }
      showToast('已执行入库', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '操作失败', 'error') }
    finally { setActing(false) }
  }

  const remove = async (p: PurchaseItem) => {
    const ok = await showConfirm(`确认删除采购申请「${p.title}」？`)
    if (!ok) return
    try {
      const res = await fetch(`/api/v1/purchases/${p.id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || '删除失败') }
      showToast('已删除', 'success')
      setDetail(null); load()
    } catch (e: any) { showToast(e.message || '删除失败', 'error') }
  }

  const stats = [
    { label: '总申请', value: list.length },
    { label: '审批中', value: list.filter(p => p.status === '审批中').length },
    { label: '已入库', value: list.filter(p => p.status === '已入库').length },
  ]

  return (
    <div>
      <PageHeader
        icon={ShoppingCart}
        title="采购申请"
        description="办公用品、设备、服务等采购事项，提交后经审批通过后执行采购与入库"
        tone="orange"
        stats={stats}
        right={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} /> 新建采购
          </button>
        }
      />

      {/* 范围切换 */}
      {canViewAll && (
        <div className="flex items-center gap-1 bg-bg-hover/60 border border-border rounded-lg p-0.5 w-fit mb-5">
          {([
            { key: 'mine' as const, label: '我发起的' },
            { key: 'all' as const, label: '全部申请' },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setScope(t.key)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                scope === t.key ? 'bg-bg-card text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-gray-400" size={28} /></div>
      ) : list.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="暂无采购申请" description="点击右上角「新建采购」发起第一笔申请" tone="orange" />
      ) : (
        <div className="space-y-2">
          {list.map(p => (
            <button
              key={p.id}
              onClick={() => setDetail(p)}
              className="w-full text-left rounded-xl bg-bg-card border border-border/50 p-4 hover:border-border hover:bg-bg-hover/40 transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{p.title}</span>
                    {statusBadge(p.status)}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-gray-400">{p.purchase_type}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1 truncate">
                    供应商 {p.supplier_name || '—'}
                    {canViewAll && scope === 'all' && <span className="ml-1.5">· 申请人 {p.user_name}</span>}
                    <span className="ml-1.5">· {fmtDate(p.created_at)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-orange-400">{fmtAmount(p.total_amount, p.currency, p.amount_unit)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <Modal
          icon={ShoppingCart}
          title={detail.title}
          subtitle={`${detail.purchase_type} · ${fmtAmount(detail.total_amount, detail.currency, detail.amount_unit)}`}
          tone="orange"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">{statusBadge(detail.status)}</div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Info label="供应商" value={detail.supplier_name || '—'} />
              <Info label="申请人" value={detail.user_name || '—'} />
              <Info label="总金额" value={fmtAmount(detail.total_amount, detail.currency, detail.amount_unit)} />
              <Info label="期望日期" value={detail.expected_date ? fmtDateOnly(detail.expected_date) : '—'} />
              {detail.purchased_at && <Info label="采购时间" value={fmtDate(detail.purchased_at)} />}
              {detail.stored_at && <Info label="入库时间" value={fmtDate(detail.stored_at)} />}
            </div>

            {/* 采购明细 */}
            {parseItems(detail.items).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">采购明细</p>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-bg-hover/60 text-gray-400">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">名称</th>
                        <th className="text-left px-3 py-2 font-medium">规格</th>
                        <th className="text-right px-3 py-2 font-medium">数量</th>
                        <th className="text-right px-3 py-2 font-medium">单价</th>
                        <th className="text-right px-3 py-2 font-medium">金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseItems(detail.items).map((it, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="px-3 py-2 text-gray-200">{it.name}</td>
                          <td className="px-3 py-2 text-gray-400">{it.spec || '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{it.qty}</td>
                          <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{it.unit_price.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-right text-orange-400 font-medium tabular-nums">{it.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-bg-hover/40 border-t border-border">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-right text-gray-400">合计</td>
                        <td className="px-3 py-2 text-right text-orange-400 font-bold tabular-nums">{detail.total_amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {detail.reason && (
              <div>
                <p className="text-xs text-gray-400 mb-1">采购事由</p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{detail.reason}</p>
              </div>
            )}

            {detail.attachments && JSON.parse(detail.attachments).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1.5">附件</p>
                <FileUpload filesJson={detail.attachments} disabled />
              </div>
            )}

            {/* 审批进度（提交后展示） */}
            {detail.status !== '草稿' && (
              <ApprovalTimeline targetType="purchase" targetId={detail.id} onChanged={load} />
            )}

            {/* 操作区 */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {detail.status === '草稿' && (
                <>
                  <button
                    onClick={() => submitApproval(detail)}
                    disabled={acting}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 text-white text-xs font-bold hover:bg-orange-600 disabled:opacity-50 transition-colors"
                  >
                    {acting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 提交审批
                  </button>
                  <button
                    onClick={() => openEdit(detail)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white transition-colors"
                  >
                    <Pencil size={14} /> 编辑
                  </button>
                  <button
                    onClick={() => remove(detail)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 size={14} /> 删除
                  </button>
                </>
              )}
              {detail.status === '审批中' && (
                <button
                  onClick={() => revoke(detail)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white disabled:opacity-50 transition-colors"
                >
                  <RotateCcw size={14} /> 撤回申请
                </button>
              )}
              {detail.status === '已批准' && canManage && (
                <button
                  onClick={() => procure(detail)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 text-white text-xs font-bold hover:bg-cyan-600 disabled:opacity-50 transition-colors"
                >
                  {acting ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />} 执行采购
                </button>
              )}
              {detail.status === '已采购' && canManage && (
                <button
                  onClick={() => store(detail)}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 text-white text-xs font-bold hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {acting ? <Loader2 size={14} className="animate-spin" /> : <Warehouse size={14} />} 执行入库
                </button>
              )}
              {detail.status === '已驳回' && (
                <button
                  onClick={() => openEdit(detail)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white transition-colors"
                >
                  <Pencil size={14} /> 修改后重提
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* 创建/编辑弹窗 */}
      {showForm && (
        <Modal
          icon={editingId ? Pencil : Plus}
          title={editingId ? '编辑采购申请' : '新建采购申请'}
          subtitle="填写采购信息，保存为草稿后可提交审批"
          tone="orange"
          size="2xl"
          onClose={() => setShowForm(false)}
        >
          <div className="space-y-4">
            <Field label="采购标题" required>
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                placeholder="如「8月办公电脑采购」"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">采购类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {types.map(t => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, purchase_type: t })}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.purchase_type === t
                        ? 'border-orange-500 text-orange-400 bg-orange-500/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="供应商（可选）">
                <SearchableSelect
                  options={[{ id: 0, label: '不指定' }, ...suppliers.map(s => ({ id: s.id, label: s.name }))]}
                  value={form.supplier_id || 0}
                  onChange={(v) => setForm({ ...form, supplier_id: v === 0 ? null : Number(v) })}
                  clearValue={0}
                />
              </Field>
              <Field label="期望到货日期（可选）">
                <input
                  type="date"
                  value={form.expected_date}
                  onChange={e => setForm({ ...form, expected_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500"
                />
              </Field>
            </div>

            {/* 采购明细 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs text-gray-400">采购明细</label>
                <button
                  type="button"
                  onClick={addRow}
                  className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <Plus size={12} /> 添加行
                </button>
              </div>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-bg-hover/60 text-gray-400">
                    <tr>
                      <th className="text-left px-2 py-2 font-medium">名称</th>
                      <th className="text-left px-2 py-2 font-medium">规格</th>
                      <th className="text-right px-2 py-2 font-medium w-20">数量</th>
                      <th className="text-right px-2 py-2 font-medium w-24">单价</th>
                      <th className="text-right px-2 py-2 font-medium w-24">金额</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, idx) => (
                      <tr key={idx} className="border-t border-border/40">
                        <td className="px-2 py-1.5">
                          <input
                            value={it.name}
                            onChange={e => updateRow(idx, 'name', e.target.value)}
                            placeholder="物品名称"
                            className="w-full px-2 py-1 rounded bg-bg-input border border-border text-xs outline-none focus:border-orange-500"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={it.spec}
                            onChange={e => updateRow(idx, 'spec', e.target.value)}
                            placeholder="规格型号"
                            className="w-full px-2 py-1 rounded bg-bg-input border border-border text-xs outline-none focus:border-orange-500"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            value={it.qty}
                            onChange={e => updateRow(idx, 'qty', e.target.value)}
                            placeholder="0"
                            className="w-full px-2 py-1 rounded bg-bg-input border border-border text-xs text-right outline-none focus:border-orange-500 tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            value={it.unit_price}
                            onChange={e => updateRow(idx, 'unit_price', e.target.value)}
                            placeholder="0.00"
                            className="w-full px-2 py-1 rounded bg-bg-input border border-border text-xs text-right outline-none focus:border-orange-500 tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right text-orange-400 font-medium tabular-nums">
                          {calcAmount(it).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeRow(idx)}
                            className="text-gray-500 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-bg-hover/40 border-t border-border">
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right text-gray-400">合计</td>
                      <td className="px-2 py-2 text-right text-orange-400 font-bold tabular-nums">{calcTotal().toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="总金额（自动汇总）">
                <input
                  value={calcTotal().toFixed(2)}
                  readOnly
                  className="w-full px-3 py-2 rounded-lg bg-bg-input/60 border border-border text-sm text-orange-400 font-bold outline-none tabular-nums"
                />
              </Field>
              <Field label="金额单位">
                <div className="flex rounded-lg overflow-hidden border border-border h-[38px] text-xs">
                  {(['元', '万元'] as const).map(u => (
                    <button key={u} type="button" onClick={() => setForm({ ...form, amount_unit: u })}
                      className={`flex-1 px-2.5 transition-colors ${form.amount_unit === u ? 'bg-orange-600 text-white' : 'bg-bg-input text-gray-400 hover:bg-bg-hover'}`}>{u}</button>
                  ))}
                </div>
              </Field>
              <Field label="币种">
                <SearchableSelect
                  options={['CNY', 'USD', 'HKD', 'EUR'].map(c => ({ id: c, label: c }))}
                  value={form.currency}
                  onChange={(v) => setForm({ ...form, currency: v === 0 ? '' : String(v) })}
                  clearValue=""
                />
              </Field>
            </div>

            <Field label="采购事由">
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                rows={3}
                placeholder="说明采购用途、背景"
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-orange-500 resize-none"
              />
            </Field>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">附件（可选，可粘贴截图）</label>
              <FileUpload filesJson={form.attachments} onChange={v => setForm({ ...form, attachments: v })} />
            </div>

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
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {editingId ? '保存' : '创建草稿'}
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
