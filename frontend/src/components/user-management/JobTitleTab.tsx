import { useState, useEffect, useCallback } from 'react'
import { Briefcase, Plus, Edit3, Trash2, Loader2, X, Save } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import { apiFetch, apiPost, apiPut, apiDelete } from '../../services/api'

interface JobTitle {
  id: number
  name: string
  description: string | null
  sort_order: number
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-900 dark:text-gray-200 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15'

export function JobTitleTab() {
  const { toast } = useToast()
  const [list, setList] = useState<JobTitle[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', sort_order: 0 })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<JobTitle[]>('/api/v1/job-titles').catch(() => [])
      setList(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setForm({ name: '', description: '', sort_order: list.length * 10 })
    setEditingId(null)
    setShowCreate(true)
  }

  const openEdit = (jt: JobTitle) => {
    setForm({ name: jt.name, description: jt.description || '', sort_order: jt.sort_order })
    setEditingId(jt.id)
    setShowCreate(true)
  }

  const save = async () => {
    if (!form.name.trim()) { toast('请填写职位名称', 'warning'); return }
    setSaving(true)
    try {
      if (editingId) {
        await apiPut(`/api/v1/job-titles/${editingId}`, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          sort_order: form.sort_order,
        })
        toast('已保存', 'success')
      } else {
        await apiPost('/api/v1/job-titles', {
          name: form.name.trim(),
          description: form.description.trim() || null,
          sort_order: form.sort_order,
        })
        toast('职位已创建', 'success')
      }
      setShowCreate(false)
      load()
    } catch (e: any) {
      toast(e.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (jt: JobTitle) => {
    if (!confirm(`确认删除职位「${jt.name}」？已分配该职位的用户不受影响。`)) return
    try {
      await apiDelete(`/api/v1/job-titles/${jt.id}`)
      toast('已删除', 'success')
      load()
    } catch (e: any) {
      toast(e.message || '删除失败', 'error')
    }
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">职位管理</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">维护公司职位目录，新建用户和入职申请可直接选择</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all"
        >
          <Plus size={14} /> 新建职位
        </button>
      </div>

      {/* 新建/编辑表单 */}
      {showCreate && (
        <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-900 dark:text-white">{editingId ? '编辑职位' : '新建职位'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">职位名称 <span className="text-red-500">*</span></label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                maxLength={100}
                placeholder="如「高级工程师」"
                autoFocus
                className={inputCls}
                onKeyDown={e => { if (e.key === 'Enter') save() }}
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">备注（可选）</label>
              <input
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                maxLength={255}
                placeholder="职位说明"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-400 text-xs hover:border-accent-blue/50 hover:text-accent-blue transition-colors"
            >
              <X size={13} /> 取消
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              保存
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="animate-spin text-gray-400" size={20} />
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <Briefcase size={32} className="mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">还没有职位</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">点击「新建职位」添加第一个职位</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-hover/50 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">职位名称</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">备注</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((jt, idx) => (
                <tr key={jt.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? '' : 'bg-bg-hover/20'}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Briefcase size={13} className="text-gray-400 dark:text-gray-500 shrink-0" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{jt.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{jt.description || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(jt)}
                        className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-accent-blue hover:bg-accent-blue/10 transition-colors"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => remove(jt)}
                        className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
