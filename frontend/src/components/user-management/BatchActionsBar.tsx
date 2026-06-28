import { useState } from 'react'
import { CheckCheck, Ban, LogOut, KeyRound, FolderTree, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { DepartmentFlat } from '../../services/types'

interface BatchActionsBarProps {
  selectedCount: number
  onClearSelection: () => void
  onAction: (action: 'enable' | 'disable' | 'resign' | 'set_department' | 'reset_password', departmentId?: number | null) => void
  loading?: boolean
}

export function BatchActionsBar({ selectedCount, onClearSelection, onAction, loading }: BatchActionsBarProps) {
  const [showDeptPicker, setShowDeptPicker] = useState(false)
  const { fetchWithAuth } = useAuth()
  const [depts, setDepts] = useState<DepartmentFlat[]>([])

  const loadDepts = async () => {
    try {
      const res = await fetchWithAuth('/api/v1/users/departments')
      if (res.ok) setDepts(await res.json())
    } catch {
    }
  }

  if (selectedCount === 0) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-blue/10 border border-accent-blue/30 shadow-sm animate-slideIn">
      <span className="text-xs font-bold text-accent-blue flex items-center gap-1.5">
        <CheckCheck size={14} /> 已选中 {selectedCount} 人
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onAction('enable')}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
          title="批量启用账号"
        >
          <CheckCheck size={12} /> 启用
        </button>
        <button
          onClick={() => onAction('disable')}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          title="批量停用账号"
        >
          <Ban size={12} /> 停用
        </button>
        <button
          onClick={() => setShowDeptPicker(true)}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          title="批量调整部门"
        >
          <FolderTree size={12} /> 调部门
        </button>
        <button
          onClick={() => onAction('reset_password')}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
          title="批量重置密码"
        >
          <KeyRound size={12} /> 重置密码
        </button>
        <button
          onClick={() => onAction('resign')}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          title="批量标记为离职"
        >
          <LogOut size={12} /> 标记离职
        </button>
        <button
          onClick={onClearSelection}
          className="ml-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-bg-hover transition-colors"
          title="取消选择"
        >
          <X size={14} />
        </button>
      </div>

      {showDeptPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowDeptPicker(false)}>
          <div className="bg-bg-card rounded-2xl p-5 w-96 max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">选择目标部门</h3>
            <div className="max-h-80 overflow-y-auto space-y-1 border border-border/30 rounded-lg p-2">
              <button
                onClick={() => { onAction('set_department', null); setShowDeptPicker(false) }}
                className="w-full text-left px-3 py-2 rounded text-xs hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-700 dark:text-gray-300"
              >
                <span className="text-gray-400">— 移出部门（不绑定）</span>
              </button>
              {depts.map(d => (
                <button
                  key={d.id}
                  onClick={() => { onAction('set_department', d.id); setShowDeptPicker(false) }}
                  className="w-full text-left px-3 py-2 rounded text-xs hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-700 dark:text-gray-300"
                >
                  {d.name}
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <button onClick={() => setShowDeptPicker(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">取消</button>
            </div>
          </div>
        </div>
      )}
      {showDeptPicker && depts.length === 0 && void loadDepts()}
    </div>
  )
}
