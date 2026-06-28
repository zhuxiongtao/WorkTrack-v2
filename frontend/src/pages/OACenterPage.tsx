import { useState, useEffect, useCallback } from 'react'
import {
  CalendarDays, Clock, Receipt, Plane, ShoppingCart, Package,
  Loader2, Plus, Send, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, XCircle, Clock as ClockIcon, X,
  Link2, Wallet, User, Building2, Calendar, Sparkles, Paperclip, Eye, Wand2, FileText, UserPlus,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal, Field } from '../components/design-system'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import FileUpload from '../components/FileUpload'
import { ApprovalTimeline } from '../components/approval/ApprovalTimeline'
import { apiFetch } from '../services/api'
import {
  expenseService,
  type LegalEntity, type EmployeeLoan, type RelationCandidate,
} from '../services/expenseService'
import ExcelImport from '../components/expense/ExcelImport'
import SearchableSelect, { type SearchableSelectOption } from '../components/SearchableSelect'

/* ──── 类型定义 ──── */
type OAType = 'leave' | 'overtime' | 'expense' | 'trip' | 'purchase' | 'hire'

interface ApprovalInstance {
  id: number
  flow_code: string
  title: string
  target_type: string
  target_id: number
  status: string // pending | approved | rejected | cancelled
  current_node: string | null
  current_node_kind: string | null
  current_action_label: string | null
  node_total: number
  node_index: number
  submitted_by: number
  submitted_by_name: string | null
  submitted_at: string | null
  finished_at: string | null
  can_act: boolean
}

/* ──── OA 模块配置 ──── */
const OA_MODULES: Record<OAType, {
  label: string
  desc: string
  icon: typeof CalendarDays
  color: string
  api: string
  targetType: string
}> = {
  leave:    { label: '请假申请', desc: '年假/事假/病假/调休等', icon: CalendarDays,  color: '#8B5CF6', api: '/api/v1/leaves',         targetType: 'leave' },
  overtime: { label: '加班申请', desc: '加班调休或加班费',     icon: Clock,         color: '#06B6D4', api: '/api/v1/overtimes',      targetType: 'overtime' },
  expense:  { label: '报销申请', desc: '差旅/交通/办公等费用', icon: Receipt,       color: '#10B981', api: '/api/v1/expenses',       targetType: 'expense' },
  trip:     { label: '出差申请', desc: '出差审批与预算申报',   icon: Plane,         color: '#3B82F6', api: '/api/v1/business-trips', targetType: 'business_trip' },
  purchase: { label: '采购申请', desc: '办公用品/设备/服务',   icon: ShoppingCart,  color: '#F59E0B', api: '/api/v1/purchases',      targetType: 'purchase' },
  hire:     { label: '员工入职', desc: '新员工入职申请与建账号', icon: UserPlus,      color: '#3B82F6', api: '/api/v1/hires',          targetType: 'hire' },
}

const OA_TARGET_MAP: Record<string, OAType> = {
  leave: 'leave',
  overtime: 'overtime',
  expense: 'expense',
  business_trip: 'trip',
  purchase: 'purchase',
  hire: 'hire',
}

/* ──── 状态映射 ──── */
const STATUS_META: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  pending:   { label: '审批中', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',   icon: ClockIcon },
  approved:  { label: '已通过', cls: 'text-green-400 bg-green-500/10 border-green-500/30',   icon: CheckCircle2 },
  rejected:  { label: '已驳回', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20',         icon: XCircle },
  cancelled: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30',      icon: AlertCircle },
}

function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30', icon: AlertCircle }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>
      <m.icon size={10} /> {m.label}
    </span>
  )
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return s }
}

function toISO(s: string): string {
  if (!s) return ''
  return s.length === 16 ? s + ':00' : s
}

function calcHours(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start)
  const e = new Date(end)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0
  const diff = (e.getTime() - s.getTime()) / (1000 * 60 * 60)
  return diff > 0 ? Math.round(diff * 100) / 100 : 0
}

// 请假档位时间：上午 09:00-12:00（0.5天）、下午 13:00-18:00（0.5天）
const SLOT_START: Record<string, string> = { am: '09:00', pm: '13:00' }
const SLOT_END: Record<string, string>   = { am: '12:00', pm: '18:00' }

// 根据开始/结束日期和档位计算请假天数（只支持 0.5 天和 1 天）
function calcLeaveDays(startDate: string, startSlot: string, endDate: string, endSlot: string): number {
  if (!startDate || !endDate) return 0
  const s = new Date(startDate)
  const e = new Date(endDate)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0
  const dayDiff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24))
  if (dayDiff < 0) return 0
  if (dayDiff === 0) {
    // 同一天：上午→上午=0.5天，下午→下午=0.5天，上午→下午=1天，下午→上午=非法0
    if (startSlot === endSlot) return 0.5
    if (startSlot === 'am' && endSlot === 'pm') return 1
    return 0
  }
  // 跨天：首日 0.5/1 + 中间整天 + 末日 0.5/1
  const firstDay = startSlot === 'am' ? 1 : 0.5
  const lastDay = endSlot === 'pm' ? 1 : 0.5
  const middleDays = dayDiff - 1
  return firstDay + middleDays + lastDay
}

// 天数 → 小时数（1 天 = 8 小时）
function leaveDaysToHours(days: number): number {
  return Math.round(days * 8 * 10) / 10
}

// 出差天数计算（与请假相同，只支持 0.5 天和 1 天粒度）
function calcTripDays(startDate: string, startSlot: string, endDate: string, endSlot: string): number {
  return calcLeaveDays(startDate, startSlot, endDate, endSlot)
}

// 日期 + 档位 → ISO datetime 字符串
function dateSlotToISO(date: string, slot: string, isStart: boolean): string {
  const time = isStart ? (SLOT_START[slot] || '09:00') : (SLOT_END[slot] || '18:00')
  return `${date}T${time}:00`
}

/* ──── 假期余额提示 ──── */
interface LeaveBalanceItem {
  leave_type: string
  total_hours: number
  used_hours: number
  remaining_hours: number
  year: number
}

const STATUTORY_DAYS: Record<string, number> = {
  '婚假': 3, '产假': 158, '陪产假': 15, '丧假': 3,
}

const LEAVE_TYPES = ['年假', '事假', '病假', '调休', '婚假', '产假', '陪产假', '丧假']
const COMPENSATE_TYPES = ['调休', '加班费']
const EXPENSE_TYPES = ['差旅', '交通', '餐饮', '办公用品', '通讯', '培训', '其他']
const PURCHASE_TYPES = ['办公用品', '设备', '服务', '其他']
const CURRENCIES = ['CNY', 'USD', 'HKD', 'EUR']
const AMOUNT_UNITS = ['元', '万元']

/* ════════════════════════════════════════════
   主页面
════════════════════════════════════════════ */
export default function OACenterPage() {
  const { hasPermission } = useAuth()
  const [tab, setTab] = useState<'mine' | 'pending'>('mine')
  const [list, setList] = useState<ApprovalInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [formType, setFormType] = useState<OAType | null>(null)
  const [detailItem, setDetailItem] = useState<ApprovalInstance | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = tab === 'mine' ? '/api/v1/approvals/mine' : '/api/v1/approvals/pending'
      const res = await apiFetch<ApprovalInstance[]>(url)
      if (Array.isArray(res)) {
        // 只展示 OA 相关的审批实例
        setList(res.filter(item => OA_TARGET_MAP[item.target_type]))
      } else {
        setList([])
      }
    } catch { setList([]) }
    finally { setLoading(false) }
  }, [tab])

  useEffect(() => { load() }, [load])

  const openForm = (type: OAType) => {
    // hire 表单字段多且复杂，走独立页面 /hires
    if (type === 'hire') {
      window.location.href = '/hires'
      return
    }
    setFormType(type)
  }
  const closeForm = () => { setFormType(null); load() }

  return (
    <div>
      {/* 页面标题 */}
      <PageHeader
        icon={CalendarDays}
        title="OA 办公"
        description="统一发起请假、加班、报销、出差、采购申请，查看审批进度"
      />

      {/* ── 功能卡片入口 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {(Object.keys(OA_MODULES) as OAType[]).filter(key => {
          // hire 模块仅 HR/管理员可见（需 hire:manage 权限）
          if (key === 'hire') return hasPermission('hire:manage')
          return true
        }).map(key => {
          const mod = OA_MODULES[key]
          return (
            <button
              key={key}
              onClick={() => openForm(key)}
              className="group relative rounded-xl border border-border bg-bg-card p-4 text-left transition-all hover:border-transparent hover:shadow-lg"
              style={{ '--card-color': mod.color } as React.CSSProperties}
            >
              {/* 顶部色条 */}
              <div
                className="absolute top-0 left-0 right-0 h-1 rounded-t-xl opacity-80"
                style={{ background: mod.color }}
              />
              <div className="flex items-center gap-2.5 mb-1.5">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: mod.color + '18' }}
                >
                  <mod.icon size={18} style={{ color: mod.color }} />
                </div>
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{mod.label}</span>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{mod.desc}</p>
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: mod.color }}>
                <Plus size={11} /> 发起申请
              </div>
            </button>
          )
        })}
      </div>

      {/* 资产管理入口（不走审批流，单独入口） */}
      {hasPermission('asset:read') && (
        <div className="mb-6">
          <a
            href="/assets"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-bg-card text-xs text-gray-600 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue transition-colors"
          >
            <Package size={14} /> 企业资产管理（领用/归还/调拨）
          </a>
        </div>
      )}

      {/* ── Tab 切换 ── */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {([
          { key: 'mine', label: '我的申请' },
          { key: 'pending', label: '我的待办' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'text-accent-blue'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-blue rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* ── 统一申请清单 ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 size={20} className="animate-spin mr-2" /> 加载中…
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={tab === 'mine' ? Receipt : CheckCircle2}
          title={tab === 'mine' ? '还没有申请记录' : '没有待办审批'}
          description={tab === 'mine' ? '点击上方卡片发起申请' : '所有审批已处理完毕'}
        />
      ) : (
        <div className="space-y-2">
          {list.map(item => {
            const oaType = OA_TARGET_MAP[item.target_type]
            const mod = oaType ? OA_MODULES[oaType] : null
            const expanded = detailItem?.id === item.id
            return (
              <div
                key={item.id}
                className={`rounded-xl border transition-all ${
                  expanded
                    ? 'border-accent-blue/30 bg-accent-blue/5'
                    : 'border-border bg-bg-card hover:bg-bg-hover'
                }`}
              >
                <button
                  onClick={() => setDetailItem(expanded ? null : item)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  {/* 类型图标 */}
                  {mod && (
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: mod.color + '18' }}
                    >
                      <mod.icon size={16} style={{ color: mod.color }} />
                    </div>
                  )}

                  {/* 重点信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {mod && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: mod.color + '18', color: mod.color }}
                        >
                          {mod.label}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{item.title}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      <span>{item.submitted_by_name || '未知'}</span>
                      <span>·</span>
                      <span>{fmtDate(item.submitted_at)}</span>
                      {item.current_node && (
                        <>
                          <span>·</span>
                          <span className="text-amber-500 dark:text-amber-400">
                            {item.node_index}/{item.node_total} {item.current_node}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 状态徽章 */}
                  <div className="shrink-0 flex items-center gap-2">
                    {statusBadge(item.status)}
                    {expanded
                      ? <ChevronDown size={14} className="text-gray-400" />
                      : <ChevronRight size={14} className="text-gray-400" />}
                  </div>
                </button>

                {/* 展开详情：审批时间线 */}
                {expanded && (
                  <div className="border-t border-border/50 p-4">
                    {item.status === 'pending' && item.can_act && tab === 'pending' && (
                      <div className="mb-3 text-[11px] text-accent-blue">
                        当前节点需要您审批
                      </div>
                    )}
                    <ApprovalTimeline targetType={item.target_type} targetId={item.target_id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── 表单弹窗 ── */}
      {formType && (
        <OAFormModal
          type={formType}
          onClose={closeForm}
        />
      )}
    </div>
  )
}

/* ════════════════════════════════════════════
   OA 表单弹窗（根据类型动态渲染）
════════════════════════════════════════════ */
function OAFormModal({ type, onClose }: { type: OAType; onClose: () => void }) {
  const { toast } = useToast()
  const { user, fetchWithAuth } = useAuth()
  const mod = OA_MODULES[type]
  const [saving, setSaving] = useState(false)
  const [balances, setBalances] = useState<LeaveBalanceItem[]>([])

  // 报销 V2 状态
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([])
  const [myLoans, setMyLoans] = useState<EmployeeLoan[]>([])
  const [departments, setDepartments] = useState<Array<{ id: number; name: string; parent_id: number | null }>>([])
  const [previewItemIdx, setPreviewItemIdx] = useState<number | null>(null)
  const [quickPreview, setQuickPreview] = useState<{ itemIdx: number; fileIdx: number } | null>(null)
  const [relationDrawer, setRelationDrawer] = useState<{
    open: boolean
    targetType: 'business_trip' | 'leave' | 'purchase'
    candidates: RelationCandidate[]
    loading: boolean
  }>({ open: false, targetType: 'business_trip', candidates: [], loading: false })

  // 申请时间：表单打开瞬间锁定
  const [applyTime] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  })

  // 通用表单字段
  const [form, setForm] = useState<Record<string, any>>({
    // leave
    leave_type: '年假',
    title: '',
    start_date: '',
    start_slot: 'am' as 'am' | 'pm',
    end_date: '',
    end_slot: 'pm' as 'am' | 'pm',
    reason: '',
    attachments: null,
    // overtime
    compensate_type: '调休',
    hours: '',
    // expense V2（费用类型不再作为顶层字段；每条明细自带 expense_type）
    amount: '',
    amount_unit: '元',
    currency: 'CNY',
    expense_date: '',
    invoice_entity_id: null as number | null,
    priority_offset_loan: false,
    items: [] as Array<{
      id?: number
      name: string
      expense_type: string
      department_id: number | null
      city: string
      expense_date: string
      amount: string | number
      note: string
      remark: string
      attachments: string | null
    }>,
    relations: [] as Array<{ target_type: 'business_trip' | 'leave' | 'purchase'; target_id: number; relation_note: string; target_title?: string; target_meta?: any }>,
    // trip
    destination: '',
    days: '',
    purpose: '',
    budget: '',
    budget_unit: '元',
    // purchase
    purchase_type: '办公用品',
    supplier_id: 0,
    total_amount: '',
    expected_date: '',
  })

  // 加载假期余额（仅请假类型需要）
  useEffect(() => {
    if (type !== 'leave') return
    (async () => {
      try {
        const res = await fetch(`/api/v1/leave-balances/my?year=${new Date().getFullYear()}`)
        if (res.ok) {
          const data = await res.json()
          setBalances(Array.isArray(data) ? data : [])
        }
      } catch { /* ignore */ }
    })()
  }, [type])

  // 报销 V2：加载公司主体 + 个人未结清借款
  useEffect(() => {
    if (type !== 'expense') return
    (async () => {
      try {
        const ents = await expenseService.listLegalEntities()
        setLegalEntities(ents || [])
        // 默认勾选默认主体
        const def = (ents || []).find((e) => e.is_default) || (ents || [])[0]
        if (def && !form.invoice_entity_id) {
          setForm((prev) => ({ ...prev, invoice_entity_id: def.id }))
        }
      } catch { /* ignore */ }
    })()
  }, [type])

  // 报销 V2：加载部门列表（用于明细「费用使用部门」下拉）
  useEffect(() => {
    if (type !== 'expense') return
    (async () => {
      try {
        const list = await apiFetch<Array<{ id: number; name: string; parent_id: number | null }>>(
          '/api/v1/users/departments'
        )
        setDepartments(Array.isArray(list) ? list : [])
      } catch { /* ignore */ }
    })()
  }, [type])

  // 借款随主体联动
  useEffect(() => {
    if (type !== 'expense') return
    if (!form.invoice_entity_id) { setMyLoans([]); return }
    (async () => {
      try {
        const loans = await expenseService.listMyActiveLoans(form.invoice_entity_id)
        setMyLoans(loans || [])
      } catch { /* ignore */ }
    })()
  }, [type, form.invoice_entity_id])

  const update = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }))

  // 请假可休时间提示
  const getLeaveHint = (): { text: string; tone: 'info' | 'warn' | 'danger' } | null => {
    if (type !== 'leave') return null
    const leaveType = form.leave_type
    const bal = balances.find(b => b.leave_type === leaveType)
    const HOURS_PER_DAY = 8
    // 当前表单计算的请假天数
    const formDays = form.start_date && form.end_date
      ? calcLeaveDays(form.start_date, form.start_slot, form.end_date, form.end_slot)
      : 0
    const formHours = leaveDaysToHours(formDays)

    if (leaveType === '年假' || leaveType === '调休') {
      if (!bal || bal.total_hours === 0) {
        return { text: `无可用${leaveType}额度，请联系 HR 确认`, tone: 'danger' }
      }
      const remainingDays = Math.round((bal.remaining_hours / HOURS_PER_DAY) * 10) / 10
      const usedDays = Math.round((bal.used_hours / HOURS_PER_DAY) * 10) / 10
      const totalDays = Math.round((bal.total_hours / HOURS_PER_DAY) * 10) / 10
      if (formHours > 0 && formHours > bal.remaining_hours) {
        return { text: `剩余 ${remainingDays} 天，本次申请 ${formDays} 天将超额透支`, tone: 'danger' }
      }
      return { text: `剩余 ${remainingDays} 天 / 总额 ${totalDays} 天（已用 ${usedDays} 天）`, tone: remainingDays > 0 ? 'info' : 'warn' }
    }
    if (leaveType === '事假' || leaveType === '病假') {
      return { text: '无额度限制，按需申请（病假建议附医院证明）', tone: 'info' }
    }
    const statutory = STATUTORY_DAYS[leaveType]
    if (statutory !== undefined) {
      if (bal && bal.total_hours > 0) {
        const remainingDays = Math.round((bal.remaining_hours / HOURS_PER_DAY) * 10) / 10
        return { text: `法定 ${statutory} 天，剩余 ${remainingDays} 天`, tone: 'info' }
      }
      return { text: `法定 ${statutory} 天，需 HR 核准后发放额度`, tone: 'info' }
    }
    return null
  }

  // 构建请求体
  const buildBody = (): Record<string, any> | null => {
    switch (type) {
      case 'leave':
        if (!form.title.trim()) { toast('请填写请假事由', 'warning'); return null }
        if (!form.start_date || !form.end_date) { toast('请选择起止日期', 'warning'); return null }
        if (new Date(form.end_date) < new Date(form.start_date)) { toast('结束日期不能早于开始日期', 'warning'); return null }
        return {
          leave_type: form.leave_type,
          title: form.title.trim(),
          start_at: dateSlotToISO(form.start_date, form.start_slot, true),
          end_at: dateSlotToISO(form.end_date, form.end_slot, false),
          hours: leaveDaysToHours(calcLeaveDays(form.start_date, form.start_slot, form.end_date, form.end_slot)),
          reason: form.reason.trim(),
          attachments: form.attachments,
        }
      case 'overtime':
        if (!form.title.trim()) { toast('请填写加班标题', 'warning'); return null }
        if (!form.start_at || !form.end_at) { toast('请选择起止时间', 'warning'); return null }
        return {
          title: form.title.trim(),
          start_at: toISO(form.start_at),
          end_at: toISO(form.end_at),
          hours: parseFloat(form.hours) || 0,
          reason: form.reason.trim(),
          compensate_type: form.compensate_type,
          attachments: form.attachments,
        }
      case 'expense':
        if (!form.title.trim()) { toast('请填写报销摘要', 'warning'); return null }
        if (!form.invoice_entity_id) { toast('请选择发票的我方名义', 'warning'); return null }
        // 至少一条明细
        const validItems = ((form.items || []) as any[]).filter(
          (it) => (typeof it.amount === 'number' ? it.amount : parseFloat(it.amount)) || it.name || it.note
        )
        if (validItems.length === 0) { toast('请至少添加一条报销明细', 'warning'); return null }
        // 若任一明细类别为「差旅」则要求必须关联出差申请
        const hasTripItem = validItems.some((it: any) => it.expense_type === '差旅')
        if (hasTripItem && (form.relations || []).filter((r: any) => r.target_type === 'business_trip').length === 0) {
          toast('差旅类报销必须关联已批准的出差申请', 'warning'); return null
        }
        const expenseTotal = validItems.reduce(
          (s, it) => s + (typeof it.amount === 'number' ? it.amount : (parseFloat(it.amount) || 0)),
          0
        )
        // 顶层 expense_type 取第一个有类别的明细（兼容后端 V2 字段）
        const topExpenseType = validItems.find((it: any) => it.expense_type)?.expense_type || '其他'
        return {
          expense_type: topExpenseType,
          title: form.title.trim(),
          amount: Math.round(expenseTotal * 100) / 100,
          amount_unit: form.amount_unit,
          currency: form.currency,
          expense_date: form.expense_date ? toISO(form.expense_date) : new Date().toISOString(),
          reason: form.reason.trim(),
          attachments: form.attachments,
          invoice_entity_id: form.invoice_entity_id,
          priority_offset_loan: !!form.priority_offset_loan,
          items: validItems.map((it: any) => ({
            name: it.name || '',
            expense_type: it.expense_type || '其他',
            department_id: it.department_id || null,
            city: it.city || '',
            expense_date: it.expense_date || null,
            amount: typeof it.amount === 'number' ? it.amount : (parseFloat(it.amount) || 0),
            note: it.note || '',
            remark: it.remark || '',
            attachments: it.attachments || null,
            sort_order: it.sort_order || 0,
          })),
          relations: (form.relations || []).map((r: any) => ({
            target_type: r.target_type,
            target_id: r.target_id,
            relation_note: r.relation_note || '',
          })),
          // 兼容旧字段
          trip_id: hasTripItem
            ? (form.relations || []).find((r: any) => r.target_type === 'business_trip')?.target_id || null
            : null,
        }
      case 'trip':
        if (!form.title.trim()) { toast('请填写出差标题', 'warning'); return null }
        if (!form.destination.trim()) { toast('请填写目的地', 'warning'); return null }
        if (!form.start_date || !form.end_date) { toast('请选择起止时间', 'warning'); return null }
        if (new Date(form.end_date) < new Date(form.start_date)) { toast('结束时间不能早于开始时间', 'warning'); return null }
        return {
          title: form.title.trim(),
          destination: form.destination.trim(),
          transport: '其他',
          start_date: dateSlotToISO(form.start_date, form.start_slot, true),
          end_date: dateSlotToISO(form.end_date, form.end_slot, false),
          days: calcTripDays(form.start_date, form.start_slot, form.end_date, form.end_slot),
          purpose: form.purpose.trim(),
          budget: parseFloat(form.budget) || 0,
          budget_unit: form.budget_unit,
          currency: form.currency,
          attachments: form.attachments,
        }
      case 'purchase':
        if (!form.title.trim()) { toast('请填写采购标题', 'warning'); return null }
        return {
          title: form.title.trim(),
          purchase_type: form.purchase_type,
          supplier_id: form.supplier_id || 0,
          items: null,
          total_amount: parseFloat(form.total_amount) || 0,
          amount_unit: form.amount_unit,
          currency: form.currency,
          expected_date: form.expected_date || null,
          reason: form.reason.trim(),
          attachments: form.attachments,
        }
      default:
        // hire 等复杂表单走独立页面 /hires，不在 OACenterPage 快速创建
        return null
    }
  }

  const save = async () => {
    const body = buildBody()
    if (!body) return
    setSaving(true)
    try {
      // 1. 创建草稿
      const res = await fetch(mod.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.detail || '创建失败')
      }
      const created = await res.json()
      const id = created.id
      if (!id) throw new Error('未返回申请 ID')

      // 2. 提交审批
      const submitRes = await fetch(`${mod.api}/${id}/submit-approval`, { method: 'POST' })
      if (!submitRes.ok) {
        const e = await submitRes.json().catch(() => ({}))
        throw new Error(e.detail || '提交审批失败')
      }
      toast(`${mod.label}已提交审批`, 'success')
      onClose()
    } catch (e: any) {
      toast(e.message || '提交失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const leaveHint = getLeaveHint()
  const inputCls = 'w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15'

  return (
    <Modal
      icon={mod.icon}
      title={`发起${mod.label}`}
      subtitle="填写信息后直接提交审批"
      tone="purple"
      size={type === 'expense' ? '4xl' : 'xl'}
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* ── 请假表单 ── */}
        {type === 'leave' && (
          <>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">请假类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {LEAVE_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => update('leave_type', t)}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.leave_type === t
                        ? 'border-accent-blue text-accent-blue bg-accent-blue/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {leaveHint && (
                <div className={`mt-2 px-3 py-2 rounded-lg border text-[11px] ${
                  leaveHint.tone === 'info' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
                  leaveHint.tone === 'warn' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                  'text-red-400 bg-red-500/10 border-red-500/20'
                }`}>
                  {leaveHint.text}
                </div>
              )}
            </div>
            <Field label="请假事由" required>
              <input value={form.title} onChange={e => update('title', e.target.value)} maxLength={200}
                placeholder="如「家中有事需请假一天」" className={inputCls} />
            </Field>
            {/* 开始时间：日期 + 上午/下午（合并为一个时间点） */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">开始时间 <span className="text-red-400">*</span></label>
              <div className="flex gap-2">
                <input type="date" value={form.start_date}
                  onChange={e => update('start_date', e.target.value)}
                  className={`${inputCls} flex-1`} />
                <div className="inline-flex rounded-lg border border-gray-200 dark:border-border/60 overflow-hidden shrink-0">
                  {(['am', 'pm'] as const).map(s => (
                    <button key={s} type="button" onClick={() => update('start_slot', s)}
                      className={`px-3 text-xs transition-colors ${
                        form.start_slot === s
                          ? 'bg-accent-blue text-white'
                          : 'bg-white dark:bg-bg-input text-gray-500 hover:text-accent-blue'
                      }`}>
                      {s === 'am' ? '上午' : '下午'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* 结束时间：日期 + 上午/下午（合并为一个时间点） */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">结束时间 <span className="text-red-400">*</span></label>
              <div className="flex gap-2">
                <input type="date" value={form.end_date}
                  onChange={e => update('end_date', e.target.value)}
                  className={`${inputCls} flex-1`} />
                <div className="inline-flex rounded-lg border border-gray-200 dark:border-border/60 overflow-hidden shrink-0">
                  {(['am', 'pm'] as const).map(s => (
                    <button key={s} type="button" onClick={() => update('end_slot', s)}
                      className={`px-3 text-xs transition-colors ${
                        form.end_slot === s
                          ? 'bg-accent-blue text-white'
                          : 'bg-white dark:bg-bg-input text-gray-500 hover:text-accent-blue'
                      }`}>
                      {s === 'am' ? '上午' : '下午'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {form.start_date && form.end_date && (() => {
              const days = calcLeaveDays(form.start_date, form.start_slot, form.end_date, form.end_slot)
              if (days <= 0) return (
                <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20 text-[11px] text-red-400">
                  结束时间不能早于开始时间
                </div>
              )
              return (
                <div className="px-3 py-2 rounded-lg bg-accent-blue/5 border border-accent-blue/20 text-[11px] text-accent-blue">
                  请假时长：<span className="font-semibold">{days} 天</span>
                </div>
              )
            })()}
            <Field label="详细说明">
              <textarea value={form.reason} onChange={e => update('reason', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </Field>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">证明附件（可选）</label>
              <FileUpload filesJson={form.attachments} onChange={v => update('attachments', v)} />
            </div>
          </>
        )}

        {/* ── 加班表单 ── */}
        {type === 'overtime' && (
          <>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">补偿方式</label>
              <div className="grid grid-cols-2 gap-2">
                {COMPENSATE_TYPES.map(t => (
                  <button key={t} onClick={() => update('compensate_type', t)}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.compensate_type === t
                        ? 'border-accent-blue text-accent-blue bg-accent-blue/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}>{t}</button>
                ))}
              </div>
            </div>
            <Field label="加班标题" required>
              <input value={form.title} onChange={e => update('title', e.target.value)} maxLength={200}
                placeholder="如「项目上线加班」" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始时间" required>
                <input type="datetime-local" value={form.start_at}
                  onChange={e => { const next: Record<string, any> = { ...form, start_at: e.target.value }; const h = calcHours(next.start_at, next.end_at); if (h > 0) next.hours = String(h); setForm(next) }}
                  className={inputCls} />
              </Field>
              <Field label="结束时间" required>
                <input type="datetime-local" value={form.end_at}
                  onChange={e => { const next: Record<string, any> = { ...form, end_at: e.target.value }; const h = calcHours(next.start_at, next.end_at); if (h > 0) next.hours = String(h); setForm(next) }}
                  className={inputCls} />
              </Field>
            </div>
            <Field label="加班时长（小时）" hint="自动计算，可调整">
              <input type="number" step="0.5" value={form.hours} onChange={e => update('hours', e.target.value)} className={inputCls} />
            </Field>
            <Field label="加班事由">
              <textarea value={form.reason} onChange={e => update('reason', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </Field>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">附件（可选）</label>
              <FileUpload filesJson={form.attachments} onChange={v => update('attachments', v)} />
            </div>
          </>
        )}

        {/* ── 报销表单 V2 ── */}
        {type === 'expense' && (
          <>
            {/* 申请人 / 申请部门 / 申请时间（只读，根据当前登录用户自动填入） */}
            <div className="grid grid-cols-3 gap-3 px-3 py-2.5 rounded-lg bg-bg-hover/40 border border-border">
              <div className="flex items-center gap-2 min-w-0">
                <User size={13} className="text-accent-blue shrink-0" />
                <span className="text-[11px] text-gray-500 shrink-0">申请人</span>
                <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                  {user?.name || '当前用户'}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Building2 size={13} className="text-accent-blue shrink-0" />
                <span className="text-[11px] text-gray-500 shrink-0">申请部门</span>
                <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                  {user?.department_name || '—'}
                </span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Calendar size={13} className="text-accent-blue shrink-0" />
                <span className="text-[11px] text-gray-500 shrink-0 w-[4em]">申请时间</span>
                <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                  {applyTime}
                </span>
              </div>
            </div>

            {/* 发票主体 + 优先抵消 + 关联申请单（同一行三列） */}
            <div className="grid grid-cols-3 gap-3">
              {/* 发票的我方名义 */}
              <div className="flex flex-col">
                <div className="flex items-center h-5 mb-1.5">
                  <label className="block text-xs text-gray-400">
                    发票的我方名义 <span className="text-red-400">*</span>
                  </label>
                </div>
                <SearchableSelect<number>
                  value={form.invoice_entity_id ?? null}
                  onChange={(v) => update('invoice_entity_id', v)}
                  placeholder="请选择公司主体"
                  options={legalEntities.map<SearchableSelectOption>((e) => ({
                    value: e.id,
                    label: e.name,
                    hint: e.short_name,
                    badge: e.is_default ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue text-[10px]">
                        默认
                      </span>
                    ) : undefined,
                  }))}
                  renderTrigger={(sel) => (
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="truncate">{sel?.label}</span>
                      {sel?.hint && <span className="text-gray-400 text-[11px] truncate">· {sel.hint}</span>}
                    </span>
                  )}
                  renderOption={(opt, _active, _selected) => (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{opt.label}</span>
                        {opt.badge}
                      </div>
                      {opt.hint && (
                        <div className="text-[10px] text-gray-400 truncate mt-0.5">简称：{opt.hint}</div>
                      )}
                    </div>
                  )}
                />
              </div>

              {/* 优先抵消借款 */}
              <div className="flex flex-col">
                <div className="flex items-center h-5 mb-1.5">
                  <label className="block text-xs text-gray-400">优先抵消借款</label>
                </div>
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-card cursor-pointer hover:border-accent-blue/50 h-9">
                  <input
                    type="checkbox"
                    checked={!!form.priority_offset_loan}
                    onChange={e => update('priority_offset_loan', e.target.checked)}
                    className="accent-blue w-4 h-4"
                  />
                  <Wallet size={14} className="text-gray-500" />
                  <span className="text-xs text-gray-700 dark:text-gray-300">优先抵消借款</span>
                </label>
              </div>

              {/* 关联申请单 */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between h-5 mb-1.5">
                  <label className="text-xs text-gray-400">
                    关联申请单 {(form.items || []).some((it: any) => it.expense_type === '差旅') && (
                      <span className="text-red-400">*</span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      setRelationDrawer({ open: true, targetType: 'business_trip', candidates: [], loading: true })
                      try {
                        const cands = await expenseService.listRelationCandidates('business_trip')
                        setRelationDrawer((p) => ({ ...p, candidates: cands || [], loading: false }))
                      } catch {
                        setRelationDrawer((p) => ({ ...p, candidates: [], loading: false }))
                      }
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/10 transition-colors"
                  >
                    <Link2 size={10} /> 添加关联
                  </button>
                </div>
                {form.relations.length === 0 ? (
                  <div className="px-3 py-2 rounded-lg bg-bg-hover/40 border border-border text-[11px] text-gray-500 h-9 flex items-center">
                    暂未关联
                  </div>
                ) : (
                  <div className="space-y-1">
                    {form.relations.map((r: any, idx: number) => (
                      <div
                        key={idx}
                        className="px-2 py-1.5 rounded-lg border border-border bg-bg-card flex items-center justify-between"
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <Link2 size={11} className="text-accent-blue shrink-0" />
                          <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate">
                            {r.target_title || `#${r.target_id}`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            update('relations', form.relations.filter((_: any, i: number) => i !== idx))
                          }
                          className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-500/10 shrink-0"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 报销摘要 */}
            <Field label="报销摘要" required>
              <input
                value={form.title}
                onChange={e => update('title', e.target.value)}
                maxLength={200}
                placeholder="如「北京客户拜访差旅报销」"
                className={inputCls}
              />
            </Field>

            {/* 报销明细表格（每行：报销名称、类别、费用使用部门、城市、费用日期、金额、说明、备注、票据） */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400">
                  报销明细 <span className="text-red-400">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <ExcelImport
                    departments={departments}
                    onImported={(rows) => {
                      const merged = [
                        ...form.items,
                        ...rows.map((r, i) => ({
                          name: r.name,
                          expense_type: r.expense_type || '其他',
                          // 优先用 Excel 给的部门名解析成 id；否则默认申请人所在部门
                          department_id: (() => {
                            const m = (r as any).department_name
                              ? departments.find((d) => d.name === (r as any).department_name)
                              : null
                            return m?.id ?? user?.department_id ?? null
                          })(),
                          city: r.city || '',
                          expense_date: r.expense_date ? String(r.expense_date).slice(0, 16) : '',
                          amount: r.amount,
                          note: r.note || '',
                          remark: r.remark || '',
                          attachments: null,
                          sort_order: form.items.length + i,
                        })),
                      ]
                      update('items', merged)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update('items', [
                        ...form.items,
                        {
                          name: '',
                          expense_type: '其他',
                          // 新增明细默认申请人所在部门
                          department_id: user?.department_id ?? null,
                          city: '',
                          expense_date: '',
                          amount: '',
                          note: '',
                          remark: '',
                          attachments: null,
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-accent-blue border border-accent-blue/30 hover:bg-accent-blue/10"
                  >
                    <Plus size={11} /> 添加明细
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-bg-hover/50 text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium w-[60px]">序号</th>
                      <th className="px-2 py-1.5 text-left font-medium w-[130px]">报销名称（类型）</th>
                      <th className="px-2 py-1.5 text-left font-medium w-[130px]">费用使用部门</th>
                      <th className="px-2 py-1.5 text-left font-medium w-[90px]">费用产生城市</th>
                      <th className="px-2 py-1.5 text-left font-medium w-[120px]">费用产生时间</th>
                      <th className="px-2 py-1.5 text-right font-medium w-[110px]">
                        报销金额
                        <span className="block text-[9px] font-normal text-gray-400">可从发票自动识别</span>
                      </th>
                      <th className="px-2 py-1.5 text-left font-medium min-w-[260px]">说明 / 备注</th>
                      <th className="px-2 py-1.5 text-left font-medium w-[180px]">票据 / 发票</th>
                      <th className="px-2 py-1.5 w-[40px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-2 py-4 text-center text-gray-400">
                          点击「添加明细」或「从 Excel 导入」填充报销项
                        </td>
                      </tr>
                    )}
                    {form.items.map((item: any, idx: number) => (
                      <tr key={idx} className="border-t border-border/50 align-top">
                        <td className="px-1 py-1.5 text-center text-gray-400 tabular-nums">{idx + 1}</td>
                        <td className="px-1 py-1">
                          <select
                            value={item.expense_type}
                            onChange={e => {
                              const next = [...form.items]
                              // 类别变更时同步把「name」也设为类别名（避免空白，兼容后端 schema）
                              next[idx] = { ...item, expense_type: e.target.value, name: e.target.value }
                              update('items', next)
                            }}
                            className="w-full px-1.5 py-1 rounded bg-transparent border border-border/60 text-xs outline-none focus:border-accent-blue"
                          >
                            {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={item.department_id ?? ''}
                            onChange={e => {
                              const next = [...form.items]
                              next[idx] = { ...item, department_id: e.target.value ? parseInt(e.target.value) : null }
                              update('items', next)
                            }}
                            className="w-full px-1.5 py-1 rounded bg-transparent border border-border/60 text-xs outline-none focus:border-accent-blue"
                          >
                            <option value="">未指定</option>
                            {departments.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={item.city}
                            placeholder="北京"
                            onChange={e => {
                              const next = [...form.items]
                              next[idx] = { ...item, city: e.target.value }
                              update('items', next)
                            }}
                            className="w-full px-1.5 py-1 rounded bg-transparent border border-border/60 text-xs outline-none focus:border-accent-blue"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="datetime-local"
                            value={item.expense_date}
                            onChange={e => {
                              const next = [...form.items]
                              next[idx] = { ...item, expense_date: e.target.value }
                              update('items', next)
                            }}
                            className="w-full px-1.5 py-1 rounded bg-transparent border border-border/60 text-xs outline-none focus:border-accent-blue"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <div className="relative">
                            <input
                              type="number"
                              step="0.01"
                              value={item.amount}
                              placeholder="0.00"
                              onChange={e => {
                                const next = [...form.items]
                                next[idx] = { ...item, amount: e.target.value }
                                update('items', next)
                              }}
                              className="w-full pl-1.5 pr-7 py-1 rounded bg-transparent border border-border/60 text-xs text-right tabular-nums outline-none focus:border-accent-blue"
                            />
                            {/* AI 识别按钮：扫描已上传票据中的金额 */}
                            {parseAtts(item.attachments).length > 0 && (
                              <button
                                type="button"
                                title="从已上传票据自动识别金额"
                                onClick={async () => {
                                  const result = await aiRecognizeInvoice(parseAtts(item.attachments), fetchWithAuth)
                                  if (result.error) {
                                    toast(`识别失败：${result.error}`, 'error')
                                    return
                                  }
                                  const ai = result.data
                                  if (typeof ai?.amount === 'number' && ai.amount > 0) {
                                    const next = [...form.items]
                                    next[idx] = { ...item, amount: ai.amount }
                                    update('items', next)
                                    toast(`已自动识别金额：¥${ai.amount.toFixed(2)}`, 'success')
                                  } else {
                                    toast('未识别到金额，请手动填写', 'info')
                                  }
                                }}
                                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-accent-blue hover:bg-accent-blue/10"
                              >
                                <Wand2 size={11} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={item.note}
                            placeholder="费用说明 / 备注"
                            onChange={e => {
                              const next = [...form.items]
                              next[idx] = { ...item, note: e.target.value, remark: e.target.value }
                              update('items', next)
                            }}
                            className="w-full px-1.5 py-1 rounded bg-transparent border border-border/60 text-xs outline-none focus:border-accent-blue"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            {(() => {
                              const atts = parseAtts(item.attachments)
                              if (atts.length === 0) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewItemIdx(idx)}
                                    className="flex-1 px-1.5 py-1.5 rounded border border-dashed border-border/60 text-[11px] text-gray-500 hover:border-accent-blue/50 hover:text-accent-blue flex items-center justify-center gap-1"
                                  >
                                    <Paperclip size={11} /> 上传
                                  </button>
                                )
                              }
                              // 票据小缩略图：图片显示缩略图，其他文件显示图标
                              return atts.slice(0, 3).map((a, ai) => {
                                const isImg = a.type.startsWith('image/')
                                return (
                                  <div
                                    key={ai}
                                    className="relative group w-9 h-9 rounded border border-border/60 overflow-hidden bg-bg-hover shrink-0"
                                    title={a.name}
                                  >
                                    {isImg ? (
                                      <AuthedImgInline url={a.url} name={a.name} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-gray-500">
                                        <FileText size={14} />
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setQuickPreview({ itemIdx: idx, fileIdx: ai })}
                                      className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors"
                                      title="一键预览"
                                    >
                                      <Eye size={14} className="text-white opacity-0 group-hover:opacity-100" />
                                    </button>
                                  </div>
                                )
                              })
                            })()}
                            {parseAtts(item.attachments).length > 3 && (
                              <span className="text-[10px] text-gray-400 self-center">
                                +{parseAtts(item.attachments).length - 3}
                              </span>
                            )}
                            {parseAtts(item.attachments).length > 0 && (
                              <button
                                type="button"
                                onClick={() => setPreviewItemIdx(idx)}
                                className="px-1.5 py-1 rounded text-[10px] text-accent-blue hover:bg-accent-blue/10 inline-flex items-center gap-0.5"
                                title="管理票据"
                              >
                                <Plus size={10} />{parseAtts(item.attachments).length}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              update('items', form.items.filter((_: any, i: number) => i !== idx))
                            }
                            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-500/10"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {form.items.length > 0 && (
                    <tfoot className="bg-bg-hover/30 border-t border-border">
                      <tr>
                        <td colSpan={5} className="px-2 py-1.5 text-right text-gray-500 font-medium">合计</td>
                        <td className="px-2 py-1.5 text-right font-bold text-accent-blue tabular-nums">
                          {form.items
                            .reduce(
                              (s: number, it: any) => s + (typeof it.amount === 'number' ? it.amount : (parseFloat(it.amount) || 0)),
                              0
                            )
                            .toFixed(2)}
                        </td>
                        <td colSpan={3} className="px-2 py-1.5 text-gray-500">
                          {form.amount_unit} {form.currency} · 共 {form.items.length} 条
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* 说明备注 */}
            <Field label="说明备注">
              <textarea
                value={form.reason}
                onChange={e => update('reason', e.target.value)}
                rows={2}
                placeholder="如费用产生背景、报销原因等"
                className={`${inputCls} resize-none`}
              />
            </Field>

            {/* 底部统计：实时计算 */}
            <ExpenseStatistics
              items={form.items}
              priorityOffset={!!form.priority_offset_loan}
              activeLoansTotal={myLoans.reduce((s, l) => s + l.remaining, 0)}
            />

            {/* 个人欠款情况（汇总） */}
            {form.invoice_entity_id && myLoans.length > 0 && (
              <div className="px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-center justify-between">
                <div className="text-[11px] text-amber-500">
                  个人欠款（{myLoans.length} 笔未结清）
                </div>
                <div className="text-sm tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                  ¥{myLoans.reduce((s, l) => s + l.remaining, 0).toFixed(2)}
                </div>
              </div>
            )}

            {/* 关联申请单抽屉 */}
            {relationDrawer.open && (
              <RelationDrawer
                targetType={relationDrawer.targetType}
                candidates={relationDrawer.candidates}
                loading={relationDrawer.loading}
                existing={form.relations}
                onClose={() => setRelationDrawer((p) => ({ ...p, open: false }))}
                onConfirm={(rels) => {
                  update('relations', rels)
                  setRelationDrawer((p) => ({ ...p, open: false }))
                }}
                onChangeType={async (t) => {
                  setRelationDrawer((p) => ({ ...p, targetType: t, loading: true, candidates: [] }))
                  try {
                    const cands = await expenseService.listRelationCandidates(t)
                    setRelationDrawer((p) => ({ ...p, candidates: cands || [], loading: false }))
                  } catch {
                    setRelationDrawer((p) => ({ ...p, candidates: [], loading: false }))
                  }
                }}
              />
            )}

            {/* 一键全屏预览（点击缩略图直接显示） */}
            {quickPreview && form.items[quickPreview.itemIdx] && (
              <QuickPreview
                file={parseAtts(form.items[quickPreview.itemIdx].attachments)[quickPreview.fileIdx]}
                files={parseAtts(form.items[quickPreview.itemIdx].attachments)}
                onChange={(v) => {
                  const next = [...form.items]
                  next[quickPreview.itemIdx] = { ...next[quickPreview.itemIdx], attachments: v }
                  update('items', next)
                }}
                itemName={form.items[quickPreview.itemIdx].name}
                onClose={() => setQuickPreview(null)}
                onManage={() => {
                  setPreviewItemIdx(quickPreview.itemIdx)
                  setQuickPreview(null)
                }}
              />
            )}

            {/* 票据预览/编辑弹窗（按明细） */}
            {previewItemIdx !== null && form.items[previewItemIdx] && (
              <ItemAttachmentDialog
                item={form.items[previewItemIdx]}
                onClose={() => setPreviewItemIdx(null)}
                onChange={(v) => {
                  const next = [...form.items]
                  next[previewItemIdx] = { ...next[previewItemIdx], attachments: v }
                  update('items', next)
                }}
                onRecognize={async (atts) => {
                  // AI 自动识别：上传票据图片走 vision 模型，把识别结果填到对应字段
                  const result = await aiRecognizeInvoice(atts, fetchWithAuth)
                  if (result.error) {
                    toast(`识别失败：${result.error}`, 'error')
                    return
                  }
                  const ai = result.data
                  if (!ai) { toast('未识别到有效信息', 'info'); return }
                  const next = [...form.items]
                  const cur = { ...next[previewItemIdx] }
                  if (ai.expense_type && !cur.expense_type) cur.expense_type = ai.expense_type
                  if (ai.expense_date && !cur.expense_date) cur.expense_date = String(ai.expense_date).slice(0, 16)
                  if (typeof ai.amount === 'number' && !cur.amount) cur.amount = ai.amount
                  if (ai.city && !cur.city) cur.city = ai.city
                  if (ai.note && !cur.note) cur.note = ai.note
                  next[previewItemIdx] = cur
                  update('items', next)
                  toast('已自动填入识别结果（仅填充空白字段）', 'success')
                }}
              />
            )}
          </>
        )}

        {/* ── 出差表单 ── */}
        {type === 'trip' && (
          <>
            <Field label="出差标题" required>
              <input value={form.title} onChange={e => update('title', e.target.value)} maxLength={200}
                placeholder="如「上海客户拜访」" className={inputCls} />
            </Field>
            <Field label="目的地" required>
              <input value={form.destination} onChange={e => update('destination', e.target.value)} className={inputCls} />
            </Field>
            {/* 开始时间：日期 + 上午/下午 */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">开始时间 <span className="text-red-400">*</span></label>
              <div className="flex gap-2">
                <input type="date" value={form.start_date}
                  onChange={e => { const next: Record<string, any> = { ...form, start_date: e.target.value }; const d = calcTripDays(next.start_date, next.start_slot, next.end_date, next.end_slot); next.days = d > 0 ? String(d) : ''; setForm(next) }}
                  className={`${inputCls} flex-1`} />
                <div className="inline-flex rounded-lg border border-gray-200 dark:border-border/60 overflow-hidden shrink-0">
                  {(['am', 'pm'] as const).map(s => (
                    <button key={s} type="button" onClick={() => { const next: Record<string, any> = { ...form, start_slot: s }; const d = calcTripDays(next.start_date, next.start_slot, next.end_date, next.end_slot); next.days = d > 0 ? String(d) : ''; setForm(next) }}
                      className={`px-3 text-xs transition-colors ${
                        form.start_slot === s
                          ? 'bg-accent-blue text-white'
                          : 'bg-white dark:bg-bg-input text-gray-500 hover:text-accent-blue'
                      }`}>
                      {s === 'am' ? '上午' : '下午'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* 结束时间：日期 + 上午/下午 */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">结束时间 <span className="text-red-400">*</span></label>
              <div className="flex gap-2">
                <input type="date" value={form.end_date}
                  onChange={e => { const next: Record<string, any> = { ...form, end_date: e.target.value }; const d = calcTripDays(next.start_date, next.start_slot, next.end_date, next.end_slot); next.days = d > 0 ? String(d) : ''; setForm(next) }}
                  className={`${inputCls} flex-1`} />
                <div className="inline-flex rounded-lg border border-gray-200 dark:border-border/60 overflow-hidden shrink-0">
                  {(['am', 'pm'] as const).map(s => (
                    <button key={s} type="button" onClick={() => { const next: Record<string, any> = { ...form, end_slot: s }; const d = calcTripDays(next.start_date, next.start_slot, next.end_date, next.end_slot); next.days = d > 0 ? String(d) : ''; setForm(next) }}
                      className={`px-3 text-xs transition-colors ${
                        form.end_slot === s
                          ? 'bg-accent-blue text-white'
                          : 'bg-white dark:bg-bg-input text-gray-500 hover:text-accent-blue'
                      }`}>
                      {s === 'am' ? '上午' : '下午'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {form.start_date && form.end_date && (() => {
              const d = calcTripDays(form.start_date, form.start_slot, form.end_date, form.end_slot)
              if (d <= 0) return (
                <div className="px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20 text-[11px] text-red-400">
                  结束时间不能早于开始时间
                </div>
              )
              return (
                <div className="px-3 py-2 rounded-lg bg-accent-blue/5 border border-accent-blue/20 text-[11px] text-accent-blue">
                  出差天数：<span className="font-semibold">{d} 天</span>
                </div>
              )
            })()}
            <div className="grid grid-cols-2 gap-3">
              <Field label="预算">
                <input type="number" step="0.01" value={form.budget} onChange={e => update('budget', e.target.value)} className={inputCls} />
              </Field>
              <Field label="预算单位">
                <select value={form.budget_unit} onChange={e => update('budget_unit', e.target.value)} className={inputCls}>
                  {AMOUNT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
            </div>
            <Field label="出差事由">
              <textarea value={form.purpose} onChange={e => update('purpose', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </Field>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">附件（可选）</label>
              <FileUpload filesJson={form.attachments} onChange={v => update('attachments', v)} />
            </div>
          </>
        )}

        {/* ── 采购表单 ── */}
        {type === 'purchase' && (
          <>
            <Field label="采购标题" required>
              <input value={form.title} onChange={e => update('title', e.target.value)} maxLength={200}
                placeholder="如「办公电脑采购」" className={inputCls} />
            </Field>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">采购类型</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PURCHASE_TYPES.map(t => (
                  <button key={t} onClick={() => update('purchase_type', t)}
                    className={`py-2 rounded-lg text-xs border transition-colors ${
                      form.purchase_type === t
                        ? 'border-accent-blue text-accent-blue bg-accent-blue/10'
                        : 'border-border text-gray-400 hover:bg-bg-hover'
                    }`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="总金额">
                <input type="number" step="0.01" value={form.total_amount} onChange={e => update('total_amount', e.target.value)} className={inputCls} />
              </Field>
              <Field label="单位">
                <select value={form.amount_unit} onChange={e => update('amount_unit', e.target.value)} className={inputCls}>
                  {AMOUNT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="币种">
                <select value={form.currency} onChange={e => update('currency', e.target.value)} className={inputCls}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <Field label="期望到货日期">
              <input type="date" value={form.expected_date} onChange={e => update('expected_date', e.target.value)} className={inputCls} />
            </Field>
            <Field label="采购事由">
              <textarea value={form.reason} onChange={e => update('reason', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </Field>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">附件（可选，报价单等）</label>
              <FileUpload filesJson={form.attachments} onChange={v => update('attachments', v)} />
            </div>
          </>
        )}

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border bg-bg-card text-xs font-medium text-gray-600 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue transition-colors">
            取消
          </button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 transition-all">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            提交审批
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ════════════════════════════════════════════
   报销 V2：底部统计（实时计算）
════════════════════════════════════════════ */
function ExpenseStatistics({
  items,
  priorityOffset,
  activeLoansTotal,
}: {
  items: Array<{ amount: string | number }>
  priorityOffset: boolean
  activeLoansTotal: number
}) {
  const total = items.reduce(
    (s, it) => s + (typeof it.amount === 'number' ? it.amount : (parseFloat(it.amount as string) || 0)),
    0
  )
  const offset = priorityOffset ? Math.min(total, activeLoansTotal) : 0
  const shouldPay = Math.max(0, total - offset)
  return (
    <div className="px-3 py-2.5 rounded-lg border border-border bg-bg-hover/30">
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <div className="text-[11px] text-gray-500">票据总金额</div>
          <div className="font-semibold tabular-nums">¥{total.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-500">抵消借款</div>
          <div className="font-semibold tabular-nums text-amber-500">¥{offset.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-500">公司应支付</div>
          <div className="font-semibold tabular-nums text-emerald-500">¥{shouldPay.toFixed(2)}</div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════
   报销 V2：关联申请单抽屉
════════════════════════════════════════════ */
function RelationDrawer({
  targetType,
  candidates,
  loading,
  existing,
  onClose,
  onConfirm,
  onChangeType,
}: {
  targetType: 'business_trip' | 'leave' | 'purchase'
  candidates: RelationCandidate[]
  loading: boolean
  existing: Array<{ target_type: string; target_id: number; target_title?: string }>
  onClose: () => void
  onConfirm: (rels: any[]) => void
  onChangeType: (t: 'business_trip' | 'leave' | 'purchase') => void
}) {
  const [picked, setPicked] = useState<Set<number>>(
    new Set(existing.filter((e) => e.target_type === targetType).map((e) => e.target_id))
  )
  // 当抽屉打开时重置已选
  useEffect(() => {
    setPicked(new Set(existing.filter((e) => e.target_type === targetType).map((e) => e.target_id)))
  }, [targetType, existing])

  const toggle = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirm = () => {
    // 保留其他类型已选项 + 本次新选
    const others = existing.filter((e) => e.target_type !== targetType)
    const newOnes = candidates
      .filter((c) => picked.has(c.id))
      .map((c) => ({
        target_type: targetType,
        target_id: c.id,
        relation_note: '',
        target_title: c.title,
        target_meta: c,
      }))
    onConfirm([...others, ...newOnes])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-card rounded-xl shadow-2xl w-[520px] max-w-[92vw] max-h-[80vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">选择关联申请单</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-gray-500">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-auto">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-gray-500">类型</span>
            {(['business_trip', 'leave', 'purchase'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChangeType(t)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  targetType === t
                    ? 'bg-accent-blue text-white'
                    : 'border border-border text-gray-500 hover:text-accent-blue hover:border-accent-blue/50'
                }`}
              >
                {t === 'business_trip' ? '出差' : t === 'leave' ? '请假' : '采购'}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="py-8 text-center text-gray-400 text-xs">加载中…</div>
          ) : candidates.length === 0 ? (
            <div className="px-3 py-6 rounded-lg bg-bg-hover/40 border border-border text-xs text-gray-500 text-center">
              暂无可关联的{ targetType === 'business_trip' ? '出差' : targetType === 'leave' ? '请假' : '采购'}申请
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              {candidates.map((c) => {
                const checked = picked.has(c.id)
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 px-3 py-2 border-b border-border/50 last:border-b-0 cursor-pointer hover:bg-bg-hover/40"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      className="accent-blue w-4 h-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{c.title}</div>
                      {targetType === 'business_trip' && (
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {c.destination} · {c.start_date} → {c.end_date} · 预算 ¥{c.budget?.toFixed?.(2) || c.budget}
                        </div>
                      )}
                      {targetType === 'leave' && (
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {c.leave_type} · {c.hours} 小时 · {c.start_at?.slice(0, 10)} → {c.end_at?.slice(0, 10)}
                        </div>
                      )}
                      {targetType === 'purchase' && (
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {c.purchase_type} · ¥{c.total_amount?.toFixed?.(2) || c.total_amount} · {c.status}
                        </div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-lg border border-border bg-bg-card text-gray-600 hover:border-accent-blue/50 hover:text-accent-blue"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={picked.size === 0}
            className="px-4 py-1.5 text-xs rounded-lg bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-50"
          >
            关联 {picked.size > 0 && `(${picked.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════
   报销 V2：单条明细的票据/附件弹窗（上传、预览、AI 识别）
════════════════════════════════════════════ */
interface ItemAtt {
  name: string
  path: string
  size: number
  type: string
  url: string
}

function parseAtts(json: string | null | undefined): ItemAtt[] {
  if (!json) return []
  try { return JSON.parse(json) as ItemAtt[] } catch { return [] }
}

type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

/** 发票 AI 识别：上传实际图片/PDF 到 /api/v1/ai/invoice-ocr 走 vision 模型
 *  返回 { data, error }：data 为识别结果，error 为错误信息（供调用方提示用户）
 */
async function aiRecognizeInvoice(
  atts: ItemAtt[],
  fetchWithAuth: FetchWithAuth,
): Promise<{
  data?: {
    expense_type?: string
    amount?: number
    expense_date?: string
    city?: string
    note?: string
    invoice_no?: string
    seller?: string
  }
  error?: string
}> {
  if (!atts || atts.length === 0) return { error: '没有附件可识别' }
  // 筛选可识别的文件：图片 + PDF
  const recognizable = atts.filter((a) => a.type.startsWith('image/') || a.type === 'application/pdf')
  if (recognizable.length === 0) return { error: '仅支持图片和 PDF 文件识别' }

  // 逐个识别，取第一个有效结果（多张票据时合并金额）
  let bestResult: Record<string, any> | null = null
  let totalAmount = 0
  let lastError = ''
  for (const att of recognizable) {
    try {
      // 1) 用 fetchWithAuth 获取认证后的文件 blob
      const resp = await fetchWithAuth(att.url)
      if (!resp.ok) { lastError = `下载文件失败(${resp.status})`; continue }
      const blob = await resp.blob()
      // 2) 构建 FormData 上传到发票识别端点
      const formData = new FormData()
      formData.append('file', blob, att.name)
      formData.append('hint', '')
      const apiResp = await fetchWithAuth('/api/v1/ai/invoice-ocr', {
        method: 'POST',
        body: formData,
      })
      if (!apiResp.ok) {
        // 读取后端返回的错误详情
        try {
          const errBody = await apiResp.json()
          lastError = errBody?.detail || `识别失败(${apiResp.status})`
        } catch {
          lastError = `识别失败(${apiResp.status})`
        }
        continue
      }
      const json = await apiResp.json()
      const data = json?.data
      if (!data) { lastError = '返回数据为空'; continue }
      // 合并结果：取第一个有效值，金额累加
      if (!bestResult) bestResult = {}
      if (!bestResult.expense_type && data.expense_type) bestResult.expense_type = data.expense_type
      if (!bestResult.expense_date && data.expense_date) bestResult.expense_date = data.expense_date
      if (!bestResult.city && data.city) bestResult.city = data.city
      if (!bestResult.note && data.note) bestResult.note = data.note
      if (!bestResult.invoice_no && data.invoice_no) bestResult.invoice_no = data.invoice_no
      if (!bestResult.seller && data.seller) bestResult.seller = data.seller
      if (typeof data.amount === 'number' && data.amount > 0) totalAmount += data.amount
    } catch (e: any) {
      lastError = e?.message || '网络异常'
    }
  }
  if (!bestResult && totalAmount === 0) return { error: lastError || '未识别到有效信息' }
  if (totalAmount > 0) bestResult = bestResult || {}
  if (bestResult) {
    bestResult.amount = totalAmount > 0 ? totalAmount : undefined
  }
  return { data: bestResult as any }
}

function ItemAttachmentDialog({
  item,
  onClose,
  onChange,
  onRecognize,
}: {
  item: { name: string; attachments: string | null }
  onClose: () => void
  onChange: (v: string | null) => void
  onRecognize: (atts: ItemAtt[]) => Promise<void>
}) {
  const atts = parseAtts(item.attachments)
  const [preview, setPreview] = useState<ItemAtt | null>(null)
  const [recognizing, setRecognizing] = useState(false)

  const handleRecognize = async () => {
    setRecognizing(true)
    try {
      await onRecognize(atts)
    } finally {
      setRecognizing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-card rounded-xl shadow-2xl w-[640px] max-w-[92vw] max-h-[88vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">票据 / 附件</h3>
            {item.name && (
              <p className="text-[11px] text-gray-500 mt-0.5">所属明细：{item.name}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-gray-500">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-auto space-y-4">
          {/* 当前票据缩略图网格 */}
          {atts.length > 0 && (
            <div>
              <div className="text-[11px] text-gray-500 mb-1.5">已上传 {atts.length} 个文件</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {atts.map((a, i) => {
                  const isImg = a.type.startsWith('image/')
                  return (
                    <div
                      key={i}
                      onClick={() => setPreview(a)}
                      className="group relative aspect-square rounded-lg border border-border bg-bg-hover overflow-hidden cursor-pointer hover:border-accent-blue/50"
                      title={a.name}
                    >
                      {isImg ? (
                        <AuthedImgInline url={a.url} alt={a.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 p-2">
                          <Paperclip size={20} />
                          <span className="text-[10px] mt-1 truncate w-full text-center">{a.name}</span>
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 bg-black/60 text-[10px] text-white truncate">
                        {a.name}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          const next = atts.filter((_, idx) => idx !== i)
                          onChange(next.length > 0 ? JSON.stringify(next) : null)
                        }}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="删除"
                      >
                        <X size={10} className="text-white" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 上传组件（复用全局 FileUpload，通过 onChange 写回 items[i].attachments） */}
          <div>
            <div className="text-[11px] text-gray-500 mb-1.5">添加更多票据</div>
            <FileUpload filesJson={item.attachments} onChange={onChange} />
          </div>

          {/* AI 识别按钮 */}
          <div className="px-3 py-2.5 rounded-lg border border-accent-blue/30 bg-accent-blue/5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-accent-blue flex items-center gap-1">
                <Sparkles size={12} /> AI 智能识别
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                上传票据图片自动识别类别、金额、日期、城市（仅填充空白字段）
              </div>
            </div>
            <button
              type="button"
              disabled={recognizing || atts.length === 0}
              onClick={handleRecognize}
              className="px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
            >
              {recognizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              开始识别
            </button>
          </div>

          {/* 票据全屏预览 */}
          {preview && (
            <div className="fixed inset-0 z-[60] bg-black/85 flex flex-col items-center justify-center p-4" onClick={() => setPreview(null)}>
              <button
                onClick={() => setPreview(null)}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
              >
                <X size={18} />
              </button>
              <div className="text-white text-xs mb-2">{preview.name}</div>
              {preview.type.startsWith('image/') ? (
                <AuthedImgInline url={preview.url} alt={preview.name} className="max-w-[92vw] max-h-[82vh] object-contain" />
              ) : (
                <div className="text-white/80 text-sm">该文件类型不支持在线预览，请下载查看</div>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded-lg bg-accent-blue text-white hover:bg-blue-600"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════
   一键全屏预览（点击缩略图立即显示原图）
════════════════════════════════════════════ */
function QuickPreview({
  file,
  files,
  onChange,
  itemName,
  onClose,
  onManage,
}: {
  file: ItemAtt | null
  files: ItemAtt[]
  onChange: (v: string | null) => void
  itemName: string
  onClose: () => void
  onManage: () => void
}) {
  // 当前展示的文件索引（默认 0）
  const [idx, setIdx] = useState(0)
  // 同步：父组件传入的 file 变化时（不同缩略图点击），切换 idx
  useEffect(() => {
    if (file && files.length > 0) {
      const found = files.findIndex((f) => f.url === file.url)
      if (found >= 0) setIdx(found)
    }
  }, [file?.url, files.length])

  const cur = files[idx]

  // 键盘：← → 切换文件；Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && idx > 0) setIdx(idx - 1)
      else if (e.key === 'ArrowRight' && idx < files.length - 1) setIdx(idx + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, files.length, onClose])

  if (!cur) return null
  const isImg = cur.type.startsWith('image/')

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col"
      onClick={onClose}
    >
      {/* 顶部工具条 */}
      <div className="px-4 py-2.5 flex items-center justify-between text-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">
            {itemName && <span className="text-white/60 mr-2">{itemName}</span>}
            {cur.name}
          </span>
          {files.length > 1 && (
            <span className="text-[11px] text-white/50 shrink-0">{idx + 1} / {files.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onManage}
            className="px-2.5 py-1 rounded text-[11px] bg-white/10 hover:bg-white/20 inline-flex items-center gap-1"
            title="管理 / 上传更多"
          >
            <Paperclip size={11} /> 管理票据
          </button>
          <button
            onClick={() => {
              const next = files.filter((_, i) => i !== idx)
              onChange(next.length > 0 ? JSON.stringify(next) : null)
              if (next.length === 0) onClose()
              else if (idx >= next.length) setIdx(next.length - 1)
            }}
            className="px-2.5 py-1 rounded text-[11px] bg-red-500/80 hover:bg-red-500 inline-flex items-center gap-1"
            title="删除当前文件"
          >
            <X size={11} /> 删除
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10"
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {/* 主预览区 */}
      <div className="flex-1 flex items-center justify-center px-12 py-2 min-h-0 relative" onClick={(e) => e.stopPropagation()}>
        {files.length > 1 && (
          <button
            onClick={() => idx > 0 && setIdx(idx - 1)}
            disabled={idx === 0}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30"
            title="上一个 (←)"
          >
            <ChevronDown size={20} className="rotate-90" />
          </button>
        )}
        {isImg ? (
          <AuthedImgInline url={cur.url} name={cur.name} className="max-w-full max-h-full object-contain" />
        ) : (
          <div className="text-center text-white/80">
            <FileText size={48} className="mx-auto mb-3 text-white/40" />
            <p className="text-sm">{cur.name}</p>
            <p className="text-xs text-white/50 mt-1">该文件类型不支持在线预览</p>
          </div>
        )}
        {files.length > 1 && (
          <button
            onClick={() => idx < files.length - 1 && setIdx(idx + 1)}
            disabled={idx === files.length - 1}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30"
            title="下一个 (→)"
          >
            <ChevronDown size={20} className="-rotate-90" />
          </button>
        )}
      </div>
      {/* 底部缩略图条 */}
      {files.length > 1 && (
        <div className="px-4 py-2 flex items-center gap-1.5 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
          {files.map((f, fi) => {
            const isImg2 = f.type.startsWith('image/')
            return (
              <button
                key={fi}
                onClick={() => setIdx(fi)}
                className={`shrink-0 w-12 h-12 rounded overflow-hidden border-2 ${fi === idx ? 'border-accent-blue' : 'border-white/20 hover:border-white/50'}`}
                title={f.name}
              >
                {isImg2 ? (
                  <AuthedImgInline url={f.url} name={f.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/10 flex items-center justify-center text-white/60">
                    <FileText size={14} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* 在弹窗内使用的带认证的图像展示（避免影响 FileUpload 中已有的版本） */
function AuthedImgInline({ url, alt, name, className }: { url: string; alt?: string; name?: string; className?: string }) {
  const { fetchWithAuth } = useAuth()
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl = ''
    fetchWithAuth(url)
      .then((r) => r.blob())
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      })
      .catch(() => {})
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [url, fetchWithAuth])
  if (!blobUrl) return <div className={className} />
  return <img src={blobUrl} alt={alt || name || ''} className={className} />
}
