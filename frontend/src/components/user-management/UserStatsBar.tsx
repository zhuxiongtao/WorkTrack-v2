import { Users, UserCheck, UserX, Lock } from 'lucide-react'

interface UserStatsBarProps {
  total: number
  active: number
  resigned: number
  locked: number
}

export function UserStatsBar({ total, active, resigned, locked }: UserStatsBarProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="p-4 rounded-xl bg-bg-card border border-gray-200 dark:border-border/40 flex items-center gap-4 shadow-sm hover:border-gray-300 dark:hover:border-border/80 transition-all">
        <div className="w-10 h-10 rounded-lg bg-accent-blue/10 flex items-center justify-center shrink-0">
          <Users size={18} className="text-accent-blue" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">系统总成员</p>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">{total} <span className="text-xs font-normal text-gray-500">人</span></p>
        </div>
      </div>
      <div className="p-4 rounded-xl bg-bg-card border border-gray-200 dark:border-border/40 flex items-center gap-4 shadow-sm hover:border-gray-300 dark:hover:border-border/80 transition-all">
        <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0">
          <UserCheck size={18} className="text-emerald-500 dark:text-emerald-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">正常活跃中</p>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{active} <span className="text-xs font-normal text-gray-500">人</span></p>
        </div>
      </div>
      <div className="p-4 rounded-xl bg-bg-card border border-gray-200 dark:border-border/40 flex items-center gap-4 shadow-sm hover:border-gray-300 dark:hover:border-border/80 transition-all">
        <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-500/10 flex items-center justify-center shrink-0">
          <UserX size={18} className="text-gray-500 dark:text-gray-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">已离职</p>
          <p className="text-xl font-bold text-gray-500 dark:text-gray-400 mt-0.5">{resigned} <span className="text-xs font-normal text-gray-500">人</span></p>
        </div>
      </div>
      <div className="p-4 rounded-xl bg-bg-card border border-gray-200 dark:border-border/40 flex items-center gap-4 shadow-sm hover:border-gray-300 dark:hover:border-border/80 transition-all">
        <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center shrink-0">
          <Lock size={18} className="text-red-500 dark:text-red-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">登录锁定中</p>
          <p className="text-xl font-bold text-red-500 dark:text-red-400 mt-0.5">{locked} <span className="text-xs font-normal text-gray-500">个</span></p>
        </div>
      </div>
    </div>
  )
}
