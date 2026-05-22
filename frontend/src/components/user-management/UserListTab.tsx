import { useState, useMemo, useCallback } from 'react'
import { UserPlus } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import type { UserData, UserListParams } from '../../services/types'
import type { PaginatedResponse } from '../../services/types'
import {
  useUserListQuery,
  useRolesQuery,
  useDeleteUserMutation,
  useToggleUserActiveMutation,
  useSetUserStatusMutation,
} from '../../hooks/useUserManagementQueries'
import { UserStatsBar } from './UserStatsBar'
import { UserFilterBar } from './UserFilterBar'
import { UserTable } from './UserTable'
import { UserFormModal } from './UserFormModal'
import { ResetPasswordModal } from './ResetPasswordModal'

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
  const { user: currentUser } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()

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

  // 计算统计
  const stats = useMemo(() => {
    const allUsers = users
    return {
      total: pagination?.total ?? allUsers.length,
      active: allUsers.filter(u => u.status === 'active').length,
      resigned: allUsers.filter(u => u.status === 'resigned').length,
      locked: allUsers.filter(u => u.locked_until && new Date(u.locked_until) > new Date()).length,
    }
  }, [users, pagination])

  // 回调
  const openCreate = useCallback(() => {
    setEditingUser(null)
    setShowCreate(true)
  }, [])

  const openEdit = useCallback((u: UserData) => {
    setEditingUser(u)
    setShowCreate(true)
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
  }, [])

  const handleRoleChange = useCallback((v: string | number) => {
    setFilterRole(v)
    setPage(1)
  }, [])

  const handleStatusChange = useCallback((v: string) => {
    setFilterStatus(v)
    setPage(1)
  }, [])

  return (
    <div className="space-y-4">
      <UserStatsBar total={stats.total} active={stats.active} resigned={stats.resigned} locked={stats.locked} />

      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <UserFilterBar
            search={search} onSearchChange={handleSearchChange}
            roleId={filterRole} onRoleChange={handleRoleChange}
            status={filterStatus} onStatusChange={handleStatusChange}
            roles={roles}
          />
        </div>
        <button
          onClick={openCreate}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 transition-colors cursor-pointer shadow-sm"
        >
          <UserPlus size={14} />
          录入新成员
        </button>
      </div>

      <UserTable
        users={users}
        loading={isLoading}
        currentUserId={currentUser?.id ?? 0}
        pagination={pagination}
        onPageChange={setPage}
        onEdit={openEdit}
        onToggleActive={handleToggleActive}
        onSetStatus={handleSetStatus}
        onDelete={handleDelete}
        onResetPassword={(u) => setResetPwdUser(u)}
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
    </div>
  )
}
