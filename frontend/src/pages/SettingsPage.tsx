import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X, Save, Trash2, Loader2, Key, Globe, Cpu, Settings2, ListChecks, Sparkles, Brain, Eye, EyeOff, Mic, MessageSquare, Search, ChevronDown, Home, RotateCcw, Edit3, Server, User, Package, MapPin, Activity, Cloud, Palette, Upload, Copy, Terminal, Zap, Building2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

interface Provider {
  id: number
  name: string
  base_url: string
  api_key: string
  is_active: boolean
  provider_type: string
  supported_models_json: string
  user_id: number | null
}

interface ProviderModelItem {
  id: number
  model_name: string
  model_type: string
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
}

const TASK_TYPES = [
  { key: 'chat', label: '对话模型', icon: MessageSquare, desc: '日报总结、会议分析、AI 对话' },
  { key: 'embedding', label: '嵌入模型', icon: Brain, desc: '语义搜索、向量索引' },
  { key: 'vision', label: '视觉模型', icon: Eye, desc: '图片分析（预留）' },
  { key: 'speech_to_text', label: '语音转文字', icon: Mic, desc: '录音转文字' },
  { key: 'web_search', label: '联网搜索', icon: Search, desc: 'Tavily 联网查询' },
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

export default function SettingsPage() {
  // ===== 标签页状态 =====
  const { user, fetchWithAuth } = useAuth()
  const { toast: showToast, confirm: showConfirm } = useToast()
  const isAdmin = user?.is_admin ?? false
  const canAccessModels = isAdmin || (user?.can_manage_models) || (user?.use_shared_models)
  const canManageModels = isAdmin || (user?.can_manage_models)
  const [activeTab, setActiveTab] = useState(canAccessModels ? 'models' : 'prompts')

  const TABS = [
    ...(canAccessModels ? [{ key: 'models', label: '模型管理', icon: Cpu, desc: '供应商与任务模型配置' }] : []),
    { key: 'prompts', label: 'AI 提示词', icon: Edit3, desc: '自定义 AI 输出风格' },
    ...(isAdmin ? [{ key: 'system', label: '系统配置', icon: Settings2, desc: '字段选项与行业分类' }] : []),
    { key: 'account', label: '个人账户', icon: User, desc: '个人信息、首页与密码' },
    { key: 'about', label: '关于', icon: Server, desc: '系统运行状态' },
  ]

  // ===== 个人账户状态 =====
  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileEmail, setProfileEmail] = useState(user?.email || '')
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
  const [form, setForm] = useState({ name: '', base_url: '', api_key: '' })
  const [testingModelId, setTestingModelId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string; reply?: string }>>({})
  const [editingTypeModelId, setEditingTypeModelId] = useState<number | null>(null)
  const [fetchingModels, setFetchingModels] = useState<number | null>(null)

  const [providerModels, setProviderModels] = useState<Record<number, ProviderModelItem[]>>({})
  const [expandedDropdown, setExpandedDropdown] = useState<number | null>(null)
  const [modelSearch, setModelSearch] = useState('')

  // 品牌自定义
  const [branding, setBranding] = useState({ logo_url: '', site_title: 'WorkTrack' })
  const [brandLogoFile, setBrandLogoFile] = useState<File | null>(null)
  const [brandLogoPreview, setBrandLogoPreview] = useState('')
  const [brandSaving, setBrandSaving] = useState(false)
  const [brandMsg, setBrandMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadBranding = useCallback(() => {
    fetch('/api/v1/settings/branding', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
    })
      .then(res => res.json())
      .then(data => setBranding({ logo_url: data.logo_url || '', site_title: data.site_title || 'WorkTrack' }))
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

  // 点击空白区域关闭类型下拉和添加模型下拉
  const typeDropdownRef = useRef<HTMLDivElement>(null)
  const addModelDropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editingTypeModelId === null && expandedDropdown === null) return
    const handler = (e: MouseEvent) => {
      if (editingTypeModelId !== null && typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setEditingTypeModelId(null)
      }
      if (expandedDropdown !== null && addModelDropdownRef.current && !addModelDropdownRef.current.contains(e.target as Node)) {
        setExpandedDropdown(null); setModelSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editingTypeModelId, expandedDropdown])

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
    setForm({ name: '', base_url: '', api_key: '' })
    setShowForm(true)
  }

  const openEdit = (p: Provider) => {
    setEditingProvider(p)
    setForm({ name: p.name, base_url: p.base_url, api_key: p.api_key })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.base_url.trim()) return
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
    await fetch(`/api/v1/settings/providers/${id}`, { method: 'DELETE' })
    setProviderModels((prev) => { const n = { ...prev }; delete n[id]; return n })
    loadProviders()
    showToast('供应商已删除', 'success')
  }

  const handleToggleActive = async (p: Provider) => {
    await fetch(`/api/v1/settings/providers/${p.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: p.name, base_url: p.base_url, api_key: p.api_key, is_active: !p.is_active }),
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

  const addModel = async (providerId: number, modelName: string) => {
    try {
      const res = await fetch(`/api/v1/settings/providers/${providerId}/models`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName }),
      })
      if (!res.ok) { const e = await res.json(); showToast(e.detail || '添加失败', 'error'); return }
      loadProviderModels(providerId)
      showToast('模型已添加', 'success')
    } catch { showToast('添加请求失败', 'error') }
  }

  const removeModel = async (providerId: number, modelId: number) => {
    try {
      await fetch(`/api/v1/settings/providers/${providerId}/models/${modelId}`, { method: 'DELETE' })
      loadProviderModels(providerId)
      showToast('模型已移除', 'success')
    } catch { /* noop */ }
  }

  const testModel = async (providerId: number, modelId: number) => {
    setTestingModelId(modelId)
    try {
      const res = await fetch(`/api/v1/settings/providers/${providerId}/models/${modelId}/test`, { method: 'POST' })
      const data = await res.json()
      setTestResults((prev) => ({ ...prev, [modelId]: data }))
    } catch {
      setTestResults((prev) => ({ ...prev, [modelId]: { success: false, message: '网络请求失败' } }))
    } finally { setTestingModelId(null) }
  }

  const updateModelType = async (providerId: number, modelId: number, newType: string) => {
    setEditingTypeModelId(null)
    try {
      const res = await fetch(`/api/v1/settings/providers/${providerId}/models/${modelId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_type: newType }),
      })
      if (res.ok) {
        loadProviderModels(providerId)
      }
    } catch { /* noop */ }
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
  const saveTaskConfig = async (taskType: string, providerId: number | null, modelName: string) => {
    setTaskSaving(taskType)
    try {
      await fetch('/api/v1/settings/task-models', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: taskType, provider_id: providerId, model_name: modelName }),
      })
      loadTaskConfigs()
    } finally { setTaskSaving(null) }
  }
  const getActiveProviders = () => {
    if (isAdmin) return providers.filter((p) => p.is_active && p.api_key)
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

  // ===== 系统信息 =====
  const [systemInfo, setSystemInfo] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    fetch('/api/v1/settings/system-info')
      .then((r) => r.json())
      .then((d) => setSystemInfo(d))
      .catch(() => {})
  }, [])

  // ===== AI 提示词 =====
  const [aiPrompts, setAiPrompts] = useState<Record<string, { label: string; desc: string; system_prompt: string; user_prompt_template: string; variables: string[]; customized: boolean }>>({})
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null)
  const [promptForm, setPromptForm] = useState({ system_prompt: '', user_prompt_template: '' })
  const [promptSaving, setPromptSaving] = useState(false)
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
      await fetchWithAuth(`/api/v1/settings/ai-prompts/${taskType}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promptForm),
      })
      setEditingPrompt(null)
      setAiReq('')
      loadPrompts()
      showToast('提示词已保存', 'success')
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
  const categoryLabels: Record<string, string> = { product: '涉及产品', project_scenario: '项目场景', sales_person: '销售', project_status: '项目状态', cloud: '云标签' }
  const categoryIcons: Record<string, any> = { product: Package, project_scenario: MapPin, sales_person: User, project_status: Activity, cloud: Cloud }
  const categoryColors: Record<string, string> = { product: '#3B82F6', project_scenario: '#8B5CF6', sales_person: '#F59E0B', project_status: '#10B981', cloud: '#EC4899' }
  const loadFieldOptions = () => { fetch('/api/v1/settings/field-options').then((r) => r.json()).then((d) => setFieldOptions(d as FieldOption[])) }
  useEffect(() => { loadFieldOptions() }, [])

  // 行业标准化分类
  const [industryCats, setIndustryCats] = useState('')
  const [industryCatsSaving, setIndustryCatsSaving] = useState(false)
  const loadIndustryCats = useCallback(() => {
    fetchWithAuth('/api/v1/settings/industry-categories')
      .then(r => r.json())
      .then(d => setIndustryCats((d.categories || []).join('\n')))
      .catch(() => {})
  }, [fetchWithAuth])
  useEffect(() => { loadIndustryCats() }, [loadIndustryCats])
  const saveIndustryCats = async () => {
    setIndustryCatsSaving(true)
    try {
      const res = await fetchWithAuth('/api/v1/settings/industry-categories', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: industryCats }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: '保存失败' }))
        throw new Error(err.detail || '保存失败')
      }
      showToast('行业分类已保存', 'success')
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error')
    }
    finally { setIndustryCatsSaving(false) }
  }
  useEffect(() => {
    fetch('/api/v1/settings/preferences')
      .then((r) => r.json())
      .then((d) => { if (d.home_page) setHomePage(d.home_page) })
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

  const presets = [
    { name: 'OpenAI', base_url: 'https://api.openai.com/v1' },
    { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1' },
    { name: 'Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { name: 'Anthropic', base_url: 'https://api.anthropic.com/v1' },
    { name: 'MiniMax', base_url: 'https://api.minimaxi.com/v1' },
    { name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1' },
    { name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { name: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
    { name: 'xAI Grok', base_url: 'https://api.x.ai/v1' },
    { name: 'Together', base_url: 'https://api.together.xyz/v1' },
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
                  onClick={() => setActiveTab(tab.key)}
                  className={`whitespace-nowrap transition-all duration-200 group shrink-0
                    max-md:flex max-md:items-center max-md:gap-1.5 max-md:px-3 max-md:py-1.5 max-md:rounded-lg max-md:text-xs
                    md:w-full md:text-left md:px-4 md:py-3 md:rounded-xl
                    ${isActive
                      ? 'bg-accent-blue text-white shadow-lg shadow-blue-500/20'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 md:hover:bg-bg-card border border-transparent md:hover:border-border max-md:bg-bg-card max-md:border-border'
                    }`}
                >
                  <tab.icon size={17} className={`${isActive ? '' : 'text-gray-500 group-hover:text-gray-700 dark:text-gray-300'} max-md:size-[14px]`} />
                  <span className="text-sm md:text-sm font-medium max-md:text-xs">{tab.label}</span>
                  <span className={`hidden md:block text-[10px] leading-tight mt-0.5 ${isActive ? 'text-blue-600 dark:text-blue-200' : 'text-gray-600 group-hover:text-gray-500'}`}>{tab.desc}</span>
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
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium text-gray-900 dark:text-white flex items-center gap-2"><Cpu size={18} className="text-[#3B82F6]" /> 模型供应商</h3>
          {canManageModels && <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-sm hover:bg-accent-blue/85"><Plus size={14} /> 添加供应商</button>}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500"><Loader2 size={20} className="mx-auto animate-spin mb-2" />加载中...</div>
        ) : providers.length === 0 ? (
          <div className="p-8 rounded-xl bg-bg-card border border-dashed border-border text-center">
            <Settings2 size={32} className="mx-auto text-gray-600 mb-3" />
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">尚未配置模型供应商</p>
            <p className="text-gray-600 text-xs mb-4">添加 AI 模型供应商以启用智能整理功能</p>
            <div className="flex flex-wrap justify-center gap-2">
              {presets.map((p) => (
                <button key={p.name} onClick={() => { setForm({ ...form, name: p.name, base_url: p.base_url }); setShowForm(true) }}
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
                <div key={p.id} className="rounded-xl bg-bg-card border border-border overflow-hidden">
                  <div className="p-4 flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</span>
                        <button
                          onClick={() => canManageModels && (isAdmin || p.user_id === user?.id) && handleToggleActive(p)}
                          className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                            p.is_active ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'
                          } ${canManageModels && (isAdmin || p.user_id === user?.id) ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          {p.is_active ? '已启用' : '已停用'}
                        </button>
                        {p.user_id == null && !isAdmin && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-500/10 text-gray-500">共享</span>
                        )}
                        {p.user_id != null && !isAdmin && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400">我的</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1"><Globe size={12} />{p.base_url}</span>
                        {p.api_key && <span className="flex items-center gap-1"><Key size={12} />{p.api_key.slice(0, 6)}...{p.api_key.slice(-4)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      {canManageModels && (isAdmin || p.user_id === user?.id) && (
                        <button onClick={() => openEdit(p)} className="px-2.5 py-1.5 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border">编辑</button>
                      )}
                      {canManageModels && (isAdmin || p.user_id === user?.id) && (
                        <button onClick={() => handleDelete(p.id)} className="px-2 py-1.5 rounded-lg bg-bg-hover text-xs text-red-400 hover:text-red-300 border border-border"><Trash2 size={12} /></button>
                      )}
                    </div>
                  </div>

                  {/* 模型列表 */}
                  <div className="px-4 pb-3">
                    <span className="text-xs text-gray-500">已配置 {(providerModels[p.id] || []).length} 个模型</span>
                    {(providerModels[p.id] || []).length === 0 ? (
                      <p className="text-xs text-gray-600 py-2">暂无模型，点击「添加模型」输入名称</p>
                    ) : (
                      <div className="space-y-1 my-2">
                        {(providerModels[p.id] || []).map((m) => {
                          const tr = testResults[m.id]
                          return (
                            <div key={m.id} className="group flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-input">
                              <span className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate flex-1 min-w-0">{m.model_name}</span>
                              {/* 类型标签 */}
                              <div className="relative shrink-0 w-[52px] flex justify-center" ref={editingTypeModelId === m.id ? typeDropdownRef : undefined}>
                                <button onClick={() => setEditingTypeModelId(editingTypeModelId === m.id ? null : m.id)}
                                  className={`text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer hover:ring-1 hover:ring-white/20 transition-all ${TYPE_COLORS[m.model_type] || TYPE_COLORS.chat}`}>
                                  {TYPE_LABEL[m.model_type] || m.model_type}
                                </button>
                                {editingTypeModelId === m.id && (
                                  <div className="absolute top-full left-0 mt-1 z-40 rounded-lg bg-bg-hover border border-[#3B82F6]/50 shadow-xl overflow-hidden min-w-[72px]">
                                    {MODEL_TYPE_OPTIONS.map((opt) => (
                                      <button key={opt.key} onClick={() => updateModelType(p.id, m.id, opt.key)}
                                        className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-border transition-colors ${m.model_type === opt.key ? 'text-[#3B82F6]' : 'text-gray-400'}`}>
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* 测试按钮 + 删除 */}
                              <div className="flex items-center gap-1 shrink-0 w-[68px] justify-end">
                                {tr && <span className={`text-[10px] truncate max-w-[50px] ${tr.success ? 'text-green-400' : 'text-red-400'}`} title={tr.message}>{tr.success ? (tr.reply ? `"${tr.reply}"` : '✓') : '✗'}</span>}
                                <button onClick={() => testModel(p.id, m.id)} disabled={testingModelId === m.id}
                                  className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[10px] text-gray-500 hover:text-[#10B981] border border-border disabled:opacity-50 shrink-0">
                                  {testingModelId === m.id ? <Loader2 size={10} className="animate-spin" /> : '测试'}
                                </button>
                                <button onClick={() => removeModel(p.id, m.id)}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-600 hover:text-red-400 shrink-0"><Trash2 size={10} /></button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 添加模型 */}
                    {canManageModels && (isAdmin || p.user_id === user?.id) && (
                    <div className="relative">
                      <button onClick={() => {
                        const isOpen = expandedDropdown === p.id
                        setExpandedDropdown(isOpen ? null : p.id); setModelSearch('')
                        // 首次展开时自动拉取模型列表
                        if (!isOpen && availableModels.length === 0 && p.api_key) {
                          handleFetchModels(p.id)
                        }
                      }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-bg-input border border-dashed border-border text-xs text-gray-400 hover:text-white hover:border-[#3B82F6]/50">
                        <Plus size={12} /> 添加模型 <ChevronDown size={12} className={expandedDropdown === p.id ? 'rotate-180' : ''} />
                      </button>
                      {expandedDropdown === p.id && (
                        <div ref={addModelDropdownRef} className="absolute z-30 mt-1 w-full max-h-64 rounded-lg bg-bg-card border border-border shadow-xl overflow-hidden">
                          <div className="p-2 border-b border-border">
                            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-bg-input border border-border">
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
                                    addModel(p.id, modelSearch.trim()); setModelSearch(''); setExpandedDropdown(null)
                                  }
                                }} />
                            </div>
                          </div>
                          <div className="overflow-y-auto max-h-40">
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
                                <button key={m.id} onClick={() => { addModel(p.id, m.id); setModelSearch(''); setExpandedDropdown(null) }}
                                  className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-bg-hover flex items-center gap-2">
                                  <span className="text-[10px] text-[#3B82F6]">+</span>
                                  <span className="font-mono truncate">{m.id}</span>
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

      {/* 任务模型配置 */}
      <div>
        <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Sparkles size={18} className="text-[#F59E0B]" /> 任务模型配置</h3>
        <p className="text-xs text-gray-500 mb-4 dark:text-gray-400">为不同 AI 任务指定使用的模型供应商和具体模型</p>
        {getActiveProviders().length === 0 ? (
          <div className="p-6 rounded-xl bg-bg-card border border-dashed border-border text-center">
            <Settings2 size={24} className="mx-auto text-gray-600 mb-2" /><p className="text-xs text-gray-500">请先添加并启用至少一个模型供应商</p>
          </div>
        ) : (
          <div className="space-y-3">
            {TASK_TYPES.map((task) => {
              // 联网搜索独立处理（不通过供应商选择模型）
              if (task.key === 'web_search') return null
              const cfg = taskConfigs[task.key]
              const spId = cfg?.provider_id
              const sp = spId ? providers.find((p) => p.id === spId) : null
              const models = (providerModels[spId || 0] || []).map((m) => m.model_name)
              return (
                <div key={task.key} className="p-3.5 max-md:p-3 rounded-xl bg-bg-card border border-border">
                  <div className="flex items-start gap-2.5 max-md:gap-2">
                    <task.icon size={20} className="text-[#F59E0B] mt-0.5 shrink-0 max-md:size-[16px]" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap"><span className="text-sm font-medium text-gray-900 dark:text-white max-md:text-xs">{task.label}</span><span className="text-xs text-gray-500 dark:text-gray-600 max-md:hidden">{task.desc}</span></div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
                        <select value={spId || ''} onChange={(e) => saveTaskConfig(task.key, e.target.value ? Number(e.target.value) : null, '')}
                          className="px-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] sm:min-w-[140px]">
                          <option value="">选择供应商</option>
                          {getActiveProviders().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {sp && models.length > 0 && (
                          <select value={cfg?.model_name || ''} onChange={(e) => saveTaskConfig(task.key, spId, e.target.value)}
                            className="px-3 py-1.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] sm:min-w-[200px]">
                            <option value="">选择模型</option>
                            {models.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        )}
                        {cfg?.model_name && <span className="text-xs text-[#10B981]">{cfg.provider_name ? `${cfg.provider_name} / ` : ''}{cfg.model_name}</span>}
                        {taskSaving === task.key && <Loader2 size={14} className="animate-spin text-gray-400" />}
                      </div>
                    </div>
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
        <p className="text-xs text-gray-500 mb-4 dark:text-gray-400">配置 Tavily Search API 以启用 AI 联网搜索能力（获取客户信息、行业动态等）</p>
        <div className="p-4 rounded-xl bg-bg-card border border-border max-w-lg">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={15} className="text-emerald-400" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">Tavily Search</span>
            <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-500 hover:text-[#3B82F6] ml-auto">获取 API Key →</a>
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
        <p className="text-xs text-gray-500 mb-4 dark:text-gray-400">自定义各 AI 任务的 System Prompt 和用户消息模板，让 AI 输出更符合你的预期。使用 <code className="px-1.5 py-0.5 rounded bg-bg-input text-[10px] text-[#8B5CF6]">{'{变量名}'}</code> 表示动态内容占位。</p>
        {Object.keys(aiPrompts).length === 0 ? (
          <div className="p-6 rounded-xl bg-bg-card border border-dashed border-border text-center">
            <Loader2 size={20} className="mx-auto animate-spin text-gray-500 mb-2" />
            <p className="text-xs text-gray-500">加载提示词配置中...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(aiPrompts).map(([taskType, prompt]) => {
              const isEditing = editingPrompt === taskType
              return (
                <div key={taskType} className="p-3.5 max-md:p-3 rounded-xl bg-bg-card border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-gray-900 dark:text-white max-md:text-xs">{prompt.label}</span>
                        {prompt.customized && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#A78BFA]">已自定义</span>}
                      </div>
                      <p className="text-xs text-gray-500 mb-1 max-md:hidden">{prompt.desc}</p>
                      <p className="text-[10px] text-gray-600">变量: {prompt.variables?.join(', ') || '无'}</p>
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
                          title="恢复默认"
                        >
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 编辑面板 */}
                  {isEditing && (
                    <div className="mt-4 space-y-3 border-t border-border pt-4">
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
                          <span className="text-[10px] text-gray-500">描述需求，AI 自动生成规范提示词</span>
                        </div>
                        <textarea
                          value={aiReq}
                          onChange={(e) => setAiReq(e.target.value)}
                          placeholder="例如：请帮我写一个日报总结提示词，要突出每日的技术突破和工作亮点，语气积极向上，每条总结控制在100字以内"
                          className="w-full h-16 p-2.5 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-[#8B5CF6] resize-none leading-relaxed placeholder-gray-600"
                        />
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-gray-600">{aiReq.length} 字</span>
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

      {/* ==================== 系统配置 ==================== */}
      {activeTab === 'system' && (
        <>

      {/* 品牌自定义 */}
      {isAdmin && (
        <div className="mb-10 p-5 rounded-xl bg-bg-card border border-border">
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
                  <p className="text-[10px] text-gray-600 mt-0.5">PNG、JPEG、GIF、WebP、SVG、ICO，最大 2MB</p>
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
              <p className="text-[10px] text-gray-600 mt-1.5">将在侧边栏顶部和浏览器标签页显示</p>
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
                      headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
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
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
                    body: JSON.stringify({ site_title: branding.site_title, logo_url: logoUrl }),
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
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {brandSaving && <Loader2 size={14} className="animate-spin" />}
              <Save size={14} />{brandSaving ? '保存中...' : '保存品牌设置'}
            </button>
            <button
              onClick={() => { setBranding({ logo_url: '', site_title: 'WorkTrack' }); setBrandLogoFile(null); setBrandLogoPreview('') }
              }
              className="px-4 py-2 rounded-lg bg-bg-hover text-xs text-gray-400 hover:text-white border border-border transition-colors"
            >
              恢复默认
            </button>
          </div>
        </div>
      )}

      {/* MCP 对外服务 */}
      {isAdmin && (
        <div className="mb-10 p-5 rounded-xl bg-bg-card border border-border">
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
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
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
              <span className="text-[10px] text-gray-600">
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
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
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
            <p className="text-[10px] text-gray-600 mt-1.5">
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
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` },
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
                  <p className="text-[10px] text-gray-600 mt-1">保存到 claude_desktop_config.json，重启 Claude Desktop</p>
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
                        <p className="text-[10px] text-[#8B5CF6] font-medium">{g.cat}</p>
                        <p className="text-[9px] text-gray-500">{g.tools}</p>
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
                        <p className={`text-[10px] ${isActive ? 'text-gray-500' : 'text-gray-400 dark:text-gray-500'}`}>{count} 个选项</p>
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
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-bg-input px-2 py-0.5 rounded-full">
                    {fieldOptions.filter((o) => o.category === selectedCategory).length} 项
                  </span>
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">每行一个，空行自动忽略</span>
              </div>
              <div className="p-4">
                <textarea
                  value={editingOptions}
                  onChange={(e) => setEditingOptions(e.target.value)}
                  className="w-full h-52 p-4 rounded-lg bg-bg-input border border-border text-sm text-gray-800 dark:text-gray-300 outline-none focus:border-[#3B82F6] resize-none placeholder-gray-400 dark:placeholder-gray-600 font-mono leading-relaxed transition-colors"
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
                <span className="text-[10px] text-gray-400 dark:text-gray-500">修改后即刻生效</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 行业标准化分类 */}
      <div className="mt-6">
        <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Building2 size={18} className="text-[#3B82F6]" /> 行业标准化分类</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">获取客户信息时，AI 会将公司自动归类到以下标准行业之一。每行一个行业名称，用换行分隔。</p>
        <div className="p-4 rounded-xl bg-bg-card border border-border">
          <textarea
            value={industryCats}
            onChange={(e) => setIndustryCats(e.target.value)}
            className="w-full h-48 p-4 rounded-lg bg-bg-input border border-border text-sm text-gray-800 dark:text-gray-300 outline-none focus:border-[#3B82F6] resize-none placeholder-gray-400 dark:placeholder-gray-600 font-mono leading-relaxed transition-colors"
            placeholder="每行一个行业分类名称..."
          />
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={saveIndustryCats}
              disabled={industryCatsSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-all shadow-lg shadow-blue-500/20"
            >
              {industryCatsSaving && <Loader2 size={14} className="animate-spin" />}
              <Save size={14} />{industryCatsSaving ? '保存中…' : '保存行业分类'}
            </button>
            <p className="text-[10px] text-gray-500 dark:text-gray-600">修改后，新获取的客户信息将按此分类映射</p>
          </div>
        </div>
      </div>
      </>
      )}

      {/* ==================== 个人账户 ==================== */}
      {activeTab === 'account' && (
        <>
          {/* 个人信息 */}
          <div className="mb-10">
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <User size={18} className="text-accent-blue" /> 个人信息
            </h3>
            <div className="p-5 rounded-xl bg-bg-card border border-border">
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
                        if(user) user.avatar = data.avatar_url
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
                  <p className="text-[10px] text-gray-600 mt-1">用户名不可修改</p>
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
                <button
                  onClick={async () => {
                    setAccountMsg(null)
                    setProfileSaving(true)
                    try {
                      const res = await fetchWithAuth('/api/v1/auth/me', {
                        method: 'PUT',
                        body: JSON.stringify({ name: profileName, email: profileEmail || null }),
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
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm hover:bg-accent-blue/85 disabled:opacity-50"
                >
                  {profileSaving && <Loader2 size={14} className="animate-spin" />}
                  <Save size={14} />{profileSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>

          {/* 首页设置 */}
          <div className="mb-10">
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Home size={18} className="text-[#F59E0B]" /> 首页设置
            </h3>
            <p className="text-xs text-gray-500 mb-4">选择打开平台时的默认首页，每位用户可以独立设置</p>
            <div className="p-5 rounded-xl bg-bg-card border border-border">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <span className="text-sm text-gray-400">默认首页:</span>
                <select
                  value={homePage}
                  onChange={(e) => setHomePage(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6]"
                >
                  <option value="/reports">日报周报</option>
                  <option value="/projects">项目管理</option>
                  <option value="/meetings">会议纪要</option>
                  <option value="/dashboard">数据看板</option>
                  <option value="/ai">AI 中心</option>
                  <option value="/customers">客户管理</option>
                </select>
                <button
                  onClick={handleSaveHomePage}
                  disabled={homePageSaving}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm hover:bg-accent-blue/85 disabled:opacity-50 sm:w-auto"
                >
                  {homePageSaving && <Loader2 size={14} className="animate-spin" />}
                  {homePageSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>

          {/* 修改密码 */}
          <div>
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Key size={18} className="text-amber-400" /> 修改密码
            </h3>
            <div className="p-5 rounded-xl bg-bg-card border border-border">
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
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                >
                  {passwordSaving && <Loader2 size={14} className="animate-spin" />}
                  <Key size={14} />{passwordSaving ? '修改中...' : '修改密码'}
                </button>
                <p className="text-[10px] text-gray-600">修改密码后所有设备上的登录状态将失效，需要重新登录。</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================== 关于 ==================== */}
      {activeTab === 'about' && (
        <>
      
      {/* 系统状态 */}
      <div>
        <h3 className="text-base font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Server size={18} className="text-gray-400" /> 系统信息</h3>
        <div className="p-4 rounded-xl bg-bg-card border border-border space-y-2">
          {systemInfo ? (
            <>
              <div className="flex justify-between text-sm"><span className="text-gray-500">数据库</span><span className="text-gray-700 dark:text-gray-300">{systemInfo.database_type || '未知'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">数据库地址</span><span className="text-gray-700 dark:text-gray-300 font-mono text-xs">{systemInfo.database_url || '-'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">向量存储</span><span className="text-gray-700 dark:text-gray-300">{systemInfo.vector_store || 'ChromaDB'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">向量存储大小</span><span className="text-gray-700 dark:text-gray-300">{systemInfo.vector_store_size || '-'}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">已配置供应商</span><span className="text-gray-700 dark:text-gray-300">{systemInfo.total_providers || '0'} 个</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">启用供应商</span><span className="text-gray-700 dark:text-gray-300">{systemInfo.active_providers || '0'} 个</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">用户总数</span><span className="text-gray-700 dark:text-gray-300">{systemInfo.total_users || '0'} 人（管理员 {systemInfo.admin_users || '0'} 人）</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">服务运行时间</span><span className="text-gray-700 dark:text-gray-300">{systemInfo.uptime || '-'}</span></div>
            </>
          ) : (
            <div className="text-center py-4 text-gray-500 text-sm">加载中...</div>
          )}
        </div>
      </div>
      </>
      )}

      {/* 弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-bg-card rounded-t-2xl flex items-center justify-between px-5 py-4 border-b border-border z-10">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">{editingProvider ? '编辑供应商' : '添加模型供应商'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-bg-hover text-gray-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="p-5">
              {!editingProvider && (
                <>
                  <p className="text-xs text-gray-500 mb-3">选择预置供应商自动填充，或手动填写下方信息</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
                    {presets.map((p) => (
                      <button key={p.name} onClick={() => setForm({ ...form, name: p.name, base_url: p.base_url })}
                        className="px-2 py-2 rounded-lg bg-bg-input border border-border text-xs text-gray-400 hover:text-white hover:border-[#3B82F6]/50 hover:bg-bg-hover transition-all truncate">
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] text-gray-600 shrink-0">或手动填写</span>
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
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">API 端点 <span className="text-red-400">*</span></label>
                  <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="https://api.deepseek.com/v1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">API Key</label>
                  <input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} type="password"
                    className="w-full px-3 py-2.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-300 outline-none focus:border-[#3B82F6] transition-colors font-mono" placeholder="sk-..." />
                </div>
              </div>
              <button onClick={handleSave} disabled={saving || !form.name.trim() || !form.base_url.trim()}
                className="w-full mt-6 py-2.5 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {saving && <Loader2 size={16} className="animate-spin" />}<Save size={16} />{saving ? '保存中...' : '保存'}
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
