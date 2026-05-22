import { useState } from 'react'
import { ChevronRight, ChevronDown, Plus, Edit3, Trash2, Users, Shield, UserCog } from 'lucide-react'
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
}: DepartmentTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <div
        className={`group flex items-center gap-1 py-1.5 px-2 rounded-lg cursor-pointer transition-all text-sm border border-transparent ${
          isSelected
            ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-bg-hover/40'
        }`}
        style={{ paddingLeft: `${8 + level * 20}px` }}
        onClick={() => onSelect(node.id)}
      >
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
