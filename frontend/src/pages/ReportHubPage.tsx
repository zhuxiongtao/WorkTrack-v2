import { useState } from 'react'
import { BookOpen, BarChart3 } from 'lucide-react'
import ReportsPageContent from './ReportsPage'
import WeeklyReportContent from './WeeklyReportPage'

export default function ReportHubPage() {
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily')

  return (
    <div>
      {/* Tab 切换 */}
      <div className="flex items-center gap-1 mb-6 p-1 rounded-xl bg-bg-card border border-border w-fit">
        <button
          onClick={() => setTab('daily')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'daily'
              ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <BookOpen size={16} />
          日报
        </button>
        <button
          onClick={() => setTab('weekly')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'weekly'
              ? 'bg-accent-blue text-white shadow-lg shadow-accent-blue/20'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <BarChart3 size={16} />
          周报
        </button>
      </div>

      {/* 内容区 */}
      {tab === 'daily' ? <ReportsPageContent /> : <WeeklyReportContent />}
    </div>
  )
}
