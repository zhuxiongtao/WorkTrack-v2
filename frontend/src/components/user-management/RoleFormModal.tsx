import { useState } from 'react'
import { X, Save, Loader2, Shield, Layers, Check } from 'lucide-react'
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

export function RoleFormModal({ isOpen, editingRole, permissions, onClose }: RoleFormModalProps) {
  const { toast: showToast } = useToast()
  const [roleForm, setRoleForm] = useState(() => ({
    name: editingRole?.name ?? '',
    code: editingRole?.code ?? '',
    description: editingRole?.description ?? '',
  }))
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(
    () => new Set(editingRole?.permission_codes ?? [])
  )

  const createMutation = useCreateRoleMutation()
  const updateMutation = useUpdateRoleMutation()
  const saving = createMutation.isPending || updateMutation.isPending

  if (!isOpen) return null

  const togglePerm = (code: string) => {
    setSelectedPerms(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden max-h-[85vh] animate-scaleIn" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border/15 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center text-accent-blue">
              <Shield size={16} />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{editingRole ? '配置角色属性与操作集' : '构建新业务角色'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">角色展示名称 *</label>
              <input value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium"
                placeholder="e.g. 华东区销售经理" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">角色唯一编码 *</label>
              <input value={roleForm.code}
                onChange={e => setRoleForm({ ...roleForm, code: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-600 font-medium"
                placeholder="e.g. east_sales_mgr"
                disabled={!!editingRole?.is_system} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">角色说明/职责描述</label>
              <input value={roleForm.description} onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium"
                placeholder="e.g. 负责华东地区的客户资料管理与跟进" />
            </div>
          </div>

          <div className="space-y-3.5">
            <span className="text-[11px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" /> 分配子模块操作级权限集
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PERM_GROUPS.map(mod => {
                const modPerms = permissions.filter(p => p.module === mod)
                if (!modPerms.length) return null
                const allSelected = modPerms.every(p => selectedPerms.has(p.code))
                return (
                  <div key={mod} className="p-4 rounded-xl bg-gray-50/50 dark:bg-bg-hover/10 border border-gray-200 dark:border-border/20 transition-all hover:border-gray-300 dark:hover:border-border/40 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between border-b border-gray-150 dark:border-border/10 pb-2">
                      <h5 className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                        <Layers size={11} className="text-accent-blue" /> {MODULE_LABELS[mod] || mod}
                      </h5>
                      <button type="button" onClick={() => {
                        setSelectedPerms(prev => {
                          const next = new Set(prev)
                          if (allSelected) { modPerms.forEach(p => next.delete(p.code)) }
                          else { modPerms.forEach(p => next.add(p.code)) }
                          return next
                        })
                      }} className="text-[10px] text-accent-blue hover:text-blue-600 font-bold transition-colors cursor-pointer">
                        {allSelected ? '取消全选' : '快速全选'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {modPerms.map(p => {
                        const isChecked = selectedPerms.has(p.code)
                        return (
                          <button key={p.code} type="button" onClick={() => togglePerm(p.code)}
                            className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all duration-150 border text-left cursor-pointer ${
                              isChecked
                                ? 'bg-blue-50 dark:bg-accent-blue/10 text-blue-600 dark:text-blue-400 font-semibold border-blue-200 dark:border-accent-blue/25 shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 border-transparent bg-white hover:bg-gray-150 dark:bg-bg-hover/40 dark:hover:bg-bg-hover hover:text-gray-900 dark:hover:text-gray-200'
                            }`}>
                            <span className="truncate pr-1 font-medium">{p.name}</span>
                            {isChecked && <Check size={11} className="shrink-0 text-blue-500 dark:text-accent-blue" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-border/15 shrink-0 bg-gray-50/50 dark:bg-bg-hover/10 flex items-center justify-end gap-2.5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">放弃修改</button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? '正在保存...' : editingRole ? '保存角色权限' : '确认创建角色'}
          </button>
        </div>
      </div>
    </div>
  )
}
