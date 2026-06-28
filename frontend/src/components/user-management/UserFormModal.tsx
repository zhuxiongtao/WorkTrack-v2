import { useState, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Save, Loader2, UserPlus, Crown, Sparkles, Users, Eye, EyeOff, Check, ChevronRight, ChevronLeft, Mail, AtSign, Briefcase, Building2, UserCheck, ShieldCheck, Lock, AlertCircle, CalendarClock, CalendarCheck2 } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import type { UserData } from '../../services/types'
import SearchableSelect from '../SearchableSelect'
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

type StepKey = 'basics' | 'org' | 'privileges'

const STEPS: { key: StepKey; label: string; icon: typeof Mail; tone: string }[] = [
  { key: 'basics',     label: '基础信息', icon: Mail,      tone: 'blue'   },
  { key: 'org',        label: '组织架构', icon: Building2, tone: 'cyan'   },
  { key: 'privileges', label: '系统特权', icon: ShieldCheck, tone: 'amber' },
]

// 密码强度评估
function evaluatePassword(pwd: string): { score: 0 | 1 | 2 | 3 | 4; label: string; tone: 'red' | 'orange' | 'amber' | 'emerald' | 'gray'; checks: { label: string; pass: boolean }[] } {
  const checks = [
    { label: '至少 8 位',        pass: pwd.length >= 8 },
    { label: '包含字母',         pass: /[A-Za-z]/.test(pwd) },
    { label: '包含数字',         pass: /\d/.test(pwd) },
    { label: '字母 + 数字组合',  pass: /[A-Za-z]/.test(pwd) && /\d/.test(pwd) },
  ]
  const passed = checks.filter(c => c.pass).length
  if (!pwd) return { score: 0, label: '请输入密码', tone: 'gray', checks }
  if (passed < 2) return { score: 1, label: '弱', tone: 'red', checks }
  if (passed < 3) return { score: 2, label: '一般', tone: 'orange', checks }
  if (passed < 4) return { score: 3, label: '良好', tone: 'amber', checks }
  return { score: 4, label: '很强', tone: 'emerald', checks }
}

const TONE_BG: Record<string, string> = {
  blue:   'bg-accent-blue',
  cyan:   'bg-cyan-500',
  amber:  'bg-amber-500',
  red:    'bg-red-500',
  orange: 'bg-orange-500',
  emerald: 'bg-emerald-500',
  gray:   'bg-gray-400',
}

export function UserFormModal({ isOpen, editingUser, onClose }: UserFormModalProps) {
  const { toast: showToast, alert: showAlert } = useToast()

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
    first_work_date: editingUser?.first_work_date ?? null as string | null,
    hire_date: editingUser?.hire_date ?? null as string | null,
  }))
  const [showPassword, setShowPassword] = useState(false)
  const [step, setStep] = useState<StepKey>('basics')
  const [leaderManuallyEdited, setLeaderManuallyEdited] = useState(false)

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
        first_work_date: editingUser?.first_work_date ?? null as string | null,
        hire_date: editingUser?.hire_date ?? null as string | null,
      })
      setShowPassword(false)
      setStep('basics')
      setLeaderManuallyEdited(false)
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
    if (leaderManuallyEdited) return
    if (editingUser && form.department_id === editingUser.department_id) return

    const dept = departments.find(d => d.id === form.department_id)
    if (!dept?.manager_id) return

    if (editingUser && editingUser.id === dept.manager_id && dept.parent_id) {
      const parentDept = departments.find(d => d.id === dept.parent_id)
      if (parentDept?.manager_id) {
        setForm(prev => ({ ...prev, leader_id: parentDept.manager_id }))
        return
      }
    }
    if (!(editingUser && editingUser.id === dept.manager_id)) {
      setForm(prev => ({ ...prev, leader_id: dept.manager_id }))
    }
  }, [form.department_id, departments, editingUser, leaderManuallyEdited])

  // 按参加工作日期预估法定累计工龄与年假天数（前端展示用，最终以后端为准）
  const annualLeavePreview = useMemo(() => {
    if (!form.first_work_date) return { years: 0, days: 0 }
    const start = new Date(form.first_work_date)
    if (isNaN(start.getTime())) return { years: 0, days: 0 }
    const ref = new Date(new Date().getFullYear(), 11, 31)
    let years = ref.getFullYear() - start.getFullYear()
    if (ref.getMonth() < start.getMonth() || (ref.getMonth() === start.getMonth() && ref.getDate() < start.getDate())) years -= 1
    const days = years < 1 ? 0 : years < 10 ? 5 : years < 20 ? 10 : 15
    return { years: Math.max(0, years), days }
  }, [form.first_work_date])

  // 当前密码强度（仅创建用户时计算）
  const pwdEval = useMemo(() => evaluatePassword(form.password), [form.password])
  // 编辑时不校验；创建时密码可留空（系统自动生成），若填写则需至少"良好"
  const pwdValid = !!editingUser || !form.password || pwdEval.score >= 3

  // 基础信息校验
  const basicsValid = useMemo(() => {
    if (!form.username.trim()) return false
    if (!form.email.trim()) return false
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email.trim())) return false
    if (!editingUser && !pwdValid) return false
    return true
  }, [form.username, form.email, pwdValid, editingUser])

  const canEnterOrg = basicsValid
  const canEnterPrivileges = canEnterOrg

  const handleSave = useCallback(async () => {
    if (!form.username.trim()) { showToast('用户名不能为空', 'warning'); setStep('basics'); return }
    if (!form.email.trim()) { showToast('电子邮箱不能为空', 'warning'); setStep('basics'); return }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email.trim())) { showToast('请输入有效的电子邮箱地址', 'warning'); setStep('basics'); return }
    if (!editingUser && form.password && !pwdValid) { showToast('自定义密码需至少 8 位且含字母数字，或留空由系统自动生成', 'warning'); setStep('basics'); return }

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
          first_work_date: form.first_work_date,
          hire_date: form.hire_date,
        },
      }, { onSuccess: onClose })
    } else {
      createMutation.mutate({
        username: form.username,
        password: form.password || undefined,  // 留空 → 后端自动生成初始密码
        name: form.name,
        email: form.email,
        is_admin: form.is_admin,
        use_shared_models: form.use_shared_models,
        can_manage_models: form.can_manage_models,
        leader_id: form.leader_id,
        department_id: form.department_id,
        job_title: form.job_title,
        first_work_date: form.first_work_date,
        hire_date: form.hire_date,
      }, {
        onSuccess: (data) => {
          if (data?.welcome_email_sent) {
            showToast('账号已创建，欢迎邮件（含初始密码）已发送给用户', 'success')
          } else if (data?.initial_password) {
            // 邮件未配置/发送失败：把初始密码弹给管理员线下转交
            showAlert(
              `账号「${form.username}」已创建，但欢迎邮件未发送（邮件服务未配置或发送失败）。\n\n请将以下初始密码转交给用户，其首次登录后需修改密码：\n\n初始密码：${data.initial_password}`,
              'warning',
            )
          } else {
            showToast('账号已创建', 'success')
          }
          onClose()
        },
      })
    }
  }, [form, editingUser, pwdValid, updateMutation, createMutation, showToast, onClose])

  const updateFormField = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const goNext = () => {
    if (step === 'basics' && canEnterOrg) setStep('org')
    else if (step === 'org' && canEnterPrivileges) setStep('privileges')
  }
  const goPrev = () => {
    if (step === 'privileges') setStep('org')
    else if (step === 'org') setStep('basics')
  }

  if (!isOpen) return null

  const currentStepIndex = STEPS.findIndex(s => s.key === step)

  // 挂载到 document.body 避免被父元素的 overflow / transform 限制
  // z-[100] 高于应用全局遮罩 (z-40) 与抽屉 (z-30)，并避免被页面内任何 stacking context 影响
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-4 py-6" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] rounded-2xl bg-bg-card border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="px-6 pt-4 pb-3 border-b border-gray-200 dark:border-border/15 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-accent-blue flex items-center justify-center text-[#fff] shadow-sm shrink-0">
                <UserPlus size={17} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">{editingUser ? '编辑用户资料' : '录入新系统成员'}</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5 truncate">
                  {editingUser ? '修改成员的账号、组织、权限信息' : '按步骤完成账号创建，标 * 为必填'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer shrink-0"><X size={16} /></button>
          </div>

          {/* 步骤指示器：单行紧密排列，无右箭头，激活步用进度条样式 */}
          <div className="mt-3 flex items-stretch gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const active = s.key === step
              const done = i < currentStepIndex
              return (
                <div key={s.key} className="flex-1 flex flex-col gap-1 min-w-0">
                  <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-bold transition-colors truncate ${
                    active ? `${TONE_BG[s.tone]} text-[#fff] shadow-sm` :
                    done ? 'bg-emerald-500/10 text-emerald-500' :
                    'bg-gray-100 dark:bg-bg-hover/40 text-gray-400 dark:text-gray-500'
                  }`}>
                    {done ? <Check size={11} strokeWidth={3} /> : <Icon size={11} />}
                    <span className="truncate">{s.label}</span>
                  </div>
                  {/* 进度条：已完成/当前步填充 */}
                  <div className="h-0.5 rounded-full bg-gray-100 dark:bg-bg-hover/40 overflow-hidden">
                    <div className={`h-full transition-all ${
                      done ? 'w-full bg-emerald-500' :
                      active ? 'w-1/2 bg-accent-blue' :
                      'w-0'
                    }`} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 表单体 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {step === 'basics' && (
            <div className="space-y-5 animate-fadeIn">
              <SectionTitle icon={Mail} title="账号凭证" subtitle="用于登录系统" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="登录用户名" required icon={AtSign} hint="登录时使用，保存后不可修改">
                  <input
                    value={form.username}
                    onChange={e => updateFormField('username', e.target.value)}
                    className="form-input font-mono"
                    placeholder="e.g. zhangsan"
                    autoFocus
                  />
                </FormField>
                <FormField label="显示名称" icon={UserCheck} hint="系统内显示的姓名">
                  <input
                    value={form.name}
                    onChange={e => updateFormField('name', e.target.value)}
                    className="form-input"
                    placeholder="e.g. 张三"
                  />
                </FormField>
              </div>

              {!editingUser && (
                <FormField label="初始密码" icon={Lock} hint="留空则系统自动生成并通过邮件发送给用户；无论是否自定义，用户首次登录都需强制修改密码">
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={e => updateFormField('password', e.target.value)}
                      className="form-input pr-10 font-mono"
                      placeholder="留空自动生成，或自定义（≥8 位，含字母数字）"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex items-center pr-3 hover:text-gray-800 dark:hover:text-gray-200 text-gray-400 cursor-pointer">
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {/* 强度计 */}
                  {form.password && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-bg-hover/40 overflow-hidden flex gap-0.5">
                          {[1, 2, 3, 4].map(i => (
                            <div
                              key={i}
                              className={`flex-1 rounded-full transition-colors ${
                                pwdEval.score >= i ? TONE_BG[pwdEval.tone] : 'bg-transparent'
                              }`}
                            />
                          ))}
                        </div>
                        <span className={`text-[11px] font-bold ${pwdEval.tone === 'red' ? 'text-red-500' : pwdEval.tone === 'orange' ? 'text-orange-500' : pwdEval.tone === 'amber' ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {pwdEval.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {pwdEval.checks.map((c, i) => (
                          <div key={i} className={`flex items-center gap-1 text-[11px] ${c.pass ? 'text-emerald-500' : 'text-gray-400 dark:text-gray-600'}`}>
                            {c.pass ? <Check size={9} strokeWidth={3} /> : <span className="w-[9px] h-[9px] rounded-full border border-gray-300 dark:border-gray-700" />}
                            <span>{c.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </FormField>
              )}

              <FormField label="系统电子邮箱" required icon={Mail}>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => updateFormField('email', e.target.value)}
                  className={`form-input font-mono ${form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? 'border-red-400 focus:border-red-400 focus:ring-red-400/15' : ''}`}
                  placeholder="e.g. zhangsan@worktrack.com"
                />
                {form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && (
                  <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10} /> 邮箱格式不正确</p>
                )}
              </FormField>
            </div>
          )}

          {step === 'org' && (
            <div className="space-y-5 animate-fadeIn">
              <SectionTitle icon={Building2} title="组织架构" subtitle="将成员归属到部门和汇报上级" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="所属组织部门" icon={Building2} hint="选择后将自动推荐部门负责人为汇报上级">
                  <SearchableSelect
                    options={[
                      { value: 0, label: '暂不分配部门' },
                      ...departments.map(d => {
                        const mgrName = d.manager_id ? allUsers.find(u => u.id === d.manager_id)?.name || '未知' : null
                        return {
                          value: d.id,
                          label: d.name,
                          hint: mgrName ? `负责人: ${mgrName}` : '暂未指定负责人',
                        }
                      }),
                    ]}
                    value={form.department_id || 0}
                    onChange={(v) => updateFormField('department_id', (v as number) || null)}
                    placeholder="选择所属部门"
                    searchPlaceholder="搜索部门名称..."
                    emptyText="没有匹配部门"
                  />
                </FormField>

                <FormField label="汇报上级领导" icon={UserCheck} hint={form.leader_id ? '由部门自动推断，可手动调整' : '选择部门后将自动推荐'}>
                  <SearchableSelect
                    options={[
                      { value: 0, label: '暂不指定' },
                      ...allUsers
                        .filter(u => u.id !== editingUser?.id && u.is_active)
                        .map(u => ({
                          value: u.id,
                          label: u.name || u.username,
                          hint: `@${u.username}`,
                        })),
                    ]}
                    value={form.leader_id || 0}
                    onChange={(v) => {
                      setLeaderManuallyEdited(true)
                      updateFormField('leader_id', (v as number) || null)
                    }}
                    placeholder={allUsers.length === 0 ? '暂无可选成员' : '选择汇报上级'}
                    searchPlaceholder="按姓名 / 用户名搜索..."
                    emptyText="没有匹配成员"
                  />
                </FormField>
              </div>

              <FormField label="职位名称" icon={Briefcase} hint="可选，便于在组织架构中识别">
                <input
                  value={form.job_title ?? ''}
                  onChange={e => updateFormField('job_title', e.target.value || null)}
                  className="form-input"
                  placeholder="e.g. 前端开发工程师"
                />
              </FormField>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="参加工作日期" icon={CalendarClock} hint="首次参加工作时间，按法定累计工龄自动核算年假档位">
                  <input
                    type="date"
                    value={form.first_work_date ?? ''}
                    onChange={e => updateFormField('first_work_date', e.target.value || null)}
                    className="form-input"
                  />
                </FormField>
                <FormField label="本公司入职日期" icon={CalendarCheck2} hint="入职本公司的时间，用于司龄统计">
                  <input
                    type="date"
                    value={form.hire_date ?? ''}
                    onChange={e => updateFormField('hire_date', e.target.value || null)}
                    className="form-input"
                  />
                </FormField>
              </div>
              {form.first_work_date && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 px-3 py-2 flex items-center gap-2">
                  <CalendarClock size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-300/90">
                    按参加工作日期，当前累计工龄约 <b>{annualLeavePreview.years}</b> 年，法定年假 <b>{annualLeavePreview.days}</b> 天/年
                  </span>
                </div>
              )}

              {/* 预览卡片 */}
              <div className="rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50/50 dark:from-accent-blue/5 dark:to-cyan-500/5 border border-blue-100 dark:border-accent-blue/15 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-accent-blue/15 flex items-center justify-center text-accent-blue text-xs font-bold">
                    {(form.name || form.username || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">
                      {form.name || form.username || '新成员'} <span className="text-gray-400 dark:text-gray-500 font-mono font-normal">@{form.username || '未命名'}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-500 truncate">
                      {form.job_title || '未指定职位'} · {form.email || '未填写邮箱'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-500 mt-3 pt-3 border-t border-blue-100 dark:border-accent-blue/10">
                  <div className="flex items-center gap-1">
                    <Building2 size={10} />
                    <span>{departments.find(d => d.id === form.department_id)?.name || '未分配部门'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <UserCheck size={10} />
                    <span>{allUsers.find(u => u.id === form.leader_id)?.name || '未指定上级'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'privileges' && (
            <div className="space-y-5 animate-fadeIn">
              <SectionTitle icon={ShieldCheck} title="系统特权" subtitle="高级权限，谨慎分配" />

              <div className="rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 p-3 flex items-start gap-2">
                <AlertCircle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-amber-700 dark:text-amber-300/80 leading-relaxed">
                  以下三项是高敏感度权限。普通成员只需要有「角色」即可使用系统功能，无需在此开启任何项。
                </p>
              </div>

              <div className="space-y-3">
                <PrivilegeToggle
                  icon={Crown}
                  iconClass="text-amber-500"
                  title="设为系统超级管理员"
                  desc="拥有后台全部权限，可管理用户、角色、部门与系统设置。"
                  checked={form.is_admin}
                  onChange={v => updateFormField('is_admin', v)}
                />
                <PrivilegeToggle
                  icon={Sparkles}
                  iconClass="text-blue-500"
                  title="允许自主管理 AI 模型供应商"
                  desc="可独立配置 OpenAI / DeepSeek 等 API 密钥与专有模型方案。"
                  checked={form.can_manage_models}
                  onChange={v => updateFormField('can_manage_models', v)}
                />
                <PrivilegeToggle
                  icon={Users}
                  iconClass="text-purple-500"
                  title="允许调用平台公共共享模型"
                  desc="无需自行配置 API 密钥，直接使用管理员预置的共享大语言模型。"
                  checked={form.use_shared_models}
                  onChange={v => updateFormField('use_shared_models', v)}
                />
              </div>

              {/* 角色提示 */}
              <div className="rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-gray-200 dark:border-border/20 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <UserCheck size={12} className="text-accent-blue" />
                  <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">关于「角色」</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
                  用户的常规功能权限由「角色」统一管理。保存成员后，可在成员列表点行首盾牌图标单独调整其角色（直接分配 + 部门角色取并集）。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 页脚 */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-border/15 shrink-0 bg-gray-50/50 dark:bg-bg-hover/10 flex items-center justify-between gap-2.5">
          <div className="text-[11px] text-gray-500 dark:text-gray-500">
            步骤 {currentStepIndex + 1} / {STEPS.length}
          </div>
          <div className="flex items-center gap-2">
            {step !== 'basics' && (
              <button type="button" onClick={goPrev} className="px-3.5 py-2 rounded-lg bg-bg-card hover:bg-gray-100 dark:hover:bg-bg-hover text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold flex items-center gap-1 shadow-sm">
                <ChevronLeft size={13} /> 上一步
              </button>
            )}
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-card hover:bg-gray-100 dark:hover:bg-bg-hover text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">取消</button>
            {step !== 'privileges' ? (
              <button
                type="button"
                onClick={goNext}
                disabled={(step === 'basics' && !canEnterOrg) || (step === 'org' && !canEnterPrivileges)}
                className="px-4 py-2 rounded-lg bg-accent-blue text-[#fff] text-xs font-bold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                下一步 <ChevronRight size={13} />
              </button>
            ) : (
              <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-accent-blue text-[#fff] text-xs font-bold hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? '正在保存...' : '保存成员'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// === 内部小组件 ===

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof Mail; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-7 h-7 rounded-lg bg-accent-blue/10 flex items-center justify-center text-accent-blue">
        <Icon size={14} />
      </div>
      <div>
        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h4>
        {subtitle && <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function FormField({
  label, required, icon: Icon, hint, children,
}: {
  label: string; required?: boolean; icon?: typeof Mail; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={11} className="text-gray-400 dark:text-gray-500" />}
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function PrivilegeToggle({
  icon: Icon, iconClass, title, desc, checked, onChange,
}: {
  icon: typeof Crown; iconClass: string; title: string; desc: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className={`flex items-start justify-between p-4 rounded-xl border transition-all ${
      checked
        ? 'bg-accent-blue/5 border-accent-blue/30 shadow-sm'
        : 'bg-bg-card border-gray-200 dark:border-border/30 hover:bg-gray-50/50 dark:hover:bg-bg-hover/20'
    }`}>
      <div className="min-w-0 pr-4 flex items-start gap-2.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${checked ? 'bg-accent-blue/15' : 'bg-gray-100 dark:bg-bg-hover/40'}`}>
          <Icon size={14} className={iconClass} />
        </div>
        <div className="min-w-0">
          <span className="text-xs font-bold text-gray-800 dark:text-gray-200 block">{title}</span>
          <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
          checked ? 'bg-accent-blue' : 'bg-gray-300 dark:bg-gray-700'
        }`}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}
