import { useState } from 'react'
import { ChevronRight, ChevronDown, Plus, Edit3, Trash2, Users, Shield, UserCog, Move } from 'lucide-react'
import type { DepartmentTreeNode } from '../../services/types'

interface DepartmentTreeNodeProps {
  node: DepartmentTreeNode
  selectedId: number | null
  level: number
  onSelect: (id: number) => void
  onAddChild: (parentId: number) => void
  onEdit: (node: DepartmentTreeNode) => void
  onDelete: (node: DepartmentTreeNode) => void
  onRoleConfig: (node: DepartmentTreeNode) => void
  onMove: (deptId: number, newParentId: number | null) => Promise<void>
  descendantsMap: Record<number, Set<number>>
}

export function DepartmentTreeNodeComponent({
  node,
  selectedId,
  level,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
  onRoleConfig,
  onMove,
  descendantsMap,
}: DepartmentTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = selectedId === node.id

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/dept-id', String(node.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!isDragOver) setIsDragOver(true)
  }

  const handleDragLeave = () => setIsDragOver(false)

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const draggedId = Number(e.dataTransfer.getData('text/dept-id'))
    if (!draggedId || draggedId === node.id) return
    if (descendantsMap[draggedId]?.has(node.id)) return
    await onMove(draggedId, node.id)
  }

  return (
    <div>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`group flex items-center gap-1 py-1.5 px-2 rounded-lg cursor-pointer transition-all text-sm border ${
          isDragOver
            ? 'border-accent-blue bg-accent-blue/15 ring-2 ring-accent-blue/30'
            : isSelected
              ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue'
              : 'border-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-bg-hover/40'
        }`}
        style={{ paddingLeft: `${8 + level * 20}px` }}
        onClick={() => onSelect(node.id)}
      >
        <span
          className="shrink-0 cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 transition-colors"
          title="按住拖拽以调整上级"
          onClick={(e) => e.stopPropagation()}
        >
          <Move size={11} />
        </span>

        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          className={`shrink-0 p-0.5 rounded transition-colors ${
            hasChildren
              ? 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
              : 'text-transparent pointer-events-none'
          }`}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          <span className="truncate font-medium block">{node.name}</span>
          {node.manager_name && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5 mt-0.5">
              <UserCog size={9} />
              <span className="truncate">{node.manager_name}</span>
            </span>
          )}
        </div>

        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500 group-hover:hidden">
          <Users size={10} /> {node.user_count}
        </span>

        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-1">
          <button
            onClick={(e) => { e.stopPropagation(); onRoleConfig(node) }}
            className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-500/10 text-gray-400 hover:text-purple-500 transition-colors"
            title="配置部门角色"
          >
            <Shield size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id) }}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-bg-hover text-gray-400 hover:text-accent-blue transition-colors"
            title="新增子部门"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(node) }}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-bg-hover text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            title="编辑部门"
          >
            <Edit3 size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(node) }}
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
            title="删除部门"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <DepartmentTreeNodeComponent
              key={child.id}
              node={child}
              selectedId={selectedId}
              level={level + 1}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
              onRoleConfig={onRoleConfig}
              onMove={onMove}
              descendantsMap={descendantsMap}
            />
          ))}
        </div>
      )}
    </div>
  )
}
