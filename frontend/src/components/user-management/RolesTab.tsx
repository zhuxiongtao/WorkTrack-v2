import { useState, useCallback, useEffect } from 'react'
import { Loader2, Plus, ChevronRight } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import type { RoleData } from '../../services/types'
import { useRolesQuery, usePermissionsQuery, useDeleteRoleMutation } from '../../hooks/useUserManagementQueries'
import { RoleDetail } from './PermissionMatrix'
import { RoleFormModal } from './RoleFormModal'

export function RolesTab() {
  const { toast: showToast, confirm: showConfirm } = useToast()

  const { data: roles = [], isLoading: rolesLoading } = useRolesQuery()
  const { data: permissions = [] } = usePermissionsQuery()
  const deleteMutation = useDeleteRoleMutation()

  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [showRoleForm, setShowRoleForm] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleData | null>(null)

  // 始终以 roles 列表中的最新对象为 selectedRole，避免删除后看到陈旧数据
  const selectedRole = selectedRoleId != null
    ? roles.find(r => r.id === selectedRoleId) ?? null
    : null

  // 首次加载后自动选中第一个角色，方便一眼看到详情
  useEffect(() => {
    if (selectedRoleId == null && roles.length > 0) {
      setSelectedRoleId(roles[0].id)
    }
  }, [roles, selectedRoleId])

  const openRoleCreate = useCallback(() => {
    setEditingRole(null)
    setShowRoleForm(true)
  }, [])

  const openRoleEdit = useCallback((r: RoleData) => {
    setEditingRole(r)
    setShowRoleForm(true)
  }, [])

  const handleDeleteRole = useCallback(async (r: RoleData) => {
    const msg = r.is_system
      ? `「${r.name}」是系统内置角色，删除后该角色的所有用户/部门/用户组关联将一并移除，确定继续？`
      : `确定删除角色「${r.name}」？删除后关联的用户/部门/用户组将自动解除该角色。`
    if (!await showConfirm(msg)) return
    deleteMutation.mutate(r.id, {
      onSuccess: () => {
        if (selectedRoleId === r.id) setSelectedRoleId(null)
      },
    })
  }, [selectedRoleId, showToast, showConfirm, deleteMutation])

  return (
    <div className="flex flex-col lg:flex-row gap-5">
      {/* 左侧角色选择面板 */}
      <div className="w-full lg:w-64 shrink-0 space-y-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase">内置与自定义角色</span>
          <button onClick={openRoleCreate} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-accent-blue transition-colors cursor-pointer" title="创建自定义角色">
            <Plus size={15} />
          </button>
        </div>
        {rolesLoading ? (
          <div className="p-6 text-center rounded-xl bg-bg-card border border-gray-200 dark:border-border/30">
            <Loader2 size={16} className="mx-auto animate-spin text-gray-500 mb-2" />
            <span className="text-[11px] text-gray-600">载入中...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {roles.map(r => (
              <button
                key={r.id}
                onClick={() => setSelectedRoleId(r.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all duration-150 relative cursor-pointer group ${
                  selectedRoleId === r.id
                    ? 'bg-blue-50/50 dark:bg-accent-blue/5 border-accent-blue/40 text-accent-blue shadow-sm'
                    : 'bg-bg-card border-gray-200 dark:border-border/40 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-bg-hover/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm truncate">{r.name}</span>
                  {r.is_system ? (
                    <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-gray-100 dark:bg-bg-hover text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-border/20">系统内置</span>
                  ) : (
                    <span className="text-[11px] font-bold px-1.5 py-0.2 rounded bg-gray-50 dark:bg-bg-hover/30 text-gray-500 dark:text-gray-400 border border-gray-150 dark:border-border/10">自定义</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 font-mono truncate">{r.code}</p>
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-100 dark:border-border/10">
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">{r.permission_codes.length} 项权限定义</span>
                  <ChevronRight size={12} className={`text-gray-400 transition-transform ${selectedRoleId === r.id ? 'translate-x-0.5 text-accent-blue' : 'group-hover:translate-x-0.5'}`} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 右侧角色详情（轻量展示） */}
      <div className="flex-1 min-w-0 rounded-xl bg-bg-card border border-gray-200 dark:border-border/40 p-5 shadow-sm">
        <RoleDetail
          role={selectedRole}
          permissions={permissions}
          onEdit={openRoleEdit}
          onDelete={handleDeleteRole}
        />
      </div>

      <RoleFormModal
        isOpen={showRoleForm}
        editingRole={editingRole}
        permissions={permissions}
        onClose={() => setShowRoleForm(false)}
      />
    </div>
  )
}
