import { Shield, ShieldAlert, Pencil, Trash2 } from 'lucide-react'
import type { RoleData, PermissionData } from '../../services/types'
import { MODULE_LABELS } from '../../services/types'

const MODULE_ICONS: Record<string, string> = {
  user: '👤', project: '📋', customer: '🏢', contract: '📑', report: '📝',
  meeting: '📅', ai: '🤖', wiki: '📚', settings: '⚙️', dashboard: '📊',
  task: '⏰', log: '📜', monitor: '🖥️', data: '💾',
  management: '🛡️', share: '🔗',
  upstream: '🔗', reconcile: '🧮', model: '🔄',
  feedback: '💬', payment: '💰', seal: '🔏',
}

interface RoleDetailProps {
  role: RoleData | null
  permissions: PermissionData[]
  onEdit: (role: RoleData) => void
  onDelete: (role: RoleData) => void
}

export function RoleDetail({ role, permissions, onEdit, onDelete }: RoleDetailProps) {
  if (!role) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-600 gap-3">
        <Shield size={32} className="opacity-30" />
        <div className="text-center">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300">查看角色详情</p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1.5">从左侧选择一个角色查看其权限配置</p>
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
  const modKeys = Object.keys(grouped).sort((a, b) => grouped[b].codes.length - grouped[a].codes.length)

  return (
    <div className="space-y-4">
      {/* 头部：角色名 + 描述 + 操作 */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3 border-b border-gray-200 dark:border-border/20">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{role.name}</h3>
            {role.is_system ? (
              <span className="text-[11px] font-bold px-1.5 py-0.3 rounded bg-amber-500/10 text-amber-500 border border-amber-500/15">系统内置</span>
            ) : (
              <span className="text-[11px] font-bold px-1.5 py-0.3 rounded bg-blue-500/10 text-blue-500 border border-blue-500/15">自定义</span>
            )}
            <span className="text-[11px] text-gray-500 dark:text-gray-500 font-mono">#{role.code}</span>
          </div>
          {role.description && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">{role.description}</p>
          )}
        </div>
        <div className="flex gap-2 self-start shrink-0">
          <button onClick={() => onEdit(role)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-bg-hover border border-gray-200 dark:border-border/30 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
            <Pencil size={11} /> 编辑
          </button>
          <button onClick={() => onDelete(role)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/15 transition-colors">
            <Trash2 size={11} /> 删除
          </button>
        </div>
      </div>

      {role.permission_codes.length === 0 ? (
        <div className="text-center py-10 rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-dashed border-gray-200 dark:border-border/20 text-gray-500">
          <ShieldAlert size={26} className="mx-auto opacity-30 mb-2" />
          <p className="text-xs">该角色未配置任何权限，点击「编辑」进行分配</p>
        </div>
      ) : (
        <>
          {/* 一行紧凑的统计条 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mr-1">已授权</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-accent-blue bg-accent-blue/8 border border-accent-blue/15 px-1.5 py-0.5 rounded">
              {role.permission_codes.length} 项
            </span>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{modKeys.length} 个模块</span>
          </div>

          {/* 模块权限：单行 chip 流，不再嵌套卡片 */}
          <div className="space-y-2.5">
            {modKeys.map(mod => (
              <div key={mod} className="flex items-start gap-2.5">
                <div className="flex items-center gap-1.5 shrink-0 w-24 pt-0.5">
                  <span className="text-xs">{MODULE_ICONS[mod] || '📦'}</span>
                  <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 truncate">{grouped[mod].name}</span>
                </div>
                <div className="flex-1 min-w-0 flex flex-wrap gap-1">
                  {grouped[mod].codes.map(code => {
                    const p = permissions.find(pp => pp.code === code)
                    return (
                      <span key={code} className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 dark:bg-accent-blue/8 text-gray-700 dark:text-blue-300 text-[11px] font-medium border border-gray-200 dark:border-accent-blue/12">
                        {p?.name || code}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
