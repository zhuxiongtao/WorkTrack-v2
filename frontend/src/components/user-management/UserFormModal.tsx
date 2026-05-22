import { useState, useCallback, useEffect } from 'react'
import { X, Save, Loader2, UserPlus, Crown, Sparkles, Users, Eye, EyeOff } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useToast } from '../../contexts/ToastContext'
import type { UserData } from '../../services/types'
import {
  useCreateUserMutation,
  useUpdateUserMutation,
  useUsersSimpleQuery,
  useDepartmentsFlatQuery,
} from '../../hooks/useUserManagementQueries'

interface UserFormModalProps {
  isOpen: boolean
  editingUser: UserData | null
  onClose: () => void
}

export function UserFormModal({ isOpen, editingUser, onClose }: UserFormModalProps) {
  const { theme } = useTheme()
  const { toast: showToast } = useToast()

  const [form, setForm] = useState(() => ({
    username: editingUser?.username ?? '',
    password: '',
    name: editingUser?.name ?? '',
    email: editingUser?.email ?? '',
    is_admin: editingUser?.is_admin ?? false,
    use_shared_models: editingUser?.use_shared_models ?? false,
    can_manage_models: editingUser?.can_manage_models ?? false,
    leader_id: editingUser?.leader_id ?? null as number | null,
    department_id: editingUser?.department_id ?? null as number | null,
    job_title: editingUser?.job_title ?? null as string | null,
  }))
  const [showPassword, setShowPassword] = useState(false)

  // 打开弹窗或切换编辑对象时重置表单
  useEffect(() => {
    if (isOpen) {
      setForm({
        username: editingUser?.username ?? '',
        password: '',
        name: editingUser?.name ?? '',
        email: editingUser?.email ?? '',
        is_admin: editingUser?.is_admin ?? false,
        use_shared_models: editingUser?.use_shared_models ?? false,
        can_manage_models: editingUser?.can_manage_models ?? false,
        leader_id: editingUser?.leader_id ?? null as number | null,
        department_id: editingUser?.department_id ?? null as number | null,
        job_title: editingUser?.job_title ?? null as string | null,
      })
      setShowPassword(false)
    }
  }, [isOpen, editingUser])

  const createMutation = useCreateUserMutation()
  const updateMutation = useUpdateUserMutation()
  const { data: allUsers = [] } = useUsersSimpleQuery()
  const { data: departments = [] } = useDepartmentsFlatQuery()
  const saving = createMutation.isPending || updateMutation.isPending

  // 选择部门后自动推断汇报上级
  useEffect(() => {
    if (!form.department_id || departments.length === 0) return

    // 仅当部门发生了变化（非初始加载）时才自动推断
    if (editingUser && form.department_id === editingUser.department_id) return

    const dept = departments.find(d => d.id === form.department_id)
    if (!dept?.manager_id) return

    // 如果用户本人就是该部门的负责人，查找上级部门的负责人
    if (editingUser && editingUser.id === dept.manager_id && dept.parent_id) {
      const parentDept = departments.find(d => d.id === dept.parent_id)
      if (parentDept?.manager_id) {
        setForm(prev => ({ ...prev, leader_id: parentDept.manager_id }))
        return
      }
    }

    // 默认：汇报给本部门负责人
    if (!(editingUser && editingUser.id === dept.manager_id)) {
      setForm(prev => ({ ...prev, leader_id: dept.manager_id }))
    }
  }, [form.department_id, departments, editingUser])

  const handleSave = async () => {
    if (!form.username.trim()) { showToast('用户名不能为空', 'warning'); return }
    if (!form.email.trim()) { showToast('电子邮箱不能为空', 'warning'); return }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email.trim())) { showToast('请输入有效的电子邮箱地址', 'warning'); return }

    if (editingUser) {
      updateMutation.mutate({
        id: editingUser.id,
        data: {
          username: form.username,
          name: form.name,
          email: form.email || null,
          is_admin: form.is_admin,
          use_shared_models: form.use_shared_models,
          can_manage_models: form.can_manage_models,
          leader_id: form.leader_id,
          department_id: form.department_id,
          job_title: form.job_title,
        },
      }, { onSuccess: onClose })
    } else {
      if (!form.password.trim()) { showToast('请输入初始密码', 'warning'); return }
      createMutation.mutate({
        username: form.username,
        password: form.password,
        name: form.name,
        email: form.email,
        is_admin: form.is_admin,
        use_shared_models: form.use_shared_models,
        can_manage_models: form.can_manage_models,
        leader_id: form.leader_id,
        department_id: form.department_id,
        job_title: form.job_title,
      }, { onSuccess: onClose })
    }
  }

  const updateFormField = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden max-h-[90vh] animate-scaleIn" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-border/15 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center text-accent-blue">
              <UserPlus size={16} />
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{editingUser ? '编辑用户资料' : '录入新系统成员'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer"><X size={16} /></button>
        </div>

        {/* 表单体 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 基础属性 */}
          <div className="space-y-4">
            <span className="text-[11px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1.5 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
              基础属性与凭证
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">登录用户名 *</label>
                <input
                  value={form.username}
                  onChange={e => updateFormField('username', e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium font-mono"
                  placeholder="e.g. zhangsan (登录时使用)"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">显示名称/真实昵称</label>
                <input
                  value={form.name}
                  onChange={e => updateFormField('name', e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium"
                  placeholder="e.g. 张三 (系统内显示)"
                />
              </div>
            </div>

            {!editingUser && (
              <div className="relative">
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">初始密码 *</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={e => updateFormField('password', e.target.value)}
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium font-mono"
                    placeholder="最少 8 位，须含字母和数字组合"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex items-center pr-3 hover:text-gray-800 dark:hover:text-gray-200 text-gray-400 cursor-pointer">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">系统电子邮箱 *</label>
              <input
                type="email"
                value={form.email}
                onChange={e => updateFormField('email', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium font-mono"
                placeholder="e.g. example@worktrack.com (必填)"
              />
            </div>

            {/* 组织架构与汇报线上级 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">所属组织部门</label>
                <select
                  value={form.department_id || 0}
                  onChange={e => updateFormField('department_id', parseInt(e.target.value, 10) || null)}
                  style={{ colorScheme: theme }}
                  className="w-full h-10 px-3.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-xs text-gray-700 dark:text-gray-200 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 cursor-pointer font-bold font-sans"
                >
                  <option value={0} className="bg-white dark:bg-bg-input text-gray-800 dark:text-gray-200">无部门 (未分配)</option>
                  {departments.map(d => {
                    const mgrName = d.manager_id ? allUsers.find(u => u.id === d.manager_id)?.name || '未知' : null
                    return (
                      <option key={d.id} value={d.id} className="bg-white dark:bg-bg-input text-gray-800 dark:text-gray-200">
                        {d.name}{mgrName ? ` — 负责人: ${mgrName}` : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">汇报上级领导</label>
                {form.leader_id ? (
                  <div className="w-full h-10 px-3.5 rounded-xl bg-gray-50 dark:bg-bg-hover/20 border border-gray-200 dark:border-border/60 text-xs text-gray-700 dark:text-gray-200 flex items-center font-bold font-sans">
                    {(() => {
                      const leader = allUsers.find(u => u.id === form.leader_id)
                      return leader ? `${leader.name || leader.username} (@${leader.username})` : '未知'
                    })()}
                    <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500 font-normal">由所属部门自动推断</span>
                  </div>
                ) : (
                  <div className="w-full h-10 px-3.5 rounded-xl bg-gray-50 dark:bg-bg-hover/20 border border-gray-200 dark:border-border/60 text-xs text-gray-400 dark:text-gray-500 flex items-center font-sans">
                    未指定部门或该部门暂无负责人
                  </div>
                )}
              </div>
            </div>

            {/* 职位 */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">职位名称</label>
              <input
                value={form.job_title ?? ''}
                onChange={e => updateFormField('job_title', e.target.value || null)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-medium"
                placeholder="e.g. 前端开发工程师"
              />
            </div>
          </div>

          {/* 系统特权与 AI 权限 */}
          <div className="pt-4 border-t border-gray-200 dark:border-border/10 space-y-4">
            <span className="text-[11px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              系统特权与 AI 权限定制
            </span>

            <div className="space-y-3">
              {/* is_admin */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-gray-150 dark:border-border/20 transition-all hover:bg-gray-100/50 dark:hover:bg-bg-hover/20 shadow-sm">
                <div className="min-w-0 pr-4">
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                    <Crown size={12} className="text-amber-500" /> 设置为系统超级管理员
                  </span>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 leading-relaxed">允许该用户拥有系统后台最高管理特权。</p>
                </div>
                <button type="button" onClick={() => updateFormField('is_admin', !form.is_admin)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${form.is_admin ? 'bg-accent-blue' : 'bg-gray-300 dark:bg-gray-750'}`}>
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ${form.is_admin ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* can_manage_models */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-gray-150 dark:border-border/20 transition-all hover:bg-gray-100/50 dark:hover:bg-bg-hover/20 shadow-sm">
                <div className="min-w-0 pr-4">
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-blue-500 dark:text-blue-400" /> 允许用户自主管理 AI 模型供应商
                  </span>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 leading-relaxed">赋予用户独立配置专属 OpenAI / DeepSeek API 密钥和专有模型方案的能力。</p>
                </div>
                <button type="button" onClick={() => updateFormField('can_manage_models', !form.can_manage_models)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${form.can_manage_models ? 'bg-accent-blue' : 'bg-gray-300 dark:bg-gray-750'}`}>
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ${form.can_manage_models ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* use_shared_models */}
              <div className="flex items-start justify-between p-4 rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-gray-150 dark:border-border/20 transition-all hover:bg-gray-100/50 dark:hover:bg-bg-hover/20 shadow-sm">
                <div className="min-w-0 pr-4">
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                    <Users size={12} className="text-purple-500 dark:text-purple-400" /> 允许调用系统平台公共共享模型
                  </span>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 leading-relaxed">授权后可直接调用管理员配置的平台默认公共共享大语言模型。</p>
                </div>
                <button type="button" onClick={() => updateFormField('use_shared_models', !form.use_shared_models)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${form.use_shared_models ? 'bg-accent-blue' : 'bg-gray-300 dark:bg-gray-750'}`}>
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ${form.use_shared_models ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 页脚 */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-border/15 shrink-0 bg-gray-50/50 dark:bg-bg-hover/10 flex items-center justify-end gap-2.5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">取消</button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? '正在保存...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  )
}
