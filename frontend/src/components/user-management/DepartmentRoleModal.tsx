import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Save, Loader2, Shield, ShieldCheck } from 'lucide-react'
import type { RoleData } from '../../services/types'
import {
  useRolesQuery,
  useDepartmentRolesQuery,
  useSetDepartmentRolesMutation,
} from '../../hooks/useUserManagementQueries'

interface DepartmentRoleModalProps {
  isOpen: boolean
  departmentId: number | null
  departmentName: string
  onClose: () => void
}

export function DepartmentRoleModal({ isOpen, departmentId, departmentName, onClose }: DepartmentRoleModalProps) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<number>>(new Set())

  const { data: allRoles = [] } = useRolesQuery()
  const { data: deptRoles = [], isLoading } = useDepartmentRolesQuery(isOpen ? departmentId : null)
  const setDeptRolesMutation = useSetDepartmentRolesMutation()
  const saving = setDeptRolesMutation.isPending

  // 同步已分配的角色
  useEffect(() => {
    if (isOpen && deptRoles.length > 0) {
      setSelectedRoleIds(new Set(deptRoles.map(r => r.id)))
    } else if (isOpen) {
      setSelectedRoleIds(new Set())
    }
  }, [isOpen, deptRoles])

  const toggleRole = (roleId: number) => {
    setSelectedRoleIds(prev => {
      const next = new Set(prev)
      if (next.has(roleId)) {
        next.delete(roleId)
      } else {
        next.add(roleId)
      }
      return next
    })
  }

  const handleSave = () => {
    if (departmentId === null) return
    setDeptRolesMutation.mutate(
      { deptId: departmentId, roleIds: Array.from(selectedRoleIds) },
      { onSuccess: () => onClose() }
    )
  }

  if (!isOpen) return null

  // 按角色类型分组
  const systemRoles = allRoles.filter(r => r.is_system)
  const customRoles = allRoles.filter(r => !r.is_system)

  const selectedCount = selectedRoleIds.size

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-scaleIn" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border/15 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500">
              <Shield size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">部门角色配置</h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{departmentName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Loader2 size={20} className="animate-spin mb-2 text-purple-500" />
              <span className="text-xs">加载角色数据...</span>
            </div>
          ) : (
            <div className="space-y-5">
              {/* 说明 */}
              <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-500/5 border border-purple-100 dark:border-purple-500/10">
                <p className="text-[11px] text-purple-700 dark:text-purple-300 leading-relaxed">
                  为 <span className="font-bold">{departmentName}</span> 设置角色后，该组织内所有成员都将自动继承这些角色的全部权限。
                </p>
              </div>

              {/* 已选计数 */}
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-purple-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  已选择 <span className="font-bold text-purple-600 dark:text-purple-400">{selectedCount}</span> 个角色
                </span>
              </div>

              {/* 系统预设角色 */}
              {systemRoles.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2.5">系统预设角色</p>
                  <div className="space-y-1.5">
                    {systemRoles.map(role => (
                      <RoleCheckbox
                        key={role.id}
                        role={role}
                        checked={selectedRoleIds.has(role.id)}
                        onToggle={() => toggleRole(role.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 自定义角色 */}
              {customRoles.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2.5">自定义角色</p>
                  <div className="space-y-1.5">
                    {customRoles.map(role => (
                      <RoleCheckbox
                        key={role.id}
                        role={role}
                        checked={selectedRoleIds.has(role.id)}
                        onToggle={() => toggleRole(role.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {allRoles.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <Shield size={28} className="mx-auto opacity-30 mb-2" />
                  <span className="text-xs">暂无可分配的角色</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 页脚 */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-border/15 shrink-0 bg-gray-50/50 dark:bg-bg-hover/10 flex items-center justify-end gap-2.5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">
            取消
          </button>
          <button type="button" onClick={handleSave} disabled={saving || isLoading} className="px-4 py-2 rounded-lg bg-purple-500 text-white text-xs font-bold hover:bg-purple-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? '正在保存...' : '保存角色配置'}
          </button>
        </div>
      </div>
    </div>
  , document.body)
}

// 角色复选框子组件
function RoleCheckbox({ role, checked, onToggle }: { role: RoleData; checked: boolean; onToggle: () => void }) {
  return (
    <label className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all border ${
      checked
        ? 'bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20'
        : 'bg-white dark:bg-bg-input border-gray-200 dark:border-border/40 hover:bg-gray-50 dark:hover:bg-bg-hover/30'
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 rounded border-gray-300 text-purple-500 focus:ring-purple-500/20 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <span className={`text-xs font-semibold truncate block ${checked ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-200'}`}>
          {role.name}
        </span>
        {role.description && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 block truncate">{role.description}</span>
        )}
      </div>
      {checked && (
        <ShieldCheck size={14} className="text-purple-500 shrink-0" />
      )}
    </label>
  )
}
