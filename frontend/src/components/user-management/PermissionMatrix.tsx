import { Shield, ShieldAlert, Layers } from 'lucide-react'
import type { RoleData, PermissionData } from '../../services/types'
import { MODULE_LABELS } from '../../services/types'

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
        <Shield size={36} className="text-gray-400 dark:text-gray-600 opacity-40" />
        <div className="text-center">
          <p className="text-sm font-bold">查看权限矩阵</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1.5">请选择左侧列表中的任意一个角色以查看其具体的原子级操作权限</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 角色信息概要头 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-200 dark:border-border/20">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{role.name}</h3>
            {role.is_system && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 shadow-sm">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> 系统管理员特权
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">角色编码：{role.code}</p>
          {role.description && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 bg-gray-50 dark:bg-bg-hover/40 px-2.5 py-1.5 rounded-lg border border-gray-150 dark:border-border/20 italic">{role.description}</p>
          )}
        </div>
        <div className="flex gap-2 self-start sm:self-center">
          <button onClick={() => onEdit(role)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-bg-hover border border-gray-200 dark:border-border/30 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer font-semibold shadow-sm">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> 编辑角色与权限
          </button>
          <button onClick={() => onDelete(role)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/15 transition-colors cursor-pointer font-semibold shadow-sm">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg> {role.is_system ? '删除系统角色' : '删除角色'}
          </button>
        </div>
      </div>

      {/* 矩阵 */}
      {role.permission_codes.length === 0 ? (
        <div className="text-center py-12 rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-gray-150 dark:border-border/20 text-gray-400">
          <ShieldAlert size={28} className="mx-auto opacity-30 mb-2" />
          <p className="text-xs">该角色未配置任何模块权限，点击「编辑角色」进行分配</p>
        </div>
      ) : (
        <div className="space-y-3">
          <span className="text-xs font-bold text-gray-400 dark:text-gray-500 tracking-wider uppercase block pb-1">赋予该角色的具体操作权限:</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(() => {
              const grouped: Record<string, { name: string; codes: string[] }> = {}
              role.permission_codes.forEach(code => {
                const mod = code.split(':')[0]
                if (!grouped[mod]) grouped[mod] = { name: MODULE_LABELS[mod] || mod, codes: [] }
                grouped[mod].codes.push(code)
              })
              return Object.entries(grouped).map(([mod, g]) => (
                <div key={mod} className="p-3.5 rounded-xl bg-gray-50/50 dark:bg-bg-hover/10 border border-gray-200 dark:border-border/30 space-y-3 hover:border-gray-300 dark:hover:border-border/50 transition-all shadow-sm">
                  <div className="flex items-center justify-between border-b border-gray-150 dark:border-border/10 pb-2">
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-300 flex items-center gap-1.5">
                      <Layers size={11} className="text-accent-blue" /> {g.name}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono bg-gray-100 dark:bg-bg-hover px-1.5 py-0.5 rounded">{g.codes.length} 项</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.codes.map(code => {
                      const p = permissions.find(pp => pp.code === code)
                      return (
                        <span key={code} className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 dark:bg-accent-blue/5 text-blue-600 dark:text-blue-400 text-[11px] font-semibold border border-blue-150 dark:border-accent-blue/15 shadow-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-accent-blue/60" /> {p?.name || code}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
