import { useState, useCallback, useMemo } from 'react'
import { Loader2, Plus, Building2 } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import type { DepartmentTreeNode } from '../../services/types'
import {
  useDepartmentTreeQuery,
  useDeleteDepartmentMutation,
  useMoveDepartmentMutation,
} from '../../hooks/useUserManagementQueries'
import { DepartmentTreeNodeComponent } from './DepartmentTreeNode'
import { DepartmentFormModal } from './DepartmentFormModal'
import { DepartmentRoleModal } from './DepartmentRoleModal'

interface DepartmentTreeProps {
  selectedDepartmentId: number | null
  onDepartmentSelect: (id: number | null) => void
}

function buildDescendantsMap(nodes: DepartmentTreeNode[]): Record<number, Set<number>> {
  const map: Record<number, Set<number>> = {}
  const walk = (n: DepartmentTreeNode, ancestors: Set<number>) => {
    for (const a of ancestors) {
      if (!map[a]) map[a] = new Set()
      map[a].add(n.id)
    }
    const next = new Set(ancestors)
    next.add(n.id)
    if (n.children?.length) for (const c of n.children) walk(c, next)
  }
  for (const root of nodes) walk(root, new Set())
  return map
}

export function DepartmentTree({ selectedDepartmentId, onDepartmentSelect }: DepartmentTreeProps) {
  const { confirm: showConfirm } = useToast()

  const { data: tree = [], isLoading } = useDepartmentTreeQuery()
  const deleteMutation = useDeleteDepartmentMutation()
  const moveMutation = useMoveDepartmentMutation()

  const [showFormModal, setShowFormModal] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<DepartmentTreeNode | null>(null)
  const [parentIdForNew, setParentIdForNew] = useState<number | null>(null)
  const [roleConfigNode, setRoleConfigNode] = useState<DepartmentTreeNode | null>(null)

  const descendantsMap = useMemo(() => buildDescendantsMap(tree), [tree])

  const handleSelect = useCallback((id: number) => {
    onDepartmentSelect(selectedDepartmentId === id ? null : id)
  }, [selectedDepartmentId, onDepartmentSelect])

  const openCreateRoot = useCallback(() => {
    setEditingDepartment(null)
    setParentIdForNew(null)
    setShowFormModal(true)
  }, [])

  const openAddChild = useCallback((parentId: number) => {
    setEditingDepartment(null)
    setParentIdForNew(parentId)
    setShowFormModal(true)
  }, [])

  const openEdit = useCallback((node: DepartmentTreeNode) => {
    setEditingDepartment(node)
    setParentIdForNew(null)
    setShowFormModal(true)
  }, [])

  const openRoleConfig = useCallback((node: DepartmentTreeNode) => {
    setRoleConfigNode(node)
  }, [])

  const handleDelete = useCallback(async (node: DepartmentTreeNode) => {
    if (!await showConfirm(`确定删除部门「${node.name}」？${node.children.length > 0 ? '\n其下所有子部门也将被删除！' : ''}`)) return
    deleteMutation.mutate(node.id)
    if (selectedDepartmentId === node.id) {
      onDepartmentSelect(null)
    }
  }, [showConfirm, deleteMutation, selectedDepartmentId, onDepartmentSelect])

  const handleMove = useCallback(async (deptId: number, newParentId: number | null) => {
    if (newParentId !== null && descendantsMap[deptId]?.has(newParentId)) {
      return
    }
    moveMutation.mutate({ deptId, newParentId })
  }, [moveMutation, descendantsMap])

  return (
    <div className="w-[260px] shrink-0 flex flex-col rounded-xl bg-bg-card border border-gray-200 dark:border-border/30 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-border/20 shrink-0">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-accent-blue" />
          <span className="text-sm font-bold text-gray-800 dark:text-gray-200">组织架构</span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1" title="按住行首拖动图标可调整上级">可拖拽改父</span>
        </div>
        <button
          onClick={openCreateRoot}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-400 hover:text-accent-blue transition-colors cursor-pointer"
          title="新增一级部门"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Loader2 size={18} className="animate-spin mb-2 text-accent-blue" />
            <span className="text-xs">加载组织架构...</span>
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Building2 size={24} className="opacity-40 mb-2" />
            <span className="text-xs">暂无部门</span>
          </div>
        ) : (
          tree.map((node) => (
            <DepartmentTreeNodeComponent
              key={node.id}
              node={node}
              selectedId={selectedDepartmentId}
              level={0}
              onSelect={handleSelect}
              onAddChild={openAddChild}
              onEdit={openEdit}
              onDelete={handleDelete}
              onRoleConfig={openRoleConfig}
              onMove={handleMove}
              descendantsMap={descendantsMap}
            />
          ))
        )}
      </div>

      <DepartmentFormModal
        isOpen={showFormModal}
        editingDepartment={editingDepartment}
        parentDepartmentId={parentIdForNew}
        departments={tree}
        onClose={() => setShowFormModal(false)}
      />

      <DepartmentRoleModal
        isOpen={roleConfigNode !== null}
        departmentId={roleConfigNode?.id ?? null}
        departmentName={roleConfigNode?.name ?? ''}
        onClose={() => setRoleConfigNode(null)}
      />
    </div>
  )
}
