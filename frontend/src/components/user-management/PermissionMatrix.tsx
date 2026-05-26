import { Shield, ShieldAlert, Pencil, Trash2 } from 'lucide-react'
import type { RoleData, PermissionData } from '../../services/types'
import { MODULE_LABELS } from '../../services/types'

const MODULE_ICONS: Record<string, string> = {
  user: '👤', project: '📋', customer: '🏢', contract: '📑', report: '📝',
  meeting: '📅', ai: '🤖', wiki: '📚', settings: '⚙️', dashboard: '📊',
  task: '⏰', log: '📜', monitor: '🖥️', data: '💾',
}

interface PermissionMatrixProps {
  role: RoleData | null
  permissions: PermissionData[]
  onEdit: (role: RoleData) => void
  onDelete: (role: RoleData) => void
}

export function PermissionMatrix({ role, permissions, onEdit, onDelete }: PermissionMatrixProps) {
  if (!role) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-500 gap-3">
        <Shield size={36} className="text-gray-600 opacity-40" />
        <div className="text-center">
          <p className="text-sm font-bold text-gray-300">查看权限矩阵</p>
          <p className="text-xs text-gray-500 mt-1.5">选择左侧角色查看其权限配置</p>
        </div>
      </div>
    )
  }

  const grouped: Record<string, { name: string; codes: string[] }> = {}
  role.permission_codes.forEach(code => {
    const mod = code.split(':')[0]
    if (!grouped[mod]) grouped[mod] = { name: MODULE_LABELS[mod] || mod, codes: [] }
    grouped[mod].codes.push(code)
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border/20">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-gray-100">{role.name}</h3>
            {role.is_system && (
              <span className="text-[9px] font-bold px-1.5 py-0.3 rounded bg-amber-500/10 text-amber-400 border border-amber-500/15">系统内置</span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 font-mono">{role.code}</p>
          {role.description && (
            <p className="text-xs text-gray-400 mt-1 bg-bg-hover/40 px-2.5 py-1 rounded-lg border border-border/15 italic">{role.description}</p>
          )}
        </div>
        <div className="flex gap-2 self-start">
          <button onClick={() => onEdit(role)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-bg-hover border border-border/30 text-gray-300 hover:text-white transition-colors">
            <Pencil size={11} /> 编辑权限
          </button>
          <button onClick={() => onDelete(role)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/15 transition-colors">
            <Trash2 size={11} /> 删除
          </button>
        </div>
      </div>

      {role.permission_codes.length === 0 ? (
        <div className="text-center py-12 rounded-xl bg-bg-hover/10 border border-border/20 text-gray-500">
          <ShieldAlert size={28} className="mx-auto opacity-30 mb-2" />
          <p className="text-xs">该角色未配置任何权限，点击「编辑权限」进行分配</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">已授权模块</span>
            <span className="text-[10px] text-gray-500">{role.permission_codes.length} 项权限</span>
          </div>
          {Object.entries(grouped).map(([mod, g]) => (
            <div key={mod} className="rounded-lg border border-border/25 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-bg-hover/20">
                <span className="text-xs">{MODULE_ICONS[mod] || '📦'}</span>
                <span className="text-xs font-bold text-gray-200">{g.name}</span>
                <span className="text-[9px] text-gray-500 bg-bg-hover px-1.5 py-0.3 rounded-full ml-auto">{g.codes.length}</span>
              </div>
              <div className="px-3 py-2 flex flex-wrap gap-1">
                {g.codes.map(code => {
                  const p = permissions.find(pp => pp.code === code)
                  return (
                    <span key={code} className="inline-flex items-center px-2 py-0.5 rounded bg-accent-blue/8 text-blue-300 text-[10px] font-semibold border border-accent-blue/12">
                      {p?.name || code}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
