import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X, Save, Trash2, Loader2, Key, Globe, Cpu, Settings2, ListChecks, Sparkles, Brain, Eye, EyeOff, Mic, MessageSquare, Search, ChevronDown, Home, RotateCcw, Edit3, User, Package, MapPin, Activity, Cloud, Palette, Upload, Copy, Terminal, Zap, Pencil, AlertTriangle, Sliders, Layers, Megaphone, RefreshCw, CheckCircle2, Power, Mail, Send, Briefcase, Building2, Users, Calendar } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useSearchParams } from 'react-router-dom'
import ModelDetailDrawer from '../components/ModelDetailDrawer'
import TaskOverrideModal from '../components/TaskOverrideModal'
import { IconBox, StatusBadge, SectionHeader, TASK_GROUP_ICONS, SUBTASK_ICONS } from '../components/design-system'
import RichTextEditor from '../components/RichTextEditor'
import SearchableSelect from '../components/SearchableSelect'

interface Provider {
  id: number
  name: string
  base_url: string
  api_key: string
  is_active: boolean
  provider_type: string
  supported_models_json: string
  user_id: number | null
  project_id: string | null
  location: string | null
  gcp_label_team: string | null
  gcp_label_app: string | null
  gcp_label_env: string | null
}

interface ProviderModelItem {
  id: number
  model_name: string
  model_type: string
  // P1 多模态：模型可执行的任务类型列表
  supported_task_types: string[]
  // P1 任务级「需要能力」：模型的能力标签（与后端 ProviderModel 字段一致）
  supports_function_calling?: boolean
  supports_vision?: boolean
  supports_json_mode?: boolean
  supports_thinking?: boolean
  supports_streaming?: boolean
  supports_system_prompt?: boolean
}

interface FetchedModel {
  id: string
  owned_by: string
}

interface FieldOption {
  id: number; category: string; value: string; sort_order: number
}

interface TaskConfig {
  task_type: string
  provider_id: number | null
  provider_name: string | null
  model_name: string
  user_id: number | null
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
}

interface Preset {
  id: number
  name: string
  description: string
  is_system: boolean
  user_id: number | null
  temperature: number | null
  top_p: number | null
  max_tokens: number | null
  thinking_mode: string | null
  thinking_budget: number | null
  response_format: string | null
}

// 任务组：按功能性质聚类。同一组的所有 task 共享同一个模型配置。
const TASK_GROUPS: {
  id: string
  label: string
  desc: string
  icon: any
  color: string
  taskKeys: string[]
  compatibleTypes: string[]
}[] = [
  { id: 'chat', label: '通用对话', desc: 'AI 助手、在线问答、自由聊天', icon: TASK_GROUP_ICONS.chat.icon, color: '#3B82F6', taskKeys: ['chat'], compatibleTypes: ['chat'] },
  { id: 'summary', label: '内容总结', desc: '日报 / 周报 / 会议纪要 — 3 任务共享', icon: TASK_GROUP_ICONS.summary.icon, color: '#10B981', taskKeys: ['daily_summary', 'weekly_summary', 'meeting_organize'], compatibleTypes: ['chat'] },
  { id: 'extract', label: '结构化抽取', desc: '会议抽取 / 合同解析 / 项目分析 / 公司信息 — 4 任务共享', icon: TASK_GROUP_ICONS.extract.icon, color: '#A78BFA', taskKeys: ['meeting_extract', 'contract_parse', 'project_analysis', 'company_info'], compatibleTypes: ['chat'] },
  { id: 'insight', label: '业务洞察', desc: '周 / 月 / 季 综合业务洞察共享', icon: TASK_GROUP_ICONS.insight.icon, color: '#F59E0B', taskKeys: ['insight_week', 'insight_month', 'insight_quarter'], compatibleTypes: ['chat'] },
  { id: 'multimodal', label: '多模态 / 专用模型', desc: '语音转写 / 图像理解 / 向量化 — 各需不同类型模型', icon: TASK_GROUP_ICONS.multimodal.icon, color: '#EC4899', taskKeys: ['speech_to_text', 'vision', 'embedding'], compatibleTypes: [] },
]


const MODEL_TYPE_OPTIONS = [
  { key: 'chat', label: '对话' },
  { key: 'embedding', label: '嵌入' },
  { key: 'speech_to_text', label: 'ASR' },
  { key: 'vision', label: '视觉' },
  { key: 'web_search', label: '搜索' },
]
const TYPE_COLORS: Record<string, string> = {
  chat: 'bg-gray-500/10 text-gray-500',
  embedding: 'bg-blue-500/10 text-blue-400',
  speech_to_text: 'bg-amber-500/10 text-amber-400',
  vision: 'bg-purple-500/10 text-purple-400',
  web_search: 'bg-emerald-500/10 text-emerald-400',
}
const TYPE_LABEL: Record<string, string> = { chat: '对话', embedding: '嵌入', speech_to_text: 'ASR', vision: '视觉', web_search: '搜索' }

// P1 多模态：检查模型是否支持某个 task_type（向后兼容老数据：fallback 到 model_type）
const modelSupports = (m: ProviderModelItem, taskType: string): boolean => {
  if (Array.isArray(m.supported_task_types) && m.supported_task_types.length > 0) {
    return m.supported_task_types.includes(taskType)
  }
  // 老数据兜底：基于 model_type 字段
  return m.model_type === taskType
}

// P1 多模态：检查模型是否支持组内任一 task_type
const modelSupportsAnyOf = (m: ProviderModelItem, taskTypes: string[]): boolean => {
  if (!taskTypes || taskTypes.length === 0) return true
  return taskTypes.some((t) => modelSupports(m, t))
}

// ==================== 邮件服务配置 ====================
type ToastFn = (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void

const EMAIL_PRESETS: Record<string, { label: string; host: string; port: number; use_tls: boolean; use_ssl: boolean; note: string }> = {
  gmail:   { label: 'Gmail（App Password）',    host: 'smtp.gmail.com',     port: 587, use_tls: true,  use_ssl: false, note: '在 Google 账号「安全→两步验证→应用专用密码」生成密码' },
  qq:      { label: 'QQ邮箱',                   host: 'smtp.qq.com',        port: 587, use_tls: true,  use_ssl: false, note: '在 QQ 邮箱「设置→账户→POP3/SMTP」开启并获取授权码' },
  '163':   { label: '163邮箱',                  host: 'smtp.163.com',       port: 465, use_tls: false, use_ssl: true,  note: '在 163「设置→POP3/SMTP/IMAP」开启客户端授权码' },
  outlook: { label: 'Outlook / Office 365',     host: 'smtp.office365.com', port: 587, use_tls: true,  use_ssl: false, note: '使用 Microsoft 账号密码或应用专用密码' },
  smtp:    { label: '自定义 SMTP',              host: '',                   port: 587, use_tls: true,  use_ssl: false, note: '适用于公司自建邮箱或其他 SMTP 服务商' },
}

function EmailConfigSection({ showToast }: { showToast: ToastFn }) {
  const [cfg, setCfg] = useState({
    enabled: false, host: '', port: 587, username: '', password: '',
    from_name: 'WorkTrack 系统', use_tls: true, use_ssl: false,
    provider: 'smtp', password_set: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    fetch('/api/v1/settings/email-config', { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCfg(prev => ({ ...prev, ...d, password: '' })) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const applyPreset = (key: string) => {
    const p = EMAIL_PRESETS[key]
    if (p) setCfg(prev => ({ ...prev, provider: key, host: p.host, port: p.port, use_tls: p.use_tls, use_ssl: p.use_ssl }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        enabled: cfg.enabled, host: cfg.host, port: cfg.port,
        username: cfg.username, from_name: cfg.from_name,
        use_tls: cfg.use_tls, use_ssl: cfg.use_ssl, provider: cfg.provider,
      }
      if (cfg.password) payload.password = cfg.password
      const r = await fetch('/api/v1/settings/email-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify(payload),
      })
      if (!r.ok) throw new Error((await r.json()).detail || '保存失败')
      showToast('邮件配置已保存', 'success')
      setCfg(prev => ({ ...prev, password: '', password_set: prev.password_set || !!prev.password }))
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!testTo || !testTo.includes('@')) return showToast('请填写有效的收件邮箱', 'error')
    setTesting(true)
    try {
      const r = await fetch('/api/v1/settings/email-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify({ to: testTo }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || d.message || '发送失败')
      showToast(d.message || '测试邮件已发送', 'success')
    } catch (e: any) {
      showToast(e.message || '发送失败', 'error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return null
  const presetNote = EMAIL_PRESETS[cfg.provider]?.note

  return (
    <div className="mb-10 p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
      <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1 flex items-center gap-2">
        <Mail size={18} className="text-[#3B82F6]" /> 邮件服务配置
      </h3>
      <p className="text-xs text-gray-500 mb-5">配置 SMTP 邮件服务，用于审批通知、密码重置等系统邮件发送</p>

      {/* 启用开关 */}
      <div className="flex items-center justify-between mb-5 p-3 rounded-lg bg-bg-hover border border-border">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">启用邮件服务</p>
          <p className="text-[11px] text-gray-500 mt-0.5">开启后系统将通过配置的 SMTP 发送通知邮件</p>
        </div>
        <button
          onClick={() => setCfg(prev => ({ ...prev, enabled: !prev.enabled }))}
          className={`relative w-11 h-6 rounded-full transition-colors ${cfg.enabled ? 'bg-[#3B82F6]' : 'bg-gray-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${cfg.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* 服务商预设 */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-2">选择邮件服务商（预设参数）</label>
        <div className="grid grid-cols-5 gap-2 max-md:grid-cols-3">
          {Object.entries(EMAIL_PRESETS).map(([key, p]) => (
            <button key={key} onClick={() => applyPreset(key)}
              className={`px-2 py-2 text-[11px] rounded-lg border text-center transition-colors ${cfg.provider === key ? 'border-[#3B82F6] bg-[#3B82F6]/10 text-[#60A5FA]' : 'border-border text-gray-400 hover:border-gray-400'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {presetNote && <p className="text-[11px] text-amber-400/80 mt-2">💡 {presetNote}</p>}
      </div>

      {/* SMTP 参数 */}
      <div className="grid grid-cols-2 gap-3 mb-4 max-md:grid-cols-1">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">SMTP 主机</label>
          <input value={cfg.host} onChange={e => setCfg(prev => ({ ...prev, host: e.target.value }))}
            placeholder="如 smtp.gmail.com"
            className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white focus:outline-none focus:border-[#3B82F6]" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">端口</label>
          <input type="number" value={cfg.port} onChange={e => setCfg(prev => ({ ...prev, port: parseInt(e.target.value) || 587 }))}
            className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white focus:outline-none focus:border-[#3B82F6]" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">发件邮箱（用户名）</label>
          <input value={cfg.username} onChange={e => setCfg(prev => ({ ...prev, username: e.target.value }))}
            placeholder="your@email.com"
            className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white focus:outline-none focus:border-[#3B82F6]" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            密码 / 授权码{cfg.password_set && !cfg.password && <span className="ml-1 text-emerald-400">（已设置）</span>}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={cfg.password}
              onChange={e => setCfg(prev => ({ ...prev, password: e.target.value }))}
              placeholder={cfg.password_set ? '留空则不修改' : '邮箱密码或应用专用密码'}
              className="w-full px-3 py-2 pr-8 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white focus:outline-none focus:border-[#3B82F6]"
            />
            <button onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">发件人显示名称</label>
          <input value={cfg.from_name} onChange={e => setCfg(prev => ({ ...prev, from_name: e.target.value }))}
            placeholder="WorkTrack 系统"
            className="w-full px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white focus:outline-none focus:border-[#3B82F6]" />
        </div>
        <div className="flex items-center gap-4 pt-5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cfg.use_tls} onChange={e => setCfg(prev => ({ ...prev, use_tls: e.target.checked, use_ssl: e.target.checked ? false : prev.use_ssl }))} />
            <span className="text-xs text-gray-400">STARTTLS</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cfg.use_ssl} onChange={e => setCfg(prev => ({ ...prev, use_ssl: e.target.checked, use_tls: e.target.checked ? false : prev.use_tls }))} />
            <span className="text-xs text-gray-400">SSL（465端口）</span>
          </label>
        </div>
      </div>

      {/* 操作区 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-xs font-medium hover:bg-blue-600 disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saving ? '保存中...' : '保存配置'}
        </button>
        <div className="flex items-center gap-2">
          <input value={testTo} onChange={e => setTestTo(e.target.value)}
            placeholder="发送测试邮件至..."
            className="px-3 py-2 text-xs bg-bg-input border border-border rounded-lg text-gray-900 dark:text-white focus:outline-none focus:border-[#3B82F6] w-48" />
          <button onClick={handleTest} disabled={testing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-hover border border-border text-xs text-gray-400 hover:text-white disabled:opacity-50">
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {testing ? '发送中...' : '发送测试'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ==================== 系统公告 & AI 资讯 管理 Tab ====================

function AnnouncementTab({
  fetchWithAuth, showToast,
}: {
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>
  showToast: ToastFn
}) {
  const [content, setContent] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchResult, setFetchResult] = useState<{ inserted: number; updated: number; total: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/v1/news/announcement')
      if (res.ok) {
        const a = await res.json()
        setContent(a.content || '')
        setEnabled(!!a.enabled)
        setPublishedAt(a.published_at)
      }
    } catch {
      showToast('加载公告失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, showToast])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (enabled && !content.trim()) {
      showToast('已启用状态下公告内容不能为空', 'warning')
      return
    }
    setSaving(true)
    try {
      const res = await fetchWithAuth('/api/v1/news/announcement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, enabled }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.detail || `保存失败 (${res.status})`)
      }
      const a = await res.json()
      setContent(a.content || '')
      setEnabled(!!a.enabled)
      setPublishedAt(a.published_at)
      showToast(enabled ? '公告已发布' : '公告已保存', 'success')
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleFetchNow = async () => {
    setRefreshing(true)
    try {
      const res = await fetchWithAuth('/api/v1/news/fetch-now', { method: 'POST' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.detail || `抓取失败 (${res.status})`)
      }
      const r = await res.json()
      setFetchResult({ inserted: r.inserted || 0, updated: r.updated || 0, total: r.total || 0 })
      showToast(`抓取完成：新增 ${r.inserted}，更新 ${r.updated}，共 ${r.total} 条`, 'success')
    } catch (e: any) {
      showToast(e.message || '抓取失败', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-20 text-gray-500">
        <Loader2 size={24} className="mx-auto animate-spin mb-2" />
        加载中...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ===== AI 资讯抓取卡片 ===== */}
      <div className="p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles size={18} className="text-cyan-400" /> AI 资讯流
          </h3>
          <button
            onClick={handleFetchNow}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 text-xs font-medium disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '抓取中...' : '立即抓取'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          数据源：<a href="https://aihot.virxact.com" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">aihot.virxact.com</a> 每日 RSS，定时任务每 2 小时自动抓取；可点击"立即抓取"手动触发。
        </p>
        {fetchResult && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs">
            <CheckCircle2 size={12} />
            上次抓取：新增 <b>{fetchResult.inserted}</b>，更新 <b>{fetchResult.updated}</b>，共 <b>{fetchResult.total}</b> 条
          </div>
        )}
      </div>

      {/* ===== 公告编辑器 ===== */}
      <div className="p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <Megaphone size={18} className="text-amber-400" /> 全频道系统公告
          </h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-500">{enabled ? '已发布' : '已停用'}</span>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-gray-500/40'}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </button>
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
          <Power size={10} />
          启用后所有登录用户登录时即可在 Dashboard 顶部看到此公告（高亮琥珀色置顶条）。
          {publishedAt && <span className="text-gray-600">· 上次发布：{new Date(publishedAt).toLocaleString('zh-CN')}</span>}
        </p>

        <RichTextEditor
          value={content}
          onChange={setContent}
          placeholder="支持富文本：版本更新、企业内部通知、活动公告... 留空则不发布"
          className="min-h-[280px]"
        />

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#10B981] text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? '保存中...' : (enabled ? '保存并发布' : '保存（停用）')}
          </button>
          <span className="text-[11px] text-gray-500">公告为富文本，最多 50000 字符</span>
        </div>
      </div>

      {/* ===== 实时预览 ===== */}
      <div className="p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
        <h3 className="text-base font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Megaphone size={16} className="text-amber-400" /> Dashboard 实时预览
        </h3>
        <div className="space-y-2">
          <div
            className={`px-3 py-1.5 rounded-lg border ${enabled && content.trim()
              ? 'bg-gradient-to-r from-amber-500/15 via-amber-500/8 to-amber-500/15 border-amber-500/25'
              : 'bg-bg-hover border-border opacity-50'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Megaphone size={11} className="text-amber-400" />
              <span className="text-[11px] font-bold text-amber-300">公告</span>
              {!enabled && <span className="text-[11px] text-gray-500">（停用，不会显示）</span>}
            </div>
            <div className="text-[11px] text-amber-100 truncate">
              {content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || '（暂无内容）'}
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={11} className="text-cyan-400" />
              <span className="text-[11px] font-bold text-cyan-300">AI 资讯</span>
            </div>
            <div className="text-[11px] text-gray-500">滚动条（30 条最新资讯，hover 暂停，点击跳转源链接）</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  // ===== 标签页状态 =====
  const { user, setUser, fetchWithAuth, hasPermission, isAdmin } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const canAccessModels = hasPermission('ai:manage_own') || hasPermission('ai:manage_shared') || hasPermission('ai:use')
  const canManageModels = hasPermission('ai:manage_own') || hasPermission('ai:manage_shared')
  const canEditSettings = hasPermission('settings:edit')
  const canManageShared = hasPermission('ai:manage_shared')
  const canUseAI = hasPermission('ai:use')
  // 判断当前用户是否可以编辑指定供应商（编辑/删除/启停/管理模型）
  const canEditProvider = (p: Provider) => canManageShared || (hasPermission('ai:manage_own') && p.user_id === user?.id)
  const [searchParams, setSearchParams] = useSearchParams()
  const accessibleTabs = [
    ...(canAccessModels ? ['models' as const] : []),
    ...(canUseAI ? ['prompts' as const] : []),
    ...(canEditSettings ? ['system' as const] : []),
    ...(canEditSettings ? ['announcement' as const] : []),
    'account' as const,
  ]
  const resolveInitialTab = () => {
    const tabParam = searchParams.get('tab')
    if (tabParam && accessibleTabs.includes(tabParam as any)) return tabParam
    return canAccessModels ? 'models' : canUseAI ? 'prompts' : canEditSettings ? 'system' : 'account'
  }
  const [activeTab, setActiveTab] = useState(resolveInitialTab)
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    setSearchParams({ tab }, { replace: true })
  }

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam && tabParam !== activeTab && accessibleTabs.includes(tabParam as any)) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  const TABS = [
    ...(canAccessModels ? [{ key: 'models', label: '模型管理', icon: Cpu, desc: '供应商与任务模型配置' }] : []),
    ...(canUseAI ? [{ key: 'prompts', label: 'AI 提示词', icon: Edit3, desc: '自定义 AI 输出风格' }] : []),
    ...(canEditSettings ? [{ key: 'system', label: '系统配置', icon: Settings2, desc: '字段选项管理' }] : []),
    ...(canEditSettings ? [{ key: 'announcement', label: '系统公告', icon: Megaphone, desc: '全频道公告与 AI 资讯' }] : []),
    { key: 'account', label: '个人账户', icon: User, desc: '个人信息、首页与密码' },
  ]

  // ===== 个人账户状态 =====
  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileEmail, setProfileEmail] = useState(user?.email || '')
  const [profileJobTitle, setProfileJobTitle] = useState(user?.job_title || '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [accountMsg, setAccountMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [form, setForm] = useState({ name: '', base_url: '', api_key: '', project_id: '', location: '', gcp_label_team: '', gcp_label_app: '', gcp_label_env: '' })
  const [testingModelId, setTestingModelId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string; reply?: string; elapsed?: number }>>({})
  const [fetchingModels, setFetchingModels] = useState<number | null>(null)

  const [providerModels, setProviderModels] = useState<Record<number, ProviderModelItem[]>>({})
  const [expandedDropdown, setExpandedDropdown] = useState<number | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [addModelType, setAddModelType] = useState('auto')

  // 模型参数抽屉
  const [detailDrawer, setDetailDrawer] = useState<{ open: boolean; providerId: number | null; providerName: string; modelId: number | null; modelName: string | null }>({
    open: false, providerId: null, providerName: '', modelId: null, modelName: null,
  })

  // 任务参数覆盖弹窗
  const [overrideModal, setOverrideModal] = useState<{ open: boolean; taskType: string; taskLabel: string }>({
    open: false, taskType: '', taskLabel: '',
  })

  // 品牌自定义
  const [branding, setBranding] = useState({ logo_url: '', site_title: 'WorkTrack', frontend_url: '' })
  const [brandLogoFile, setBrandLogoFile] = useState<File | null>(null)
  const [brandLogoPreview, setBrandLogoPreview] = useState('')
  const [brandSaving, setBrandSaving] = useState(false)
  const [brandMsg, setBrandMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadBranding = useCallback(() => {
    fetch('/api/v1/settings/branding')
      .then(res => res.json())
      .then(data => setBranding({ logo_url: data.logo_url || '', site_title: data.site_title || 'WorkTrack', frontend_url: data.frontend_url || '' }))
      .catch(() => {})
  }, [])

  useEffect(() => { loadBranding() }, [loadBranding])

  // MCP 服务配置
  const [mcpConfig, setMcpConfig] = useState({ api_key: '', api_key_masked: '', enabled: false, server_url: '/mcp', has_key: false, public_url: '' })
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpMsg, setMcpMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showMcpKey, setShowMcpKey] = useState(false)
  const [showMcpCode, setShowMcpCode] = useState(false)

  const loadMcpConfig = useCallback(() => {
    fetch('/api/v1/settings/mcp-config')
      .then(res => res.json())
      .then(data => setMcpConfig(data))
      .catch(() => {})
  }, [])

  useEffect(() => { loadMcpConfig() }, [loadMcpConfig])

  // 点击空白区域关闭添加模型下拉
  const addModelDropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expandedDropdown === null) return
    const handler = (e: MouseEvent) => {
      if (expandedDropdown !== null && addModelDropdownRef.current && !addModelDropdownRef.current.contains(e.target as Node)) {
        setExpandedDropdown(null); setModelSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expandedDropdown])

  const loadProviders = useCallback(() => {
    fetch('/api/v1/settings/providers')
      .then((res) => res.json())
      .then((data) => { setProviders(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadProviders() }, [loadProviders])

  const loadProviderModels = useCallback((pid: number) => {
    fetch(`/api/v1/settings/providers/${pid}/models`)
      .then((r) => r.json())
      .then((d) => setProviderModels((prev) => ({ ...prev, [pid]: Array.isArray(d) ? d : [] })))
      .catch(() => {})
  }, [])

  useEffect(() => {
    providers.forEach((p) => loadProviderModels(p.id))
  }, [providers, loadProviderModels])

  const openCreate = () => {
    setEditingProvider(null)
    setForm({ name: '', base_url: '', api_key: '', project_id: '', location: '', gcp_label_team: '', gcp_label_app: '', gcp_label_env: '' })
    setShowForm(true)
  }

  const openEdit = (p: Provider) => {
    setEditingProvider(p)
    setForm({ name: p.name, base_url: p.base_url, api_key: p.api_key, project_id: p.project_id || '', location: p.location || '', gcp_label_team: p.gcp_label_team || '', gcp_label_app: p.gcp_label_app || '', gcp_label_env: p.gcp_label_env || '' })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    if (!form.base_url.trim() && !form.project_id.trim()) return
    setSaving(true)
    try {
      if (editingProvider) {
        await fetch(`/api/v1/settings/providers/${editingProvider.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        })
      } else {
        await fetch('/api/v1/settings/providers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        })
      }
      setShowForm(false)
      loadProviders()
      showToast(editingProvider ? '模型供应商已更新' : '模型供应商已添加', 'success')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    if (!await showConfirm('确定删除此供应商及其所有模型配置？')) return
    await fetchWithAuth(`/api/v1/settings/providers/${id}`, { method: 'DELETE' })
    setProviderModels((prev) => { const n = { ...prev }; delete n[id]; return n })
    loadProviders()
    loadTaskConfigs()
    showToast('供应商已删除', 'success')
  }

  const handleToggleActive = async (p: Provider) => {
    await fetch(`/api/v1/settings/providers/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: p.name, base_url: p.base_url, api_key: p.api_key, is_active: !p.is_active, project_id: p.project_id, location: p.location, gcp_label_team: p.gcp_label_team, gcp_label_app: p.gcp_label_app, gcp_label_env: p.gcp_label_env }),
    })
    loadProviders()
  }

  const handleFetchModels = async (id: number) => {
    setFetchingModels(id)
    try {
      const res = await fetch(`/api/v1/settings/providers/${id}/fetch-models`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) { console.warn('拉取模型列表失败:', data.message); return }
      loadProviders(); loadProviderModels(id)
    } catch (e) { console.warn('拉取模型请求失败:', e) }
    finally { setFetchingModels(null) }
  }

  const addModel = async (providerId: number, modelName: string, modelType?: string) => {
    try {
      const body: Record<string, string> = { model_name: modelName }
      if (modelType && modelType !== 'auto') {
        body.model_type = modelType
      }
      const res = await fetch(`/api/v1/settings/providers/${providerId}/models`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) { const e = await res.json(); showToast(e.detail || '添加失败', 'error'); return }
      loadProviderModels(providerId)
      showToast('模型已添加', 'success')
      setAddModelType('auto')
    } catch { showToast('添加请求失败', 'error') }
  }

  const removeModel = async (providerId: number, modelId: number) => {
    try {
      await fetch(`/api/v1/settings/providers/${providerId}/models/${modelId}`, { method: 'DELETE' })
      loadProviderModels(providerId)
      loadTaskConfigs()
      showToast('模型已移除', 'success')
    } catch { /* noop */ }
  }

  const testModel = async (providerId: number, modelId: number) => {
    setTestingModelId(modelId)
    const start = Date.now()
    try {
      const res = await fetchWithAuth(`/api/v1/settings/providers/${providerId}/models/${modelId}/test`, { method: 'POST' })
      const data = await res.json()
      const elapsed = Date.now() - start
      setTestResults((prev) => ({ ...prev, [modelId]: { ...data, elapsed } }))
    } catch {
      const elapsed = Date.now() - start
      setTestResults((prev) => ({ ...prev, [modelId]: { success: false, message: '网络请求失败', elapsed } }))
    } finally { setTestingModelId(null) }
  }

  const getAvailableModels = (p: Provider): FetchedModel[] => {
    try { return JSON.parse(p.supported_models_json || '[]') }
    catch { return [] }
  }

  const getConfiguredNames = (pid: number): Set<string> => {
    return new Set((providerModels[pid] || []).map((m) => m.model_name))
  }

  // ===== 任务模型 =====
  const [taskConfigs, setTaskConfigs] = useState<Record<string, TaskConfig>>({})
  const [taskSaving, setTaskSaving] = useState<string | null>(null)
  const loadTaskConfigs = useCallback(() => {
    fetch('/api/v1/settings/task-models').then((r) => r.json()).then((d) => setTaskConfigs(d as Record<string, TaskConfig>)).catch(() => {})
  }, [])
  useEffect(() => { loadTaskConfigs() }, [loadTaskConfigs])
  const saveTaskConfig = async (taskTypes: string | string[], providerId: number | null, modelName: string) => {
    const list = Array.isArray(taskTypes) ? taskTypes : [taskTypes]
    setTaskSaving(list[0])
    try {
      // 并发保存组内所有 task
      await Promise.all(list.map((taskType) => {
        const existing = taskConfigs[taskType]
        return fetch('/api/v1/settings/task-models', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task_type: taskType,
            provider_id: providerId,
            model_name: modelName,
            override_temperature: existing?.override_temperature ?? null,
            override_top_p: existing?.override_top_p ?? null,
            override_max_tokens: existing?.override_max_tokens ?? null,
            override_frequency_penalty: existing?.override_frequency_penalty ?? null,
            override_presence_penalty: existing?.override_presence_penalty ?? null,
            override_stop: existing?.override_stop ?? null,
            override_thinking_mode: existing?.override_thinking_mode ?? null,
            override_thinking_budget: existing?.override_thinking_budget ?? null,
            override_response_format: existing?.override_response_format ?? null,
            override_json_schema: existing?.override_json_schema ?? null,
            override_extra_params_json: existing?.override_extra_params_json ?? null,
            preset_id: existing?.preset_id ?? null,
          }),
        })
      }))
      loadTaskConfigs()
    } finally { setTaskSaving(null) }
  }

  // ===== 参数预设 =====
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [presetEditor, setPresetEditor] = useState<{ open: boolean; preset: Preset | null }>({ open: false, preset: null })
  const [presetForm, setPresetForm] = useState({ name: '', description: '', temperature: '', top_p: '', max_tokens: '', thinking_mode: '', thinking_budget: '', response_format: '' })
  const [presetSaving, setPresetSaving] = useState(false)

  const loadPresets = useCallback(() => {
    setPresetsLoading(true)
    fetch('/api/v1/settings/model-presets')
      .then((r) => r.json())
      .then((d) => setPresets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setPresetsLoading(false))
  }, [])
  useEffect(() => { loadPresets() }, [loadPresets])

  // 打开预设编辑器（修复 P1 bug：编辑时回填表单）
  const openPresetEditor = (p: Preset | null) => {
    if (p) {
      setPresetForm({
        name: p.name || '',
        description: p.description || '',
        temperature: p.temperature == null ? '' : String(p.temperature),
        top_p: p.top_p == null ? '' : String(p.top_p),
        max_tokens: p.max_tokens == null ? '' : String(p.max_tokens),
        thinking_mode: p.thinking_mode || '',
        thinking_budget: p.thinking_budget == null ? '' : String(p.thinking_budget),
        response_format: p.response_format || '',
      })
    } else {
      setPresetForm({ name: '', description: '', temperature: '', top_p: '', max_tokens: '', thinking_mode: '', thinking_budget: '', response_format: '' })
    }
    setPresetEditor({ open: true, preset: p })
  }


  const handleSavePreset = async () => {
    if (!presetForm.name.trim()) { showToast('请填写预设名称', 'warning'); return }
    setPresetSaving(true)
    try {
      const payload: Record<string, any> = {
        name: presetForm.name.trim(),
        description: presetForm.description.trim(),
        temperature: presetForm.temperature === '' ? null : Number(presetForm.temperature),
        top_p: presetForm.top_p === '' ? null : Number(presetForm.top_p),
        max_tokens: presetForm.max_tokens === '' ? null : Number(presetForm.max_tokens),
        thinking_mode: presetForm.thinking_mode || null,
        thinking_budget: presetForm.thinking_budget === '' ? null : Number(presetForm.thinking_budget),
        response_format: presetForm.response_format || null,
      }
      const isEdit = !!presetEditor.preset
      const url = isEdit ? `/api/v1/settings/model-presets/${presetEditor.preset!.id}` : '/api/v1/settings/model-presets'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '保存失败')
      }
      showToast(isEdit ? '预设已更新' : '预设已创建', 'success')
      setPresetEditor({ open: false, preset: null })
      loadPresets()
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error')
    } finally { setPresetSaving(false) }
  }

  const handleDeletePreset = async (p: Preset) => {
    if (!await showConfirm(`确定删除预设「${p.name}」？引用该预设的任务会回退到模型默认参数。`)) return
    try {
      const res = await fetch(`/api/v1/settings/model-presets/${p.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '删除失败')
      }
      showToast('预设已删除', 'success')
      loadPresets()
    } catch (e: any) {
      showToast(e.message || '删除失败', 'error')
    }
  }
  const getActiveProviders = () => {
    if (canEditSettings) return providers.filter((p) => p.is_active && p.api_key)
    return providers.filter((p) => p.is_active && p.api_key && (p.user_id === user?.id || (p.user_id == null && (user?.use_shared_models))))
  }

  // ===== 字段选项 =====
  const [fieldOptions, setFieldOptions] = useState<FieldOption[]>([])
  const [selectedCategory, setSelectedCategory] = useState('product')
  const [editingOptions, setEditingOptions] = useState('')
  const [optionsSaving, setOptionsSaving] = useState(false)
  const [homePage, setHomePage] = useState('/reports')
  const [homePageSaving, setHomePageSaving] = useState(false)
  const [tavilyApiKey, setTavilyApiKey] = useState('')
  const [tavilySaving, setTavilySaving] = useState(false)
  const [searchProvider, setSearchProvider] = useState('auto')
  const [searchProviderSaving, setSearchProviderSaving] = useState(false)

  // 加载 Tavily 配置
  useEffect(() => {
    fetch('/api/v1/settings/tavily-config')
      .then((r) => r.json())
      .then((d) => { if (d.api_key) setTavilyApiKey(d.api_key) })
      .catch(() => {})
  }, [])

  const handleSaveTavilyKey = async () => {
    setTavilySaving(true)
    try {
      await fetch('/api/v1/settings/tavily-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyApiKey }),
      })
      showToast('Tavily API Key 已保存', 'success')
    } finally { setTavilySaving(false) }
  }

  const handleSaveSearchProvider = async (value: string) => {
    setSearchProvider(value)
    setSearchProviderSaving(true)
    try {
      await fetch('/api/v1/settings/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'search_provider', value }),
      })
      showToast('搜索通道已更新', 'success')
    } finally { setSearchProviderSaving(false) }
  }

  // ===== AI 提示词 =====
  const [aiPrompts, setAiPrompts] = useState<Record<string, { label: string; desc: string; system_prompt: string; user_prompt_template: string; variables: string[]; customized: boolean; source: string; global_system_prompt?: string; global_user_prompt_template?: string }>>({})
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const [promptForm, setPromptForm] = useState({ system_prompt: '', user_prompt_template: '' })
  const [promptSaving, setPromptSaving] = useState(false)
  const [promptScope, setPromptScope] = useState<Record<string, string>>({})
  const [aiReq, setAiReq] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)

  const loadPrompts = useCallback(() => {
    fetchWithAuth('/api/v1/settings/ai-prompts')
      .then((r) => r.json())
      .then((d) => setAiPrompts(d as Record<string, any>))
      .catch(() => {})
  }, [])
  useEffect(() => { loadPrompts() }, [loadPrompts])

  const openPromptEditor = (taskType: string) => {
    const p = aiPrompts[taskType]
    if (!p) return
    setEditingPrompt(taskType)
    setPromptForm({ system_prompt: p.system_prompt, user_prompt_template: p.user_prompt_template })
    setAiReq('')
  }

  const savePrompt = async (taskType: string) => {
    setPromptSaving(true)
    try {
      const scope = promptScope[taskType] || 'user'
      const url = scope === 'global' && isAdmin
        ? `/api/v1/settings/ai-prompts/global/${taskType}`
        : `/api/v1/settings/ai-prompts/${taskType}`
      await fetchWithAuth(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promptForm),
      })
      setEditingPrompt(null)
      setAiReq('')
      loadPrompts()
      showToast(scope === 'global' ? '全局提示词已保存' : '提示词已保存', 'success')
    } finally { setPromptSaving(false) }
  }

  const generatePrompt = async (taskType: string) => {
    if (!aiReq.trim()) { showToast('请先描述你的需求', 'warning'); return }
    setAiGenerating(true)
    try {
      const res = await fetchWithAuth('/api/v1/settings/ai-prompts/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: taskType, requirement: aiReq }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '生成失败')
      }
      const data = await res.json()
      setPromptForm({
        system_prompt: data.system_prompt || promptForm.system_prompt,
        user_prompt_template: data.user_prompt_template || promptForm.user_prompt_template,
      })
      showToast('提示词已生成，你可以继续修改后保存', 'success')
    } catch (e: any) {
      showToast(e.message || 'AI 生成失败，请检查模型配置', 'error')
    } finally { setAiGenerating(false) }
  }

  const resetPrompt = async (taskType: string) => {
    if (!await showConfirm('确定恢复默认提示词？')) return
    try {
      await fetchWithAuth(`/api/v1/settings/ai-prompts/${taskType}`, { method: 'DELETE' })
      loadPrompts()
      showToast('提示词已恢复默认', 'success')
    } catch { /* noop */ }
  }
  const categoryLabels: Record<string, string> = { product: '涉及产品', project_scenario: '项目场景', sales_person: '销售', project_status: '项目状态', cloud: '供应商' }
  const categoryIcons: Record<string, any> = { product: Package, project_scenario: MapPin, sales_person: User, project_status: Activity, cloud: Cloud }
  const categoryColors: Record<string, string> = { product: '#3B82F6', project_scenario: '#8B5CF6', sales_person: '#F59E0B', project_status: '#10B981', cloud: '#EC4899' }
  const loadFieldOptions = () => { fetch('/api/v1/settings/field-options').then((r) => r.json()).then((d) => setFieldOptions(d as FieldOption[])) }
  useEffect(() => { loadFieldOptions() }, [])

  useEffect(() => {
    fetch('/api/v1/settings/preferences')
      .then((r) => r.json())
      .then((d) => {
        if (d.home_page) setHomePage(d.home_page)
        if (d.search_provider) setSearchProvider(d.search_provider)
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    setEditingOptions(fieldOptions.filter((o) => o.category === selectedCategory).sort((a, b) => a.sort_order - b.sort_order).map((o) => o.value).join('\n'))
  }, [selectedCategory, fieldOptions])
  const handleSaveOptions = async () => {
    setOptionsSaving(true)
    try {
      const values = editingOptions.split('\n').map((s) => s.trim()).filter(Boolean)
      await fetch('/api/v1/settings/field-options/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: selectedCategory, values }) })
      loadFieldOptions()
      showToast('字段选项已保存', 'success')
    } finally { setOptionsSaving(false) }
  }

  const handleSaveHomePage = async () => {
    setHomePageSaving(true)
    try {
      await fetch('/api/v1/settings/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'home_page', value: homePage }),
      })
      window.dispatchEvent(new CustomEvent('home-page-changed'))
      showToast('首页偏好已更新', 'success')
    } finally { setHomePageSaving(false) }
  }

  const providerPresets = [
    { name: 'OpenAI', base_url: 'https://api.openai.com/v1' },
    { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1' },
    { name: 'Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/' },
    { name: 'Vertex AI', base_url: 'https://aiplatform.googleapis.com/v1', project_id: '', location: 'global' },
    { name: 'Anthropic', base_url: 'https://api.anthropic.com/v1' },
    { name: 'MiniMax', base_url: 'https://api.minimaxi.com/v1' },
    { name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1' },
    { name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { name: '智谱GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4/' },
    { name: '文心一言', base_url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/' },
    { name: '月之暗面', base_url: 'https://api.moonshot.cn/v1' },
    { name: '零一万物', base_url: 'https://api.lingyiwanwu.com/v1' },
    { name: '百川', base_url: 'https://api.baichuan-ai.com/v1' },
    { name: '豆包', base_url: 'https://ark.cn-beijing.volces.com/api/v3/' },
    { name: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
    { name: 'xAI Grok', base_url: 'https://api.x.ai/v1' },
    { name: 'Together', base_url: 'https://api.together.xyz/v1' },
    { name: '小米MiMo', base_url: 'https://api.xiaomimimo.com/v1' },
  ]

  return (
    <div className="max-md:px-1">
      <div className="mb-4 max-md:mb-3">
        <h2 className="text-xl max-md:text-lg font-bold text-gray-900 dark:text-white">系统设置</h2>
        <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">管理 AI 模型供应商和系统配置</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        {/* 移动端：横向滚动标签 | 桌面端：左侧竖向导航 */}
        <div className="md:w-44 flex-shrink-0 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
          <div className="flex flex-row md:flex-col gap-1.5 md:space-y-1 md:gap-0">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  className={`whitespace-nowrap transition-all duration-200 group shrink-0
                    max-md:flex max-md:items-center max-md:gap-1.5 max-md:px-3 max-md:py-1.5 max-md:rounded-lg max-md:text-xs
                    md:w-full md:text-left md:px-4 md:py-3 md:rounded-xl
                    ${isActive
                      ? 'bg-accent-blue text-[#fff] shadow-lg shadow-blue-500/20'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 md:hover:bg-bg-card border border-transparent md:hover:border-border max-md:bg-bg-card max-md:border-border'
                    }`}
                >
                  <tab.icon size={17} className={`${isActive ? 'text-white' : 'text-gray-500 group-hover:text-gray-700 dark:text-gray-300'} max-md:size-[14px]`} />
                  <span className="text-sm md:text-sm font-semibold max-md:text-xs">{tab.label}</span>
                  <span className={`hidden md:block text-[11px] leading-tight mt-0.5 ${isActive ? 'text-blue-100/90 dark:text-blue-200' : 'text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-300'}`}>{tab.desc}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 右侧内容 */}
        <div className="flex-1 min-w-0">

      {/* ==================== 模型管理 ==================== */}
      {activeTab === 'models' && (
        <>

      {/* 模型供应商 */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Cpu size={15} className="text-[#3B82F6] shrink-0" />
            <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white whitespace-nowrap">模型供应商</h3>
            <span className="text-[11px] text-gray-500 truncate">配置 AI 模型来源、API Key、模型清单</span>
          </div>
          {canManageModels && <button onClick={openCreate} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent-blue text-[#fff] text-xs hover:bg-accent-blue/85 shrink-0"><Plus size={12} /> 添加供应商</button>}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500"><Loader2 size={20} className="mx-auto animate-spin mb-2" />加载中...</div>
        ) : providers.length === 0 ? (
          <div className="p-8 rounded-xl bg-bg-card border border-dashed border-border text-center">
            <Settings2 size={32} className="mx-auto text-gray-600 mb-3" />
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">尚未配置模型供应商</p>
            <p className="text-gray-600 text-xs mb-4">添加 AI 模型供应商以启用智能整理功能</p>
            <div className="flex flex-wrap justify-center gap-2">
              {providerPresets.map((p) => (
                <button key={p.name} onClick={() => { setForm({ ...form, name: p.name, base_url: p.base_url, project_id: (p as any).project_id || '', location: (p as any).location || '', gcp_label_team: '', gcp_label_app: '', gcp_label_env: '' }); setShowForm(true) }}
                  className="px-3 py-2 rounded-lg bg-bg-hover border border-border text-xs text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:border-[#3B82F6]/50 transition-all">+ {p.name}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((p) => {
              const availableModels = getAvailableModels(p)
              const configuredNames = getConfiguredNames(p.id)
              const unconfiguredModels = availableModels.filter((m) => !configuredNames.has(m.id))
              const filteredUnconfigured = modelSearch
                ? unconfiguredModels.filter((m) => m.id.toLowerCase().includes(modelSearch.toLowerCase()))
                : unconfiguredModels

              return (
                <div key={p.id} className="rounded-lg bg-bg-card border border-border">
                  <div className="px-3.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[300px]">{p.name}</span>
                          <button
                            onClick={() => canEditProvider(p) && handleToggleActive(p)}
                            className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                              p.is_active ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'
                            } ${canEditProvider(p) ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            {p.is_active ? '已启用' : '已停用'}
                          </button>
                          {p.user_id == null && !canManageShared && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-500/10 text-gray-500 shrink-0">共享</span>
                          )}
                          {p.user_id != null && !canManageShared && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 shrink-0">我的</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                          {p.project_id ? (
                            <span className="flex items-center gap-1 min-w-0"><Cloud size={12} className="shrink-0 text-[#4285F4]" /><span className="truncate max-w-[400px]">GCP: {p.project_id} ({p.location || 'global'})</span></span>
                          ) : (
                            <span className="flex items-center gap-1 min-w-0"><Globe size={12} className="shrink-0" /><span className="truncate max-w-[400px]">{p.base_url}</span></span>
                          )}
                          {p.api_key && <span className="flex items-center gap-1 shrink-0"><Key size={12} />{p.api_key.slice(0, 6)}...{p.api_key.slice(-4)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {canEditProvider(p) && (
                          <button onClick={() => openEdit(p)} className="px-2.5 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">编辑</button>
                        )}
                        {canEditProvider(p) && (
                          <button onClick={() => handleDelete(p.id)} className="px-2 py-1.5 rounded-lg bg-bg-hover text-xs text-red-400 hover:text-red-300 border border-border"><Trash2 size={12} /></button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 模型列表 - 紧凑行布局 */}
                  <div className="px-3.5 pb-2.5">
                    <div className="flex items-center justify-between mb-1.5 mt-1">
                      <span className="text-[11px] text-gray-500 font-medium tracking-wide uppercase">已配置 {(providerModels[p.id] || []).length} 个模型</span>
                    </div>
                    {(providerModels[p.id] || []).length === 0 ? (
                      <p className="text-[11px] text-gray-600 py-2 px-1">暂无模型，点击「添加模型」输入名称</p>
                    ) : (
                      <div className="space-y-px">
                        {(providerModels[p.id] || []).map((m) => {
                          const tr = testResults[m.id]
                          const supList = Array.isArray(m.supported_task_types) && m.supported_task_types.length > 0
                            ? m.supported_task_types
                            : [m.model_type]
                          // 把所有能力去重后拼成内联小字（主类型已在 supList 中，不重复）
                          const allLabels = Array.from(new Set(supList)).map((tt) => TYPE_LABEL[tt] || tt)
                          return (
                            <div key={m.id} className="group flex items-center gap-2 px-2 py-1 rounded-md hover:bg-bg-hover transition-colors cursor-pointer"
                              onClick={() => canEditProvider(p) && setDetailDrawer({ open: true, providerId: p.id, providerName: p.name, modelId: m.id, modelName: m.model_name })}>
                              {/* 模型名 */}
                              <span className="text-[11px] text-gray-700 dark:text-gray-300 font-mono truncate flex-1 min-w-0">{m.model_name}</span>
                              {/* 能力内联说明（单一来源、不再 chip 化） */}
                              {allLabels.length > 0 && (
                                <span className="hidden md:inline text-[11px] text-gray-500 dark:text-gray-400 shrink-0 truncate max-w-[180px]" title={allLabels.join(' · ')}>
                                  · {allLabels.join(' · ')}
                                </span>
                              )}
                              {/* 测试状态点 */}
                              {tr && (
                                <span
                                  title={tr.success ? `✅ ${tr.elapsed}ms${tr.reply ? ` - "${tr.reply}"` : ''}` : `❌ ${tr.message || '失败'}`}
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${tr.success ? 'bg-green-400' : 'bg-red-400'}`}
                                />
                              )}
                              {/* 测试按钮 */}
                              {canEditProvider(p) && (
                                <button onClick={(e) => { e.stopPropagation(); testModel(p.id, m.id) }} disabled={testingModelId === m.id}
                                  className="opacity-0 group-hover:opacity-100 px-1.5 py-px rounded text-[11px] text-gray-500 hover:text-[#10B981] shrink-0"
                                  title="测试连通性">
                                  {testingModelId === m.id ? <Loader2 size={10} className="animate-spin" /> : '测试'}
                                </button>
                              )}
                              {/* 删除按钮 */}
                              {canEditProvider(p) && (
                                <button onClick={(e) => { e.stopPropagation(); removeModel(p.id, m.id) }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-600 hover:text-red-400 shrink-0"
                                  title="删除模型">
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 添加模型 */}
                    {canEditProvider(p) && (
                    <div className="relative">
                      <button onClick={() => {
                        const isOpen = expandedDropdown === p.id
                        setExpandedDropdown(isOpen ? null : p.id); setModelSearch(''); setAddModelType('auto')
                        // 每次展开时重新拉取模型列表，确保获取最新模型
                        if (!isOpen && p.api_key) {
                          handleFetchModels(p.id)
                        }
                      }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bg-input border border-dashed border-border text-xs text-gray-400 hover:text-white hover:border-[#3B82F6]/50">
                        <Plus size={12} /> 添加模型 <ChevronDown size={12} className={expandedDropdown === p.id ? 'rotate-180' : ''} />
                      </button>
                      {expandedDropdown === p.id && (
                        <div ref={addModelDropdownRef} className="absolute z-30 left-0 mt-1 min-w-[340px] max-w-[480px] w-auto max-h-[420px] rounded-lg bg-bg-card border border-border shadow-xl overflow-hidden">
                          <div className="p-2.5 border-b border-border space-y-2">
                            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-input border border-border">
                              {fetchingModels === p.id ? (
                                <Loader2 size={12} className="animate-spin text-gray-500 shrink-0" />
                              ) : (
                                <Search size={12} className="text-gray-500 shrink-0" />
                              )}
                              <input value={modelSearch} onChange={(e) => setModelSearch(e.target.value)}
                                placeholder={fetchingModels === p.id ? '正在拉取模型列表...' : '搜索模型名，回车手动添加...'}
                                className="flex-1 bg-transparent text-xs text-gray-700 dark:text-gray-300 outline-none placeholder-gray-500 dark:placeholder-gray-600" autoFocus
                                disabled={fetchingModels === p.id}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && modelSearch.trim()) {
                                    addModel(p.id, modelSearch.trim(), addModelType); setModelSearch(''); setExpandedDropdown(null); setAddModelType('auto')
                                  }
                                }} />
                            </div>
                            {/* 类型选择器 */}
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-gray-500 shrink-0">添加类型:</span>
                              <SearchableSelect
                                className="flex-1"
                                options={[{ id: 'auto', label: '自动推断' }, ...MODEL_TYPE_OPTIONS.map(opt => ({ id: opt.key, label: opt.label }))]}
                                value={addModelType}
                                onChange={(v) => setAddModelType(v === 0 ? '' : String(v))}
                                clearValue=""
                              />
                            </div>
                          </div>
                          <div className="overflow-y-auto max-h-52">
                            {fetchingModels === p.id ? (
                              <p className="p-3 text-xs text-gray-500 text-center">正在拉取模型列表...</p>
                            ) : availableModels.length === 0 ? (
                              <p className="p-3 text-xs text-gray-600 dark:text-gray-500 text-center">暂无模型列表，直接输入模型名按回车添加</p>
                            ) : filteredUnconfigured.length === 0 ? (
                              <p className="p-3 text-xs text-gray-600 dark:text-gray-500 text-center">
                                {modelSearch ? '无匹配，按回车手动添加' : '全部已配置，输入新模型名按回车添加'}
                              </p>
                            ) : (
                              filteredUnconfigured.slice(0, 50).map((m) => (
                                <button key={m.id} onClick={() => { addModel(p.id, m.id, addModelType); setModelSearch(''); setExpandedDropdown(null); setAddModelType('auto') }}
                                  className="w-full text-left px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-bg-hover flex items-center gap-2.5 border-b border-border/30 last:border-b-0">
                                  <span className="text-[11px] text-[#3B82F6] font-medium shrink-0">+</span>
                                  <span className="font-mono text-[11px] truncate flex-1 min-w-0">{m.id}</span>
                                  {addModelType !== 'auto' && (
                                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${TYPE_COLORS[addModelType] || TYPE_COLORS.chat}`}>
                                      {TYPE_LABEL[addModelType] || addModelType}
                                    </span>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 参数预设模板 */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={15} className="text-[#A78BFA] shrink-0" />
            <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white whitespace-nowrap">参数预设模板</h3>
            <span className="text-[11px] text-gray-500 truncate">常用参数组合一键引用</span>
          </div>
          {canManageShared && (
            <button onClick={() => openPresetEditor(null)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#A78BFA] text-white text-xs hover:bg-purple-600 shrink-0">
              <Plus size={12} />新建预设
            </button>
          )}
        </div>

        {presetsLoading ? (
          <div className="p-6 text-center text-gray-500 text-sm"><Loader2 size={16} className="inline animate-spin mr-2" />加载中...</div>
        ) : presets.length === 0 ? (
          <div className="p-6 rounded-xl bg-bg-card border border-dashed border-border text-center">
            <Layers size={24} className="mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-500">暂无预设模板</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2.5">
            {presets.map((p) => {
              const params: string[] = []
              if (p.temperature != null) params.push(`temp=${p.temperature}`)
              if (p.top_p != null) params.push(`top_p=${p.top_p}`)
              if (p.max_tokens != null) params.push(`max=${p.max_tokens}`)
              if (p.thinking_mode) params.push(`think=${p.thinking_mode}`)
              if (p.response_format && p.response_format !== 'text') params.push(`fmt=${p.response_format}`)
              return (
                <div key={p.id} className="p-3 rounded-lg bg-bg-card border border-border group">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {p.is_system ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 shrink-0">系统</span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 shrink-0">个人</span>
                        )}
                        <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.name}</h4>
                      </div>
                      {p.description && <p className="text-[11px] text-gray-500 line-clamp-2">{p.description}</p>}
                    </div>
                    {!p.is_system && canManageShared && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => openPresetEditor(p)}
                          title="编辑"
                          className="p-1 rounded text-gray-500 hover:text-[#3B82F6] opacity-0 group-hover:opacity-100">
                          <Pencil size={11} />
                        </button>
                        <button onClick={() => handleDeletePreset(p)}
                          title="删除"
                          className="p-1 rounded text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                  {params.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/40">
                      {params.map((pa, i) => (
                        <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-input text-gray-400 font-mono">{pa}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 任务模型配置 - 紧凑卡片 */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={15} className="text-[#F59E0B] shrink-0" />
            <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white whitespace-nowrap">任务模型配置</h3>
            <span className="text-[11px] text-gray-500 truncate">
              {canManageShared ? '为不同 AI 任务组配置模型及参数（管理员配置，对全局生效）' : '为每个任务组选择使用的模型，参数由管理员统一配置'}
            </span>
          </div>
        </div>
        {getActiveProviders().length === 0 ? (
          <div className="p-6 rounded-xl bg-bg-card border border-dashed border-border text-center">
            <Settings2 size={24} className="mx-auto text-gray-600 mb-2" /><p className="text-xs text-gray-500">请先添加并启用至少一个模型供应商</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
            {TASK_GROUPS.map((group) => {
              const GroupIcon = group.icon
              const isMultimodal = group.id === 'multimodal'
              const subIcons: Record<string, any> = { speech_to_text: Mic, vision: Eye, embedding: Brain }
              const subLabels: Record<string, string> = { speech_to_text: '语音转写', vision: '图像理解', embedding: '向量化' }
              // 提取所有 sub-tasks 的 task_keys（普通组是 1 个，多模态是 3 个）
              const rowTasks = isMultimodal
                ? group.taskKeys.map((tk) => ({ key: tk, label: subLabels[tk] || tk, icon: subIcons[tk] || Sparkles, isShared: false }))
                : [{ key: group.taskKeys[0], label: group.label, icon: GroupIcon, isShared: true }]
              // 整体高度统计：已选/未选状态
              const fullyConfiguredCount = group.taskKeys.filter((tk) => taskConfigs[tk]?.provider_id && taskConfigs[tk]?.model_name).length
              return (
                <div key={group.id} className="rounded-lg bg-bg-card border border-border overflow-hidden hover:border-[#3B82F6]/30 transition-colors" style={{ borderColor: `${group.color}25` }}>
                  <div className="px-3 py-2.5 flex items-center gap-2.5">
                    <IconBox icon={GroupIcon} size="md" tone={
                      group.id === 'chat' ? 'blue' :
                      group.id === 'summary' ? 'green' :
                      group.id === 'extract' ? 'purple' :
                      group.id === 'insight' ? 'orange' : 'pink'
                    } variant="soft" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-gray-900 dark:text-white">{group.label}</span>
                        <span className="text-[11px] text-gray-500 truncate">{group.desc}</span>
                      </div>
                    </div>
                    {/* 整体完成度指示 */}
                    <StatusBadge
                      variant={fullyConfiguredCount === group.taskKeys.length ? 'success' : fullyConfiguredCount > 0 ? 'info' : 'neutral'}
                      noIcon
                    >
                      {fullyConfiguredCount}/{group.taskKeys.length}
                    </StatusBadge>
                  </div>
                  <div className="px-3 pb-2.5 space-y-1">
                    {rowTasks.map((rt) => {
                      const tk = rt.key
                      const cfg = taskConfigs[tk]
                      const spId = cfg?.provider_id
                      const sp = spId ? providers.find((p) => p.id === spId) : null
                      const providerDeleted = spId && !sp
                      const allSelectedModels = providerModels[spId || 0] || []
                      const selectedModel = cfg?.model_name ? allSelectedModels.find((m) => m.model_name === cfg.model_name) : null
                      const modelDeleted = cfg?.model_name && sp && allSelectedModels.length > 0 && !selectedModel
                      const typeMismatch = selectedModel && (isMultimodal
                        ? !modelSupports(selectedModel, tk)
                        : !modelSupportsAnyOf(selectedModel, group.compatibleTypes))
                      const RowIcon = rt.icon
                      const c = cfg
                      const hasOverride = c && (c.override_temperature != null || c.override_max_tokens != null || c.override_thinking_mode != null || c.preset_id != null)
                      // 合并 供应商|模型 value，格式 "providerId|modelName"
                      const combinedValue = spId && cfg?.model_name ? `${spId}|${cfg.model_name}` : ''
                      return (
                        <div key={tk} className="flex items-center gap-1.5 group/row">
                          {/* 行首小标签 */}
                          <span className="flex items-center gap-1 text-[11px] text-gray-500 shrink-0 w-[78px] truncate">
                            <RowIcon size={11} className="shrink-0" style={{ color:
                              tk === 'speech_to_text' ? '#06B6D4' :
                              tk === 'vision' ? '#8B5CF6' :
                              tk === 'embedding' ? '#3B82F6' :
                              group.color
                            }} />{rt.label}
                          </span>
                          {/* 供应商 + 模型合并 select，按供应商分组 */}
                          <SearchableSelect
                            className="flex-1 min-w-[180px] max-w-[340px]"
                            options={[
                              { id: '', label: '选择模型…' },
                              ...getActiveProviders().flatMap((p) => {
                                const pModels = providerModels[p.id] || []
                                const filtered = isMultimodal
                                  ? pModels.filter((m) => modelSupports(m, tk))
                                  : (group.compatibleTypes.length > 0
                                    ? pModels.filter((m) => modelSupportsAnyOf(m, group.compatibleTypes))
                                    : pModels)
                                return filtered.map((m) => ({
                                  id: `${p.id}|${m.model_name}`,
                                  label: m.model_name,
                                  sub: `${p.name} · ${TYPE_LABEL[m.model_type] || m.model_type}`,
                                }))
                              }),
                            ]}
                            value={combinedValue}
                            onChange={(v) => {
                              const val = v === 0 ? '' : String(v)
                              if (!val) {
                                if (isMultimodal) saveTaskConfig(tk, null, '')
                                else saveTaskConfig(group.taskKeys, null, '')
                              } else {
                                const sep = val.indexOf('|')
                                const pid = Number(val.slice(0, sep))
                                const mn = val.slice(sep + 1)
                                if (isMultimodal) saveTaskConfig(tk, pid, mn)
                                else saveTaskConfig(group.taskKeys, pid, mn)
                              }
                            }}
                            clearValue=""
                          />
                          {/* 类型不匹配警告 / 已配置状态 */}
                          {cfg?.model_name && !providerDeleted && !modelDeleted && (
                            typeMismatch ? (
                              <StatusBadge variant="warning" title="此模型不支持该任务类型">类型不匹配</StatusBadge>
                            ) : (
                              <StatusBadge variant="success" title="已配置">已配置</StatusBadge>
                            )
                          )}
                          {/* 加载中 */}
                          {taskSaving === tk && <Loader2 size={12} className="animate-spin text-gray-400 shrink-0" />}
                          {/* 覆盖参数按钮：仅管理员（ai:manage_shared）可配置参数，普通自管用户只换模型 */}
                          {cfg?.model_name && canManageShared && (
                            <button onClick={() => setOverrideModal({ open: true, taskType: tk, taskLabel: isMultimodal ? `${group.label}/${rt.label}` : `${group.label}` })}
                              title={hasOverride ? '已配置覆盖参数，点击修改' : '为此任务配置参数覆盖'}
                              className={`ml-auto flex items-center gap-1 px-1.5 py-1 rounded text-[11px] border shrink-0 transition-colors ${hasOverride ? 'text-[#F59E0B] border-[#F59E0B]/60 bg-[#F59E0B]/10' : 'text-gray-500 hover:text-amber-300 border-border bg-bg-hover'}`}>
                              <Sliders size={10} />
                              {hasOverride && <span className="w-1 h-1 rounded-full bg-[#F59E0B] shrink-0" />}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 联网搜索服务 */}
      <div className="mt-10">
        <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Search size={18} className="text-emerald-400" /> 联网搜索服务</h3>
        <p className="text-xs text-gray-500 mb-4 dark:text-gray-400">选择联网搜索通道。Gemini 接地搜索（Grounding）借助所配置的 Vertex/Gemini 供应商直接联网获取实时信息并附带引用来源；Tavily 为传统搜索 API。</p>

        {/* 搜索通道选择 */}
        <div className="p-4 rounded-xl bg-bg-card border border-border max-w-lg mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Search size={15} className="text-emerald-400" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">搜索通道</span>
            {searchProviderSaving && <Loader2 size={12} className="animate-spin text-gray-400 ml-1" />}
          </div>
          <div className="space-y-2">
            {[
              { v: 'auto', label: '自动（推荐）', desc: '已配置 Vertex/Gemini 时优先用接地搜索，失败自动回退 Tavily' },
              { v: 'gemini_grounding', label: 'Gemini 接地搜索', desc: '优先 Gemini 接地搜索，异常时回退 Tavily 兜底' },
              { v: 'tavily', label: 'Tavily', desc: '仅使用 Tavily Search API（传统行为）' },
            ].map((opt) => (
              <label key={opt.v}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${searchProvider === opt.v ? 'border-emerald-400/60 bg-emerald-500/5' : 'border-border hover:bg-bg-hover/40'}`}>
                <input type="radio" name="search_provider" value={opt.v}
                  checked={searchProvider === opt.v}
                  onChange={() => handleSaveSearchProvider(opt.v)}
                  className="mt-0.5 accent-emerald-500" />
                <div>
                  <div className="text-sm text-gray-900 dark:text-white font-medium">{opt.label}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-bg-card border border-border max-w-lg">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={15} className="text-emerald-400" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">Tavily Search</span>
            <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-500 hover:text-[#3B82F6] ml-auto">获取 API Key →</a>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tavilyApiKey}
              onChange={(e) => setTavilyApiKey(e.target.value)}
              placeholder="tvly-xxxxxxxxxxxxxxxx"
              className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-emerald-400 font-mono"
            />
            <button onClick={handleSaveTavilyKey} disabled={tavilySaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 border border-emerald-500/30 disabled:opacity-50 shrink-0">
              {tavilySaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {tavilySaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
      </>
      )}

      {/* ==================== AI 提示词 ==================== */}
      {activeTab === 'prompts' && (
        <>

      {/* AI 提示词配置 */}
      <div className="mb-10">
        <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Edit3 size={18} className="text-[#8B5CF6]" /> AI 提示词配置</h3>
        <p className="text-xs text-gray-500 mb-4 dark:text-gray-400">自定义 AI 任务的提示词，影响输出风格和内容结构。使用 <code className="px-1.5 py-0.5 rounded bg-bg-input text-[11px] text-[#8B5CF6]">{'{变量名}'}</code> 表示动态占位。结构化抽取、图像理解、通用对话、ASR / 嵌入等任务的提示词由系统固定，不开放自定义。</p>
        {isAdmin && <p className="text-xs text-indigo-500 mb-3">管理员提示：你可以编辑全局默认提示词，新用户将自动继承。普通用户可自行覆盖为个人提示词。</p>}
        {Object.keys(aiPrompts).length === 0 ? (
          <div className="p-6 rounded-xl bg-bg-card border border-dashed border-border text-center">
            <Loader2 size={20} className="mx-auto animate-spin text-gray-500 mb-2" />
            <p className="text-xs text-gray-500">加载提示词配置中...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(aiPrompts).filter(([taskType]) => ![
              'speech_to_text', // ASR 模型，无 LLM 提示词
              'embedding',      // 嵌入模型，无 LLM 提示词
              'meeting_extract',  // JSON schema 由代码硬解析，改提示词会报错
              'contract_parse',   // 同上
              'vision',           // 图像理解，提示词无实际定制价值
              'chat',             // ai_chat() 不调用 _get_prompt()，配置不生效
              'company_info',     // fetch_company_info() 内联硬编码提示词，配置不生效
            ].includes(taskType)).map(([taskType, prompt]) => {
              const isEditing = editingPrompt === taskType
              const sourceLabel = prompt.source === 'user' ? '个人自定义' : prompt.source === 'global' ? '全局默认' : '系统默认'
              const sourceColor = prompt.source === 'user' ? 'bg-[#8B5CF6]/10 text-[#A78BFA]' : prompt.source === 'global' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-gray-500/10 text-gray-400'
              return (
                <div key={taskType} className="p-3.5 max-md:p-3 rounded-xl bg-bg-card border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-gray-900 dark:text-white max-md:text-xs">{prompt.label}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${sourceColor}`}>{sourceLabel}</span>
                      </div>
                      <p className="text-xs text-gray-500 mb-1 max-md:hidden">{prompt.desc}</p>
                      <p className="text-[11px] text-gray-600">变量: {prompt.variables?.join(', ') || '无'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => openPromptEditor(taskType)}
                        className="px-2.5 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border transition-colors"
                      >
                        <Edit3 size={12} className="inline mr-1 max-md:mr-0" /><span className="max-md:hidden">编辑</span>
                      </button>
                      {prompt.customized && (
                        <button
                          onClick={() => resetPrompt(taskType)}
                          className="px-2.5 py-1.5 rounded-lg bg-bg-hover text-xs text-amber-400 hover:text-amber-300 border border-border transition-colors"
                          title="恢复为全局默认"
                        >
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 编辑面板 */}
                  {isEditing && (
                    <div className="mt-4 space-y-3 border-t border-border pt-4">
                      {isAdmin && (
                        <div className="flex items-center gap-2 mb-2">
                          <label className="text-xs text-gray-400">编辑范围：</label>
                          <SearchableSelect
                            options={[
                              { id: 'user', label: '个人提示词（仅影响自己）' },
                              { id: 'global', label: '全局默认（影响所有新用户）' },
                            ]}
                            value={promptScope[taskType] || 'user'}
                            onChange={(v) => setPromptScope(prev => ({ ...prev, [taskType]: v === 0 ? 'user' : String(v) }))}
                            clearValue=""
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-400 mb-1.5">System Prompt</label>
                        <textarea
                          value={promptForm.system_prompt}
                          onChange={(e) => setPromptForm({ ...promptForm, system_prompt: e.target.value })}
                          className="w-full h-24 p-3 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#8B5CF6] resize-none font-mono leading-relaxed"
                          placeholder={prompt.system_prompt}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1.5">用户消息模板</label>
                        <textarea
                          value={promptForm.user_prompt_template}
                          onChange={(e) => setPromptForm({ ...promptForm, user_prompt_template: e.target.value })}
                          className="w-full h-24 p-3 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#8B5CF6] resize-none font-mono leading-relaxed"
                          placeholder={prompt.user_prompt_template}
                        />
                      </div>
                      {/* AI 帮写提示词 */}
                      <div className="p-3 rounded-lg bg-[#8B5CF6]/5 border border-[#8B5CF6]/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles size={13} className="text-[#A78BFA]" />
                          <span className="text-xs font-medium text-[#A78BFA]">AI 帮你写提示词</span>
                          <span className="text-[11px] text-gray-500">描述需求，AI 自动生成规范提示词</span>
                        </div>
                        <textarea
                          value={aiReq}
                          onChange={(e) => setAiReq(e.target.value)}
                          placeholder="例如：请帮我写一个日报总结提示词，要突出每日的技术突破和工作亮点，语气积极向上，每条总结控制在100字以内"
                          className="w-full h-16 p-2.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#8B5CF6] resize-none leading-relaxed placeholder-gray-600"
                        />
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[11px] text-gray-600">{aiReq.length} 字</span>
                          <button
                            onClick={() => generatePrompt(taskType)}
                            disabled={aiGenerating || !aiReq.trim()}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#8B5CF6] text-white text-xs font-medium hover:bg-purple-600 disabled:opacity-40 transition-colors"
                          >
                            {aiGenerating && <Loader2 size={12} className="animate-spin" />}
                            <Sparkles size={12} />{aiGenerating ? 'AI 思考中...' : '生成提示词'}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => savePrompt(taskType)}
                          disabled={promptSaving}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-medium hover:bg-purple-600 disabled:opacity-50 transition-colors"
                        >
                          {promptSaving && <Loader2 size={12} className="animate-spin" />}
                          <Save size={12} />{promptSaving ? '保存中...' : '保存'}
                        </button>
                        <button
                          onClick={() => setEditingPrompt(null)}
                          className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      </>
      )}

      {/* ==================== 系统公告 & AI 资讯 ==================== */}
      {activeTab === 'announcement' && canEditSettings && (
        <AnnouncementTab fetchWithAuth={fetchWithAuth} showToast={showToast} />
      )}

      {/* ==================== 系统配置 ==================== */}
      {activeTab === 'system' && (
        <>
      {/* 品牌自定义 */}
      {canEditSettings && (
        <div className="mb-10 p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1 flex items-center gap-2">
            <Palette size={18} className="text-[#F59E0B]" /> 品牌自定义
          </h3>
          <p className="text-xs text-gray-500 mb-5">自定义网站 Logo 和标题，保存后在侧边栏和浏览器标签页生效</p>

          {brandMsg && (
            <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${brandMsg.type === 'success' ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-red-500/10 text-red-400'}`}>
              {brandMsg.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Logo 上传 */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">网站 Logo</label>
              <div className="flex items-start gap-3">
                <div
                  className="w-16 h-16 rounded-xl border-2 border-dashed border-border flex items-center justify-center shrink-0 overflow-hidden bg-bg-input cursor-pointer hover:border-[#3B82F6]/50 transition-colors relative group"
                  onClick={() => document.getElementById('brand-logo-input')?.click()}
                >
                  {brandLogoPreview ? (
                    <img src={brandLogoPreview} alt="Logo预览" className="w-full h-full object-cover" />
                  ) : branding.logo_url ? (
                    <img src={branding.logo_url} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <Upload size={20} className="text-gray-500" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Upload size={14} className="text-white" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    id="brand-logo-input"
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.ico"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 2 * 1024 * 1024) {
                        setBrandMsg({ type: 'error', text: '文件大小不能超过 2MB' })
                        return
                      }
                      setBrandLogoFile(file)
                      setBrandLogoPreview(URL.createObjectURL(file))
                      setBrandMsg(null)
                    }}
                  />
                  <p className="text-[11px] text-gray-400">推荐 200×200 px 方形图片</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">PNG、JPEG、GIF、WebP、SVG、ICO，最大 2MB</p>
                  {brandLogoFile && (
                    <button onClick={() => { setBrandLogoFile(null); setBrandLogoPreview('') }}
                      className="text-[11px] text-red-400 hover:text-red-300 mt-1">移除</button>
                  )}
                </div>
              </div>
            </div>
            {/* 站点标题 */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">网站标题</label>
              <input
                value={branding.site_title}
                onChange={(e) => setBranding({ ...branding, site_title: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                placeholder="WorkTrack"
                maxLength={60}
              />
              <p className="text-[11px] text-gray-600 mt-1.5">将在侧边栏顶部和浏览器标签页显示</p>
            </div>
            {/* 前端地址 */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">前端访问地址</label>
              <input
                value={branding.frontend_url}
                onChange={(e) => setBranding({ ...branding, frontend_url: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors"
                placeholder="https://worktrack.example.com"
              />
              <p className="text-[11px] text-gray-600 mt-1.5">用于邮件中拼接登录链接和密码重置链接，如 https://worktrack.example.com</p>
            </div>
          </div>
          {/* 保存 */}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border">
            <button
              onClick={async () => {
                setBrandSaving(true)
                setBrandMsg(null)
                try {
                  // 先上传 logo（如果有）
                  let logoUrl = branding.logo_url
                  if (brandLogoFile) {
                    const fd = new FormData()
                    fd.append('file', brandLogoFile)
                    const logoRes = await fetch('/api/v1/settings/branding/upload-logo', {
                      method: 'POST',
                      body: fd,
                    })
                    if (logoRes.ok) {
                      const logoData = await logoRes.json()
                      logoUrl = logoData.logo_url
                    } else {
                      const err = await logoRes.json()
                      throw new Error(err.detail || 'Logo上传失败')
                    }
                  }
                  // 保存品牌配置
                  const saveRes = await fetch('/api/v1/settings/branding', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ site_title: branding.site_title, logo_url: logoUrl, frontend_url: branding.frontend_url }),
                  })
                  if (!saveRes.ok) {
                    const err = await saveRes.json()
                    throw new Error(err.detail || '保存失败')
                  }
                  setBrandMsg({ type: 'success', text: '品牌配置已保存，刷新页面后生效' })
                  setBrandLogoFile(null)
                  setBrandLogoPreview('')
                  loadBranding()
                } catch (e: any) {
                  setBrandMsg({ type: 'error', text: e.message || '保存失败' })
                } finally {
                  setBrandSaving(false)
                }
              }}
              disabled={brandSaving}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#3B82F6] text-[#fff] text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {brandSaving && <Loader2 size={14} className="animate-spin" />}
              <Save size={14} />{brandSaving ? '保存中...' : '保存品牌设置'}
            </button>
            <button
              onClick={() => { setBranding({ logo_url: '', site_title: 'WorkTrack', frontend_url: '' }); setBrandLogoFile(null); setBrandLogoPreview('') }
              }
              className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border transition-colors"
            >
              恢复默认
            </button>
          </div>
        </div>
      )}

      {/* MCP 对外服务 */}
      {canEditSettings && (
        <div className="mb-10 p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
          <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1 flex items-center gap-2">
            <Terminal size={18} className="text-[#8B5CF6]" /> MCP 对外服务
          </h3>
          <p className="text-xs text-gray-500 mb-5">将 WorkTrack 数据暴露为 MCP 工具，供 Claude Desktop、Cursor、Cline 等智能体调用</p>

          {mcpMsg && (
            <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${mcpMsg.type === 'success' ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-red-500/10 text-red-400'}`}>
              {mcpMsg.text}
            </div>
          )}

          {/* 服务开关 */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border">
            <div>
              <p className="text-sm text-gray-900 dark:text-gray-200">MCP 服务状态</p>
              <p className="text-[11px] text-gray-500 mt-0.5">启用后，持有 API Key 的外部智能体可通过 MCP 协议访问 WorkTrack 数据</p>
            </div>
            <button
              onClick={async () => {
                setMcpLoading(true)
                try {
                  const res = await fetch('/api/v1/settings/mcp-config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: !mcpConfig.enabled, public_url: mcpConfig.public_url }),
                  })
                  if (res.ok) {
                    setMcpConfig({ ...mcpConfig, enabled: !mcpConfig.enabled })
                    setMcpMsg({ type: 'success', text: `MCP 服务已${mcpConfig.enabled ? '停用' : '启用'}` })
                  } else {
                    const err = await res.json()
                    setMcpMsg({ type: 'error', text: err.detail || '操作失败' })
                  }
                } catch (e: any) {
                  setMcpMsg({ type: 'error', text: e.message || '操作失败' })
                } finally {
                  setMcpLoading(false)
                }
              }}
              disabled={mcpLoading}
              className={`relative w-11 h-6 rounded-full transition-colors ${mcpConfig.enabled ? 'bg-[#10B981]' : 'bg-gray-600'} disabled:opacity-50`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${mcpConfig.enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {/* 服务地址 */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-400">服务地址</label>
              <span className="text-[11px] text-gray-600">
                {mcpConfig.public_url ? '已自定义' : '自动检测：' + window.location.origin}
              </span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <code className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-[#8B5CF6] font-mono select-all">
                {(() => {
                  const base = mcpConfig.public_url || window.location.origin
                  return base + '/mcp'
                })()}
              </code>
              <button
                onClick={() => {
                  const base = mcpConfig.public_url || window.location.origin
                  navigator.clipboard.writeText(base + '/mcp')
                  setMcpMsg({ type: 'success', text: '已复制' })
                  setTimeout(() => setMcpMsg(null), 2000)
                }}
                className="p-2 rounded-lg bg-bg-hover border border-border text-gray-400 hover:text-white transition-colors"
                title="复制地址"
              >
                <Copy size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={mcpConfig.public_url}
                onChange={(e) => setMcpConfig({ ...mcpConfig, public_url: e.target.value })}
                className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#8B5CF6] transition-colors font-mono"
                placeholder={window.location.origin}
              />
              <button
                onClick={async () => {
                  setMcpLoading(true)
                  try {
                    const res = await fetch('/api/v1/settings/mcp-config', {
                      method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ enabled: mcpConfig.enabled, public_url: mcpConfig.public_url }),
                    })
                    if (res.ok) {
                      setMcpMsg({ type: 'success', text: '公开地址已保存' })
                      setTimeout(() => setMcpMsg(null), 2000)
                    } else {
                      const err = await res.json()
                      setMcpMsg({ type: 'error', text: err.detail || '保存失败' })
                    }
                  } catch (e: any) {
                    setMcpMsg({ type: 'error', text: e.message || '保存失败' })
                  } finally {
                    setMcpLoading(false)
                  }
                }}
                disabled={mcpLoading}
                className="px-3 py-2 rounded-lg bg-bg-hover border border-border text-xs text-gray-400 hover:text-white transition-colors shrink-0"
              >
                保存
              </button>
            </div>
            <p className="text-[11px] text-gray-600 mt-1.5">
              默认自动检测当前访问地址。如需外部智能体通过公网域名访问，请填写真实地址（如 https://worktrack.example.com）
            </p>
          </div>

          {/* API Key 管理 */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1.5">API Key</label>
            {mcpConfig.has_key ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 font-mono select-all">
                  {showMcpKey ? mcpConfig.api_key : mcpConfig.api_key_masked}
                </code>
                <button
                  onClick={() => setShowMcpKey(!showMcpKey)}
                  className="p-2 rounded-lg bg-bg-hover border border-border text-gray-400 hover:text-white transition-colors"
                  title={showMcpKey ? '隐藏' : '显示'}
                >
                  {showMcpKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(mcpConfig.api_key); setMcpMsg({ type: 'success', text: '已复制' }); setTimeout(() => setMcpMsg(null), 2000) }}
                  className="p-2 rounded-lg bg-bg-hover border border-border text-gray-400 hover:text-white transition-colors"
                  title="复制 Key"
                >
                  <Copy size={14} />
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-gray-600">尚未生成 API Key</p>
            )}
          </div>

          {/* 按钮 */}
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setMcpLoading(true)
                setMcpMsg(null)
                try {
                  const res = await fetch('/api/v1/settings/mcp-config/generate-key', {
                    method: 'POST',
                  })
                  if (res.ok) {
                    const data = await res.json()
                    setMcpConfig({ ...mcpConfig, api_key: data.api_key, api_key_masked: data.api_key, has_key: true })
                    setShowMcpKey(true)
                    setMcpMsg({ type: 'success', text: '新 Key 已生成，请立即复制保存' })
                  } else {
                    const err = await res.json()
                    setMcpMsg({ type: 'error', text: err.detail || '生成失败' })
                  }
                } catch (e: any) {
                  setMcpMsg({ type: 'error', text: e.message || '生成失败' })
                } finally {
                  setMcpLoading(false)
                }
              }}
              disabled={mcpLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#8B5CF6] text-white text-sm font-medium hover:bg-purple-600 disabled:opacity-50 transition-colors"
            >
              {mcpLoading && <Loader2 size={14} className="animate-spin" />}
              <Key size={14} />{mcpConfig.has_key ? '重新生成 Key' : '生成 API Key'}
            </button>
          </div>

          {/* 对接说明 */}
          <div className="mt-5 pt-4 border-t border-border">
            <button
              onClick={() => setShowMcpCode(!showMcpCode)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <Zap size={12} className="text-[#F59E0B]" />
              <span>对接说明与示例代码</span>
              <ChevronDown size={12} className={`transition-transform ${showMcpCode ? 'rotate-180' : ''}`} />
            </button>
            {showMcpCode && (
              (() => {
                const mcpBaseUrl = mcpConfig.public_url || window.location.origin
                const mcpKey = mcpConfig.has_key ? (showMcpKey ? mcpConfig.api_key : 'YOUR_MCP_KEY') : 'YOUR_MCP_KEY'
                return (
              <div className="mt-3 space-y-4">
                {/* Claude Desktop */}
                <div>
                  <p className="text-[11px] text-gray-500 mb-1.5 font-medium">🤖 Claude Desktop 配置</p>
                  <pre className="text-[11px] bg-bg-input border border-border rounded-lg p-3 overflow-x-auto text-gray-700 dark:text-gray-300 leading-relaxed">{`{
  "mcpServers": {
    "worktrack": {
      "url": "${mcpBaseUrl}/mcp",
      "headers": { "Authorization": "Bearer ${mcpKey}" }
    }
  }
}`}</pre>
                  <p className="text-[11px] text-gray-600 mt-1">保存到 claude_desktop_config.json，重启 Claude Desktop</p>
                </div>
                {/* Cursor / Cline */}
                <div>
                  <p className="text-[11px] text-gray-500 mb-1.5 font-medium">🖥️ Cursor / Cline / VS Code Copilot</p>
                  <pre className="text-[11px] bg-bg-input border border-border rounded-lg p-3 overflow-x-auto text-gray-700 dark:text-gray-300 leading-relaxed">{`{
  "mcpServers": {
    "worktrack": {
      "transport": {
        "type": "http",
        "url": "${mcpBaseUrl}/mcp"
      },
      "headers": { "Authorization": "Bearer ${mcpKey}" }
    }
  }
}`}</pre>
                </div>
                {/* 可用工具列表 */}
                <div>
                  <p className="text-[11px] text-gray-500 mb-1.5 font-medium">🔧 可用工具（18个）</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {[
                      { cat: '日报', tools: 'list/search/get/create/update' },
                      { cat: '周报', tools: 'list/get' },
                      { cat: '项目', tools: 'list/search/get/create/update' },
                      { cat: '客户', tools: 'list/get/create' },
                      { cat: '会议', tools: 'list/get/create' },
                      { cat: '全局', tools: 'global_search / get_overview' },
                    ].map(g => (
                      <div key={g.cat} className="px-2 py-1.5 rounded-lg bg-bg-input border border-border">
                        <p className="text-[11px] text-[#8B5CF6] font-medium">{g.cat}</p>
                        <p className="text-[11px] text-gray-500">{g.tools}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
                )
              })()
            )}
          </div>
        </div>
      )}

      {/* 字段选项 */}
      <div className="mb-10">
        <h3 className="text-base font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2"><ListChecks size={18} className="text-[#10B981]" /> 字段选项管理</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">管理项目表单中各下拉字段的可选值</p>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 左侧：分类选择 */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-bg-card">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">选择字段</span>
              </div>
              <div className="divide-y divide-border/50">
                {Object.entries(categoryLabels).map(([key, label]) => {
                  const Icon = categoryIcons[key]
                  const color = categoryColors[key]
                  const count = fieldOptions.filter((o) => o.category === key).length
                  const isActive = selectedCategory === key
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedCategory(key)}
                      className={`w-full flex items-center gap-3 px-4 py-3 transition-all ${
                        isActive
                          ? 'bg-[#3B82F6]/5 dark:bg-[#3B82F6]/10 border-l-2'
                          : 'hover:bg-bg-hover/50 border-l-2 border-l-transparent'
                      }`}
                      style={isActive ? { borderLeftColor: color } : {}}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: isActive ? `${color}20` : `${color}10` }}
                      >
                        <Icon size={14} style={{ color: isActive ? color : `${color}99` }} />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <p className={`text-sm truncate ${isActive ? 'text-gray-900 dark:text-gray-100 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>{label}</p>
                        <p className={`text-[11px] ${isActive ? 'text-gray-500' : 'text-gray-400 dark:text-gray-500'}`}>{count} 个选项</p>
                      </div>
                      {isActive && (
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 右侧：编辑区 */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = categoryIcons[selectedCategory]
                    const color = categoryColors[selectedCategory]
                    return (
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
                        <Icon size={14} style={{ color }} />
                      </div>
                    )
                  })()}
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{categoryLabels[selectedCategory]}</span>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 bg-bg-input px-2 py-0.5 rounded-full">
                    {fieldOptions.filter((o) => o.category === selectedCategory).length} 项
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">每行一个，空行自动忽略</span>
              </div>
              <div className="p-4">
                <textarea
                  value={editingOptions}
                  onChange={(e) => setEditingOptions(e.target.value)}
                  className="w-full h-52 p-4 max-md:p-3 rounded-lg bg-bg-input border border-border text-sm text-gray-800 dark:text-gray-300 outline-none focus:border-[#3B82F6] resize-none placeholder-gray-400 dark:placeholder-gray-600 font-mono leading-relaxed transition-colors"
                  placeholder={`输入${categoryLabels[selectedCategory]}选项，每行一个…`}
                />
              </div>
              <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-bg-card">
                <button
                  onClick={handleSaveOptions}
                  disabled={optionsSaving}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#10B981] text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-all"
                >
                  {optionsSaving && <Loader2 size={14} className="animate-spin" />}
                  <Save size={14} />{optionsSaving ? '保存中…' : '保存选项'}
                </button>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">修改后即刻生效</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== 邮件服务配置 ==================== */}
      {canEditSettings && (
        <EmailConfigSection showToast={showToast} />
      )}
      </>
      )}

      {/* ==================== 个人账户 ==================== */}
      {activeTab === 'account' && (
        <>
          {/* 个人资料概览 */}
          <div className="mb-10">
            <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
              {/* 顶部渐变横幅 */}
              <div className="h-20 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 relative">
                <div className="absolute -bottom-8 left-5">
                  <div className="w-16 h-16 rounded-full bg-bg-card border-2 border-border overflow-hidden flex items-center justify-center shadow-lg">
                    {user?.avatar ? (
                      <img src={user.avatar} alt="头像" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl font-bold text-accent-blue">{(user?.name || user?.username || '?')[0].toUpperCase()}</span>
                    )}
                  </div>
                </div>
              </div>
              {/* 基本信息 */}
              <div className="pt-10 pb-4 px-5 max-md:px-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{user?.name || user?.username || '未设置'}</h2>
                    <p className="text-sm text-gray-500">@{user?.username || ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {user?.is_admin && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-500 border border-red-500/20">管理员</span>
                    )}
                    {(user?.roles || []).map((r: string) => {
                      const roleLabels: Record<string, string> = { admin: '管理员', dept_leader: '部门领导', sales: '销售', tech: '技术', operations: '运营', business: '商务', finance: '财务', legal: '法务', boss: '老板', cashier: '出纳', seal_keeper: '印章管理员', user: '普通用户' }
                      if (r === 'admin' && user?.is_admin) return null
                      return (
                        <span key={r} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-500 border border-blue-500/20">{roleLabels[r] || r}</span>
                      )
                    })}
                  </div>
                </div>
              </div>
              {/* 详细信息网格 */}
              <div className="border-t border-border px-5 max-md:px-4 py-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {user?.job_title && (
                    <div className="flex items-center gap-2">
                      <Briefcase size={14} className="text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-gray-500">职位</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200">{user.job_title}</p>
                      </div>
                    </div>
                  )}
                  {user?.department_name && (
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-gray-500">部门</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200">{user.department_name}</p>
                      </div>
                    </div>
                  )}
                  {user?.leader_name && (
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-gray-500">汇报上级</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200">{user.leader_name}</p>
                      </div>
                    </div>
                  )}
                  {user?.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-gray-500">邮箱</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 truncate max-w-[160px]">{user.email}</p>
                      </div>
                    </div>
                  )}
                  {user?.last_login_at && (
                    <div className="flex items-center gap-2">
                      <Activity size={14} className="text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-gray-500">最近登录</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200">{new Date(user.last_login_at).toLocaleDateString('zh-CN')}</p>
                      </div>
                    </div>
                  )}
                  {user?.created_at && (
                    <div className="flex items-center gap-2">
                      <Calendar size={14} className="text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[11px] text-gray-500">注册时间</p>
                        <p className="text-sm text-gray-800 dark:text-gray-200">{new Date(user.created_at).toLocaleDateString('zh-CN')}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 个人信息 */}
          <div className="mb-10">
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <User size={18} className="text-accent-blue" /> 个人信息
            </h3>
            <div className="p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
              {accountMsg && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${
                  accountMsg.type === 'success'
                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                  {accountMsg.text}
                </div>
              )}
              {/* 头像 */}
              <div className="mb-6 flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-bg-input border-2 border-border overflow-hidden flex items-center justify-center">
                  {user?.avatar ? <img src={user.avatar} alt="头像" className="w-full h-full object-cover" /> :
                    <span className="text-2xl text-gray-500 font-bold">{(user?.name || user?.username || '?')[0].toUpperCase()}</span>}
                </div>
                <div>
                  <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">
                    上传头像
                    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]; if(!file) return
                      // 前端预检
                      if (file.size > 5 * 1024 * 1024) { showToast(`文件过大（${(file.size/1024/1024).toFixed(1)}MB），请选择 5MB 以内的文件`, 'error'); return }
                      const ext = '.' + file.name.split('.').pop()?.toLowerCase()
                      const allowed = ['.png','.jpg','.jpeg','.gif','.webp']
                      if (!allowed.includes(ext)) { showToast(`不支持 ${ext} 格式，请选择 PNG、JPEG、GIF 或 WebP 图片`, 'error'); return }
                      const fd = new FormData(); fd.append('file', file)
                      try {
                        const res = await fetchWithAuth('/api/v1/auth/avatar', { method: 'POST', body: fd })
                        if(!res.ok) {
                          let msg = '上传失败'
                          try { const err = await res.json(); msg = err.detail || msg } catch {}
                          throw new Error(`[${res.status}] ${msg}`)
                        }
                        const data = await res.json()
                        setUser(prev => prev ? { ...prev, avatar: data.avatar_url } : prev)
                        showToast('头像已更新', 'success')
                      } catch(err: any) { showToast(err.message || '上传失败', 'error') }
                    }} />
                  </label>
                  <p className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">支持 PNG、JPEG、GIF、WebP 格式，最大 5MB</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">用户名</label>
                  <input
                    value={user?.username || ''}
                    disabled
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-500 opacity-60 cursor-not-allowed"
                  />
                  <p className="text-[11px] text-gray-600 mt-1">用户名不可修改</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">昵称</label>
                  <input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent-blue"
                    placeholder="显示名称"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">邮箱</label>
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent-blue"
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">职位</label>
                  <input
                    value={profileJobTitle}
                    onChange={(e) => setProfileJobTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-accent-blue"
                    placeholder="如：产品经理、工程师"
                  />
                </div>
                <button
                  onClick={async () => {
                    setAccountMsg(null)
                    setProfileSaving(true)
                    try {
                      const res = await fetchWithAuth('/api/v1/auth/me', {
                        method: 'PUT',
                        body: JSON.stringify({ name: profileName, email: profileEmail || null, job_title: profileJobTitle || null }),
                      })
                      if (!res.ok) {
                        const e = await res.json()
                        throw new Error(e.detail || '保存失败')
                      }
                      setAccountMsg({ type: 'success', text: '个人信息已保存' })
                    } catch (err: any) {
                      setAccountMsg({ type: 'error', text: err.message })
                    } finally {
                      setProfileSaving(false)
                    }
                  }}
                  disabled={profileSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-[#fff] text-sm hover:bg-accent-blue/85 disabled:opacity-50"
                >
                  {profileSaving && <Loader2 size={14} className="animate-spin" />}
                  <Save size={14} />{profileSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>

          {/* 首页设置 */}
          {canUseAI && (
          <div className="mb-10">
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Home size={18} className="text-[#F59E0B]" /> 首页设置
            </h3>
            <p className="text-xs text-gray-500 mb-4">选择打开平台时的默认首页，每位用户可以独立设置</p>
            <div className="p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <span className="text-sm text-gray-400">默认首页:</span>
                <SearchableSelect
                  options={[
                    ...(hasPermission('report:read') ? [{ id: '/reports', label: '日报周报' }] : []),
                    ...(hasPermission('project:read') ? [{ id: '/projects', label: '项目管理' }] : []),
                    ...(hasPermission('meeting:read') ? [{ id: '/meetings', label: '会议纪要' }] : []),
                    ...(hasPermission('dashboard:read') ? [{ id: '/dashboard', label: '数据看板' }] : []),
                    ...(hasPermission('ai:use') ? [{ id: '/ai', label: 'AI 中心' }] : []),
                    ...(hasPermission('wiki:read') ? [{ id: '/wiki', label: 'AI 笔记' }] : []),
                    ...(hasPermission('customer:read') ? [{ id: '/customers', label: '客户管理' }] : []),
                    ...(hasPermission('monitor:read') ? [{ id: '/monitor', label: '运维监控' }] : []),
                  ]}
                  value={homePage}
                  onChange={(v) => setHomePage(v === 0 ? '' : String(v))}
                  clearValue=""
                />
                <button
                  onClick={handleSaveHomePage}
                  disabled={homePageSaving}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-[#fff] text-sm hover:bg-accent-blue/85 disabled:opacity-50 sm:w-auto"
                >
                  {homePageSaving && <Loader2 size={14} className="animate-spin" />}
                  {homePageSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
          )}

          {/* 修改密码 */}
          <div>
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Key size={18} className="text-amber-400" /> 修改密码
            </h3>
            <div className="p-5 max-md:p-4 rounded-xl bg-bg-card border border-border">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">当前密码</label>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-amber-400"
                    placeholder="请输入当前密码"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">新密码</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-amber-400"
                    placeholder="至少 8 位，包含字母和数字"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">确认新密码</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-amber-400"
                    placeholder="再次输入新密码"
                  />
                </div>
                <button
                  onClick={async () => {
                    setAccountMsg(null)
                    if (!oldPassword || !newPassword || !confirmPassword) {
                      setAccountMsg({ type: 'error', text: '请填写所有密码字段' })
                      return
                    }
                    if (newPassword !== confirmPassword) {
                      setAccountMsg({ type: 'error', text: '两次输入的新密码不一致' })
                      return
                    }
                    setPasswordSaving(true)
                    try {
                      const res = await fetchWithAuth('/api/v1/auth/change-password', {
                        method: 'POST',
                        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
                      })
                      if (!res.ok) {
                        const e = await res.json()
                        throw new Error(e.detail || '修改密码失败')
                      }
                      setAccountMsg({ type: 'success', text: '密码修改成功，请重新登录' })
                      setOldPassword('')
                      setNewPassword('')
                      setConfirmPassword('')
                      // 3 秒后跳转到登录页
                      setTimeout(() => {
                        window.location.href = '/login'
                      }, 2000)
                    } catch (err: any) {
                      setAccountMsg({ type: 'error', text: err.message })
                    } finally {
                      setPasswordSaving(false)
                    }
                  }}
                  disabled={passwordSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-[#fff] text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                >
                  {passwordSaving && <Loader2 size={14} className="animate-spin" />}
                  <Key size={14} />{passwordSaving ? '修改中...' : '修改密码'}
                </button>
                <p className="text-[11px] text-gray-600">修改密码后所有设备上的登录状态将失效，需要重新登录。</p>
              </div>
            </div>
          </div>
        </>
      )}


      {/* 弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 max-md:p-0" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg max-md:max-w-full max-md:h-full max-md:rounded-none max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-bg-card rounded-t-2xl max-md:rounded-t-none flex items-center justify-between px-5 max-md:px-4 py-4 border-b border-border z-10">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">{editingProvider ? '编辑供应商' : '添加模型供应商'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="p-5 max-md:p-4">
              {!editingProvider && (
                <>
                  <p className="text-xs text-gray-500 mb-3">选择预置供应商自动填充，或手动填写下方信息</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-5">
                    {providerPresets.map((p) => (
                      <button key={p.name} onClick={() => setForm({ ...form, name: p.name, base_url: p.base_url, project_id: (p as any).project_id || '', location: (p as any).location || '', gcp_label_team: '', gcp_label_app: '', gcp_label_env: '' })}
                        className="px-2 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-400 hover:text-white hover:border-[#3B82F6]/50 hover:bg-bg-hover transition-all truncate">
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[11px] text-gray-600 shrink-0">或手动填写</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                </>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">供应商名称 <span className="text-red-400">*</span></label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors" placeholder="如 DeepSeek" />
                </div>
                {(form.name === 'Vertex AI' || form.project_id) && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">GCP 项目 ID <span className="text-red-400">*</span></label>
                      <input value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="如 my-project-123456" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">GCP 区域</label>
                      <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="us-central1" />
                      <p className="text-[11px] text-gray-500 mt-1">默认 us-central1，可选如 asia-east1、europe-west4 等</p>
                    </div>
                    <div className="pt-1 border-t border-border">
                      <p className="text-[11px] text-gray-400 mb-2">GCP 账单标签（可选，用于在 GCP 费用报表中过滤此供应商的消耗）</p>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] text-gray-400 mb-1">team</label>
                          <input value={form.gcp_label_team} onChange={(e) => setForm({ ...form, gcp_label_team: e.target.value })}
                            className="w-full px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="如 platform" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-gray-400 mb-1">app</label>
                          <input value={form.gcp_label_app} onChange={(e) => setForm({ ...form, gcp_label_app: e.target.value })}
                            className="w-full px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="如 worktrack" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-gray-400 mb-1">environment</label>
                          <input value={form.gcp_label_env} onChange={(e) => setForm({ ...form, gcp_label_env: e.target.value })}
                            className="w-full px-2 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="如 production" />
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">API 端点 <span className="text-red-400">*</span></label>
                  <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="https://api.deepseek.com/v1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">{form.name === 'Vertex AI' ? '服务账号 JSON' : 'API Key'}</label>
                  <input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} type="password"
                    className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder={form.name === 'Vertex AI' ? '粘贴服务账号 JSON...' : 'sk-...'} />
                  {form.name === 'Vertex AI' && (
                    <p className="text-[11px] text-gray-500 mt-1">请粘贴 GCP 服务账号的完整 JSON 密钥内容</p>
                  )}
                </div>
              </div>
              <button onClick={handleSave} disabled={saving || !form.name.trim() || (!form.base_url.trim() && !form.project_id.trim())}
                className="w-full mt-6 py-2.5 rounded-xl bg-[#3B82F6] text-[#fff] text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {saving && <Loader2 size={16} className="animate-spin" />}<Save size={16} />{saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 模型参数抽屉 */}
      <ModelDetailDrawer
        providerId={detailDrawer.providerId || 0}
        providerName={detailDrawer.providerName}
        modelId={detailDrawer.modelId}
        modelName={detailDrawer.modelName}
        open={detailDrawer.open && detailDrawer.providerId != null && detailDrawer.modelId != null}
        onClose={() => setDetailDrawer({ open: false, providerId: null, providerName: '', modelId: null, modelName: null })}
        onSaved={() => providers.forEach((p) => loadProviderModels(p.id))}
        canEdit={true}
      />

      {/* 任务参数覆盖弹窗 */}
      {overrideModal.open && (() => {
        const cfg = taskConfigs[overrideModal.taskType]
        return (
          <TaskOverrideModal
            taskType={overrideModal.taskType}
            taskLabel={overrideModal.taskLabel}
            current={cfg || null}
            onClose={() => setOverrideModal({ open: false, taskType: '', taskLabel: '' })}
            onSaved={loadTaskConfigs}
            canEdit={canManageShared}
          />
        )
      })()}

      {/* 预设编辑器弹窗 */}
      {presetEditor.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPresetEditor({ open: false, preset: null })}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Layers size={18} className="text-[#A78BFA]" />
                {presetEditor.preset ? '编辑预设' : '新建参数预设'}
              </h3>
              <button onClick={() => setPresetEditor({ open: false, preset: null })} className="p-1.5 rounded-lg hover:bg-bg-hover text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">预设名称 <span className="text-red-400">*</span></label>
                <input value={presetForm.name} onChange={(e) => setPresetForm({ ...presetForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#A78BFA]"
                  placeholder="如：JSON 严格提取" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">描述</label>
                <input value={presetForm.description} onChange={(e) => setPresetForm({ ...presetForm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#A78BFA]"
                  placeholder="如：低温度+JSON 输出，用于数据抽取" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Temperature</label>
                  <input type="number" value={presetForm.temperature} step={0.05} min={0} max={2}
                    onChange={(e) => setPresetForm({ ...presetForm, temperature: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#A78BFA] font-mono"
                    placeholder="0.1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Top P</label>
                  <input type="number" value={presetForm.top_p} step={0.05} min={0} max={1}
                    onChange={(e) => setPresetForm({ ...presetForm, top_p: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#A78BFA] font-mono"
                    placeholder="0.95" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Max Tokens</label>
                  <input type="number" value={presetForm.max_tokens} step={100} min={1}
                    onChange={(e) => setPresetForm({ ...presetForm, max_tokens: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#A78BFA] font-mono"
                    placeholder="4000" />
                </div>
              </div>
              {presetForm.temperature !== '' && presetForm.top_p !== '' && (
                <p className="text-[11px] text-amber-400">建议 Temperature 和 Top P 只设其一，同时设置效果不可预期</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Thinking Mode</label>
                  <SearchableSelect
                    options={[
                      { id: '', label: '不设置' },
                      { id: 'off', label: '关闭' },
                      { id: 'low', label: '低' },
                      { id: 'medium', label: '中' },
                      { id: 'high', label: '高' },
                      { id: 'auto', label: '自动' },
                    ]}
                    value={presetForm.thinking_mode}
                    onChange={(v) => setPresetForm({ ...presetForm, thinking_mode: v === 0 ? '' : String(v) })}
                    clearValue=""
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Thinking Budget</label>
                  <input type="number" value={presetForm.thinking_budget} step={100} min={0}
                    onChange={(e) => setPresetForm({ ...presetForm, thinking_budget: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#A78BFA] font-mono"
                    placeholder="2000" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Response Format</label>
                <SearchableSelect
                  options={[
                    { id: '', label: '不设置' },
                    { id: 'text', label: '纯文本' },
                    { id: 'json_object', label: 'JSON 对象' },
                  ]}
                  value={presetForm.response_format}
                  onChange={(v) => setPresetForm({ ...presetForm, response_format: v === 0 ? '' : String(v) })}
                  clearValue=""
                />
              </div>
            </div>
            <div className="sticky bottom-0 bg-bg-card border-t border-border px-5 py-3 flex items-center justify-end gap-2">
              <button onClick={() => setPresetEditor({ open: false, preset: null })}
                className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">取消</button>
              <button onClick={handleSavePreset} disabled={presetSaving || !presetForm.name.trim()}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#A78BFA] text-white text-sm font-medium hover:bg-purple-600 disabled:opacity-50">
                {presetSaving && <Loader2 size={14} className="animate-spin" />}
                <Save size={14} />{presetSaving ? '保存中...' : '保存预设'}
              </button>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  )
}
