import { Loader2, Users } from 'lucide-react'
import type { UserData } from '../../services/types'
import { UserTableRow } from './UserTableRow'

interface PaginationInfo {
  page: number
  total_pages: number
  total: number
  page_size: number
}

interface UserTableProps {
  users: UserData[]
  loading: boolean
  currentUserId: number
  pagination: PaginationInfo | null
  onPageChange: (page: number) => void
  onEdit: (user: UserData) => void
  onToggleActive: (user: UserData) => void
  onSetStatus: (user: UserData, status: string) => void
  onDelete: (user: UserData) => void
  onResetPassword: (user: UserData) => void
  getAvatarColor: (name: string) => string
  formatTime: (s: string | null) => string
}

export function UserTable({
  users, loading, currentUserId, pagination,
  onPageChange, onEdit, onToggleActive, onSetStatus, onDelete, onResetPassword,
  getAvatarColor, formatTime,
}: UserTableProps) {
  if (loading) {
    return (
      <div className="text-center py-20 text-gray-500 rounded-xl bg-bg-card border border-gray-200 dark:border-border/30">
        <Loader2 size={24} className="mx-auto animate-spin mb-3 text-accent-blue" />
        <span className="text-xs">正在获取成员列表数据...</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-bg-card border border-gray-200 dark:border-border/40 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-bg-hover/30 border-b border-gray-200 dark:border-border/30">
              <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400">用户信息</th>
              <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400">所属部门</th>
              <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400">系统特权</th>
              <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400">AI模型权限</th>
              <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">状态</th>
              <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400 text-right">最后登录</th>
              <th className="px-5 py-3.5 text-xs font-semibold text-gray-500 dark:text-gray-400 text-right">管理操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-border/20">
            {users.map((u) => (
              <UserTableRow
                key={u.id}
                user={u}
                isSelf={u.id === currentUserId}
                onEdit={() => onEdit(u)}
                onToggleActive={() => onToggleActive(u)}
                onDelete={() => onDelete(u)}
                onSetStatus={(status: string) => onSetStatus(u, status)}
                onResetPassword={() => onResetPassword(u)}
                getAvatarColor={getAvatarColor}
                formatTime={formatTime}
              />
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-16 text-gray-500">
                  <Users size={32} className="mx-auto text-gray-400 dark:text-gray-600 opacity-40 mb-2" />
                  <p className="text-xs">无匹配的成员账号数据</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页控件 */}
      {pagination && pagination.total_pages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-border/20 bg-gray-50/50 dark:bg-bg-hover/10">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            共 {pagination.total} 条记录，第 {pagination.page}/{pagination.total_pages} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-border/30 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-bg-hover transition-colors cursor-pointer text-gray-700 dark:text-gray-300"
            >
              上一页
            </button>
            {Array.from({ length: Math.min(pagination.total_pages, 7) }, (_, i) => {
              let pageNum: number
              if (pagination.total_pages <= 7) {
                pageNum = i + 1
              } else if (pagination.page <= 4) {
                pageNum = i + 1
              } else if (pagination.page >= pagination.total_pages - 3) {
                pageNum = pagination.total_pages - 6 + i
              } else {
                pageNum = pagination.page - 3 + i
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    pageNum === pagination.page
                      ? 'bg-accent-blue text-white shadow-sm'
                      : 'border border-gray-200 dark:border-border/30 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-bg-hover'
                  }`}
                >
                  {pageNum}
                </button>
              )
            })}
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.total_pages}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-border/30 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-bg-hover transition-colors cursor-pointer text-gray-700 dark:text-gray-300"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
