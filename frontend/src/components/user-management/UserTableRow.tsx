import { Crown, Lock, LockOpen, UserX, UserCheck, Shield, Mail } from 'lucide-react'
import type { UserData } from '../../services/types'

interface UserTableRowProps {
  user: UserData
  isSelf: boolean
  selected: boolean
  onSelectChange: () => void
  onEdit: () => void
  onToggleActive: () => void
  onSetStatus: (status: string) => void
  onDelete: () => void
  onResetPassword: () => void
  onResendWelcome: () => void
  onManageRoles: () => void
  onUnlock: () => void
  canEdit: boolean
  canDelete: boolean
  canManageRoles: boolean
  getAvatarColor: (name: string) => string
  formatTime: (s: string | null) => string
}

export function UserTableRow({
  user: u, isSelf, selected, onSelectChange, onEdit, onToggleActive, onSetStatus, onDelete, onResetPassword, onResendWelcome, onManageRoles, onUnlock,
  canEdit, canDelete, canManageRoles,
  getAvatarColor, formatTime,
}: UserTableRowProps) {
  const isLocked = u.locked_until && new Date(u.locked_until) > new Date()

  return (
    <tr className={`hover:bg-gray-50/50 dark:hover:bg-bg-hover/20 transition-colors ${selected ? 'bg-accent-blue/5' : ''}`}>
      <td className="px-3 py-4 w-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelectChange}
          disabled={isSelf}
          className="w-3.5 h-3.5 rounded border-gray-300 text-accent-blue focus:ring-accent-blue cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      {/* 个人信息 */}
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold border shrink-0 ${getAvatarColor(u.name || u.username)}`}>
            {(u.name || u.username)[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-900 dark:text-gray-100 font-semibold text-sm truncate">{u.name || u.username}</span>
              {isSelf && (
                <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-gray-100 dark:bg-bg-hover text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-border/20">自己</span>
              )}
              {u.status === 'resigned' && (
                <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-gray-100 dark:bg-gray-500/20 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-border/20">已离职</span>
              )}
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 block truncate mt-0.5">{u.username} {u.email ? `· ${u.email}` : ''}</span>
          </div>
        </div>
      </td>

      {/* 所属部门 */}
      <td className="px-5 py-4">
        {u.department_name ? (
          <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium border border-blue-200 dark:border-blue-500/20 shadow-sm whitespace-nowrap">
            {u.department_name}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">未分配</span>
        )}
      </td>

      {/* 系统角色/特权 */}
      <td className="px-5 py-4">
        {u.is_admin ? (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold border border-amber-200 dark:border-amber-500/20 shadow-sm whitespace-nowrap">
            <Crown size={11} className="text-amber-500" /> 管理员
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-gray-50 dark:bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-border/20 whitespace-nowrap">
            普通成员
          </span>
        )}
      </td>

      {/* AI配置特权 */}
      <td className="px-5 py-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          {u.is_admin ? (
            <span className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 shadow-sm font-bold whitespace-nowrap" title="管理员天然拥有全套自管与共享 AI 模型管理及调用特权">
              全部 AI 特权
            </span>
          ) : (
            <>
              {u.can_manage_models && (
                <span className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 shadow-sm whitespace-nowrap" title="自主配置专有模型 API key">
                  自管模型
                </span>
              )}
              {u.use_shared_models && (
                <span className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20 shadow-sm whitespace-nowrap" title="可调用管理员预配置的平台公共共享模型">
                  共享模型
                </span>
              )}
              {!u.can_manage_models && !u.use_shared_models && (
                <span className="text-[11px] text-gray-400">无 AI 访问权</span>
              )}
            </>
          )}
        </div>
      </td>

      {/* 状态 */}
      <td className="px-5 py-4 text-center">
        <div className="inline-flex flex-col items-center gap-1">
          {u.status === 'resigned' ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-500/20 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-border/20 font-semibold whitespace-nowrap">
              <UserX size={10} /> 已离职
            </span>
          ) : u.status === 'disabled' ? (
            <button
              onClick={canEdit ? onToggleActive : undefined}
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full transition-all font-semibold shadow-sm bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/15 whitespace-nowrap disabled:cursor-default disabled:opacity-90 enabled:cursor-pointer"
              title={!canEdit ? "账号已停用" : (isSelf ? "不能操作自己的账号" : "点击启用账号")}
              disabled={isSelf || !canEdit}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 dark:bg-red-400" />
              已停用
            </button>
          ) : (
            <button
              onClick={canEdit ? onToggleActive : undefined}
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full transition-all font-semibold shadow-sm bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/15 whitespace-nowrap disabled:cursor-default disabled:opacity-90 enabled:cursor-pointer"
              title={!canEdit ? "账号正常" : (isSelf ? "不能禁用自己的账号" : "点击停用账号")}
              disabled={isSelf || !canEdit}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              正常
            </button>
          )}
          {isLocked && (
            <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 font-bold whitespace-nowrap" title={`因密码错误被锁定至 ${formatTime(u.locked_until)}`}>
              <Lock size={9} /> 已锁定
            </span>
          )}
        </div>
      </td>

      {/* 最后登录 */}
      <td className="px-5 py-4 text-right text-xs text-gray-500 dark:text-gray-400 font-mono">{formatTime(u.last_login_at)}</td>

      {/* 操作 */}
      <td className="px-5 py-4 text-right">
        <div className="flex items-center justify-end gap-1">
          {canEdit && isLocked && (
            <button
              onClick={onUnlock}
              className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 text-red-400 hover:text-amber-500 transition-colors cursor-pointer"
              title="解除账号锁定"
            >
              <LockOpen size={14} />
            </button>
          )}
          {canManageRoles && (
            <button onClick={onManageRoles} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-accent-blue/10 text-gray-400 hover:text-accent-blue transition-colors cursor-pointer" title="管理角色">
              <Shield size={14} />
            </button>
          )}
          {canEdit && (
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer" title="编辑个人资料">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
          )}
          {canEdit && u.email && (
            <button onClick={onResendWelcome} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors cursor-pointer" title="重发欢迎邮件（生成新密码并发送）" disabled={isSelf}>
              <Mail size={14} />
            </button>
          )}
          {canEdit && (
            <button onClick={onResetPassword} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors cursor-pointer" title="重置登录密码">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            </button>
          )}
          {/* 离职操作按钮——仅对活跃用户显示 */}
          {canEdit && u.status === 'active' && (
            <button
              onClick={() => onSetStatus('resigned')}
              className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 text-gray-400 hover:text-amber-500 transition-colors cursor-pointer"
              title="标记为离职"
              disabled={isSelf}
            >
              <UserX size={14} />
            </button>
          )}
          {/* 恢复操作——对已离职用户 */}
          {canEdit && u.status === 'resigned' && (
            <button
              onClick={() => onSetStatus('active')}
              className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-gray-400 hover:text-emerald-500 transition-colors cursor-pointer"
              title="恢复为正常状态"
            >
              <UserCheck size={14} />
            </button>
          )}
          {canDelete && (
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors cursor-pointer" title="物理删除成员" disabled={isSelf}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          )}
          {!canManageRoles && !canEdit && !canDelete && (
            <span className="text-[11px] text-gray-400">仅查看</span>
          )}
        </div>
      </td>
    </tr>
  )
}
