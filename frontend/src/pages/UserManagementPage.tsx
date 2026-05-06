import { useState, useEffect, useCallback } from 'react'
import { Shield, ShieldOff, Trash2, Loader2, X, Save, Key, Edit3, UserPlus, Cpu, Globe } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

interface UserData {
  id: number
  username: string
  name: string
  email: string | null
  is_admin: boolean
  is_active: boolean
  use_shared_models: boolean
  can_manage_models: boolean
  failed_login_attempts: number
  locked_until: string | null
  last_login_at: string | null
  created_at: string | null
}

export default function UserManagementPage() {
  const { fetchWithAuth, user: currentUser } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const [users, setUsers] = useState<UserData[]>([])
  const [loading, setLoading] = useState(true)

  // 表单状态
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<UserData | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', name: '', email: '', is_admin: false, use_shared_models: false, can_manage_models: false })

  // 重置密码状态
  const [resetPwdUser, setResetPwdUser] = useState<UserData | null>(null)
  const [resetPwdVal, setResetPwdVal] = useState('')

  const loadUsers = useCallback(() => {
    setLoading(true)
    fetchWithAuth('/api/v1/users')
      .then((r) => r.json())
      .then((d) => { setUsers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [fetchWithAuth])

  useEffect(() => { loadUsers() }, [loadUsers])

  const openCreate = () => {
    setEditingUser(null)
    setForm({ username: '', password: '', name: '', email: '', is_admin: false, use_shared_models: false, can_manage_models: false })
    setShowCreate(true)
  }

  const openEdit = (u: UserData) => {
    setEditingUser(u)
    setForm({ username: u.username, password: '', name: u.name, email: u.email || '', is_admin: u.is_admin, use_shared_models: u.use_shared_models, can_manage_models: u.can_manage_models })
    setShowCreate(true)
  }

  const handleSave = async () => {
    if (!form.username.trim()) return
    setSaving(true)
    try {
      if (editingUser) {
        // 编辑用户
        const res = await fetchWithAuth(`/api/v1/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            username: form.username,
            name: form.name,
            email: form.email || null,
            is_admin: form.is_admin,
            use_shared_models: form.use_shared_models,
            can_manage_models: form.can_manage_models,
          }),
        })
        if (!res.ok) { const e = await res.json(); showToast(e.detail || '编辑失败', 'error'); return }
      } else {
        // 创建用户
        if (!form.password.trim()) { showToast('请输入密码', 'warning'); setSaving(false); return }
        const res = await fetchWithAuth('/api/v1/users', {
          method: 'POST',
          body: JSON.stringify({
            username: form.username,
            password: form.password,
            name: form.name,
            email: form.email || null,
            is_admin: form.is_admin,
            use_shared_models: form.use_shared_models,
            can_manage_models: form.can_manage_models,
          }),
        })
        if (!res.ok) { const e = await res.json(); showToast(e.detail || '创建失败', 'error'); return }
      }
      setShowCreate(false)
      loadUsers()
      showToast(editingUser ? '用户信息已更新' : '用户创建成功', 'success')
    } finally { setSaving(false) }
  }

  const handleToggleActive = async (u: UserData) => {
    if (u.id === currentUser?.id) { showToast('不能禁用自己的账号', 'warning'); return }
    const res = await fetchWithAuth(`/api/v1/users/${u.id}/toggle-active`, { method: 'PUT' })
    if (res.ok) { loadUsers(); showToast(u.is_active ? '账号已禁用' : '账号已启用', 'success') }
  }

  const handleDelete = async (u: UserData) => {
    if (u.id === currentUser?.id) { showToast('不能删除自己的账号', 'warning'); return }
    if (!await showConfirm(`确定删除用户「${u.name || u.username}」？`)) return
    await fetchWithAuth(`/api/v1/users/${u.id}`, { method: 'DELETE' })
    loadUsers()
    showToast('用户已删除', 'success')
  }

  const handleResetPassword = async () => {
    if (!resetPwdUser || !resetPwdVal.trim()) return
    const res = await fetchWithAuth(`/api/v1/users/${resetPwdUser.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: resetPwdVal }),
    })
    if (!res.ok) { const e = await res.json(); showToast(e.detail || '重置失败', 'error'); return }
    showToast('密码已重置，用户需要重新登录', 'success')
    setResetPwdUser(null)
    setResetPwdVal('')
  }

  const formatTime = (s: string | null) => {
    if (!s) return '-'
    return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">用户管理</h2>
          <p className="text-sm text-gray-500 mt-1">管理系统中的所有用户账号</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm hover:bg-accent-blue/85"
        >
          <UserPlus size={16} /> 创建用户
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">
          <Loader2 size={20} className="mx-auto animate-spin mb-2" />加载中...
        </div>
      ) : (
        <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-gray-400 text-xs">
                <th className="text-left px-4 py-3">用户</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">邮箱</th>
                <th className="text-center px-4 py-3">角色</th>
                <th className="text-center px-4 py-3">状态</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">最后登录</th>
                <th className="text-right px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-b-0 hover:bg-bg-hover/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center text-[11px] text-accent-blue font-medium shrink-0">
                        {(u.name || u.username)[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-gray-200 font-medium">{u.name || u.username}</p>
                        <p className="text-xs text-gray-500">{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-gray-400">{u.email || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      {u.is_admin ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
                          <Shield size={10} />管理员
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-500">用户</span>
                      )}
                      {(u.use_shared_models || u.can_manage_models) && (
                        <span className="flex items-center gap-1">
                          {u.use_shared_models && <span className="text-[9px] text-blue-400/70" title="可使用共享模型">🌐</span>}
                          {u.can_manage_models && <span className="text-[9px] text-purple-400/70" title="可管理自有模型">⚙️</span>}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggleActive(u)}
                      className={`text-[11px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                        u.is_active
                          ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                          : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                      }`}
                    >
                      {u.is_active ? '正常' : '已禁用'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500 hidden md:table-cell">
                    {u.locked_until ? (
                      <span className="text-red-400" title={`锁定至 ${formatTime(u.locked_until)}`}>已锁定</span>
                    ) : (
                      formatTime(u.last_login_at)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"
                        title="编辑"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => { setResetPwdUser(u); setResetPwdVal('') }}
                        className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-amber-400 transition-colors"
                        title="重置密码"
                      >
                        <Key size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-500">暂无用户</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div
            className="w-full max-w-md mx-4 p-6 rounded-2xl bg-bg-card border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-medium text-white">
                {editingUser ? '编辑用户' : '创建用户'}
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">用户名 *</label>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-accent-blue"
                  placeholder="登录用户名"
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">密码 *</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-accent-blue"
                    placeholder="至少 8 位，含字母和数字"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1">昵称</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-accent-blue"
                  placeholder="显示名称"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">邮箱</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-accent-blue"
                  placeholder="user@example.com"
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400">管理员权限</label>
                <button
                  onClick={() => setForm({ ...form, is_admin: !form.is_admin, use_shared_models: false, can_manage_models: false })}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    form.is_admin
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-gray-500/10 text-gray-500'
                  }`}
                >
                  {form.is_admin ? <Shield size={12} className="inline mr-1" /> : <ShieldOff size={12} className="inline mr-1" />}
                  {form.is_admin ? '管理员' : '普通用户'}
                </button>
              </div>
              {!form.is_admin && (
                <div className="flex items-center gap-3">
                  <label className="text-xs text-gray-400">模型权限</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setForm({ ...form, use_shared_models: !form.use_shared_models })}
                      className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
                        form.use_shared_models
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-gray-500/10 text-gray-500'
                      }`}
                    >
                      <Globe size={11} className="inline mr-0.5" />
                      共享模型
                    </button>
                    <button
                      onClick={() => setForm({ ...form, can_manage_models: !form.can_manage_models })}
                      className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
                        form.can_manage_models
                          ? 'bg-purple-500/15 text-purple-400'
                          : 'bg-gray-500/10 text-gray-500'
                      }`}
                    >
                      <Cpu size={11} className="inline mr-0.5" />
                      自管模型
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full mt-5 py-2.5 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-accent-blue/85 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              <Save size={16} />{saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* 重置密码弹窗 */}
      {resetPwdUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setResetPwdUser(null)}>
          <div
            className="w-full max-w-sm mx-4 p-6 rounded-2xl bg-bg-card border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-white mb-2">重置密码</h3>
            <p className="text-sm text-gray-500 mb-4">
              为用户 <span className="text-gray-300">{resetPwdUser.name || resetPwdUser.username}</span> 设置新密码
            </p>
            <input
              type="password"
              value={resetPwdVal}
              onChange={(e) => setResetPwdVal(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-300 outline-none focus:border-accent-blue mb-4"
              placeholder="新密码（至少 8 位含字母和数字）"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setResetPwdUser(null)}
                className="flex-1 py-2 rounded-lg bg-bg-hover text-sm text-gray-400 hover:text-white border border-border"
              >
                取消
              </button>
              <button
                onClick={handleResetPassword}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
