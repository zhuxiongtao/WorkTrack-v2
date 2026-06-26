import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Save, Loader2, Shield, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import type { RoleData, PermissionData } from '../../services/types'
import { MODULE_LABELS, PERM_GROUPS } from '../../services/types'
import { useCreateRoleMutation, useUpdateRoleMutation } from '../../hooks/useUserManagementQueries'

interface RoleFormModalProps {
  isOpen: boolean
  editingRole: RoleData | null
  permissions: PermissionData[]
  onClose: () => void
}

const MODULE_ICONS: Record<string, string> = {
  user: '👤', project: '📋', customer: '🏢', contract: '📑', report: '📝',
  meeting: '📅', ai: '🤖', wiki: '📚', settings: '⚙️', dashboard: '📊',
  task: '⏰', log: '📜', monitor: '🖥️', data: '💾',
  upstream: '🔗', reconcile: '🧮', model: '🔄', management: '🗂️', share: '🔁',
  feedback: '💬', payment: '💰', seal: '🔏',
  // OA 办公模块
  leave: '🌴', overtime: '⏰', expense: '🧾', trip: '✈️',
  purchase: '🛒', asset: '📦', purchase_supplier: '🏷️',
}

const ACTION_LABELS: Record<string, string> = {
  read: '查看', create: '创建', edit: '编辑', delete: '删除',
  manage_roles: '管理角色', view_all: '查看全部', parse: '解析',
  use: '使用', manage_own: '管理自有', manage_shared: '管理共享',
  manage_space: '管理空间', export: '导出', import: '导入',
  manage: '管理', process: '处理', console: '总览', comment: '评论',
  pay: '执行付款', follow_tech: '技术跟进', archive: '归档',
  submit: '提交', clear: '清空',
}

export function RoleFormModal({ isOpen, editingRole, permissions, onClose }: RoleFormModalProps) {
  const { toast: showToast } = useToast()
  const [roleForm, setRoleForm] = useState({ name: '', code: '', description: '' })
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set())
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())
  const isSystemRole = !!editingRole?.is_system

  const createMutation = useCreateRoleMutation()
  const updateMutation = useUpdateRoleMutation()
  const saving = createMutation.isPending || updateMutation.isPending

  useEffect(() => {
    if (isOpen) {
      setRoleForm({
        name: editingRole?.name ?? '',
        code: editingRole?.code ?? '',
        description: editingRole?.description ?? '',
      })
      setSelectedPerms(new Set(editingRole?.permission_codes ?? []))
      setExpandedModules(new Set())
    }
  }, [isOpen, editingRole])

  if (!isOpen) return null

  const togglePerm = (code: string) => {
    setSelectedPerms(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const toggleModule = (modPerms: PermissionData[], select: boolean) => {
    setSelectedPerms(prev => {
      const next = new Set(prev)
      modPerms.forEach(p => select ? next.add(p.code) : next.delete(p.code))
      return next
    })
  }

  const toggleModuleExpand = (mod: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev)
      next.has(mod) ? next.delete(mod) : next.add(mod)
      return next
    })
  }

  const handleSave = () => {
    if (!roleForm.name.trim() || !roleForm.code.trim()) { showToast('名称和编码不能为空', 'warning'); return }
    const body = { ...roleForm, permission_codes: Array.from(selectedPerms) }
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: body }, { onSuccess: onClose })
    } else {
      createMutation.mutate(body, { onSuccess: onClose })
    }
  }

  const modulePermsMap = PERM_GROUPS.reduce<Record<string, PermissionData[]>>((acc, mod) => {
    acc[mod] = permissions.filter(p => p.module === mod)
    return acc
  }, {})

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-scaleIn" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/15 shrink-0">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-accent-blue" />
            <h3 className="text-sm font-bold text-gray-100">{editingRole ? '编辑角色' : '新建角色'}</h3>
            {isSystemRole && <span className="text-[11px] px-1.5 py-0.3 rounded bg-amber-500/10 text-amber-400 font-bold border border-amber-500/15">系统内置</span>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 角色基本信息 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">角色名称 *</label>
              <input value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border/60 text-sm text-gray-100 outline-none focus:border-accent-blue"
                placeholder="如：销售经理" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">唯一编码 *</label>
              <input value={roleForm.code}
                onChange={e => setRoleForm({ ...roleForm, code: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border/60 text-sm text-gray-100 outline-none focus:border-accent-blue font-mono"
                placeholder="如：sales_mgr"
                disabled={isSystemRole} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">描述</label>
              <input value={roleForm.description} onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border/60 text-sm text-gray-100 outline-none focus:border-accent-blue"
                placeholder="角色职责说明" />
            </div>
          </div>

          {/* 权限分配：模块级一键开关 */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-bold tracking-wider text-gray-400 uppercase">模块权限分配</span>
              <span className="text-[11px] text-gray-500">{selectedPerms.size} / {permissions.length} 项已选</span>
            </div>
            <div className="space-y-1.5">
              {PERM_GROUPS.map(mod => {
                const modPerms = modulePermsMap[mod] || []
                if (!modPerms.length) return null
                const allSelected = modPerms.every(p => selectedPerms.has(p.code))
                const someSelected = modPerms.some(p => selectedPerms.has(p.code))
                const isExpanded = expandedModules.has(mod)
                const selectedCount = modPerms.filter(p => selectedPerms.has(p.code)).length

                return (
                  <div key={mod} className="rounded-xl border border-border/30 overflow-hidden">
                    {/* 模块行：点击展开细调 */}
                    <div className={`flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer transition-colors ${someSelected ? 'bg-accent-blue/5' : 'bg-bg-hover/30'}`}
                      onClick={() => toggleModuleExpand(mod)}>
                      {/* 模块开关 */}
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleModule(modPerms, !allSelected) }}
                        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer ${allSelected ? 'bg-accent-blue' : someSelected ? 'bg-blue-400/60' : 'bg-gray-600'}`}>
                        <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition duration-200 ${allSelected ? 'translate-x-3' : someSelected ? 'translate-x-1.5' : 'translate-x-0'}`} />
                      </button>
                      <span className="text-xs">{MODULE_ICONS[mod] || '📦'}</span>
                      <span className="text-xs font-bold text-gray-200 flex-1">{MODULE_LABELS[mod] || mod}</span>
                      <span className={`text-[11px] px-1.5 py-0.3 rounded-full font-bold ${allSelected ? 'bg-accent-blue/20 text-accent-blue' : someSelected ? 'bg-blue-400/15 text-blue-300' : 'bg-bg-hover text-gray-500'}`}>
                        {selectedCount}/{modPerms.length}
                      </span>
                      {isExpanded ? <ChevronDown size={13} className="text-gray-500" /> : <ChevronRight size={13} className="text-gray-500" />}
                    </div>
                    {/* 展开细调：单个权限开关 */}
                    {isExpanded && (
                      <div className="px-3.5 pb-2.5 pt-1 border-t border-border/10 bg-bg-hover/10 space-y-1">
                        {modPerms.map(p => {
                          const isChecked = selectedPerms.has(p.code)
                          return (
                            <button key={p.code} type="button" onClick={() => togglePerm(p.code)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] transition-all border cursor-pointer ${
                                isChecked
                                  ? 'bg-accent-blue/10 text-blue-300 font-semibold border-accent-blue/20'
                                  : 'text-gray-400 border-transparent hover:bg-bg-hover hover:text-gray-300'
                              }`}>
                              <span className="flex items-center gap-2">
                                <span className={`w-3 h-3 rounded border-2 flex items-center justify-center transition-colors ${isChecked ? 'border-accent-blue bg-accent-blue' : 'border-gray-500'}`}>
                                  {isChecked && <Check size={8} className="text-white" strokeWidth={3} />}
                                </span>
                                <span className="font-medium">{ACTION_LABELS[p.action] || p.action}</span>
                                <span className="text-gray-500 font-mono text-[11px]">{p.code}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border/15 shrink-0 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border/30">取消</button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-lg bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? '保存中...' : editingRole ? '保存修改' : '创建角色'}
          </button>
        </div>
      </div>
    </div>
  , document.body)
}
