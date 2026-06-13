import { useState, useEffect } from 'react'
import { X, Save, Loader2, Brain, AlertCircle, RotateCcw, FileText, MessageSquare, Eye, Mic, Hash, Globe, ListChecks, Cpu, Sparkles, type LucideIcon } from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { IconBox } from './design-system'
import { TONES, type Tone } from '../theme/tokens'

interface ModelDetail {
  id: number
  model_name: string
  model_type: string
  // P1 多模态：可执行的 task_type 列表
  supported_task_types: string[]
  // 默认参数
  default_temperature: number | null
  default_top_p: number | null
  default_max_tokens: number | null
  default_frequency_penalty: number | null
  default_presence_penalty: number | null
  default_stop: string | null
  // 思考
  default_thinking_mode: string | null
  default_thinking_budget: number | null
  // 输出
  default_response_format: string | null
  default_json_schema: string | null
  // 能力
  context_window: number | null
  supports_streaming: boolean
  supports_function_calling: boolean
  supports_vision: boolean
  supports_json_mode: boolean
  supports_thinking: boolean
  supports_system_prompt: boolean
  // 元数据
  extra_params_json: string | null
  description: string | null
  tags: string | null
}


// P1 多模态：可执行任务类型 chips 配置
type ChipTone = 'blue' | 'purple' | 'orange' | 'green' | 'pink'
const TASK_TYPE_OPTIONS: { value: string; label: string; icon: LucideIcon; tone: ChipTone; desc: string }[] = [
  { value: 'chat', label: '对话', icon: MessageSquare, tone: 'blue', desc: '通用对话/总结/抽取/洞察' },
  { value: 'vision', label: '图像理解', icon: Eye, tone: 'purple', desc: '图片 OCR、合同扫描件识别' },
  { value: 'speech_to_text', label: '语音转写', icon: Mic, tone: 'orange', desc: '会议录音转文字 (ASR)' },
  { value: 'embedding', label: '向量化', icon: Hash, tone: 'green', desc: '文本 Embedding（语义检索）' },
  { value: 'web_search', label: '联网搜索', icon: Globe, tone: 'pink', desc: '调用 Tavily 等联网工具' },
]


interface ModelDetailDrawerProps {
  providerId: number
  providerName: string
  modelId: number | null
  modelName: string | null
  open: boolean
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

export default function ModelDetailDrawer({ providerId, providerName, modelId, modelName, open, onClose, onSaved, canEdit }: ModelDetailDrawerProps) {
  const { toast: showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<ModelDetail | null>(null)
  const [form, setForm] = useState<Partial<ModelDetail>>({})
  const [jsonSchemaText, setJsonSchemaText] = useState('')
  const [jsonSchemaError, setJsonSchemaError] = useState('')
  const [extraParamsText, setExtraParamsText] = useState('')
  const [extraParamsError, setExtraParamsError] = useState('')

  useEffect(() => {
    if (!open || !modelId) return
    setLoading(true)
    fetch(`/api/v1/settings/providers/${providerId}/models`)
      .then((r) => r.json())
      .then((list: ModelDetail[]) => {
        const m = list.find((x) => x.id === modelId)
        if (!m) { showToast('模型不存在', 'error'); onClose(); return }
        setDetail(m)
        setForm({ ...m, supported_task_types: Array.isArray(m.supported_task_types) ? m.supported_task_types : ['chat'] })
        setJsonSchemaText(m.default_json_schema || '')
        setExtraParamsText(m.extra_params_json || '')
      })
      .catch(() => showToast('加载失败', 'error'))
      .finally(() => setLoading(false))
  }, [open, modelId, providerId])

  if (!open) return null

  const set = <K extends keyof ModelDetail>(key: K, value: ModelDetail[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const setNull = (key: keyof ModelDetail) => {
    setForm((prev) => ({ ...prev, [key]: null as any }))
  }

  const toggleTaskType = (tt: string) => {
    setForm((prev) => {
      const list = prev.supported_task_types || []
      const next = list.includes(tt) ? list.filter((x) => x !== tt) : [...list, tt]
      // 至少保留一个
      return { ...prev, supported_task_types: next.length > 0 ? next : list }
    })
  }

  const validateJson = (text: string, setError: (s: string) => void): boolean => {
    if (!text.trim()) { setError(''); return true }
    try { JSON.parse(text); setError(''); return true } catch (e: any) { setError(`JSON 解析错误: ${e.message}`); return false }
  }

  const handleSave = async () => {
    if (!modelId) return
    if (jsonSchemaText.trim() && !validateJson(jsonSchemaText, setJsonSchemaError)) return
    if (extraParamsText.trim() && !validateJson(extraParamsText, setExtraParamsError)) return
    setSaving(true)
    try {
      const payload: Record<string, any> = { ...form }
      payload.default_json_schema = jsonSchemaText.trim() || null
      payload.extra_params_json = extraParamsText.trim() || null
      const res = await fetch(`/api/v1/settings/providers/${providerId}/models/${modelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '保存失败')
      }
      showToast('模型参数已保存', 'success')
      onSaved()
      onClose()
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl bg-bg-card border-l border-border shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-bg-card border-b border-border">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="min-w-0 flex-1 flex items-center gap-3">
              <IconBox icon={Cpu} size="md" tone="blue" variant="solid" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">模型参数</h3>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {providerName} / <span className="font-mono text-gray-700 dark:text-gray-300">{modelName}</span>
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500"><Loader2 size={20} className="mx-auto animate-spin mb-2" />加载中...</div>
        ) : !detail ? null : (
          <div className="p-5 space-y-6">

            {/* P1 多模态：可执行任务类型 */}
            <Section title="可执行任务类型" icon={ListChecks} color="#EC4899" hint="决定该模型能在哪些任务的下拉中可选。多模态模型可勾选多个">
              <div className="flex flex-wrap gap-2">
                {TASK_TYPE_OPTIONS.map((opt) => {
                  const active = (form.supported_task_types || []).includes(opt.value)
                  const Icon = opt.icon
                  const t = TONES[opt.tone]
                  return (
                    <button key={opt.value} type="button" onClick={() => canEdit && toggleTaskType(opt.value)}
                      disabled={!canEdit}
                      title={opt.desc}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${active
                        ? 'border-transparent text-white shadow-md'
                        : 'border-border bg-bg-input text-gray-500 hover:text-gray-300'
                        } ${!canEdit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                      style={active ? { background: `linear-gradient(135deg, ${t[500]} 0%, ${t[600]} 100%)`, boxShadow: `0 2px 8px ${t.shadow}` } : {}}>
                      <Icon size={12} />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                已选 {(form.supported_task_types || []).length} 个 ·
                例如 Gemini-3-flash 勾选「对话+图像理解」即可同时用于 chat 和 vision 任务
              </p>
            </Section>

            {/* 基础采样 */}
            <Section title="基础采样" icon={Sparkles} color="#3B82F6">
              <NumberField label="Temperature" hint="0=确定性，2=高随机。一般聊天 0.7，提取 0.1-0.3"
                value={form.default_temperature} onChange={(v) => set('default_temperature', v)} onNull={() => setNull('default_temperature')} min={0} max={2} step={0.05} />
              <NumberField label="Top P" hint="核采样。建议 0.9-1.0"
                value={form.default_top_p} onChange={(v) => set('default_top_p', v)} onNull={() => setNull('default_top_p')} min={0} max={1} step={0.05} />
              <NumberField label="Max Tokens" hint="单次最大输出 token"
                value={form.default_max_tokens} onChange={(v) => set('default_max_tokens', v)} onNull={() => setNull('default_max_tokens')} min={1} step={1} />
              <NumberField label="Frequency Penalty" hint="-2 到 2，正值减少重复"
                value={form.default_frequency_penalty} onChange={(v) => set('default_frequency_penalty', v)} onNull={() => setNull('default_frequency_penalty')} min={-2} max={2} step={0.1} />
              <NumberField label="Presence Penalty" hint="-2 到 2，正值鼓励新话题"
                value={form.default_presence_penalty} onChange={(v) => set('default_presence_penalty', v)} onNull={() => setNull('default_presence_penalty')} min={-2} max={2} step={0.1} />
              <TextField label="Stop Sequences" hint={'JSON 数组，如 ["\\n\\n"]'}
                value={form.default_stop} onChange={(v) => set('default_stop', v)} onNull={() => setNull('default_stop')} placeholder={'["\\n\\n"]'} />
            </Section>

            {/* 思考 / 推理 */}
            <Section title="思考 / 推理" icon={Brain} tone="purple" hint="o-series / Gemini thinking / Claude extended / DeepSeek R1">
              <SelectField label="Thinking Mode" value={form.default_thinking_mode} options={THINKING_MODES} onChange={(v) => set('default_thinking_mode', v)} onNull={() => setNull('default_thinking_mode')} />
              <NumberField label="Thinking Budget" hint="思考 token 上限（部分模型需设）"
                value={form.default_thinking_budget} onChange={(v) => set('default_thinking_budget', v)} onNull={() => setNull('default_thinking_budget')} min={0} step={100} />
            </Section>

            {/* 输出控制 */}
            <Section title="输出控制" icon={FileText} color="#10B981">
              <SelectField label="Response Format" value={form.default_response_format} options={RESPONSE_FORMATS} onChange={(v) => set('default_response_format', v)} onNull={() => setNull('default_response_format')} />
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">JSON Schema <span className="text-[10px] text-gray-500">（仅 json_schema 模式）</span></label>
                <textarea value={jsonSchemaText} onChange={(e) => { setJsonSchemaText(e.target.value); validateJson(e.target.value, setJsonSchemaError) }}
                  rows={6} disabled={!canEdit}
                  className={`w-full px-3 py-2 rounded-lg bg-bg-input border text-xs font-mono text-gray-700 dark:text-gray-300 outline-none focus:border-[#10B981] resize-none ${jsonSchemaError ? 'border-red-500/50' : 'border-border'}`}
                  placeholder={'{\n  "type": "object",\n  "properties": {\n    "name": { "type": "string" },\n    "score": { "type": "number" }\n  }\n}'} />
                {jsonSchemaError && <p className="text-[10px] text-red-400 mt-1">{jsonSchemaError}</p>}
                <button onClick={() => { setJsonSchemaText(''); setJsonSchemaError('') }} disabled={!canEdit || !jsonSchemaText}
                  className="text-[10px] text-gray-500 hover:text-gray-300 mt-1 disabled:opacity-40">清空</button>
              </div>
            </Section>

            {/* 能力标签 */}
            <Section title="能力标签" icon={Cpu} color="#F59E0B" hint="控制 ai_service 走哪种调用方式">
              <NumberField label="Context Window" hint="上下文窗口 token 数"
                value={form.context_window} onChange={(v) => set('context_window', v)} onNull={() => setNull('context_window')} min={0} step={1024} />
              <ToggleField label="Streaming" checked={!!form.supports_streaming} onChange={(v) => set('supports_streaming', v)} />
              <ToggleField label="Function Calling (工具调用)" checked={!!form.supports_function_calling} onChange={(v) => set('supports_function_calling', v)} />
              <ToggleField label="Vision (图像理解)" checked={!!form.supports_vision} onChange={(v) => set('supports_vision', v)} />
              <ToggleField label="JSON Mode" checked={!!form.supports_json_mode} onChange={(v) => set('supports_json_mode', v)} />
              <ToggleField label="Thinking (思考推理)" checked={!!form.supports_thinking} onChange={(v) => set('supports_thinking', v)} />
              <ToggleField label="System Prompt" checked={!!form.supports_system_prompt} onChange={(v) => set('supports_system_prompt', v)} />
            </Section>

            {/* 元数据 */}
            <Section title="元数据" icon={FileText} tone="gray">
              <TextField label="Description" hint="模型用途说明"
                value={form.description} onChange={(v) => set('description', v)} onNull={() => setNull('description')} />
              <TextField label="Tags" hint="逗号分隔，如 chat, fast, cheap"
                value={form.tags} onChange={(v) => set('tags', v)} onNull={() => setNull('tags')} />
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Extra Params (厂商专属) <span className="text-[10px] text-gray-500">JSON 对象</span></label>
                <textarea value={extraParamsText} onChange={(e) => { setExtraParamsText(e.target.value); validateJson(e.target.value, setExtraParamsError) }}
                  rows={4} disabled={!canEdit}
                  className={`w-full px-3 py-2 rounded-lg bg-bg-input border text-xs font-mono text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] resize-none ${extraParamsError ? 'border-red-500/50' : 'border-border'}`}
                  placeholder='{"top_k": 50, "seed": 42, "repetition_penalty": 1.1}' />
                {extraParamsError && <p className="text-[10px] text-red-400 mt-1">{extraParamsError}</p>}
              </div>
            </Section>

            {!canEdit && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">你没有此供应商的编辑权限</p>
              </div>
            )}
          </div>
        )}

        {/* 底部操作栏 */}
        {detail && (
          <div className="sticky bottom-0 bg-bg-card border-t border-border px-5 py-3 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">取消</button>
            {canEdit && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50">
                {saving && <Loader2 size={14} className="animate-spin" />}
                <Save size={14} />{saving ? '保存中...' : '保存参数'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, icon: Icon, tone, hint, children }: { title: string; icon: LucideIcon; tone: 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'gray'; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IconBox icon={Icon} size="sm" tone={tone} variant="soft" />
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
        {hint && <span className="text-[10px] text-gray-500">· {hint}</span>}
      </div>
      <div className="space-y-3 pl-2 border-l border-border/40 ml-3">{children}</div>
    </div>
  )
}

function NumberField({ label, hint, value, onChange, onNull, min, max, step }: { label: string; hint?: string; value: number | null | undefined; onChange: (v: number | null) => void; onNull: () => void; min?: number; max?: number; step?: number }) {
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
        placeholder="未设置（继承默认）"
        className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] font-mono" />
      {hint && <p className="text-[10px] text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

function TextField({ label, hint, value, onChange, onNull, placeholder }: { label: string; hint?: string; value: string | null | undefined; onChange: (v: string | null) => void; onNull: () => void; placeholder?: string }) {
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
      {hint && <p className="text-[10px] text-gray-500 mt-1">{hint}</p>}
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

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <label className="text-xs text-gray-400">{label}</label>
      <button onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-[#10B981]' : 'bg-gray-600'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}
