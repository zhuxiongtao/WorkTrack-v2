import { useState } from 'react'
import { Users, Shield, Sparkles } from 'lucide-react'
import { DepartmentTree } from '../components/user-management/DepartmentTree'
import { UserListTab } from '../components/user-management/UserListTab'
import { RolesTab } from '../components/user-management/RolesTab'

export default function UserManagementPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'roles'>('users')
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

      {/* 现代导航选项卡 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2">
        {/* Tabs 面板 */}
        <div className="inline-flex p-1 rounded-xl bg-bg-hover/80 border border-gray-200 dark:border-border/20 self-start">
          {(['users', 'roles'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer border ${
                activeTab === tab
                  ? 'bg-bg-card text-gray-900 dark:text-gray-100 shadow-md border-gray-200 dark:border-border/30'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200/40 dark:hover:bg-bg-hover/40'
              }`}
            >
              {tab === 'users' && <Users size={15} />}
              {tab === 'roles' && <Shield size={15} />}
              {tab === 'users' ? '用户列表' : '角色与权限矩阵'}
            </button>
          ))}
        </div>
      </div>

      {/* ========== 选项卡 1：用户列表（左右分栏布局） ========== */}
      {activeTab === 'users' && (
        <div className="flex gap-5">
          {/* 左侧：部门树 */}
          <DepartmentTree
            selectedDepartmentId={selectedDepartmentId}
            onDepartmentSelect={setSelectedDepartmentId}
          />

          {/* 右侧：用户列表 */}
          <div className="flex-1 min-w-0">
            <UserListTab departmentId={selectedDepartmentId} />
          </div>
        </div>
      )}

      {/* ========== 选项卡 2：角色与权限矩阵 ========== */}
      {activeTab === 'roles' && <RolesTab />}
    </div>
  )
}
