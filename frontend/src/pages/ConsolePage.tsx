import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  LayoutGrid, Users, Briefcase, Calendar, FileText, ChevronRight, ChevronDown,
  BarChart3, TrendingUp, Clock, Search, User, X, type LucideIcon
} from 'lucide-react'
import { IconBox } from '../components/design-system'
import type { Tone } from '../theme/tokens'

interface DeptNode {
  id: number
  name: string
  manager_id: number | null
  manager_name: string
  member_count: number
  children: DeptNode[]
}

interface MemberStats {
  id: number
  name: string
  username: string
  avatar: string | null
  department_id: number | null
  department_name: string
  job_title: string | null
  reports_this_week: number
  active_projects: number
  recent_meetings: number
}

interface OverviewData {
  stats: {
    reports_this_week: number
    active_projects: number
    recent_meetings: number
    total_customers: number
    member_count: number
  }
  members: MemberStats[]
  scope: string
  period: {
    week_start: string
    week_end: string
  }
}

interface DeptMembersData {
  department: { id: number; name: string; manager_id: number | null }
  member_count: number
  members: MemberStats[]
}

export default function ConsolePage() {
  const { user } = useAuth()
  const [deptTree, setDeptTree] = useState<DeptNode[]>([])
  const [expandedDepts, setExpandedDepts] = useState<Set<number>>(new Set())
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [deptMembers, setDeptMembers] = useState<DeptMembersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')

  // 加载部门树
  const loadDeptTree = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users/departments/tree')
      if (res.ok) {
        const data = await res.json()
        setDeptTree(data)
      }
    } catch (e) {
      console.error('Failed to load dept tree:', e)
    }
  }, [])

  // 加载概览数据
  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/console/overview')
      if (res.ok) {
        const data = await res.json()
        setOverview(data)
      } else if (res.status === 403) {
        setOverview(null)
      }
    } catch (e) {
      console.error('Failed to load overview:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // 加载部门成员
  const loadDeptMembers = useCallback(async (deptId: number) => {
    try {
      const res = await fetch(`/api/v1/console/dept/${deptId}/members`)
      if (res.ok) {
        const data = await res.json()
        setDeptMembers(data)
      }
    } catch (e) {
      console.error('Failed to load dept members:', e)
    }
  }, [])

  useEffect(() => {
    loadDeptTree()
    loadOverview()
  }, [loadDeptTree, loadOverview])

  useEffect(() => {
    if (selectedDeptId) {
      loadDeptMembers(selectedDeptId)
    } else {
      setDeptMembers(null)
    }
  }, [selectedDeptId, loadDeptMembers])

  const toggleDept = (deptId: number) => {
    setExpandedDepts(prev => {
      const next = new Set(prev)
      if (next.has(deptId)) {
        next.delete(deptId)
      } else {
        next.add(deptId)
      }
      return next
    })
  }

  const handleDeptClick = (deptId: number) => {
    setSelectedDeptId(deptId)
    setSelectedMemberId(null)
    toggleDept(deptId)
  }

  const handleMemberClick = (memberId: number) => {
    setSelectedMemberId(memberId)
  }

  const handleBackToOverview = () => {
    setSelectedDeptId(null)
    setSelectedMemberId(null)
    setDeptMembers(null)
  }

  // 过滤成员列表
  const filteredMembers = (deptMembers?.members || overview?.members || []).filter(m =>
    !searchText || m.name.toLowerCase().includes(searchText.toLowerCase()) || m.username.toLowerCase().includes(searchText.toLowerCase())
  )

  // 渲染部门节点
  const renderDeptNode = (node: DeptNode, depth: number = 0) => {
    const isExpanded = expandedDepts.has(node.id)
    const isSelected = selectedDeptId === node.id
    const hasChildren = node.children.length > 0

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
            isSelected ? 'bg-bg-hover text-white' : 'hover:bg-bg-hover/50 text-gray-300'
          }`}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          onClick={() => handleDeptClick(node.id)}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <Users size={14} className="shrink-0 text-gray-500" />
          <span className="truncate flex-1 text-sm">{node.name}</span>
          <span className="text-[11px] text-gray-500 shrink-0">{node.member_count}人</span>
        </div>
        {isExpanded && hasChildren && (
          <div>
            {node.children.map(child => renderDeptNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // 统计卡片
  const StatCard = ({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: Tone }) => (
    <div className="bg-bg-card border border-border rounded-xl p-4 max-md:p-3">
      <div className="flex items-center gap-3 max-md:gap-2">
        <IconBox icon={Icon} size="md" tone={tone} variant="solid" />
        <div>
          <div className="text-2xl max-md:text-xl font-bold text-white">{value}</div>
          <div className="text-xs max-md:text-[11px] text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  )

  // 成员行
  const MemberRow = ({ member, onClick }: { member: MemberStats; onClick: () => void }) => (
    <div
      className="flex items-center gap-4 px-4 py-3 hover:bg-bg-hover/50 rounded-lg cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="w-9 h-9 rounded-full bg-bg-hover flex items-center justify-center shrink-0 overflow-hidden">
        {member.avatar ? (
          <img src={member.avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          <User size={16} className="text-gray-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{member.name}</div>
        <div className="text-[11px] text-gray-500 truncate">{member.department_name}</div>
      </div>
      <div className="flex items-center gap-6 max-md:gap-3 text-xs shrink-0">
        <div className="flex items-center gap-1.5 max-md:hidden" title="本周日报">
          <FileText size={12} className="text-green-500" />
          <span className={member.reports_this_week > 0 ? 'text-green-400' : 'text-gray-600'}>{member.reports_this_week}</span>
        </div>
        <div className="flex items-center gap-1.5" title="活跃项目">
          <Briefcase size={12} className="text-blue-500" />
          <span className={member.active_projects > 0 ? 'text-blue-400' : 'text-gray-600'}>{member.active_projects}</span>
        </div>
        <div className="flex items-center gap-1.5" title="近期会议">
          <Calendar size={12} className="text-purple-500" />
          <span className={member.recent_meetings > 0 ? 'text-purple-400' : 'text-gray-600'}>{member.recent_meetings}</span>
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-gray-600 border-t-[#3B82F6] rounded-full" />
      </div>
    )
  }

  if (!overview && !user?.is_admin) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <LayoutGrid size={48} className="text-gray-600 mx-auto mb-4" />
          <h2 className="text-lg text-gray-400 mb-2">暂无权限</h2>
          <p className="text-sm text-gray-500">您需要具备管理总览权限才能访问此页面</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-bg-page">
      {/* 左侧面板：部门树 */}
      <div className="w-64 max-md:hidden shrink-0 bg-bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <IconBox icon={LayoutGrid} size="md" tone="red" variant="solid" />
            <h2 className="text-sm font-medium text-white">管理总览</h2>
          </div>
        </div>
        
        {/* 搜索框 */}
        <div className="px-3 py-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="搜索成员..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="w-full bg-bg-hover border border-border rounded-lg pl-8 pr-8 py-1.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-[#3B82F6]/50"
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* 部门树 */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {deptTree.length === 0 ? (
            <div className="text-center text-xs text-gray-500 py-8">暂无部门数据</div>
          ) : (
            deptTree.map(node => renderDeptNode(node))
          )}
        </div>

        {/* 底部：返回概览 */}
        {(selectedDeptId || selectedMemberId) && (
          <div className="p-3 border-t border-border">
            <button
              onClick={handleBackToOverview}
              className="w-full px-3 py-2 text-xs text-gray-400 hover:text-white bg-bg-hover rounded-lg transition-colors"
            >
              返回总览
            </button>
          </div>
        )}
      </div>

      {/* 右侧主区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部统计卡片 */}
        <div className="p-6 max-md:p-4 border-b border-border">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-md:gap-3">
            <StatCard icon={FileText}  label="本周日报" value={overview?.stats.reports_this_week || 0} tone="green" />
            <StatCard icon={Briefcase} label="活跃项目" value={overview?.stats.active_projects || 0} tone="blue" />
            <StatCard icon={Calendar}  label="近期会议" value={overview?.stats.recent_meetings || 0} tone="purple" />
            <StatCard icon={Users}     label="团队成员" value={overview?.stats.member_count || 0} tone="orange" />
          </div>
          {overview?.period && (
            <div className="mt-3 text-xs text-gray-500">
              统计周期：{overview.period.week_start} ~ {overview.period.week_end}
            </div>
          )}
        </div>

        {/* 成员列表 */}
        <div className="flex-1 overflow-y-auto p-6 max-md:p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              {selectedDeptId && deptMembers ? (
                <>
                  <Users size={16} className="text-blue-500" />
                  {deptMembers.department.name}
                  <span className="text-xs text-gray-500">({deptMembers.member_count}人)</span>
                </>
              ) : (
                <>
                  <BarChart3 size={16} className="text-rose-500" />
                  团队成员概览
                  <span className="text-xs text-gray-500">({filteredMembers.length}人)</span>
                </>
              )}
            </h3>
          </div>

          {filteredMembers.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <Users size={32} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">{searchText ? '未找到匹配的成员' : '暂无成员数据'}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredMembers.map(member => (
                <MemberRow
                  key={member.id}
                  member={member}
                  onClick={() => handleMemberClick(member.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 成员详情侧滑面板 */}
      {selectedMemberId && (
        <div className="w-80 max-md:fixed max-md:inset-0 max-md:w-full max-md:z-50 max-md:bg-bg-card shrink-0 bg-bg-card border-l border-border max-md:border-l-0 flex flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">成员详情</h3>
            <button
              onClick={() => setSelectedMemberId(null)}
              className="text-gray-500 hover:text-gray-300"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <MemberDetail memberId={selectedMemberId} />
          </div>
        </div>
      )}
    </div>
  )
}

// 成员详情组件
function MemberDetail({ memberId }: { memberId: number }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'reports' | 'projects' | 'meetings'>('reports')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/v1/console/member/${memberId}/summary`)
        if (res.ok) {
          const d = await res.json()
          setData(d)
        }
      } catch (e) {
        console.error('Failed to load member:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [memberId])

  if (loading) {
    return <div className="text-center text-gray-500 py-8">加载中...</div>
  }

  if (!data) {
    return <div className="text-center text-gray-500 py-8">无法加载数据</div>
  }

  const tabs = [
    { key: 'reports', label: '日报', count: data.weekly_reports?.length || 0 },
    { key: 'projects', label: '项目', count: data.active_projects?.length || 0 },
    { key: 'meetings', label: '会议', count: data.recent_meetings?.length || 0 },
  ] as const

  return (
    <div>
      {/* 用户信息 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full bg-bg-hover flex items-center justify-center overflow-hidden">
          {data.user.avatar ? (
            <img src={data.user.avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <User size={20} className="text-gray-500" />
          )}
        </div>
        <div>
          <div className="text-sm font-medium text-white">{data.user.name}</div>
          <div className="text-xs text-gray-500">@{data.user.username}</div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 mb-4 bg-bg-hover rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === tab.key
                ? 'bg-bg-card text-white shadow-sm'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* 内容列表 */}
      <div className="space-y-2">
        {activeTab === 'reports' && (
          data.weekly_reports?.length === 0 ? (
            <div className="text-center text-gray-500 py-6 text-xs">本周暂无日报</div>
          ) : (
            data.weekly_reports?.map((r: any) => (
              <a
                key={r.id}
                href={`/reports`}
                className="block p-3 bg-bg-hover rounded-lg hover:bg-bg-hover/80 transition-colors"
              >
                <div className="text-xs text-white mb-1">{r.date}</div>
                <div className="text-[11px] text-gray-400 line-clamp-2">{r.summary}</div>
              </a>
            ))
          )
        )}
        {activeTab === 'projects' && (
          data.active_projects?.length === 0 ? (
            <div className="text-center text-gray-500 py-6 text-xs">暂无活跃项目</div>
          ) : (
            data.active_projects?.map((p: any) => (
              <a
                key={p.id}
                href={`/projects`}
                className="block p-3 bg-bg-hover rounded-lg hover:bg-bg-hover/80 transition-colors"
              >
                <div className="text-xs text-white mb-1">{p.name}</div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">{p.customer_name}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                    p.status === '进行中' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>{p.status}</span>
                </div>
              </a>
            ))
          )
        )}
        {activeTab === 'meetings' && (
          data.recent_meetings?.length === 0 ? (
            <div className="text-center text-gray-500 py-6 text-xs">暂无近期会议</div>
          ) : (
            data.recent_meetings?.map((m: any) => (
              <a
                key={m.id}
                href={`/meetings`}
                className="block p-3 bg-bg-hover rounded-lg hover:bg-bg-hover/80 transition-colors"
              >
                <div className="text-xs text-white mb-1">{m.title}</div>
                <div className="text-[11px] text-gray-500">{m.date}</div>
              </a>
            ))
          )
        )}
      </div>
    </div>
  )
}
