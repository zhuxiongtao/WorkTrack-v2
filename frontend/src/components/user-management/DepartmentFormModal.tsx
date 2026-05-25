import { useState, useEffect, useCallback } from 'react'
import { X, Save, Loader2, UserCog } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import type { DepartmentTreeNode, DepartmentFlat } from '../../services/types'
import {
  useCreateDepartmentMutation,
  useUpdateDepartmentMutation,
  useUsersSimpleQuery,
} from '../../hooks/useUserManagementQueries'
import SearchableSelect from '../../components/SearchableSelect'

interface DepartmentFormModalProps {
  isOpen: boolean
  editingDepartment: DepartmentTreeNode | null
  parentDepartmentId: number | null
  departments: DepartmentTreeNode[]
  onClose: () => void
}

function flattenTree(nodes: DepartmentTreeNode[]): DepartmentFlat[] {
  const result: DepartmentFlat[] = []
  const walk = (list: DepartmentTreeNode[]) => {
    for (const n of list) {
      result.push({ id: n.id, name: n.name, manager_id: n.manager_id, parent_id: n.parent_id })
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return result
}

function excludeDescendants(nodes: DepartmentFlat[], excludeId: number): DepartmentFlat[] {
  const childrenMap = new Map<number, number[]>()
  for (const n of nodes) {
    if (n.parent_id != null) {
      const children = childrenMap.get(n.parent_id) || []
      children.push(n.id)
      childrenMap.set(n.parent_id, children)
    }
  }
  const excluded = new Set<number>([excludeId])
  const stack = [excludeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const children = childrenMap.get(id) || []
    for (const c of children) {
      if (!excluded.has(c)) {
        excluded.add(c)
        stack.push(c)
      }
    }
  }
  return nodes.filter(n => !excluded.has(n.id))
}

export function DepartmentFormModal({ isOpen, editingDepartment, parentDepartmentId, departments, onClose }: DepartmentFormModalProps) {
  const { toast } = useToast()
  const createMutation = useCreateDepartmentMutation()
  const updateMutation = useUpdateDepartmentMutation()
  const { data: allUsers = [] } = useUsersSimpleQuery()

  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [managerId, setManagerId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const flatDepts = flattenTree(departments)

  // 初始化表单
  useEffect(() => {
    if (isOpen) {
      if (editingDepartment) {
        setName(editingDepartment.name)
        setParentId(editingDepartment.parent_id)
        setManagerId(editingDepartment.manager_id)
      } else {
        setName('')
        setParentId(parentDepartmentId)
        setManagerId(null)
      }
    }
  }, [isOpen, editingDepartment, parentDepartmentId])

  // 可选的父部门列表（编辑时排除自身及子孙）
  const availableParents = editingDepartment
    ? excludeDescendants(flatDepts, editingDepartment.id).filter(d => d.id !== editingDepartment.id)
    : flatDepts

  const parentOptions = [
    { id: 'none', label: '无（一级部门）' },
    ...availableParents.map(d => ({
      id: d.id,
      label: d.name,
    })),
  ]

  const departmentMembers = editingDepartment
    ? allUsers.filter(u => u.department_id === editingDepartment.id)
    : (parentId ? allUsers.filter(u => u.department_id === parentId) : allUsers)

  const handleSave = useCallback(async () => {
    if (!name.trim()) { toast('部门名称不能为空', 'warning'); return }

    setSaving(true)
    try {
      if (editingDepartment) {
        await updateMutation.mutateAsync({
          id: editingDepartment.id,
          data: { name: name.trim(), parent_id: parentId, manager_id: managerId },
        })
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          parent_id: parentId,
          manager_id: managerId,
        })
      }
      onClose()
    } catch {
      // mutation toast 已在 hook 中处理
    } finally {
      setSaving(false)
    }
  }, [name, parentId, managerId, editingDepartment, createMutation, updateMutation, onClose, toast])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-bg-card rounded-2xl shadow-2xl border border-gray-200 dark:border-border/30 mx-4 animate-fadeIn">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-border/20">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
            {editingDepartment ? '编辑部门' : '新增部门'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="p-6 space-y-4">
          {/* 部门名称 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
              部门名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：技术研发部"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600"
            />
          </div>

          {/* 父部门 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
              上级部门
            </label>
            <SearchableSelect
              options={parentOptions}
              value={parentId ?? 'none'}
              onChange={(v) => setParentId(v === 'none' ? null : v as number)}
              placeholder="选择上级部门（可选）"
              emptyText="无可用部门"
              searchPlaceholder="搜索部门..."
            />
          </div>

          {/* 部门负责人 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1.5">
              <UserCog size={12} className="text-amber-500" />
              部门负责人
            </label>
            <select
              value={managerId ?? 0}
              onChange={(e) => setManagerId(parseInt(e.target.value, 10) || null)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all cursor-pointer"
            >
              <option value={0}>暂不指定负责人</option>
              {departmentMembers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name || u.username} (@{u.username})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
              只能从本部门成员中选择负责人，负责人将自动获得本部门及所有子部门成员的日报、周报等数据查看权限
            </p>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-border/20">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-bg-hover transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent-blue text-white text-sm font-bold hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {editingDepartment ? '保存修改' : '创建部门'}
          </button>
        </div>
      </div>
    </div>
  )
}
