import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Save, Loader2, Sparkles, Brain, FileText, RotateCcw, Layers, ListChecks, Wand2, Eye, Code2, Lightbulb, Zap, MessageSquare, AlertTriangle } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'

interface TaskModelConfig {
  task_type: string
  provider_id: number | null
  provider_name: string | null
  model_name: string
  user_id: number | null
  // 覆盖字段
  override_temperature: number | null
  override_top_p: number | null
  override_max_tokens: number | null
  override_frequency_penalty: number | null
  override_presence_penalty: number | null
  override_stop: string | null
  override_thinking_mode: string | null
  override_thinking_budget: number | null
  override_response_format: string | null
  override_json_schema: string | null
  override_extra_params_json: string | null
  preset_id: number | null
  // P1: 任务级「需要能力」约束
  required_capabilities: string[]
}

interface ProviderModelLite {
  model_name: string
  supports_function_calling?: boolean
  supports_vision?: boolean
  supports_json_mode?: boolean
  supports_thinking?: boolean
  supports_streaming?: boolean
  supports_system_prompt?: boolean
}

interface Preset {
  id: number
  name: string
  is_system: boolean
  description: string
  temperature: number | null
  top_p: number | null
  max_tokens: number | null
  frequency_penalty: number | null
  presence_penalty: number | null
  stop: string | null
  thinking_mode: string | null
  thinking_budget: number | null
  response_format: string | null
  json_schema: string | null
  extra_params_json: string | null
}

interface TaskOverrideModalProps {
  taskType: string
  taskLabel: string
  taskIcon?: any
  current: TaskModelConfig | null
  selectedModel?: ProviderModelLite | null  // 当前绑定的模型（含能力标签，用于对照显示）
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
  { value: 'json_schema', label: 'JSON Schema' },
]

// P1: 任务级「需要能力」chips
const CAP_OPTIONS = [
  { value: 'function_calling', label: '工具调用', icon: Wand2, color: '#EC4899', desc: '需要返回 tool_calls（AI Agent、ReAct 工作流）' },
  { value: 'vision',          label: '视觉理解', icon: Eye,     color: '#8B5CF6', desc: '需要看图能力（图像理解任务）' },
  { value: 'json_mode',       label: 'JSON 模式', icon: Code2,    color: '#10B981', desc: '需要强制 JSON 输出（合同解析、结构化抽取）' },
  { value: 'thinking',        label: '思考模式', icon: Lightbulb, color: '#A78BFA', desc: '需要开启深度思考（o-series / DeepSeek R1）' },
  { value: 'streaming',       label: '流式输出', icon: Zap,      color: '#06B6D4', desc: '需要流式返回（前端长对话、实时分析）' },
  { value: 'system_prompt',   label: '系统提示词', icon: MessageSquare, color: '#F59E0B', desc: '需要支持 system 角色（绝大多数场景）' },
]

export default function TaskOverrideModal({ taskType, taskLabel, current, selectedModel, onClose, onSaved, canEdit }: TaskOverrideModalProps) {
  const { toast: showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [presets, setPresets] = useState<Preset[]>([])
  const [form, setForm] = useState<Partial<TaskModelConfig>>({})
  // P1: 任务级「需要能力」独立状态（chips 切换）
  const [requiredCaps, setRequiredCaps] = useState<string[]>([])
  const [jsonSchemaText, setJsonSchemaText] = useState('')
  const [jsonSchemaError, setJsonSchemaError] = useState('')
  const [extraParamsText, setExtraParamsText] = useState('')
  const [extraParamsError, setExtraParamsError] = useState('')

  useEffect(() => {
    fetch('/api/v1/settings/model-presets')
      .then((r) => r.json())
      .then((data) => setPresets(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (current) {
      setForm({
        override_temperature: current.override_temperature,
        override_top_p: current.override_top_p,
        override_max_tokens: current.override_max_tokens,
        override_frequency_penalty: current.override_frequency_penalty,
        override_presence_penalty: current.override_presence_penalty,
        override_stop: current.override_stop,
        override_thinking_mode: current.override_thinking_mode,
        override_thinking_budget: current.override_thinking_budget,
        override_response_format: current.override_response_format,
        preset_id: current.preset_id,
      })
      // P1: 同步所需能力列表
      setRequiredCaps(Array.isArray(current.required_capabilities) ? current.required_capabilities : [])
      setJsonSchemaText(current.override_json_schema || '')
      setExtraParamsText(current.override_extra_params_json || '')
    } else {
      setForm({})
      setRequiredCaps([])
      setJsonSchemaText('')
      setExtraParamsText('')
    }
  }, [current])

  // 打开时若已有 preset_id 且 override 字段全空，自动把预设的字段填入
  // （让用户看到预设"长什么样"，避免选了预设但下面空白的困惑）
  useEffect(() => {
    if (!current?.preset_id) return
    if (presets.length === 0) return
    const p = presets.find((x) => x.id === current.preset_id)
    if (!p) return
    const hasAnyOverride = current.override_temperature != null
      || current.override_top_p != null
      || current.override_max_tokens != null
      || current.override_frequency_penalty != null
      || current.override_presence_penalty != null
      || current.override_thinking_mode != null
      || current.override_thinking_budget != null
      || current.override_response_format != null
      || current.override_json_schema
      || current.override_extra_params_json
    if (hasAnyOverride) return
    // 静默应用（不弹 toast），仅同步字段
    setForm((prev) => ({
      ...prev,
      override_temperature: p.temperature,
      override_top_p: p.top_p,
      override_max_tokens: p.max_tokens,
      override_frequency_penalty: p.frequency_penalty,
      override_presence_penalty: p.presence_penalty,
      override_stop: p.stop,
      override_thinking_mode: p.thinking_mode,
      override_thinking_budget: p.thinking_budget,
      override_response_format: p.response_format,
    }))
    setJsonSchemaText(p.json_schema || '')
    setExtraParamsText(p.extra_params_json || '')
    lastAppliedPresetRef.current = p.id
  }, [presets, current])

  // 选中预设时，自动把预设的字段值填入覆盖字段
  // 用户可在此基础上微调（任务覆盖 > 预设）
  const lastAppliedPresetRef = useRef<number | null>(null)
  const applyPreset = useCallback((preset: Preset) => {
    setForm((prev) => ({
      ...prev,
      preset_id: preset.id,
      override_temperature: preset.temperature,
      override_top_p: preset.top_p,
      override_max_tokens: preset.max_tokens,
      override_frequency_penalty: preset.frequency_penalty,
      override_presence_penalty: preset.presence_penalty,
      override_stop: preset.stop,
      override_thinking_mode: preset.thinking_mode,
      override_thinking_budget: preset.thinking_budget,
      override_response_format: preset.response_format,
    }))
    setJsonSchemaText(preset.json_schema || '')
    setExtraParamsText(preset.extra_params_json || '')
    lastAppliedPresetRef.current = preset.id
    showToast(`已应用预设「${preset.name}」的参数，可继续微调`, 'success')
  }, [showToast])

  const setOverride = <K extends keyof TaskModelConfig>(key: K, value: TaskModelConfig[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const setNull = (key: keyof TaskModelConfig) => {
    setForm((prev) => ({ ...prev, [key]: null as any }))
  }

  // P1: 切换「需要能力」chip
  const toggleCap = (cap: string) => {
    setRequiredCaps((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap])
  }

  const validateJson = (text: string, setError: (s: string) => void): boolean => {
    if (!text.trim()) { setError(''); return true }
    try { JSON.parse(text); setError(''); return true } catch (e: any) { setError(`JSON 解析错误: ${e.message}`); return false }
  }

  const handleSave = async () => {
    if (!current) return
    if (jsonSchemaText.trim() && !validateJson(jsonSchemaText, setJsonSchemaError)) return
    if (extraParamsText.trim() && !validateJson(extraParamsText, setExtraParamsError)) return
    setSaving(true)
    try {
      const payload = {
        task_type: taskType,
        provider_id: current.provider_id,
        model_name: current.model_name,
        ...form,
        override_json_schema: jsonSchemaText.trim() || null,
        override_extra_params_json: extraParamsText.trim() || null,
        // P1: 任务级「需要能力」约束
        required_capabilities: requiredCaps,
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
      const data = await res.json().catch(() => ({}))
      // P1: 后端若返回 caps_warning（能力与模型不匹配），提示用户
      if (data?.caps_warning && Array.isArray(data.caps_warning) && data.caps_warning.length > 0) {
        const labelMap: Record<string, string> = Object.fromEntries(CAP_OPTIONS.map((o) => [o.value, o.label]))
        const labels = data.caps_warning.filter((c: string) => !c.startsWith('__model_not_found')).map((c: string) => labelMap[c] || c)
        if (labels.length > 0) {
          showToast(`⚠️ 已保存，但当前模型不支持: ${labels.join('、')}`, 'warning')
          onSaved()
          onClose()
          return
        }
      }
      showToast(`「${taskLabel}」任务覆盖已保存`, 'success')
      onSaved()
      onClose()
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error')
    } finally { setSaving(false) }
  }

  const handleClearAll = () => {
    setForm({})
    setRequiredCaps([])  // P1
    setJsonSchemaText('')
    setJsonSchemaError('')
    setExtraParamsText('')
    setExtraParamsError('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
          {/* 提示横幅 */}
          <div className="px-5 pb-3">
            <div className="p-2.5 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/20 flex items-start gap-2">
              <ListChecks size={13} className="text-[#F59E0B] shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#F59E0B] leading-relaxed">
                这里配置的参数仅作用于「<b>{taskLabel}</b>」任务，会覆盖模型默认参数。<br />
                优先级：<b>函数硬编码 &gt; 预设模板 &gt; 任务覆盖（这里） &gt; 模型默认 &gt; 函数软默认</b>。
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* P1: 任务级「需要能力」约束 */}
          <Section title="需要的能力" icon={Wand2} color="#EC4899" hint="勾选后只允许绑定支持这些能力的模型；保存时会自动校验">
            <div className="flex flex-wrap gap-1.5">
              {CAP_OPTIONS.map((opt) => {
                const active = requiredCaps.includes(opt.value)
                const Icon = opt.icon
                // 判断当前模型是否支持（用于背景色 + 红/绿勾）
                const supports = !selectedModel || isModelSupports(selectedModel, opt.value)
                return (
                  <button
                    key={opt.value}
                    onClick={() => canEdit && toggleCap(opt.value)}
                    disabled={!canEdit}
                    title={opt.desc + (selectedModel ? (supports ? ' · ✅ 当前模型支持' : ' · ❌ 当前模型不支持') : '')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] border transition-all ${
                      active
                        ? 'border-opacity-60 text-white shadow-sm'
                        : 'border-border bg-bg-input text-gray-500 hover:text-gray-300'
                    }`}
                    style={active ? { backgroundColor: `${opt.color}25`, borderColor: opt.color, color: opt.color } : {}}
                  >
                    <Icon size={11} style={active ? { color: opt.color } : undefined} />
                    <span>{opt.label}</span>
                    {active && (
                      <span className="ml-0.5" style={{ color: supports ? '#10B981' : '#EF4444' }}>
                        {supports ? '✓' : '✕'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {requiredCaps.length > 0 && selectedModel && (
              (() => {
                const missing = requiredCaps.filter((c) => !isModelSupports(selectedModel, c))
                if (missing.length === 0) {
                  return (
                    <p className="text-[10px] text-[#10B981] flex items-center gap-1">
                      <span>✅</span>当前模型「{selectedModel.model_name}」满足全部能力
                    </p>
                  )
                }
                const labelMap: Record<string, string> = Object.fromEntries(CAP_OPTIONS.map((o) => [o.value, o.label]))
                return (
                  <div className="px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/30 flex items-start gap-1.5">
                    <AlertTriangle size={11} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-red-400 leading-relaxed">
                      当前模型「{selectedModel.model_name}」不支持: {missing.map((c) => labelMap[c] || c).join('、')}，保存会提示警告，调用时也可能失败
                    </p>
                  </div>
                )
              })()
            )}
          </Section>

          {/* 预设选择 */}
          <Section title="引用预设模板" icon={Layers} color="#A78BFA" hint="选中预设会自动把它的参数填到下方覆盖字段，可继续微调">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-gray-400">预设模板</label>
                <button onClick={() => setNull('preset_id')} disabled={!form.preset_id}
                  className="text-[10px] text-gray-500 hover:text-amber-400 disabled:opacity-30 flex items-center gap-0.5">
                  <RotateCcw size={9} />清空
                </button>
              </div>
              <select value={form.preset_id || ''} onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null
                if (!v) { setNull('preset_id'); return }
                const p = presets.find((x) => x.id === v)
                if (p) applyPreset(p)
                else setOverride('preset_id', v)
              }}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#A78BFA]">
                <option value="">不引用预设</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.is_system ? '🔒 ' : '👤 '}{p.name}{p.description ? ` — ${p.description}` : ''}
                  </option>
                ))}
              </select>
              {/* 选中预设时显示其参数预览 */}
              {form.preset_id && (() => {
                const p = presets.find((x) => x.id === form.preset_id)
                if (!p) return null
                const items: string[] = []
                if (p.temperature != null) items.push(`temp=${p.temperature}`)
                if (p.top_p != null) items.push(`top_p=${p.top_p}`)
                if (p.max_tokens != null) items.push(`max=${p.max_tokens}`)
                if (p.frequency_penalty != null) items.push(`freq_p=${p.frequency_penalty}`)
                if (p.presence_penalty != null) items.push(`pres_p=${p.presence_penalty}`)
                if (p.thinking_mode) items.push(`think=${p.thinking_mode}`)
                if (p.thinking_budget != null) items.push(`think_budget=${p.thinking_budget}`)
                if (p.response_format && p.response_format !== 'text') items.push(`fmt=${p.response_format}`)
                if (items.length === 0) return null
                return (
                  <div className="mt-2 px-2.5 py-1.5 rounded-md bg-[#A78BFA]/5 border border-[#A78BFA]/20 flex items-start gap-1.5">
                    <Layers size={10} className="text-[#A78BFA] shrink-0 mt-0.5" />
                    <p className="text-[10px] text-[#A78BFA] leading-relaxed">
                      预设将应用：<span className="font-mono">{items.join(' · ')}</span>
                    </p>
                  </div>
                )
              })()}
            </div>
          </Section>

          {/* 基础采样 */}
          <Section title="基础采样覆盖" icon={Sparkles} color="#3B82F6">
            <NumberField label="Temperature" value={form.override_temperature} onChange={(v) => setOverride('override_temperature', v)} onNull={() => setNull('override_temperature')} min={0} max={2} step={0.05} />
            <NumberField label="Top P" value={form.override_top_p} onChange={(v) => setOverride('override_top_p', v)} onNull={() => setNull('override_top_p')} min={0} max={1} step={0.05} />
            <NumberField label="Max Tokens" value={form.override_max_tokens} onChange={(v) => setOverride('override_max_tokens', v)} onNull={() => setNull('override_max_tokens')} min={1} step={1} />
            <NumberField label="Frequency Penalty" value={form.override_frequency_penalty} onChange={(v) => setOverride('override_frequency_penalty', v)} onNull={() => setNull('override_frequency_penalty')} min={-2} max={2} step={0.1} />
            <NumberField label="Presence Penalty" value={form.override_presence_penalty} onChange={(v) => setOverride('override_presence_penalty', v)} onNull={() => setNull('override_presence_penalty')} min={-2} max={2} step={0.1} />
            <TextField label="Stop Sequences" value={form.override_stop} onChange={(v) => setOverride('override_stop', v)} onNull={() => setNull('override_stop')} placeholder='["\\n\\n"]' />
          </Section>

          {/* 思考 */}
          <Section title="思考 / 推理覆盖" icon={Brain} color="#A78BFA">
            <SelectField label="Thinking Mode" value={form.override_thinking_mode} options={THINKING_MODES} onChange={(v) => setOverride('override_thinking_mode', v)} onNull={() => setNull('override_thinking_mode')} />
            <NumberField label="Thinking Budget" value={form.override_thinking_budget} onChange={(v) => setOverride('override_thinking_budget', v)} onNull={() => setNull('override_thinking_budget')} min={0} step={100} />
          </Section>

          {/* 输出 */}
          <Section title="输出控制覆盖" icon={FileText} color="#10B981">
            <SelectField label="Response Format" value={form.override_response_format} options={RESPONSE_FORMATS} onChange={(v) => setOverride('override_response_format', v)} onNull={() => setNull('override_response_format')} />
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">JSON Schema</label>
              <textarea value={jsonSchemaText} onChange={(e) => { setJsonSchemaText(e.target.value); validateJson(e.target.value, setJsonSchemaError) }}
                rows={5} disabled={!canEdit}
                className={`w-full px-3 py-2 rounded-lg bg-bg-input border text-xs font-mono text-gray-700 dark:text-gray-300 outline-none focus:border-[#10B981] resize-none ${jsonSchemaError ? 'border-red-500/50' : 'border-border'}`}
                placeholder={'{\n  "type": "object",\n  "properties": {...}\n}'} />
              {jsonSchemaError && <p className="text-[10px] text-red-400 mt-1">{jsonSchemaError}</p>}
            </div>
          </Section>

          {/* 厂商专属参数 */}
          <Section title="厂商专属参数" icon={FileText} color="#94a3b8" hint="extra_body 字段，JSON 对象">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Extra Params (JSON)</label>
              <textarea value={extraParamsText} onChange={(e) => { setExtraParamsText(e.target.value); validateJson(e.target.value, setExtraParamsError) }}
                rows={3} disabled={!canEdit}
                className={`w-full px-3 py-2 rounded-lg bg-bg-input border text-xs font-mono text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] resize-none ${extraParamsError ? 'border-red-500/50' : 'border-border'}`}
                placeholder='{"top_k": 50, "seed": 42}' />
              {extraParamsError && <p className="text-[10px] text-red-400 mt-1">{extraParamsError}</p>}
            </div>
          </Section>
        </div>

        {/* 底部 */}
        <div className="sticky bottom-0 bg-bg-card border-t border-border px-5 py-3 flex items-center justify-between gap-2">
          <button onClick={handleClearAll} disabled={!canEdit}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-bg-hover text-xs text-amber-400 hover:text-amber-300 border border-border disabled:opacity-40">
            <RotateCcw size={12} />清除全部覆盖
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">取消</button>
            {canEdit && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#F59E0B] text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50">
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
        {hint && <span className="text-[10px] text-gray-500">{hint}</span>}
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
          className="text-[10px] text-gray-500 hover:text-amber-400 disabled:opacity-30 flex items-center gap-0.5">
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

function TextField({ label, value, onChange, onNull, placeholder }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; onNull: () => void; placeholder?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-gray-400">{label}</label>
        <button onClick={onNull} disabled={!value}
          className="text-[10px] text-gray-500 hover:text-amber-400 disabled:opacity-30 flex items-center gap-0.5">
          <RotateCcw size={9} />清空
        </button>
      </div>
      <input value={value || ''} onChange={(e) => onChange(e.target.value || null)}
        placeholder={placeholder || '未设置'}
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6]" />
    </div>
  )
}

function SelectField({ label, value, options, onChange, onNull }: { label: string; value: string | null | undefined; options: { value: string; label: string }[]; onChange: (v: string | null) => void; onNull: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs text-gray-400">{label}</label>
        <button onClick={onNull} disabled={!value}
          className="text-[10px] text-gray-500 hover:text-amber-400 disabled:opacity-30 flex items-center gap-0.5">
          <RotateCcw size={9} />继承
        </button>
      </div>
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6]">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// P1: 检查模型是否支持指定能力（用于 chip 颜色/红绿勾）
function isModelSupports(m: ProviderModelLite, cap: string): boolean {
  switch (cap) {
    case 'function_calling': return !!m.supports_function_calling
    case 'vision':          return !!m.supports_vision
    case 'json_mode':       return !!m.supports_json_mode
    case 'thinking':        return !!m.supports_thinking
    case 'streaming':       return m.supports_streaming !== false  // 默认 True
    case 'system_prompt':   return m.supports_system_prompt !== false  // 默认 True
    default: return true
  }
}
