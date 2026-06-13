import { useEffect, useState } from 'react'
import { Users, UserCheck, UserX, Lock, Shield, Building2 } from 'lucide-react'

interface UserStats {
  total: number
  active: number
  disabled: number
  resigned: number
  locked: number
  admin: number
  no_dept: number
}

export function UserStatsBar() {
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/v1/users/stats', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch {
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 30000)
    const onFocus = () => fetchStats()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const renderValue = (value: number | undefined) =>
    loading && value === undefined ? '-' : value ?? 0

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard icon={Users} color="blue" label="系统总成员" value={renderValue(stats?.total)} unit="人" />
      <StatCard icon={UserCheck} color="emerald" label="正常活跃" value={renderValue(stats?.active)} unit="人" />
      <StatCard icon={UserX} color="gray" label="已离职" value={renderValue(stats?.resigned)} unit="人" />
      <StatCard icon={Lock} color="red" label="登录锁定" value={renderValue(stats?.locked)} unit="个" />
      <StatCard icon={Shield} color="amber" label="系统管理员" value={renderValue(stats?.admin)} unit="人" />
      <StatCard icon={Building2} color="purple" label="待分配部门" value={renderValue(stats?.no_dept)} unit="人" />
    </div>
  )
}

function StatCard({ icon: Icon, color, label, value, unit }: { icon: any; color: 'blue' | 'emerald' | 'gray' | 'red' | 'amber' | 'purple'; label: string; value: number | string; unit: string }) {
  const palette: Record<string, { bg: string; icon: string; value: string }> = {
    blue: { bg: 'bg-accent-blue/10', icon: 'text-accent-blue', value: 'text-gray-900 dark:text-gray-100' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: 'text-emerald-500 dark:text-emerald-400', value: 'text-emerald-600 dark:text-emerald-400' },
    gray: { bg: 'bg-gray-100 dark:bg-gray-500/10', icon: 'text-gray-500 dark:text-gray-400', value: 'text-gray-500 dark:text-gray-400' },
    red: { bg: 'bg-red-50 dark:bg-red-500/10', icon: 'text-red-500 dark:text-red-400', value: 'text-red-500 dark:text-red-400' },
    amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', icon: 'text-amber-500 dark:text-amber-400', value: 'text-amber-600 dark:text-amber-400' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-500/10', icon: 'text-purple-500 dark:text-purple-400', value: 'text-purple-600 dark:text-purple-400' },
  }
  const c = palette[color]
  return (
    <div className="p-3.5 rounded-xl bg-bg-card border border-gray-200 dark:border-border/40 flex items-center gap-3 shadow-sm hover:border-gray-300 dark:hover:border-border/80 transition-all">
      <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}>
        <Icon size={16} className={c.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium leading-tight">{label}</p>
        <p className={`text-lg font-bold ${c.value} mt-0.5 leading-tight`}>
          {value} <span className="text-[10px] font-normal text-gray-500">{unit}</span>
        </p>
      </div>
    </div>
  )
}
