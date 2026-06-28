import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Shield, Save, Building2, User, Info } from 'lucide-react'
import type { UserData } from '../../services/types'
import {
  useUserDirectRolesQuery,
  useSetUserDirectRolesMutation,
  useRolesQuery,
} from '../../hooks/useUserManagementQueries'

interface UserRolesModalProps {
  isOpen: boolean
  user: UserData | null
  onClose: () => void
}

/**
 * 用户角色管理弹窗
 *
 * 用户的"有效角色" = 直接分配(UserRole) + 部门角色(DepartmentRole)
 * - 部门角色：只读展示（由部门绑定管理，本弹窗不可改）
 * - 直接分配：可勾选切换（覆盖式保存）
 */
export function UserRolesModal({ isOpen, user, onClose }: UserRolesModalProps) {
  const { data: allRoles = [], isLoading: rolesLoading } = useRolesQuery()
  const { data: directRoleIds = [], isLoading: directLoading } = useUserDirectRolesQuery(user?.id ?? null)
  const setRolesMutation = useSetUserDirectRolesMutation()

  // 本地草稿：用户当前在编辑的"直接分配"角色 id 集合
  const [draft, setDraft] = useState<Set<number>>(new Set())
  const [dirty, setDirty] = useState(false)

  // 打开弹窗或切换用户时，草稿初始化为后端当前直接分配
  useEffect(() => {
    if (isOpen && user) {
      setDraft(new Set(directRoleIds))
      setDirty(false)
    }
  }, [isOpen, user, directRoleIds])

  // 部门角色 = 后端返回的 user.roles 中属于 DepartmentRole 的部分
  // 由于后端当前 user.roles 是合并结果（直接+部门），这里无法严格区分；
  // 但交集 = 直接 + 部门，并集 = 有效集合。我们用「user.roles 减去 直接分配 = 部门角色」来近似
  const departmentRoleIds = useMemo(() => {
    if (!user?.roles) return new Set<number>()
    const effective = new Set(user.roles.map(r => r.id))
    const deptOnly = new Set<number>()
    for (const id of effective) {
      if (!directRoleIds.includes(id)) deptOnly.add(id)
    }
    return deptOnly
  }, [user, directRoleIds])

  const toggleDraft = (roleId: number) => {
    setDraft(prev => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return next
    })
    setDirty(true)
  }

  const handleSave = async () => {
    if (!user) return
    try {
      await setRolesMutation.mutateAsync({ userId: user.id, roleIds: Array.from(draft) })
      setDirty(false)
    } catch {
      // toast 由 mutation 处理
    }
  }

  const handleReset = () => {
    setDraft(new Set(directRoleIds))
    setDirty(false)
  }

  if (!isOpen || !user) return null

  const saving = setRolesMutation.isPending
  const loading = rolesLoading || directLoading

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-scaleIn" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border/15 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center text-accent-blue shrink-0">
              <Shield size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">角色分配 · {user.name || user.username}</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 font-mono truncate">@{user.username}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer"><X size={16} /></button>
        </div>

        {/* 提示 */}
        <div className="px-6 py-2.5 bg-blue-50/50 dark:bg-accent-blue/5 border-b border-blue-100 dark:border-accent-blue/10 flex items-start gap-2">
          <Info size={13} className="text-accent-blue mt-0.5 shrink-0" />
          <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
            <span className="font-bold text-accent-blue">直接分配</span> 与 <span className="font-bold text-accent-blue">部门角色</span> 取并集，组成该用户的有效权限。部门角色由部门绑定统一管理；如需调整请前往「部门管理」。
          </p>
        </div>

        {/* 角色列表 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <div className="py-16 text-center text-gray-500">
              <Loader2 size={18} className="mx-auto animate-spin mb-2" />
              <p className="text-xs">加载角色中…</p>
            </div>
          ) : (
            <>
              {/* 部门角色摘要 */}
              {departmentRoleIds.size > 0 && (
                <div className="rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-gray-200 dark:border-border/20 p-4">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Building2 size={12} className="text-gray-500" />
                    <span className="text-[11px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">来自部门</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto">只读</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allRoles.filter(r => departmentRoleIds.has(r.id)).map(r => (
                      <span key={r.id} className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-gray-200/60 dark:bg-bg-hover/40 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-border/20">
                        {r.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 直接分配 - 可编辑 */}
              <div>
                <div className="flex items-center gap-1.5 mb-2.5 px-1">
                  <User size={12} className="text-accent-blue" />
                  <span className="text-[11px] font-bold tracking-wider text-gray-700 dark:text-gray-300 uppercase">直接分配</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-500 ml-auto">
                    已选 <span className="text-accent-blue font-bold tabular-nums">{draft.size}</span> / {allRoles.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allRoles.map(r => {
                    const checked = draft.has(r.id)
                    const isDept = departmentRoleIds.has(r.id)
                    return (
                      <label
                        key={r.id}
                        className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                          checked
                            ? 'bg-accent-blue/5 border-accent-blue/40 shadow-sm'
                            : 'bg-bg-card border-gray-200 dark:border-border/30 hover:border-gray-300 dark:hover:border-border/60 hover:bg-gray-50/50 dark:hover:bg-bg-hover/20'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDraft(r.id)}
                          className="mt-0.5 w-3.5 h-3.5 accent-accent-blue cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs font-bold ${checked ? 'text-accent-blue' : 'text-gray-800 dark:text-gray-200'}`}>{r.name}</span>
                            {r.is_system && (
                              <span className="text-[11px] font-bold px-1 py-0.2 rounded bg-gray-100 dark:bg-bg-hover text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-border/20">系统</span>
                            )}
                            {isDept && checked && (
                              <span className="text-[11px] font-bold px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/15">与部门重复</span>
                            )}
                          </div>
                          {r.description && (
                            <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{r.description}</p>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 页脚 */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-border/15 shrink-0 bg-gray-50/50 dark:bg-bg-hover/10 flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500 dark:text-gray-500">
            {dirty ? <span className="text-amber-500 font-bold">● 有未保存的修改</span> : <span>所有修改已保存</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">关闭</button>
            <button onClick={handleReset} disabled={!dirty || saving} className="px-3.5 py-2 rounded-lg bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">还原</button>
            <button onClick={handleSave} disabled={!dirty || saving} className="px-4 py-2 rounded-lg bg-accent-blue text-[#fff] text-xs font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  , document.body)
}
