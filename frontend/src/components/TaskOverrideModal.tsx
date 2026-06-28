import { useState, useEffect } from 'react'
import { X, Save, Loader2, Sparkles, Brain, FileText, RotateCcw, ListChecks, Layers } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import SearchableSelect from './SearchableSelect'

interface TaskModelConfig {
  task_type: string
  provider_id: number | null
  provider_name: string | null
  model_name: string
  user_id: number | null
  override_temperature: number | null
  override_top_p: number | null
  override_max_tokens: number | null
  override_thinking_mode: string | null
  override_thinking_budget: number | null
  override_response_format: string | null
  preset_id: number | null
}

interface Preset {
  id: number
  name: string
  is_system: boolean
  description: string
  temperature: number | null
  top_p: number | null
  max_tokens: number | null
  thinking_mode: string | null
  thinking_budget: number | null
  response_format: string | null  // 仅 text / json_object
}

interface TaskOverrideModalProps {
  taskType: string
  taskLabel: string
  current: TaskModelConfig | null
  onClose: () => void
  onSaved: () => void
  canEdit: boolean
}

const THINKING_MODES = [
  { value: '', label: '不设置' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'auto', label: '自动' },
]

const RESPONSE_FORMATS = [
  { value: '', label: '不设置' },
  { value: 'text', label: '纯文本' },
  { value: 'json_object', label: 'JSON 对象' },
]

interface OverrideForm {
  preset_id: number | null
  override_temperature: number | null
  override_top_p: number | null
  override_max_tokens: number | null
  override_thinking_mode: string | null
  override_thinking_budget: number | null
  override_response_format: string | null
}

const EMPTY_FORM: OverrideForm = {
  preset_id: null,
  override_temperature: null,
  override_top_p: null,
  override_max_tokens: null,
  override_thinking_mode: null,
  override_thinking_budget: null,
  override_response_format: null,
}

export default function TaskOverrideModal({ taskType, taskLabel, current, onClose, onSaved, canEdit }: TaskOverrideModalProps) {
  const { toast: showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [presets, setPresets] = useState<Preset[]>([])
  const [form, setForm] = useState<OverrideForm>(EMPTY_FORM)

  useEffect(() => {
    fetch('/api/v1/settings/model-presets')
      .then((r) => r.json())
      .then((data) => setPresets(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (current) {
      setForm({
        preset_id: current.preset_id,
        override_temperature: current.override_temperature,
        override_top_p: current.override_top_p,
        override_max_tokens: current.override_max_tokens,
        override_thinking_mode: current.override_thinking_mode,
        override_thinking_budget: current.override_thinking_budget,
        override_response_format: current.override_response_format,
      })
    } else {
      setForm(EMPTY_FORM)
    }
  }, [current])

  const setOverride = <K extends keyof OverrideForm>(key: K, value: OverrideForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const applyPreset = (preset: Preset) => {
    setForm((prev) => ({
      ...prev,
      preset_id: preset.id,
      override_temperature: preset.temperature,
      override_top_p: preset.top_p,
      override_max_tokens: preset.max_tokens,
      override_thinking_mode: preset.thinking_mode,
      override_thinking_budget: preset.thinking_budget,
      override_response_format: preset.response_format,
    }))
    showToast(`已应用预设「${preset.name}」，可继续微调`, 'success')
  }

  const handleSave = async () => {
    if (!current) return
    setSaving(true)
    try {
      const payload = {
        task_type: taskType,
        provider_id: current.provider_id,
        model_name: current.model_name,
        ...form,
        override_frequency_penalty: null,
        override_presence_penalty: null,
        override_stop: null,
        override_json_schema: null,
        override_extra_params_json: null,
      }
      const res = await fetch('/api/v1/settings/task-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '保存失败')
      }
      showToast(`「${taskLabel}」任务覆盖已保存`, 'success')
      onSaved()
      onClose()
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-bg-card border-b border-border">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Sparkles size={18} className="text-[#F59E0B]" />
                任务参数覆盖
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                <span className="text-gray-700 dark:text-gray-300 font-medium">{taskLabel}</span>
                <span className="mx-1.5">·</span>
                <span className="font-mono">{current?.provider_name || '未配置'}</span> / <span className="font-mono">{current?.model_name || '未配置'}</span>
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="px-5 pb-3">
            <div className="p-2.5 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/20 flex items-start gap-2">
              <ListChecks size={13} className="text-[#F59E0B] shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#F59E0B] leading-relaxed">
                这里配置的参数仅作用于「<b>{taskLabel}</b>」任务，覆盖模型默认值，空值表示继承。
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* 预设选择 */}
          <Section title="引用预设模板" icon={Layers} color="#A78BFA" hint="选中后自动填入下方字段，可继续微调">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableSelect
                  options={[
                    { value: 0, label: '不引用预设' },
                    ...presets.map((p) => ({ value: p.id, label: `${p.is_system ? '🔒 ' : '👤 '}${p.name}${p.description ? ` — ${p.description}` : ''}` })),
                  ]}
                  value={form.preset_id || 0}
                  onChange={(v) => {
                    if (!canEdit) return
                    const num = v && v !== 0 ? (v as number) : null
                    if (!num) {
                      setOverride('preset_id', null)
                      return
                    }
                    const p = presets.find((x) => x.id === num)
                    if (p) applyPreset(p)
                    else setOverride('preset_id', num)
                  }}
                />
              </div>
              {form.preset_id && (
                <button onClick={() => setOverride('preset_id', null)}
                  className="text-[11px] text-gray-500 hover:text-amber-400 flex items-center gap-0.5 shrink-0">
                  <RotateCcw size={9} />清空
                </button>
              )}
            </div>
          </Section>

          {/* 基础采样 */}
          <Section title="基础采样" icon={Sparkles} color="#3B82F6">
            <NumberField label="Temperature" value={form.override_temperature} onChange={(v) => setOverride('override_temperature', v)} onNull={() => setOverride('override_temperature', null)} min={0} max={2} step={0.05} />
            <NumberField label="Top P" value={form.override_top_p} onChange={(v) => setOverride('override_top_p', v)} onNull={() => setOverride('override_top_p', null)} min={0} max={1} step={0.05} />
            {form.override_temperature != null && form.override_top_p != null && (
              <p className="text-[11px] text-amber-400">建议 Temperature 和 Top P 只设其一，同时设置效果不可预期</p>
            )}
            <NumberField label="Max Tokens" value={form.override_max_tokens} onChange={(v) => setOverride('override_max_tokens', v)} onNull={() => setOverride('override_max_tokens', null)} min={1} step={1} />
          </Section>

          {/* 思考 */}
          <Section title="思考 / 推理" icon={Brain} color="#A78BFA">
            <SelectField label="Thinking Mode" value={form.override_thinking_mode} options={THINKING_MODES} onChange={(v) => setOverride('override_thinking_mode', v)} onNull={() => setOverride('override_thinking_mode', null)} />
            <NumberField label="Thinking Budget" value={form.override_thinking_budget} onChange={(v) => setOverride('override_thinking_budget', v)} onNull={() => setOverride('override_thinking_budget', null)} min={0} step={100} />
          </Section>

          {/* 输出格式 */}
          <Section title="输出格式" icon={FileText} color="#10B981">
            <SelectField label="Response Format" value={form.override_response_format} options={RESPONSE_FORMATS} onChange={(v) => setOverride('override_response_format', v)} onNull={() => setOverride('override_response_format', null)} />
          </Section>
        </div>

        <div className="sticky bottom-0 bg-bg-card border-t border-border px-5 py-3 flex items-center justify-between gap-2">
          <button onClick={() => setForm(EMPTY_FORM)} disabled={!canEdit}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-bg-hover text-xs text-amber-400 hover:text-amber-300 border border-border disabled:opacity-40">
            <RotateCcw size={12} />清除全部覆盖
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">取消</button>
            {canEdit && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50">
                {saving && <Loader2 size={14} className="animate-spin" />}
                <Save size={14} />{saving ? '保存中...' : '保存覆盖'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, icon: Icon, color, hint, children }: { title: string; icon: any; color: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon size={13} style={{ color }} />
        </div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
        {hint && <span className="text-[11px] text-gray-500">{hint}</span>}
      </div>
      <div className="space-y-3 pl-2 border-l border-border/40 ml-3">{children}</div>
    </div>
  )
}

function NumberField({ label, value, onChange, onNull, min, max, step }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; onNull: () => void; min?: number; max?: number; step?: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-gray-400">{label}</label>
        <button onClick={onNull} disabled={value == null}
          className="text-[11px] text-gray-500 hover:text-amber-400 disabled:opacity-30 flex items-center gap-0.5">
          <RotateCcw size={9} />继承
        </button>
      </div>
      <input type="number" value={value ?? ''} min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder="未设置（继承模型默认）"
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] font-mono" />
    </div>
  )
}

function SelectField({ label, value, options, onChange, onNull }: { label: string; value: string | null | undefined; options: { value: string; label: string }[]; onChange: (v: string | null) => void; onNull: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-gray-400">{label}</label>
        <button onClick={onNull} disabled={!value}
          className="text-[11px] text-gray-500 hover:text-amber-400 disabled:opacity-30 flex items-center gap-0.5">
          <RotateCcw size={9} />继承
        </button>
      </div>
      <SearchableSelect
        options={options.map(o => ({ value: o.value, label: o.label }))}
        value={value || ''}
        onChange={(v) => onChange(v === null ? null : (String(v) || null))}
      />
    </div>
  )
}
