import { useState, useEffect, useCallback } from 'react'
import {
  GitBranch, Plus, Edit3, Trash2, Loader2, Power, PowerOff,
  ChevronUp, ChevronDown, X, User, Shield, Users, Building2,
  FileText, Wallet, Stamp, Calculator, Briefcase, Layers,
  CheckCircle2, AlertCircle,
} from 'lucide-react'
import { Modal, ModalFooter } from '../components/design-system'
import SearchableSelect from '../components/SearchableSelect'
import { useToast } from '../contexts/ToastContext'
import { apiFetch, apiPost, apiPut, apiDelete } from '../services/api'

/* ──── 类型 ─── */
interface ApprovalNode {
  name: string
  approver_type: 'role' | 'leader' | 'dept_manager' | 'dept_or_leader' | 'user'
  approver_value: string
  order: number
  node_kind?: string
  action_label?: string
}
interface ApprovalFlow {
  id: number
  code: string
  name: string
  business_type: string
  description: string
  is_active: boolean
  is_system: boolean
  trigger_condition: { field: string; op: string; value: string | number } | null
  nodes: ApprovalNode[]
}
interface Role { id: number; code: string; name: string }
interface UserBrief { id: number; name: string; username: string; department_name?: string | null }

/* ──── 业务类型映射 ──── */
const BUSINESS_TYPES = [
  { value: 'contract',          label: '合同审批',       icon: FileText,    color: '#4B5563' },
  { value: 'payment',           label: '付款申请审批',   icon: Wallet,      color: '#4B5563' },
  { value: 'seal',              label: '盖章申请审批',   icon: Stamp,       color: '#4B5563' },
  { value: 'reconcile_summary', label: '财务月结复核',   icon: Calculator,  color: '#4B5563' },
  { value: 'supplier',          label: '供应商入驻审批', icon: Layers,      color: '#4B5563' },
  { value: 'channel',           label: '通道价格变更审批', icon: Briefcase, color: '#4B5563' },
  { value: 'project',           label: '项目立项审批',   icon: Briefcase,   color: '#4B5563' },
]

const BIZ_TYPE_MAP: Record<string, typeof BUSINESS_TYPES[number]> = Object.fromEntries(
  BUSINESS_TYPES.map(t => [t.value, t])
)

const APPROVER_TYPES = [
  { value: 'role',          label: '按角色',     icon: Shield,      desc: '持有该角色的全部用户（任一审批通过即可）' },
  { value: 'user',          label: '指定用户',   icon: User,        desc: '指定一个固定的审批人' },
  { value: 'leader',        label: '直属上级',   icon: Users,       desc: '发起人的直属上级（动态解析）' },
  { value: 'dept_manager',  label: '部门负责人', icon: Building2,   desc: '发起人所属部门的负责人（动态解析）' },
  { value: 'dept_or_leader',label: '部门负责人或上级', icon: Users, desc: '优先部门负责人，无则取直属上级（动态解析）' },
] as const

/* ──── 主页面 ──── */
export default function ApprovalFlowsPage() {
  const { toast } = useToast()
  const [flows, setFlows] = useState<ApprovalFlow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [users, setUsers] = useState<UserBrief[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ApprovalFlow | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [fs, rs, us] = await Promise.all([
        apiFetch<ApprovalFlow[]>('/api/v1/approvals/flows').catch(() => []),
        apiFetch<Role[]>('/api/v1/roles').catch(() => []),
        apiFetch<UserBrief[]>('/api/v1/users').catch(() => []),
      ])
      setFlows(Array.isArray(fs) ? fs : [])
      setRoles(Array.isArray(rs) ? rs : [])
      setUsers(Array.isArray(us) ? us : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleToggle = async (flow: ApprovalFlow) => {
    try {
      await apiFetch(`/api/v1/approvals/flows/${flow.id}/toggle`, { method: 'PATCH' })
      toast(`已${flow.is_active ? '停用' : '启用'}「${flow.name}」`, 'success')
      loadData()
    } catch (e) { toast(String(e), 'error') }
  }

  const handleDelete = async (flow: ApprovalFlow) => {
    if (!confirm(`确认删除审批流「${flow.name}」？已发起的审批实例不受影响。`)) return
    try {
      await apiDelete(`/api/v1/approvals/flows/${flow.id}`)
      toast('已删除', 'success')
      loadData()
    } catch (e) { toast(String(e), 'error') }
  }

  // 按业务类型分组
  const grouped = BUSINESS_TYPES
    .filter(bt => flows.some(f => f.business_type === bt.value))
    .map(bt => ({
      ...bt,
      flows: flows.filter(f => f.business_type === bt.value),
    }))
  // 未匹配的业务类型
  const otherTypes = flows.filter(f => !BIZ_TYPE_MAP[f.business_type])
  if (otherTypes.length > 0) {
    grouped.push({
      value: '__other__',
      label: '其他',
      icon: GitBranch,
      color: '#6B7280',
      flows: otherTypes,
    })
  }

  return (
    <div>
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <GitBranch size={20} className="text-gray-700 dark:text-gray-300" />
            审批流配置
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">为不同业务场景配置多级审批节点，支持按角色、指定用户、直属上级、部门负责人等方式</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-accent-blue rounded-lg hover:bg-blue-600 transition-colors"
        >
          <Plus size={14} />新建审批流
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" />加载中…
        </div>
      ) : flows.length === 0 ? (
        <div className="text-center py-20">
          <GitBranch size={40} className="mx-auto text-gray-300 dark:text-gray-700 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">还没有审批流配置</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">点击右上角「新建审批流」开始配置</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <div key={group.value}>
              {/* 分组标题 */}
              <div className="flex items-center gap-2 mb-3">
                <group.icon size={16} className="text-gray-600 dark:text-gray-400" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{group.label}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-600">({group.flows.length})</span>
              </div>

              <div className="space-y-3">
                {group.flows.map(flow => (
                  <FlowCard
                    key={flow.id}
                    flow={flow}
                    roles={roles}
                    users={users}
                    onEdit={() => { setEditing(flow); setShowForm(true) }}
                    onToggle={() => handleToggle(flow)}
                    onDelete={() => handleDelete(flow)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <FlowFormModal
          flow={editing}
          roles={roles}
          users={users}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadData() }}
        />
      )}
    </div>
  )
}

/* ──── 审批流卡片 ──── */
function FlowCard({
  flow, roles, users, onEdit, onToggle, onDelete,
}: {
  flow: ApprovalFlow
  roles: Role[]
  users: UserBrief[]
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const roleMap = Object.fromEntries(roles.map(r => [r.code, r.name]))
  const userMap = Object.fromEntries(users.map(u => [String(u.id), u.name || u.username]))
  const bizType = BIZ_TYPE_MAP[flow.business_type]

  return (
    <div className={`rounded-xl border transition-all ${
      flow.is_active
        ? 'border-border bg-bg-card hover:bg-bg-hover/50'
        : 'border-border bg-bg-card opacity-50'
    }`}>
      <div className="p-4">
        {/* 卡片头部 */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {bizType && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-gray-600 dark:text-gray-400 bg-bg-hover"
                >
                  <bizType.icon size={11} />
                  {bizType.label}
                </span>
              )}
              <span className="text-sm font-bold text-gray-900 dark:text-white">{flow.name}</span>
              {flow.is_system && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue font-medium border border-accent-blue/20">
                  系统预置
                </span>
              )}
            </div>
            {flow.description && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed line-clamp-2">{flow.description}</p>
            )}
            {flow.trigger_condition && (
              <div className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                <AlertCircle size={10} className="text-amber-600 dark:text-amber-400" />
                <span className="text-[10px] text-amber-700 dark:text-amber-400">
                  触发条件: {flow.trigger_condition.field} {flow.trigger_condition.op} {flow.trigger_condition.value}
                </span>
              </div>
            )}
          </div>

          {/* 状态 + 操作 */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[11px] px-2 py-1 rounded-lg font-medium flex items-center gap-1 ${
              flow.is_active
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                : 'bg-gray-100 dark:bg-gray-500/10 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-500/20'
            }`}>
              {flow.is_active ? <CheckCircle2 size={11} /> : <X size={11} />}
              {flow.is_active ? '启用' : '已停用'}
            </span>
            <button onClick={onToggle}
              className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white hover:bg-bg-hover transition-colors"
              title={flow.is_active ? '停用' : '启用'}>
              {flow.is_active ? <PowerOff size={14} /> : <Power size={14} />}
            </button>
            <button onClick={onEdit}
              className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-accent-blue hover:bg-accent-blue/10 transition-colors">
              <Edit3 size={14} />
            </button>
            {!flow.is_system && (
              <button onClick={onDelete}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-colors">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* 节点流程图 */}
        {flow.nodes.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center gap-0 flex-wrap">
              {flow.nodes.map((node, i) => {
                const typeLabel = APPROVER_TYPES.find(t => t.value === node.approver_type)?.label || node.approver_type
                const valueLabel = node.approver_type === 'role'
                  ? (roleMap[node.approver_value] || node.approver_value)
                  : node.approver_type === 'user'
                  ? (userMap[node.approver_value] || `用户${node.approver_value}`)
                  : ''
                return (
                  <div key={i} className="flex items-center">
                    <div className="rounded-lg px-3 py-2 text-[11px] border border-border bg-bg-hover">
                      <div className="font-semibold text-gray-900 dark:text-white">
                        <span className="text-[10px] text-gray-400 mr-1">{i + 1}.</span>
                        {node.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        {(() => {
                          const at = APPROVER_TYPES.find(t => t.value === node.approver_type)
                          return at ? <at.icon size={9} /> : null
                        })()}
                        <span>{typeLabel}</span>
                        {valueLabel && <span>· {valueLabel}</span>}
                      </div>
                      {node.node_kind === 'execution' && node.action_label && (
                        <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">执行: {node.action_label}</div>
                      )}
                    </div>
                    {i < flow.nodes.length - 1 && (
                      <div className="px-1.5 text-gray-400 dark:text-gray-600 text-xs">→</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {flow.nodes.length === 0 && (
          <div className="border-t border-border pt-3">
            <span className="text-[11px] text-gray-400 dark:text-gray-600 italic">无审批节点（发起即通过）</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ──── 新建/编辑弹窗 ──── */
interface NodeForm {
  name: string
  approver_type: 'role' | 'leader' | 'dept_manager' | 'dept_or_leader' | 'user'
  approver_value: string
  order: number
}

function FlowFormModal({
  flow, roles, users, onClose, onSaved,
}: {
  flow: ApprovalFlow | null
  roles: Role[]
  users: UserBrief[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const [code, setCode] = useState(flow?.code ?? '')
  const [name, setName] = useState(flow?.name ?? '')
  const [businessType, setBusinessType] = useState(flow?.business_type ?? 'contract')
  const [description, setDescription] = useState(flow?.description ?? '')
  const [isActive, setIsActive] = useState(flow?.is_active ?? true)
  const [hasCond, setHasCond] = useState(!!flow?.trigger_condition)
  const [condField, setCondField] = useState(flow?.trigger_condition?.field ?? '')
  const [condOp, setCondOp] = useState(flow?.trigger_condition?.op ?? '>=')
  const [condValue, setCondValue] = useState(String(flow?.trigger_condition?.value ?? ''))
  const [nodes, setNodes] = useState<NodeForm[]>(
    flow?.nodes?.map((n, i) => ({ ...n, order: i })) ?? []
  )

  const addNode = () => {
    setNodes(prev => [...prev, { name: '', approver_type: 'role', approver_value: '', order: prev.length }])
  }

  const removeNode = (i: number) => {
    setNodes(prev => prev.filter((_, idx) => idx !== i).map((n, idx) => ({ ...n, order: idx })))
  }

  const moveNode = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= nodes.length) return
    setNodes(prev => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next.map((n, idx) => ({ ...n, order: idx }))
    })
  }

  const updateNode = (i: number, patch: Partial<NodeForm>) => {
    setNodes(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n))
  }

  const handleSave = async () => {
    if (!name.trim()) return toast('请填写审批流名称', 'error')
    if (!flow && !code.trim()) return toast('请填写唯一标识', 'error')
    for (const n of nodes) {
      if (!n.name.trim()) return toast('节点名称不能为空', 'error')
      if ((n.approver_type === 'role' || n.approver_type === 'user') && !n.approver_value.trim()) {
        return toast(`节点「${n.name}」需要选择${n.approver_type === 'role' ? '角色' : '用户'}`, 'error')
      }
    }

    const payload = {
      name: name.trim(),
      business_type: businessType,
      description: description.trim(),
      is_active: isActive,
      trigger_condition: hasCond && condField.trim()
        ? { field: condField.trim(), op: condOp, value: isNaN(Number(condValue)) ? condValue : Number(condValue) }
        : null,
      nodes: nodes.map((n, i) => ({ name: n.name, approver_type: n.approver_type, approver_value: n.approver_value, order: i })),
    }

    setSaving(true)
    try {
      if (flow) {
        await apiPut(`/api/v1/approvals/flows/${flow.id}`, payload)
        toast('已保存', 'success')
      } else {
        await apiPost('/api/v1/approvals/flows', { ...payload, code: code.trim() })
        toast('审批流已创建', 'success')
      }
      onSaved()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={flow ? `编辑审批流 · ${flow.name}` : '新建审批流'}
      subtitle="配置触发条件与审批节点链"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-5 p-1">
        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          {!flow && (
            <div>
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1.5">唯一标识 <span className="text-red-500">*</span></label>
              <input value={code} onChange={e => setCode(e.target.value)}
                placeholder="如 contract_approval"
                className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-accent-blue transition-colors" />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1.5">审批流名称 <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="如 合同审批流"
              className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-accent-blue transition-colors" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1.5">业务场景</label>
            <SearchableSelect
              options={[
                ...BUSINESS_TYPES.map(t => ({ value: t.value, label: t.label })),
                ...(!BUSINESS_TYPES.find(t => t.value === businessType) ? [{ value: businessType, label: businessType }] : []),
              ]}
              value={businessType}
              onChange={(v) => !flow && setBusinessType((v as string) || '')}
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1.5">描述说明</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="简要说明该审批流的用途"
            className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-accent-blue transition-colors" />
        </div>

        {/* 触发条件 */}
        <div className="rounded-xl border border-border bg-bg-hover/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasCond} onChange={e => setHasCond(e.target.checked)}
                className="rounded border-border accent-accent-blue" />
              <span className="text-xs font-semibold text-gray-900 dark:text-white">设置触发条件</span>
            </label>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">（不设置则该业务所有数据均触发此审批流）</span>
          </div>
          {hasCond && (
            <div className="flex items-center gap-2">
              <input value={condField} onChange={e => setCondField(e.target.value)}
                placeholder="字段名，如 amount"
                className="flex-1 px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-accent-blue transition-colors" />
              <SearchableSelect
                options={['>=', '>', '<=', '<', '==', '!='].map(op => ({ value: op, label: op }))}
                value={condOp}
                onChange={(v) => setCondOp((v as string) || '>=')}
              />
              <input value={condValue} onChange={e => setCondValue(e.target.value)}
                placeholder="值，如 500000"
                className="flex-1 px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-accent-blue transition-colors" />
            </div>
          )}
        </div>

        {/* 审批节点 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-900 dark:text-white">审批节点</span>
            <button onClick={addNode}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-accent-blue border border-accent-blue/30 bg-accent-blue/10 rounded-lg hover:bg-accent-blue/20 transition-colors">
              <Plus size={12} />添加节点
            </button>
          </div>

          {nodes.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500 border border-dashed border-border rounded-xl">
              <GitBranch size={20} className="mx-auto text-gray-300 dark:text-gray-700 mb-2" />
              无审批节点，发起申请后将直接通过
            </div>
          ) : (
            <div className="space-y-2">
              {nodes.map((node, i) => (
                <NodeEditor
                  key={i}
                  node={node}
                  index={i}
                  total={nodes.length}
                  roles={roles}
                  users={users}
                  onChange={patch => updateNode(i, patch)}
                  onRemove={() => removeNode(i)}
                  onMoveUp={() => moveNode(i, -1)}
                  onMoveDown={() => moveNode(i, 1)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 启用状态 */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
            className="rounded border-border accent-accent-blue" />
          <span className="text-xs text-gray-700 dark:text-gray-300">创建后立即启用</span>
        </label>
      </div>

      <ModalFooter
        onClose={onClose}
        onSave={handleSave}
        saving={saving}
        saveText={flow ? '保存修改' : '创建审批流'}
        saveDisabled={!name.trim() || (!flow && !code.trim())}
      />
    </Modal>
  )
}

/* ──── 单节点编辑器 ──── */
function NodeEditor({
  node, index, total, roles, users, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  node: NodeForm
  index: number
  total: number
  roles: Role[]
  users: UserBrief[]
  onChange: (patch: Partial<NodeForm>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const approverType = APPROVER_TYPES.find(t => t.value === node.approver_type)

  return (
    <div className="rounded-xl border border-border p-3.5 bg-bg-card flex gap-3 items-start transition-colors hover:bg-bg-hover/30">
      {/* 序号 + 排序 */}
      <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-bg-hover text-gray-700 dark:text-gray-300 border border-border">
          {index + 1}
        </div>
        <button onClick={onMoveUp} disabled={index === 0}
          className="text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-20 transition-colors"><ChevronUp size={12} /></button>
        <button onClick={onMoveDown} disabled={index === total - 1}
          className="text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-20 transition-colors"><ChevronDown size={12} /></button>
      </div>

      {/* 节点配置 */}
      <div className="flex-1 min-w-0 space-y-2.5">
        {/* 节点名称 */}
        <input
          value={node.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="节点名称，如「法务审批」"
          className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-accent-blue transition-colors"
        />

        {/* 审批人类型 */}
        <div className="grid grid-cols-5 gap-1.5">
          {APPROVER_TYPES.map(t => (
            <button key={t.value}
              onClick={() => onChange({ approver_type: t.value, approver_value: '' })}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1 justify-center transition-all border ${
                node.approver_type === t.value
                  ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/30'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 bg-bg-input hover:bg-bg-hover border-transparent'
              }`}
              title={t.desc}>
              <t.icon size={11} />
              {t.label}
            </button>
          ))}
        </div>

        {/* 根据类型展示选择器 */}
        {node.approver_type === 'role' && (
          <SearchableSelect
            options={roles.map(r => ({ value: r.code, label: `${r.name}（${r.code}）` }))}
            value={node.approver_value || null}
            onChange={(v) => onChange({ approver_value: (v as string) || '' })}
            placeholder="请选择角色"
          />
        )}
        {node.approver_type === 'user' && (
          <SearchableSelect
            options={users.map(u => ({ value: String(u.id), label: `${u.name || u.username}${u.department_name ? `（${u.department_name}）` : ''}` }))}
            value={node.approver_value || null}
            onChange={(v) => onChange({ approver_value: (v as string) || '' })}
            placeholder="请选择审批人"
          />
        )}
        {(node.approver_type === 'leader' || node.approver_type === 'dept_manager' || node.approver_type === 'dept_or_leader') && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400 px-1 flex items-center gap-1.5">
            {approverType && <approverType.icon size={11} />}
            {approverType?.desc}
          </div>
        )}
      </div>

      {/* 删除 */}
      <button onClick={onRemove}
        className="p-1 text-gray-400 dark:text-gray-600 hover:text-red-500 shrink-0 mt-0.5 transition-colors">
        <X size={14} />
      </button>
    </div>
  )
}
