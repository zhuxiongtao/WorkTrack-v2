import { useState } from 'react'
import { Users, Shield, Sparkles, Briefcase } from 'lucide-react'
import { DepartmentTree } from '../components/user-management/DepartmentTree'
import { UserListTab } from '../components/user-management/UserListTab'
import { RolesTab } from '../components/user-management/RolesTab'
import { JobTitleTab } from '../components/user-management/JobTitleTab'

export default function UserManagementPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'job_titles'>('users')
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null)

  return (
    <div className="space-y-6 pb-12 animate-fadeIn text-gray-800 dark:text-gray-100">
      {/* 顶部标题栏 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/10 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">用户与权限管理</h2>
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue font-medium border border-accent-blue/20">
              <Sparkles size={11} /> 权限中心
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-medium">管理系统内部成员体系与精细化多级角色（RBAC）权限</p>
        </div>
      </div>

      {/* 导航选项卡 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2">
        <div className="inline-flex p-1 rounded-xl bg-bg-hover/80 border border-gray-200 dark:border-border/20 self-start overflow-x-auto scrollbar-none">
          {([
            { key: 'users',      label: '用户列表',      icon: Users    },
            { key: 'roles',      label: '角色与权限矩阵', icon: Shield   },
            { key: 'job_titles', label: '职位管理',      icon: Briefcase },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 max-md:px-3.5 py-2.5 max-md:py-2 rounded-lg text-sm max-md:text-xs font-semibold transition-all duration-200 cursor-pointer border whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-bg-card text-gray-900 dark:text-gray-100 shadow-md border-gray-200 dark:border-border/30'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200/40 dark:hover:bg-bg-hover/40'
              }`}
            >
              <tab.icon size={15} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 选项卡 1：用户列表（左右分栏布局） */}
      {activeTab === 'users' && (
        <div className="flex flex-col md:flex-row gap-5">
          <DepartmentTree
            selectedDepartmentId={selectedDepartmentId}
            onDepartmentSelect={setSelectedDepartmentId}
          />
          <div className="flex-1 min-w-0 overflow-x-auto">
            <UserListTab departmentId={selectedDepartmentId} />
          </div>
        </div>
      )}

      {/* 选项卡 2：角色与权限矩阵 */}
      {activeTab === 'roles' && <RolesTab />}

      {/* 选项卡 3：职位管理 */}
      {activeTab === 'job_titles' && (
        <div className="max-w-2xl">
          <JobTitleTab />
        </div>
      )}
    </div>
  )
}
