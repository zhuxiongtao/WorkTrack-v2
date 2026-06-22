import { useState, useEffect, useCallback } from 'react'
import {
  GitBranch, Plus, Edit3, Trash2, Loader2, Power, PowerOff,
  ChevronUp, ChevronDown, X, User, Shield, Users, Building2,
} from 'lucide-react'
import { PageHeader, Modal, ModalFooter, Field } from '../components/design-system'
import { useToast } from '../contexts/ToastContext'
import { apiFetch, apiPost, apiPut, apiDelete } from '../services/api'

/* ──── 类型 ──── */
interface ApprovalNode {
  name: string
  approver_type: 'role' | 'leader' | 'dept_manager' | 'user'
  approver_value: string
  order: number
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

/* ──── 常量 ──── */
const BUSINESS_TYPES = [
  { value: 'contract',          label: '合同审批' },
  { value: 'reconcile_summary', label: '对账月结' },
  { value: 'project',           label: '项目审批' },
  { value: 'supplier',          label: '供应商入驻审批' },
  { value: 'channel',           label: '通道开通审批' },
]
const BUSINESS_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  BUSINESS_TYPES.map(t => [t.value, t.label])
)

const APPROVER_TYPES = [
  { value: 'role', label: '按角色', icon: Shield, desc: '持有该角色的全部用户（任一审批通过即可）' },
  { value: 'user', label: '指定用户', icon: User, desc: '指定一个固定的审批人' },
  { value: 'leader', label: '直属上级', icon: Users, desc: '发起人的直属上级（动态解析）' },
  { value: 'dept_manager', label: '部门负责人', icon: Building2, desc: '发起人所属部门的负责人（动态解析）' },
] as const

const TYPE_COLOR: Record<string, { bg: string; text: string }> = {
  role: { bg: '#3B82F615', text: '#60A5FA' },
  user: { bg: '#10B98115', text: '#34D399' },
  leader: { bg: '#F59E0B15', text: '#FBBF24' },
  dept_manager: { bg: '#8B5CF615', text: '#A78BFA' },
}

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

  const grouped = flows.reduce<Record<string, ApprovalFlow[]>>((acc, f) => {
    const key = f.business_type
    if (!acc[key]) acc[key] = []
    acc[key].push(f)
    return acc
  }, {})

  return (
    <div className="px-6 py-5">
      <PageHeader
        icon={GitBranch}
        title="审批流配置"
        description="为不同业务场景配置多级审批节点，支持按角色、指定用户、直属上级、部门负责人四种方式"
        tone="purple"
        right={
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-indigo-500 rounded-lg hover:opacity-90"
          >
            <Plus size={14} />新建审批流
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 size={20} className="animate-spin mr-2" />加载中…
        </div>
      ) : flows.length === 0 ? (
        <div className="text-center py-20 text-gray-500 text-sm">
          还没有审批流配置，点击右上角「新建审批流」开始配置
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([btype, bflows]) => (
            <div key={btype}>
              <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3">
                {BUSINESS_TYPE_LABEL[btype] || btype}
              </div>
              <div className="space-y-3">
                {bflows.map(flow => (
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

/* ──── 单条审批流卡片 ──── */
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

  return (
    <div className={`rounded-xl border bg-white/[0.02] p-4 transition-opacity ${flow.is_active ? 'border-white/10' : 'border-white/5 opacity-60'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-white">{flow.name}</span>
            {flow.is_system && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold">系统预置</span>
            )}
            <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${flow.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/15 text-gray-400'}`}>
              {flow.is_active ? '启用' : '已停用'}
            </span>
          </div>
          <div className="text-[11px] text-gray-500 mb-3">
            {flow.description || '无说明'}
            {flow.trigger_condition && (
              <span className="ml-2 text-amber-400/80">
                · 触发条件: {flow.trigger_condition.field} {flow.trigger_condition.op} {flow.trigger_condition.value}
              </span>
            )}
          </div>

          {/* 节点流程图 */}
          <div className="flex items-center gap-0 flex-wrap">
            {flow.nodes.length === 0 ? (
              <span className="text-[11px] text-gray-600 italic">无审批节点（发起即通过）</span>
            ) : flow.nodes.map((node, i) => {
              const tc = TYPE_COLOR[node.approver_type] || TYPE_COLOR.role
              const typeLabel = APPROVER_TYPES.find(t => t.value === node.approver_type)?.label || node.approver_type
              const valueLabel = node.approver_type === 'role'
                ? (roleMap[node.approver_value] || node.approver_value)
                : node.approver_type === 'user'
                ? (userMap[node.approver_value] || `用户${node.approver_value}`)
                : ''
              return (
                <div key={i} className="flex items-center">
                  <div className="rounded-lg border px-2.5 py-1.5 text-[11px]"
                    style={{ borderColor: tc.text + '40', background: tc.bg }}>
                    <div className="font-semibold" style={{ color: tc.text }}>{node.name}</div>
                    <div className="text-gray-500 mt-0.5">
                      {typeLabel}{valueLabel ? `・${valueLabel}` : ''}
                    </div>
                  </div>
                  {i < flow.nodes.length - 1 && (
                    <div className="px-1.5 text-gray-600 text-xs">→</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onToggle}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            title={flow.is_active ? '停用' : '启用'}>
            {flow.is_active ? <PowerOff size={14} /> : <Power size={14} />}
          </button>
          <button onClick={onEdit}
            className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
            <Edit3 size={14} />
          </button>
          {!flow.is_system && (
            <button onClick={onDelete}
              className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ──── 新建/编辑弹窗 ──── */
interface NodeForm {
  name: string
  approver_type: 'role' | 'leader' | 'dept_manager' | 'user'
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
      title={flow ? `编辑审批流・${flow.name}` : '新建审批流'}
      subtitle="配置触发条件与审批节点链"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-5 p-1">
        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          {!flow && (
            <Field label="唯一标识" required>
              <input value={code} onChange={e => setCode(e.target.value)}
                placeholder="如 contract_approval"
                className="w-full px-3 py-2 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50" />
            </Field>
          )}
          <Field label="审批流名称" required>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="如 合同审批流"
              className="w-full px-3 py-2 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50" />
          </Field>
          <Field label="业务场景">
            <select value={businessType} onChange={e => setBusinessType(e.target.value)}
              disabled={!!flow}
              className="w-full px-3 py-2 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50 disabled:opacity-50">
              {BUSINESS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              {!BUSINESS_TYPES.find(t => t.value === businessType) && (
                <option value={businessType}>{businessType}</option>
              )}
            </select>
          </Field>
        </div>

        <Field label="描述说明">
          <input value={description} onChange={e => setDescription(e.target.value)}
            placeholder="简要说明该审批流的用途"
            className="w-full px-3 py-2 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50" />
        </Field>

        {/* 触发条件 */}
        <div className="rounded-xl border border-white/5 bg-black/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hasCond} onChange={e => setHasCond(e.target.checked)}
                className="rounded" />
              <span className="text-xs font-semibold text-white">设置触发条件</span>
            </label>
            <span className="text-[11px] text-gray-500">（不设置则该业务所有数据均触发此审批流）</span>
          </div>
          {hasCond && (
            <div className="flex items-center gap-2">
              <input value={condField} onChange={e => setCondField(e.target.value)}
                placeholder="字段名，如 amount"
                className="flex-1 px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50" />
              <select value={condOp} onChange={e => setCondOp(e.target.value)}
                className="px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
                {['>=', '>', '<=', '<', '==', '!='].map(op => <option key={op} value={op}>{op}</option>)}
              </select>
              <input value={condValue} onChange={e => setCondValue(e.target.value)}
                placeholder="值，如 500000"
                className="flex-1 px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50" />
            </div>
          )}
        </div>

        {/* 审批节点 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-white">审批节点</span>
            <button onClick={addNode}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-purple-300 border border-purple-500/30 bg-purple-500/10 rounded-lg hover:bg-purple-500/20">
              <Plus size={12} />添加节点
            </button>
          </div>

          {nodes.length === 0 ? (
            <div className="text-center py-6 text-xs text-gray-500 border border-dashed border-white/10 rounded-xl">
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
            className="rounded" />
          <span className="text-xs text-gray-300">创建后立即启用</span>
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
  const tc = TYPE_COLOR[node.approver_type] || TYPE_COLOR.role
  const approverType = APPROVER_TYPES.find(t => t.value === node.approver_type)

  return (
    <div className="rounded-xl border p-3 bg-black/20 flex gap-3 items-start"
      style={{ borderColor: tc.text + '30' }}>
      {/* 序号 + 排序 */}
      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
          style={{ background: tc.bg, color: tc.text }}>
          {index + 1}
        </div>
        <button onClick={onMoveUp} disabled={index === 0}
          className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ChevronUp size={12} /></button>
        <button onClick={onMoveDown} disabled={index === total - 1}
          className="text-gray-600 hover:text-gray-300 disabled:opacity-30"><ChevronDown size={12} /></button>
      </div>

      {/* 节点配置 */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* 节点名称 */}
        <input
          value={node.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="节点名称，如「法务审批」"
          className="w-full px-2.5 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
        />

        {/* 审批人类型 */}
        <div className="grid grid-cols-4 gap-1">
          {APPROVER_TYPES.map(t => (
            <button key={t.value}
              onClick={() => onChange({ approver_type: t.value, approver_value: '' })}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 justify-center transition-colors ${node.approver_type === t.value ? 'text-white' : 'text-gray-500 hover:text-gray-300 bg-black/20'}`}
              style={node.approver_type === t.value ? { background: tc.bg, color: tc.text } : undefined}
              title={t.desc}>
              <t.icon size={11} />
              {t.label}
            </button>
          ))}
        </div>

        {/* 根据类型展示选择器 */}
        {node.approver_type === 'role' && (
          <select value={node.approver_value} onChange={e => onChange({ approver_value: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
            <option value="">请选择角色</option>
            {roles.map(r => <option key={r.id} value={r.code}>{r.name}（{r.code}）</option>)}
          </select>
        )}
        {node.approver_type === 'user' && (
          <select value={node.approver_value} onChange={e => onChange({ approver_value: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-white focus:outline-none focus:border-purple-500/50">
            <option value="">请选择审批人</option>
            {users.map(u => (
              <option key={u.id} value={String(u.id)}>
                {u.name || u.username}{u.department_name ? `（${u.department_name}）` : ''}
              </option>
            ))}
          </select>
        )}
        {(node.approver_type === 'leader' || node.approver_type === 'dept_manager') && (
          <div className="text-[11px] text-gray-500 px-2">
            {approverType?.desc}，在发起审批时动态解析，无需手动指定
          </div>
        )}
      </div>

      {/* 删除 */}
      <button onClick={onRemove}
        className="p-1 text-gray-600 hover:text-rose-400 shrink-0 mt-0.5">
        <X size={14} />
      </button>
    </div>
  )
}
