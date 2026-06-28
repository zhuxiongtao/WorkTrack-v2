import { useState, useMemo, useCallback } from 'react'
import { UserPlus } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import type { UserData, UserListParams } from '../../services/types'
import type { PaginatedResponse } from '../../services/types'
import { resendWelcomeEmail } from '../../services/userService'
import {
  useUserListQuery,
  useRolesQuery,
  useDeleteUserMutation,
  useToggleUserActiveMutation,
  useSetUserStatusMutation,
  useBatchUserActionMutation,
  useUnlockUserMutation,
} from '../../hooks/useUserManagementQueries'
import { UserStatsBar } from './UserStatsBar'
import { UserFilterBar } from './UserFilterBar'
import { UserTable } from './UserTable'
import { UserFormModal } from './UserFormModal'
import { ResetPasswordModal } from './ResetPasswordModal'
import { BatchActionsBar } from './BatchActionsBar'
import { UserRolesModal } from './UserRolesModal'

function getAvatarColor(name: string) {
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const colors = [
    'from-blue-500/20 to-indigo-500/20 text-blue-500 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
    'from-emerald-500/20 to-teal-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
    'from-purple-500/20 to-pink-500/20 text-purple-500 dark:text-purple-400 border-purple-200 dark:border-purple-500/30',
    'from-amber-500/20 to-orange-500/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    'from-rose-500/20 to-red-500/20 text-rose-500 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
    'from-cyan-500/20 to-blue-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/30',
  ]
  return colors[hash % colors.length]
}

function formatTime(s: string | null) {
  if (!s) return '-'
  return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

interface UserListTabProps {
  departmentId?: number | null
}

export function UserListTab({ departmentId }: UserListTabProps) {
  const { user: currentUser, hasPermission, fetchWithAuth } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()

  // 操作权限（与后端 require_permission 对齐：避免渲染会 403 的按钮）
  const canCreate = hasPermission('user:create')
  const canEdit = hasPermission('user:edit')
  const canDelete = hasPermission('user:delete')
  const canManageRoles = hasPermission('user:manage_roles')

  // 筛选状态
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<string | number>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [page, setPage] = useState(1)
  const pageSize = 20

  // 弹窗状态
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<UserData | null>(null)
  const [resetPwdUser, setResetPwdUser] = useState<UserData | null>(null)
  const [rolesUser, setRolesUser] = useState<UserData | null>(null)

  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 构建查询参数
  const queryParams: UserListParams = useMemo(() => ({
    page,
    page_size: pageSize,
    search: search || undefined,
    department_id: departmentId || undefined,
    role_id: filterRole !== 'all' ? Number(filterRole) : undefined,
    status: filterStatus as UserListParams['status'],
  }), [page, search, departmentId, filterRole, filterStatus])

  // 数据查询
  const { data, isLoading } = useUserListQuery(queryParams)
  const { data: roles = [] } = useRolesQuery()

  // 变更
  const deleteMutation = useDeleteUserMutation()
  const toggleActiveMutation = useToggleUserActiveMutation()
  const setStatusMutation = useSetUserStatusMutation()
  const batchActionMutation = useBatchUserActionMutation()
  const unlockMutation = useUnlockUserMutation()

  // 提取用户数据和分页信息
  const users = useMemo(() => {
    if (!data) return []
    if (Array.isArray(data)) return data as UserData[]
    return (data as PaginatedResponse<UserData>).items
  }, [data])

  const pagination = useMemo(() => {
    if (!data || Array.isArray(data)) return null
    const p = data as PaginatedResponse<UserData>
    return { page: p.page, total_pages: p.total_pages, total: p.total, page_size: p.page_size }
  }, [data])

  // 统计改由 UserStatsBar 自主调用 /api/v1/users/stats 拉取全量数据

  // 回调
  const openCreate = useCallback(() => {
    setEditingUser(null)
    setShowCreate(true)
  }, [])

  const openEdit = useCallback((u: UserData) => {
    setEditingUser(u)
    setShowCreate(true)
  }, [])

  const openRoles = useCallback((u: UserData) => {
    setRolesUser(u)
  }, [])

  const handleToggleActive = useCallback(async (u: UserData) => {
    if (u.id === currentUser?.id) { showToast('不能禁用自己的账号', 'warning'); return }
    const actionText = u.is_active ? '禁用' : '启用'
    if (!await showConfirm(`确定要${actionText}用户「${u.name || u.username}」的账号吗？`)) return
    toggleActiveMutation.mutate(u.id)
  }, [currentUser, showToast, showConfirm, toggleActiveMutation])

  const handleDelete = useCallback(async (u: UserData) => {
    if (u.id === currentUser?.id) { showToast('不能删除自己的账号', 'warning'); return }
    if (!await showConfirm(`确定删除用户「${u.name || u.username}」？\n此操作将同时删除其关联的所有日报、周报、合同、对话和项目配置等数据且不可恢复！`)) return
    deleteMutation.mutate(u.id)
  }, [currentUser, showToast, showConfirm, deleteMutation])

  const handleResendWelcome = useCallback(async (u: UserData) => {
    if (!await showConfirm(
      `确定要为「${u.name || u.username}」重发欢迎邮件吗？\n系统将生成新的临时密码并发送至 ${u.email}，用户原密码将立即失效。`
    )) return
    try {
      const res = await resendWelcomeEmail(fetchWithAuth, u.id)
      if (res.sent) {
        showToast(`欢迎邮件已发送至 ${u.email}`, 'success')
      } else {
        const pwd = res.initial_password
        showToast(`邮件服务未配置，新临时密码：${pwd}（请线下告知用户）`, 'warning')
      }
    } catch (e: any) {
      showToast(e.message || '发送失败', 'error')
    }
  }, [fetchWithAuth, showConfirm, showToast])

  const handleUnlock = useCallback(async (u: UserData) => {
    if (!await showConfirm(`确定要解除「${u.name || u.username}」的账号锁定吗？\n解锁后用户可立即重新尝试登录。`)) return
    unlockMutation.mutate(u.id)
  }, [showConfirm, unlockMutation])

  const handleSetStatus = useCallback(async (u: UserData, status: string) => {
    if (u.id === currentUser?.id) { showToast('不能修改自己的账号状态', 'warning'); return }
    const labelMap: Record<string, string> = { resigned: '离职', active: '启用', disabled: '停用' }
    const label = labelMap[status] || status
    if (!await showConfirm(`确定将用户「${u.name || u.username}」标记为${label}吗？${status === 'resigned' ? '\n标记后该用户将无法登录，并清除其所属部门和锁定状态。' : ''}`)) return
    setStatusMutation.mutate({ id: u.id, status })
  }, [currentUser, showToast, showConfirm, setStatusMutation])

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v)
    setPage(1)
    setSelectedIds(new Set())
  }, [])

  const handleRoleChange = useCallback((v: string | number) => {
    setFilterRole(v)
    setPage(1)
    setSelectedIds(new Set())
  }, [])

  const handleStatusChange = useCallback((v: string) => {
    setFilterStatus(v)
    setPage(1)
    setSelectedIds(new Set())
  }, [])

  const handleBatchAction = useCallback(async (
    action: 'enable' | 'disable' | 'resign' | 'set_department' | 'reset_password',
    departmentId?: number | null,
  ) => {
    const userIds = Array.from(selectedIds)
    if (userIds.length === 0) return
    const labels: Record<string, string> = {
      enable: '启用',
      disable: '停用',
      resign: '标记为离职',
      set_department: departmentId ? `调整部门到 ID=${departmentId}` : '移出部门',
      reset_password: '重置密码（系统自动生成 10 位随机密码，原密码作废）',
    }
    if (!await showConfirm(`确定要对已选的 ${userIds.length} 个用户执行「${labels[action]}」吗？`)) return
    batchActionMutation.mutate({ user_ids: userIds, action, department_id: departmentId })
    setSelectedIds(new Set())
  }, [selectedIds, showConfirm, batchActionMutation])

  return (
    <div className="space-y-4">
      <UserStatsBar />

      {canEdit && (
        <BatchActionsBar
          selectedCount={selectedIds.size}
          onClearSelection={() => setSelectedIds(new Set())}
          onAction={handleBatchAction}
          loading={batchActionMutation.isPending}
        />
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <UserFilterBar
            search={search} onSearchChange={handleSearchChange}
            roleId={filterRole} onRoleChange={handleRoleChange}
            status={filterStatus} onStatusChange={handleStatusChange}
            roles={roles}
          />
        </div>
        {canCreate && (
          <button
            onClick={openCreate}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 transition-colors cursor-pointer shadow-sm"
          >
            <UserPlus size={14} />
            录入新成员
          </button>
        )}
      </div>

      <UserTable
        users={users}
        loading={isLoading}
        currentUserId={currentUser?.id ?? 0}
        pagination={pagination}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onPageChange={setPage}
        onEdit={openEdit}
        onToggleActive={handleToggleActive}
        onSetStatus={handleSetStatus}
        onDelete={handleDelete}
        onResetPassword={(u) => setResetPwdUser(u)}
        onResendWelcome={handleResendWelcome}
        onManageRoles={openRoles}
        onUnlock={handleUnlock}
        canEdit={canEdit}
        canDelete={canDelete}
        canManageRoles={canManageRoles}
        getAvatarColor={getAvatarColor}
        formatTime={formatTime}
      />

      <UserFormModal
        isOpen={showCreate}
        editingUser={editingUser}
        onClose={() => { setShowCreate(false); setEditingUser(null) }}
      />

      <ResetPasswordModal
        isOpen={resetPwdUser !== null}
        user={resetPwdUser}
        onClose={() => setResetPwdUser(null)}
      />

      <UserRolesModal
        isOpen={rolesUser !== null}
        user={rolesUser}
        onClose={() => setRolesUser(null)}
      />
    </div>
  )
}
