import { useState, useEffect } from 'react'
import { Activity, Users, FileText, Briefcase, Headphones, FileCheck, Clock, Database, HardDrive, Cpu, MemoryStick, Server } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

interface MonitorData {
  business: {
    users: { total: number; active: number }
    customers: { total: number }
    reports: { total: number; draft: number; submitted: number }
    weekly_summaries: { total: number }
    projects: { total: number; by_status: Record<string, number> }
    meetings: { total: number }
    contracts: { total: number }
    scheduled_tasks: { total: number }
    model_providers: { total: number }
  }
  system: {
    cpu_percent: number
    memory: { total: number; used: number; percent: number; available: number }
    disk: { total: number; used: number; percent: number; free: number }
  }
  storage: {
    database_bytes: number
    data_bytes: number
    uploads_bytes: number
    chroma_bytes: number
    audio_bytes: number
    total_bytes: number
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function StatCard({ icon: Icon, label, value, sub, color = 'blue' }: { icon: typeof Users; label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-emerald-500 to-emerald-600',
    purple: 'from-purple-500 to-purple-600',
    amber: 'from-amber-500 to-amber-600',
    rose: 'from-rose-500 to-rose-600',
    cyan: 'from-cyan-500 to-cyan-600',
    indigo: 'from-indigo-500 to-indigo-600',
    orange: 'from-orange-500 to-orange-600',
    teal: 'from-teal-500 to-teal-600',
    slate: 'from-slate-500 to-slate-600',
  }
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[color] || colors.blue} flex items-center justify-center text-[#fff] shadow-sm`}>
          <Icon size={18} />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{label}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{value}</p>
          {sub && <p className="text-[11px] text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
      </div>
    </div>
  )
}

function ResourceBar({ label, percent, used, total, color = 'blue' }: { label: string; percent: number; used: string; total: string; color?: string }) {
  const barColors: Record<string, string> = {
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  }
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="font-semibold text-gray-700 dark:text-gray-300">{label}</span>
        <span className="text-gray-500 dark:text-gray-400">{used} / {total}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div className={`h-full rounded-full ${barColors[color] || barColors.blue} transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <p className="text-right text-[11px] text-gray-400">{percent.toFixed(1)}%</p>
    </div>
  )
}

export default function MonitorPage() {
  const { fetchWithAuth } = useAuth()
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchWithAuth('/api/v1/monitor/stats')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="animate-pulse text-gray-400 flex items-center gap-2">
          <Activity size={18} className="animate-spin" /> 加载运维数据...
        </div>
      </div>
    )
  }

  if (!data) return <div className="p-8 text-center text-gray-500">加载失败</div>

  const b = data.business
  const s = data.system
  const st = data.storage

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Activity size={22} className="text-blue-500" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">运维监控</h1>
        <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">实时</span>
      </div>

      {/* 业务统计 */}
      <div>
        <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Briefcase size={14} /> 业务概览
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard icon={Users} label="用户" value={b.users.total} sub={`${b.users.active} 活跃`} color="blue" />
          <StatCard icon={Users} label="客户" value={b.customers.total} color="green" />
          <StatCard icon={FileText} label="日报" value={b.reports.total} sub={`${b.reports.submitted} 已提交 / ${b.reports.draft} 草稿`} color="purple" />
          <StatCard icon={FileText} label="周报" value={b.weekly_summaries.total} color="indigo" />
          <StatCard icon={Briefcase} label="项目" value={b.projects.total} color="amber" />
          <StatCard icon={Headphones} label="会议纪要" value={b.meetings.total} color="cyan" />
          <StatCard icon={FileCheck} label="合同" value={b.contracts.total} color="teal" />
          <StatCard icon={Clock} label="定时任务" value={b.scheduled_tasks.total} color="orange" />
          <StatCard icon={Database} label="模型供应商" value={b.model_providers.total} color="slate" />
        </div>
      </div>

      {/* 项目状态分布 */}
      {Object.keys(b.projects.by_status).length > 0 && (
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-3">项目状态分布</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(b.projects.by_status).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700/50 px-3 py-1.5 rounded-lg">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{status}</span>
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 系统资源 */}
      <div>
        <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Server size={14} /> 系统资源
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <StatCard icon={Cpu} label="CPU 使用率" value={`${s.cpu_percent}%`} color={s.cpu_percent > 80 ? 'rose' : 'blue'} />
          <StatCard icon={MemoryStick} label="内存使用率" value={`${s.memory.percent.toFixed(1)}%`} sub={`${formatBytes(s.memory.used)} / ${formatBytes(s.memory.total)}`} color={s.memory.percent > 80 ? 'rose' : 'amber'} />
          <StatCard icon={HardDrive} label="磁盘使用率" value={`${s.disk.percent.toFixed(1)}%`} sub={`${formatBytes(s.disk.used)} / ${formatBytes(s.disk.total)}`} color={s.disk.percent > 80 ? 'rose' : 'green'} />
        </div>
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5 shadow-sm space-y-4">
          <ResourceBar label="CPU" percent={s.cpu_percent} used={`${s.cpu_percent}%`} total="100%" color={s.cpu_percent > 80 ? 'rose' : 'blue'} />
          <ResourceBar label="内存" percent={s.memory.percent} used={formatBytes(s.memory.used)} total={formatBytes(s.memory.total)} color={s.memory.percent > 80 ? 'rose' : 'amber'} />
          <ResourceBar label="磁盘" percent={s.disk.percent} used={formatBytes(s.disk.used)} total={formatBytes(s.disk.total)} color={s.disk.percent > 80 ? 'rose' : 'green'} />
        </div>
      </div>

      {/* 存储分布 */}
      <div>
        <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <HardDrive size={14} /> 存储分布
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard icon={Database} label="数据库" value={formatBytes(st.database_bytes)} color="blue" />
          <StatCard icon={HardDrive} label="数据目录" value={formatBytes(st.data_bytes)} color="purple" />
          <StatCard icon={HardDrive} label="上传文件" value={formatBytes(st.uploads_bytes)} color="amber" />
          <StatCard icon={Database} label="向量库" value={formatBytes(st.chroma_bytes)} color="indigo" />
          <StatCard icon={Headphones} label="音频文件" value={formatBytes(st.audio_bytes)} color="cyan" />
          <StatCard icon={HardDrive} label="总计" value={formatBytes(st.total_bytes)} color="rose" />
        </div>
      </div>
    </div>
  )
}
