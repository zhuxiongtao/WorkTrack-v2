import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, X, Loader2, FileText, Pencil, Trash2, ToggleLeft, ToggleRight,
  LayoutTemplate, Tag, AlignLeft, CheckCircle2,
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import ContractDocEditor from '../components/ContractDocEditor'

interface Template {
  id: number
  name: string
  category: string
  description: string | null
  content: string
  is_active: boolean
  created_at: string
  updated_at: string
}

const CATEGORY_COLORS: Record<string, string> = {
  '服务合同': 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  '采购合同': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  '销售合同': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  '保密协议': 'bg-pink-500/10 text-pink-400 border-pink-500/30',
  '合作协议': 'bg-teal-500/10 text-teal-400 border-teal-500/30',
  '劳动合同': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  '租赁合同': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
}

export default function ContractTemplatesPage() {
  const { toast: showToast, confirm: showConfirm } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTpl, setEditingTpl] = useState<Template | null>(null)
  const [showEditor, setShowEditor] = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/v1/contract-templates?include_inactive=true')
      .then(r => r.json())
      .then(data => setTemplates(data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleToggleActive = async (tpl: Template) => {
    const res = await fetch(`/api/v1/contract-templates/${tpl.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ is_active: String(!tpl.is_active) }),
    })
    if (res.ok) {
      showToast(tpl.is_active ? '模板已停用' : '模板已启用', 'success')
      load()
    }
  }

  const handleDelete = async (tpl: Template) => {
    const ok = await showConfirm(`确定删除模板「${tpl.name}」？已用此模板创建的合同不受影响。`)
    if (!ok) return
    const res = await fetch(`/api/v1/contract-templates/${tpl.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) { showToast('模板已删除', 'success'); load() }
    else showToast('删除失败', 'error')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>合同模板管理</h2>
          <p className="text-xs text-gray-500 mt-0.5">创建和管理合同模板，供业务人员在新建合同时选用</p>
        </div>
        <button
          onClick={() => { setEditingTpl(null); setShowEditor(true) }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 transition-colors"
        >
          <Plus size={14} strokeWidth={2.5} />新建模板
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-gray-500" />
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
          <LayoutTemplate size={40} className="opacity-25" />
          <p className="text-sm">还没有合同模板</p>
          <button onClick={() => { setEditingTpl(null); setShowEditor(true) }}
            className="text-xs text-indigo-400 hover:text-indigo-300">+ 创建第一个模板</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map(tpl => (
            <div key={tpl.id}
              className={`rounded-xl border overflow-hidden transition-all ${tpl.is_active ? 'bg-bg-card border-border' : 'bg-bg-card/50 border-border/40 opacity-60'}`}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tpl.is_active ? 'bg-indigo-500/15' : 'bg-gray-500/10'}`}>
                      <LayoutTemplate size={14} className={tpl.is_active ? 'text-indigo-400' : 'text-gray-500'} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{tpl.name}</p>
                      {tpl.category && (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[tpl.category] || 'bg-gray-500/10 text-gray-400 border-gray-500/30'}`}>
                          {tpl.category}
                        </span>
                      )}
                    </div>
                  </div>
                  {tpl.is_active ? (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 shrink-0 flex items-center gap-1">
                      <CheckCircle2 size={9} />启用中
                    </span>
                  ) : (
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-500/10 text-gray-500 border border-gray-500/20 shrink-0">已停用</span>
                  )}
                </div>
                {tpl.description && (
                  <p className="text-[11px] text-gray-500 mt-2 line-clamp-2 leading-relaxed">{tpl.description}</p>
                )}
              </div>
              <div className="px-4 py-2.5 border-t border-border/40 flex items-center gap-1.5">
                <button onClick={() => { setEditingTpl(tpl); setShowEditor(true) }}
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-bg-hover border border-transparent hover:border-border transition-all">
                  <Pencil size={11} />编辑
                </button>
                <button onClick={() => handleToggleActive(tpl)}
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-bg-hover border border-transparent hover:border-border transition-all">
                  {tpl.is_active ? <ToggleRight size={11} className="text-green-400" /> : <ToggleLeft size={11} />}
                  {tpl.is_active ? '停用' : '启用'}
                </button>
                <button onClick={() => handleDelete(tpl)}
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all ml-auto">
                  <Trash2 size={11} />删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showEditor && createPortal(
        <TemplateEditorModal
          template={editingTpl}
          onClose={() => { setShowEditor(false); setEditingTpl(null) }}
          onSaved={() => { setShowEditor(false); setEditingTpl(null); load() }}
        />,
        document.body
      )}
    </div>
  )
}

interface TemplateEditorModalProps {
  template: Template | null
  onClose: () => void
  onSaved: () => void
}

function TemplateEditorModal({ template, onClose, onSaved }: TemplateEditorModalProps) {
  const { toast: showToast } = useToast()
  const [name, setName] = useState(template?.name || '')
  const [category, setCategory] = useState(template?.category || '')
  const [description, setDescription] = useState(template?.description || '')
  const [contentHtml, setContentHtml] = useState(template?.content || '<h1>合同标题</h1><p></p>')
  const [saving, setSaving] = useState(false)

  // Auto-sync template name from H1
  const nameManuallyEdited = useRef(!!template)
  const lastAutoName = useRef('')
  useEffect(() => {
    if (nameManuallyEdited.current) return
    const match = contentHtml.match(/<h1[^>]*>(.*?)<\/h1>/i)
    if (match) {
      const h1 = match[1].replace(/<[^>]+>/g, '').trim()
      if (h1 && h1 !== lastAutoName.current && h1 !== '合同标题') {
        lastAutoName.current = h1
        setName(h1)
      }
    }
  }, [contentHtml])

  const handleSave = async () => {
    if (!name.trim()) { showToast('请填写模板名称', 'error'); return }
    setSaving(true)
    const body = new URLSearchParams({
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      content: contentHtml,
    })
    const url = template ? `/api/v1/contract-templates/${template.id}` : '/api/v1/contract-templates'
    const method = template ? 'PUT' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (res.ok || res.status === 201) {
      showToast(template ? '模板已更新' : '模板已创建', 'success')
      onSaved()
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(err.detail || '保存失败', 'error')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4 py-6" onClick={onClose}>
      <div
        className="w-full max-w-[1200px] max-h-[97vh] rounded-2xl bg-bg-card border border-border/50 shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-3.5 border-b border-border/20 shrink-0 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center shrink-0">
            <LayoutTemplate size={15} className="text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {template ? '编辑合同模板' : '新建合同模板'}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">在 A4 文档中编辑模板正文，用 [占位符] 标记需替换的变量</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-gray-200 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* 模板元字段（紧凑横排） */}
        <div className="shrink-0 px-5 py-2.5 border-b border-border/20 bg-bg-hover/10 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">
              模板名称 <span className="text-red-400 normal-case">*</span>
            </label>
            <input
              value={name}
              onChange={e => { nameManuallyEdited.current = true; setName(e.target.value) }}
              className="w-full form-input text-sm"
              placeholder="如：商务服务合同"
              title="新建时自动从文档 H1 标题提取"
            />
          </div>
          <div style={{ width: '160px', flexShrink: 0 }}>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">合同类型</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full form-input text-sm"
            >
              <option value="">选择类型</option>
              {['服务合同', '采购合同', '销售合同', '保密协议', '合作协议', '劳动合同', '租赁合同', '其他'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <AlignLeft size={9} />说明（显示在选模板页面）
            </label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full form-input"
              placeholder="适用场景说明，如：适用于软件开发、技术服务等场景"
            />
          </div>
          <div className="text-[11px] text-gray-600 flex items-center gap-1 pb-1.5 shrink-0">
            <Tag size={10} />用 [变量名] 标记占位符
          </div>
        </div>

        {/* 编辑器主体 */}
        <div className="flex-1 min-h-0 flex flex-col">
          <ContractDocEditor
            value={contentHtml}
            onChange={setContentHtml}
            title={name || '合同模板'}
          />
        </div>

        {/* 页脚 */}
        <div className="px-5 py-3 border-t border-border/20 shrink-0 flex items-center justify-end gap-2 bg-bg-hover/10">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-border/30 hover:bg-bg-hover transition-colors">
            取消
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 flex items-center gap-1.5 transition-colors">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            {saving ? '保存中…' : (template ? '更新模板' : '创建模板')}
          </button>
        </div>
      </div>
    </div>
  )
}
