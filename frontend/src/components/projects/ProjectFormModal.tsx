import { useEffect, useState, useMemo, useCallback } from 'react'
import { X, Briefcase, DollarSign, Cloud, FileText, Calendar, ChevronDown, Activity, Wrench, Cpu, ScrollText } from 'lucide-react'
import { useProjectFormOptions, getCurrencyMeta, CURRENCY_OPTIONS } from '../../hooks/useProjectFormOptions'
import { useAuth } from '../../contexts/AuthContext'
import { CustomerCombobox } from './CustomerCombobox'
import SearchableSelect from '../SearchableSelect'
import FileUpload from '../FileUpload'
import { ErrorBoundary } from '../ErrorBoundary'
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard'
import { useUsersSimpleQuery } from '../../hooks/useUserManagementQueries'

function UnitToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-border/60 shrink-0 text-xs">
      {(['万元', '元'] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={`px-2.5 py-2 transition-colors ${value === u ? 'bg-accent-blue text-white' : 'bg-white dark:bg-bg-input text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-bg-hover'}`}
        >{u}</button>
      ))}
    </div>
  )
}

const MCV_UNITS = ['万 tokens/月', '百万 tokens/月', '亿 tokens/月', '万次/月', '百万次/月', 'QPS（并发峰值）', '自定义']
function parseMcv(raw: string): { num: string; unit: string } {
  if (!raw) return { num: '', unit: '万 tokens/月' }
  for (const u of MCV_UNITS) {
    if (raw.endsWith(u)) return { num: raw.slice(0, -u.length).trim(), unit: u }
  }
  return { num: raw, unit: '自定义' }
}

export interface ProjectFormState {
  name: string
  customer: { id: number; name: string } | null
  start_date: string
  termination_date: string
  currency: string
  opportunity_amount: string
  opportunity_amount_unit: string
  deal_amount: string
  deal_amount_unit: string
  selectedClouds: string[]
  selectedUpstreamChannels: string[]
  selectedModels: string[]
  project_scenario: string
  usage_scenario: string
  sales_person: string
  tech_support_person: string
  tech_support_user_id: number | null
  status: string
  monthly_call_volume_num: string
  monthly_call_volume_unit: string
  selectedMeetingIds: number[]
  selectedContractIds: number[]
  progress: string
  files_json: string | null
}

const STATUS_DEFAULT = '进行中'

const initialState: ProjectFormState = {
  name: '',
  customer: null,
  start_date: '',
  termination_date: '',
  currency: 'CNY',
  opportunity_amount: '',
  opportunity_amount_unit: '万元',
  deal_amount: '',
  deal_amount_unit: '万元',
  selectedClouds: [],
  selectedUpstreamChannels: [],
  selectedModels: [],
  project_scenario: '',
  usage_scenario: '',
  sales_person: '',
  tech_support_person: '',
  tech_support_user_id: null,
  status: STATUS_DEFAULT,
  monthly_call_volume_num: '',
  monthly_call_volume_unit: '万 tokens/月',
  selectedMeetingIds: [],
  selectedContractIds: [],
  progress: '',
  files_json: null,
}

interface ProjectFormModalProps {
  isOpen: boolean
  onClose: () => void
  editingProject: any | null
  onSubmit: (body: any) => Promise<void> | void
  isSubmitting?: boolean
}

export function ProjectFormModal({ isOpen, onClose, editingProject, onSubmit, isSubmitting }: ProjectFormModalProps) {
  const { customers, options, channels, modelCatalog, modelCatalogRefreshedAt, meetings, contracts, loading } = useProjectFormOptions()
  const { user } = useAuth()
  const { data: allUsers = [] } = useUsersSimpleQuery()
  const [form, setForm] = useState<ProjectFormState>(initialState)
  const [formInitial, setFormInitial] = useState<string>('')
  const [activeSection, setActiveSection] = useState<string>('basic')
  const [showCustomScenario, setShowCustomScenario] = useState(false)

  // 检测表单是否被修改
  const isDirty = isOpen && JSON.stringify(form) !== formInitial
  const { requestClose: requestCloseGuard, Dialog: UnsavedDialog } = useUnsavedGuard(isDirty)
  // 安全关闭：未修改直接关，有修改弹确认
  const safeClose = useCallback(async () => {
    if (await requestCloseGuard()) onClose()
  }, [requestCloseGuard, onClose])

  useEffect(() => {
    if (!isOpen) return
    if (editingProject) {
      const mcv = parseMcv(editingProject.monthly_call_volume || '')
      const linkedContractIds = contracts
        .filter(c => c.project_id === editingProject.id)
        .map(c => c.id)
      const initial: ProjectFormState = {
        name: editingProject.name || '',
        customer: { id: editingProject.customer_id || 0, name: editingProject.customer_name || '' },
        start_date: editingProject.start_date || '',
        termination_date: editingProject.termination_date || '',
        currency: editingProject.currency || 'CNY',
        opportunity_amount: editingProject.opportunity_amount?.toString() || '',
        opportunity_amount_unit: (editingProject as any).opportunity_amount_unit || '万元',
        deal_amount: editingProject.deal_amount?.toString() || '',
        deal_amount_unit: (editingProject as any).deal_amount_unit || '万元',
        selectedClouds: editingProject.cloud_provider ? editingProject.cloud_provider.split(',').filter(Boolean) : [],
        selectedUpstreamChannels: editingProject.upstream_channels ? editingProject.upstream_channels.split(',').filter(Boolean) : [],
        selectedModels: editingProject.models ? editingProject.models.split(',').filter(Boolean) : [],
        project_scenario: editingProject.project_scenario || '',
        usage_scenario: editingProject.usage_scenario || '',
        sales_person: editingProject.sales_person || '',
        tech_support_person: editingProject.tech_support_person || '',
        tech_support_user_id: editingProject.tech_support_user_id ?? null,
        status: editingProject.status || STATUS_DEFAULT,
        monthly_call_volume_num: mcv.num,
        monthly_call_volume_unit: mcv.unit,
        selectedMeetingIds: editingProject.meeting_ids || [],
        selectedContractIds: linkedContractIds,
        progress: editingProject.progress || '',
        files_json: editingProject.files_json || null,
      }
      setForm(initial)
      setFormInitial(JSON.stringify(initial))
      setShowCustomScenario(!!editingProject.project_scenario && !options.project_scenario.includes(editingProject.project_scenario))
    } else {
      const newInitial = { ...initialState, sales_person: user?.name || '' }
      setForm(newInitial)
      setFormInitial(JSON.stringify(newInitial))
      setShowCustomScenario(false)
    }
  }, [isOpen, editingProject, options.project_scenario, contracts, user])

  // 上游通道 → 模型建议（基于模型目录，仅作为提示，不自动写入表单，避免覆盖用户编辑意图）
  // 用户仍可手动选择或自定义模型名
  const suggestedModelsByChannels = useMemo(() => {
    if (channels.length === 0 || modelCatalog.length === 0) return []
    const seen = new Set<string>()
    const out: string[] = []
    form.selectedUpstreamChannels.forEach((name) => {
      const ch = channels.find((c) => c.name === name)
      if (!ch?.model_type) return
      // 命中模型目录里同 provider 的项，id 用 m.name（与 SearchableSelect option id 一致）
      modelCatalog
        .filter((m) => m.provider && ch.supplier_name && m.provider.toLowerCase() === ch.supplier_name.toLowerCase())
        .forEach((m) => {
          if (!seen.has(m.name)) {
            seen.add(m.name)
            out.push(m.name)
          }
        })
      // 没命中目录时降级到 model_type（兼容历史数据）
      if (!seen.has(ch.model_type)) {
        seen.add(ch.model_type)
        out.push(ch.model_type)
      }
    })
    return out
  }, [form.selectedUpstreamChannels, channels, modelCatalog])

  const currency = useMemo(() => getCurrencyMeta(form.currency), [form.currency])

  const updateField = useCallback(<K extends keyof ProjectFormState>(key: K, value: ProjectFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = async () => {
    if (!form.name.trim()) { return }
    const mcvRaw = form.monthly_call_volume_num.trim()
      ? `${form.monthly_call_volume_num.trim()} ${form.monthly_call_volume_unit}`
      : null
    const body: any = {
      name: form.name.trim(),
      customer_id: form.customer?.id || null,
      customer_name: form.customer?.name || '',
      start_date: form.start_date || null,
      termination_date: form.termination_date || null,
      currency: form.currency,
      opportunity_amount: form.opportunity_amount ? parseFloat(form.opportunity_amount) : null,
      opportunity_amount_unit: form.opportunity_amount_unit,
      deal_amount: form.deal_amount ? parseFloat(form.deal_amount) : null,
      deal_amount_unit: form.deal_amount_unit,
      cloud_provider: form.selectedClouds.join(',') || null,
      upstream_channels: form.selectedUpstreamChannels.join(',') || null,
      models: form.selectedModels.join(',') || null,
      project_scenario: form.project_scenario || null,
      usage_scenario: form.usage_scenario || null,
      sales_person: form.sales_person || null,
      tech_support_person: form.tech_support_person || null,
      tech_support_user_id: form.tech_support_user_id,
      status: form.status,
      monthly_call_volume: mcvRaw,
      progress: form.progress || null,
      files_json: form.files_json,
      meeting_ids: form.selectedMeetingIds,
      contract_ids: form.selectedContractIds,
    }
    await onSubmit(body)
  }

  if (!isOpen) return null

  const sections = [
    { id: 'basic', title: '项目概况', icon: Briefcase, desc: '名称 · 客户 · 时间' },
    { id: 'business', title: '商务 & 团队', icon: DollarSign, desc: '金额 · 币种 · 销售 · 状态' },
    { id: 'maas', title: 'MaaS 配置', icon: Cpu, desc: '通道 · 模型 · 场景 · 调用量 · 技术能力' },
    { id: 'relation', title: '协作 & 附件', icon: FileText, desc: '合同 · 会议 · 进展 · 附件' },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4 max-md:px-0 animate-fadeIn" onClick={safeClose}>
      <div
        className="bg-bg-card rounded-2xl max-md:rounded-none w-full max-w-4xl max-md:max-w-full max-md:h-full max-md:overflow-y-auto border border-gray-200 dark:border-border/40 shadow-2xl flex flex-col max-h-[92vh] animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-border/20 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {editingProject ? '编辑项目' : '新建项目'}
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {editingProject ? '修改项目信息并保存' : '填写项目完整信息，所有字段后续可编辑'}
            </p>
          </div>
          <button onClick={safeClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-bg-hover transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr]">
            {/* 左侧分节导航 */}
            <nav className="md:border-r border-gray-100 dark:border-border/20 bg-gray-50/40 dark:bg-bg-hover/5 md:py-4 md:px-3 max-md:px-4 max-md:py-3 max-md:border-b">
              <div className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-x-visible">
                {sections.map(s => {
                  const Icon = s.icon
                  const active = activeSection === s.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActiveSection(s.id)}
                      className={`shrink-0 md:w-full flex md:flex-col items-center md:items-start gap-2 md:gap-1 px-3 py-2 md:py-2.5 rounded-lg text-left transition-all ${
                        active
                          ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-bg-hover/40 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={14} className="shrink-0" />
                        <span className="text-xs font-bold whitespace-nowrap">{s.title}</span>
                      </div>
                      <span className="hidden md:block text-[11px] text-gray-400 dark:text-gray-500 ml-6">{s.desc}</span>
                    </button>
                  )
                })}
              </div>
              {loading && (
                <div className="hidden md:flex items-center gap-1.5 mt-4 px-2 text-[11px] text-gray-400">
                  <div className="w-2 h-2 bg-accent-blue rounded-full animate-pulse" />
                  正在加载选项…
                </div>
              )}
            </nav>

            {/* 右侧分节内容 */}
            <div className="px-6 py-5 space-y-6 max-md:px-4">
              {activeSection === 'basic' && (
                <Section icon={Briefcase} title="项目概况" desc="项目名称、客户、生效与终止时间">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="项目名称" required colSpan={2}>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        placeholder="如：XX 银行智能客服大模型 API 集成"
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                      />
                    </FormField>

                    <FormField label="客户名称" colSpan={2} hint="可从已有客户搜索或手动输入新客户">
                      <CustomerCombobox
                        value={form.customer}
                        onChange={(v) => updateField('customer', v)}
                        options={customers}
                      />
                    </FormField>

                    <FormField label="开始时间" icon={Calendar}>
                      <input
                        type="date"
                        value={form.start_date}
                        onChange={(e) => updateField('start_date', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                      />
                    </FormField>

                    <FormField label="终止时间" icon={Calendar}>
                      <input
                        type="date"
                        value={form.termination_date}
                        onChange={(e) => updateField('termination_date', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                      />
                    </FormField>
                  </div>
                </Section>
              )}

              {activeSection === 'business' && (
                <Section icon={DollarSign} title="商务 & 团队" desc="币种、商机与成交金额、销售与技术支持、项目状态">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="币种">
                      <CurrencySelector value={form.currency} onChange={(v) => updateField('currency', v)} />
                    </FormField>

                    <FormField label="商机金额">
                      <div className="flex gap-2">
                        <AmountInput value={form.opportunity_amount} onChange={(v) => updateField('opportunity_amount', v)} currency={currency} />
                        <UnitToggle value={form.opportunity_amount_unit} onChange={(v) => updateField('opportunity_amount_unit', v)} />
                      </div>
                    </FormField>

                    <FormField label="成交价格">
                      <div className="flex gap-2">
                        <AmountInput value={form.deal_amount} onChange={(v) => updateField('deal_amount', v)} currency={currency} />
                        <UnitToggle value={form.deal_amount_unit} onChange={(v) => updateField('deal_amount_unit', v)} />
                      </div>
                    </FormField>

                    <FormField label="销售负责人" icon={Briefcase}>
                      {options.sales_person.length > 0 ? (
                        <SearchableSelect
                          options={[{ id: '', label: '不指定' }, ...options.sales_person.map(s => ({ id: s, label: s }))]}
                          value={form.sales_person}
                          onChange={(v) => updateField('sales_person', v === '' || v === 0 ? '' : String(v))}
                          placeholder="选择销售负责人"
                          clearValue=""
                        />
                      ) : (
                        <input
                          type="text"
                          value={form.sales_person}
                          onChange={(e) => updateField('sales_person', e.target.value)}
                          placeholder="输入销售姓名"
                          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                        />
                      )}
                    </FormField>

                    <FormField label="技术支持" icon={Wrench} hint="负责项目交付、问题排查">
                      <SearchableSelect
                        options={[
                          { id: 0, label: '不指定' },
                          ...allUsers.map(u => ({ id: u.id, label: u.name || u.username }))
                        ]}
                        value={form.tech_support_user_id ?? 0}
                        onChange={(v) => {
                          const uid = v === 0 || v === '' ? null : Number(v)
                          const uname = uid ? (allUsers.find(u => u.id === uid)?.name || '') : ''
                          setForm(prev => ({ ...prev, tech_support_user_id: uid, tech_support_person: uname }))
                        }}
                        placeholder="选择技术支持人员"
                        clearValue={0}
                      />
                    </FormField>

                    <FormField label="项目状态">
                      <SearchableSelect
                        options={[
                          { id: '', label: '未设置' },
                          ...(options.project_status.length > 0 ? options.project_status : [STATUS_DEFAULT, '已签约', '已暂停', '已结束', '已流失']).map(s => ({ id: s, label: s }))
                        ]}
                        value={form.status}
                        onChange={(v) => updateField('status', v === '' || v === 0 ? '' : String(v))}
                        placeholder="选择项目状态"
                        clearValue=""
                      />
                    </FormField>
                  </div>
                </Section>
              )}

              {activeSection === 'maas' && (
                <Section icon={Cpu} title="MaaS 配置" desc="上游供应商通道、模型、场景、调用量、客户技术能力">
                  <ErrorBoundary sectionName="MaaS 配置">
                    <div className="space-y-4">
                    <FormField label="上游供应商通道" hint="来自「业务管理 → 通道管理」合作中的通道（多选）" icon={Cloud}>
                      {channels.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-bg-input/30 px-3 py-4 text-center">
                          <p className="text-xs text-gray-500">尚未配置任何通道。请先到
                            <span className="mx-1 text-accent-blue font-semibold">业务管理 → 通道管理</span>
                            添加合作中的通道。
                          </p>
                        </div>
                      ) : (
                        <ChannelChips
                          options={channels.map(c => c.name)}
                          selected={form.selectedUpstreamChannels}
                          onChange={(v) => updateField('selectedUpstreamChannels', v)}
                          formatLabel={(name) => {
                            const ch = channels.find(c => c.name === name)
                            return ch?.supplier_name ? `${ch.name} · ${ch.supplier_name}` : name
                          }}
                        />
                      )}
                    </FormField>

                    <FormField
                      label="使用模型"
                      hint={
                        modelCatalogRefreshedAt
                          ? `来自模型目录（更新于 ${new Date(modelCatalogRefreshedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）`
                          : '来自「业务管理 → 模型管理」，选填'
                      }
                      icon={Activity}
                    >
                      {modelCatalog.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-bg-input/30 px-3 py-4 text-center">
                          <p className="text-xs text-gray-500">
                            尚未配置任何模型。请先到
                            <span className="mx-1 text-accent-blue font-semibold">业务管理 → 模型管理</span>
                            触发自动采集。
                          </p>
                        </div>
                      ) : (
                        <SearchableSelect
                          multiple
                          options={(() => {
                            const seen = new Set<string>()
                            return modelCatalog
                              .filter(m => { if (seen.has(m.name)) return false; seen.add(m.name); return true })
                              .map(m => ({ id: m.name, label: m.name, sub: m.provider || undefined }))
                          })()}
                          value={form.selectedModels}
                          onChange={(v) => updateField('selectedModels', v as string[])}
                          placeholder="搜索并选择模型…"
                        />
                      )}
                      {suggestedModelsByChannels.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <span className="text-[11px] text-gray-400">基于所选通道推荐：</span>
                          {suggestedModelsByChannels.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                if (!form.selectedModels.includes(s)) {
                                  updateField('selectedModels', [...form.selectedModels, s])
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent-blue/10 text-accent-blue text-[11px] font-semibold hover:bg-accent-blue/20 transition-colors"
                              title="点击加入已选"
                            >
                              + {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </FormField>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField label="项目场景" hint="AI 应用场景分类">
                        <>
                          <SearchableSelect
                            options={[
                              { id: '', label: '不指定' },
                              ...options.project_scenario.map(s => ({ id: s, label: s })),
                              { id: '__custom__', label: '— 自定义 —' },
                            ]}
                            value={showCustomScenario ? '__custom__' : form.project_scenario}
                            onChange={(v) => {
                              if (v === '__custom__') {
                                setShowCustomScenario(true)
                                updateField('project_scenario', '')
                              } else {
                                setShowCustomScenario(false)
                                updateField('project_scenario', v === 0 ? '' : String(v))
                              }
                            }}
                            placeholder="选择 AI 应用场景"
                            clearValue=""
                          />
                          {showCustomScenario && (
                            <input
                              type="text"
                              value={form.project_scenario}
                              onChange={(e) => updateField('project_scenario', e.target.value)}
                              placeholder="输入自定义场景"
                              className="mt-1.5 w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                            />
                          )}
                        </>
                      </FormField>

                      <FormField label="预计月调用量" icon={Activity}>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={form.monthly_call_volume_num}
                            onChange={(e) => updateField('monthly_call_volume_num', e.target.value)}
                            placeholder="数值"
                            className="w-24 shrink-0 px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                          />
                          <SearchableSelect
                            className="flex-1"
                            options={MCV_UNITS.map(u => ({ id: u, label: u }))}
                            value={form.monthly_call_volume_unit}
                            onChange={(v) => updateField('monthly_call_volume_unit', v === 0 || v === '' ? '万 tokens/月' : String(v))}
                            clearValue="万 tokens/月"
                          />
                        </div>
                      </FormField>
                    </div>

                    <FormField label="项目背景与需求" hint="客户的业务诉求、技术约束与关键指标（自由文本）">
                      <textarea
                        value={form.usage_scenario}
                        onChange={(e) => updateField('usage_scenario', e.target.value)}
                        rows={3}
                        placeholder="如：客户为某银行，需构建智能客服系统，涉及多轮对话、知识库检索、意图识别等功能，要求延迟 < 500ms，月活 100 万"
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all resize-none"
                      />
                    </FormField>

                    <FormField label="客户技术能力" hint="客户已具备的 AI 基础设施与技术条件（多选）" icon={Cpu}>
                      <ChannelChips
                        options={options.cloud}
                        selected={form.selectedClouds}
                        onChange={(v) => updateField('selectedClouds', v)}
                      />
                    </FormField>
                    </div>
                  </ErrorBoundary>
                </Section>
              )}

              {activeSection === 'relation' && (
                <Section icon={FileText} title="协作 & 附件" desc="关联合同、关联会议、进展记录、附件">
                  <div className="space-y-4">
                    <FormField label="关联合同" hint="将已有合同与本项目关联（多选）" icon={ScrollText}>
                      <SearchableSelect
                        multiple
                        options={contracts
                          .filter(c => c.project_id == null || c.project_id === editingProject?.id)
                          .map(c => ({ id: c.id, label: c.title, sub: c.sign_date || '' }))}
                        value={form.selectedContractIds}
                        onChange={(v) => updateField('selectedContractIds', v as number[])}
                        placeholder="搜索并选择合同"
                      />
                    </FormField>

                    <FormField label="关联会议" hint="可关联多个相关会议纪要" icon={FileText}>
                      <SearchableSelect
                        multiple
                        options={meetings.map(m => ({ id: m.id, label: m.title, sub: m.date }))}
                        value={form.selectedMeetingIds}
                        onChange={(v) => updateField('selectedMeetingIds', v as number[])}
                        placeholder="搜索并选择相关会议"
                      />
                    </FormField>

                    <FormField label="进展记录" hint="简要记录项目当前进展">
                      <textarea
                        value={form.progress}
                        onChange={(e) => updateField('progress', e.target.value)}
                        rows={4}
                        placeholder="如：已完成 POC 测试，进入商务谈判阶段…"
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all resize-none"
                      />
                    </FormField>

                    <FormField label="附件" hint="支持拖拽、点击、粘贴；合同、报价单等">
                      <FileUpload
                        value={form.files_json}
                        onChange={(v) => updateField('files_json', v)}
                      />
                    </FormField>
                  </div>
                </Section>
              )}
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t border-gray-100 dark:border-border/20 bg-gray-50/50 dark:bg-bg-hover/5 shrink-0 max-md:px-4">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {form.name ? <span className="font-semibold text-gray-700 dark:text-gray-300">「{form.name}」</span> : '尚未填写项目名称'}
            {form.customer && <span> · 客户：{form.customer.name}</span>}
            {form.deal_amount && <span> · {currency.symbol} {form.deal_amount} {form.deal_amount_unit}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={safeClose}
              className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-border/30 rounded-lg font-semibold transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!form.name.trim() || isSubmitting}
              className="px-5 py-2 text-xs bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold transition-colors flex items-center gap-1.5"
            >
              {isSubmitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {editingProject ? '保存修改' : '创建项目'}
            </button>
          </div>
        </div>
      </div>
      {UnsavedDialog}
    </div>
  )
}

// ====== 内部子组件 ======

function Section({ icon: Icon, title, desc, children }: { icon: any; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 pb-3 border-b border-gray-100 dark:border-border/20">
        <div className="w-8 h-8 rounded-lg bg-accent-blue/10 text-accent-blue flex items-center justify-center shrink-0">
          <Icon size={16} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function FormField({ label, required, colSpan, hint, icon: Icon, children }: { label: string; required?: boolean; colSpan?: 1 | 2; hint?: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className={colSpan === 2 ? 'md:col-span-2' : ''}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="flex items-center gap-1 text-xs font-semibold text-gray-700 dark:text-gray-300">
          {Icon && <Icon size={12} className="text-gray-400" />}
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
        {hint && <span className="text-[11px] text-gray-400 dark:text-gray-500">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function CurrencySelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 pr-8 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm font-semibold outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all cursor-pointer appearance-none"
      >
        {CURRENCY_OPTIONS.map(c => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code} · {c.name}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  )
}

function AmountInput({ value, onChange, currency }: { value: string; onChange: (v: string) => void; currency: ReturnType<typeof getCurrencyMeta> }) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 font-semibold text-sm">{currency.symbol}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="w-full pl-7 pr-14 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-medium">{currency.code}</span>
    </div>
  )
}

function ChannelChips({ options, selected, onChange, allowCustom, placeholder, formatLabel }: { options: string[]; selected: string[]; onChange: (v: string[]) => void; allowCustom?: boolean; placeholder?: string; formatLabel?: (v: string) => string }) {
  const [input, setInput] = useState('')
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])
  }
  const addCustom = () => {
    if (input.trim() && !selected.includes(input.trim())) {
      onChange([...selected, input.trim()])
      setInput('')
    }
  }
  const labelOf = (v: string) => (formatLabel ? formatLabel(v) : v)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-gray-200 dark:border-border/60 bg-white dark:bg-bg-input min-h-[42px]">
        {options.map(o => {
          const isSel = selected.includes(o)
          return (
            <button
              type="button"
              key={o}
              onClick={() => toggle(o)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                isSel
                  ? 'bg-accent-blue text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-bg-hover text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-bg-hover/80'
              }`}
              title={labelOf(o)}
            >
              {labelOf(o)}
              {isSel && <X size={10} />}
            </button>
          )
        })}
        {allowCustom && (
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
            placeholder={placeholder || '自定义后回车'}
            className="flex-1 min-w-[100px] bg-transparent outline-none text-[11px] placeholder-gray-400"
          />
        )}
      </div>
      {selected.length > 0 && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          已选 {selected.length} 项
        </div>
      )}
    </div>
  )
}
