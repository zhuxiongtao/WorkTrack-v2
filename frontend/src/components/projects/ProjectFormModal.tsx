import { useEffect, useState, useMemo, useCallback } from 'react'
import { X, Briefcase, DollarSign, Cloud, FileText, Tag, Plus, Calendar, ChevronDown, Activity, Wrench } from 'lucide-react'
import { useProjectFormOptions, getCurrencyMeta, CURRENCY_OPTIONS } from '../../hooks/useProjectFormOptions'
import { CustomerCombobox } from './CustomerCombobox'
import SearchableSelect from '../SearchableSelect'
import FileUpload from '../FileUpload'
import { ErrorBoundary } from '../ErrorBoundary'
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard'

export interface ProjectFormState {
  name: string
  customer: { id: number; name: string } | null
  start_date: string
  termination_date: string
  currency: string
  opportunity_amount: string
  deal_amount: string
  selectedProducts: string[]
  selectedClouds: string[]
  selectedUpstreamChannels: string[]
  selectedModels: string[]
  project_scenario: string
  usage_scenario: string
  sales_person: string
  tech_support_person: string
  status: string
  monthly_call_volume: string
  selectedMeetingIds: number[]
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
  deal_amount: '',
  selectedProducts: [],
  selectedClouds: [],
  selectedUpstreamChannels: [],
  selectedModels: [],
  project_scenario: '',
  usage_scenario: '',
  sales_person: '',
  tech_support_person: '',
  status: STATUS_DEFAULT,
  monthly_call_volume: '',
  selectedMeetingIds: [],
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
  const { customers, options, meetings, loading } = useProjectFormOptions()
  const [form, setForm] = useState<ProjectFormState>(initialState)
  const [formInitial, setFormInitial] = useState<string>('')
  const [activeSection, setActiveSection] = useState<string>('basic')
  const [showCustomScenario, setShowCustomScenario] = useState(false)
  const [showCustomUpstream, setShowCustomUpstream] = useState(false)

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
      const isManualCustomer = editingProject.customer_id == null && !!editingProject.customer_name
      const initial: ProjectFormState = {
        name: editingProject.name || '',
        customer: { id: editingProject.customer_id || 0, name: editingProject.customer_name || '' },
        start_date: editingProject.start_date || '',
        termination_date: editingProject.termination_date || '',
        currency: editingProject.currency || 'CNY',
        opportunity_amount: editingProject.opportunity_amount?.toString() || '',
        deal_amount: editingProject.deal_amount?.toString() || '',
        selectedProducts: editingProject.product ? editingProject.product.split(',').filter(Boolean) : [],
        selectedClouds: editingProject.cloud_provider ? editingProject.cloud_provider.split(',').filter(Boolean) : [],
        selectedUpstreamChannels: editingProject.upstream_channels ? editingProject.upstream_channels.split(',').filter(Boolean) : [],
        selectedModels: editingProject.models ? editingProject.models.split(',').filter(Boolean) : [],
        project_scenario: editingProject.project_scenario || '',
        usage_scenario: editingProject.usage_scenario || '',
        sales_person: editingProject.sales_person || '',
        tech_support_person: editingProject.tech_support_person || '',
        status: editingProject.status || STATUS_DEFAULT,
        monthly_call_volume: editingProject.monthly_call_volume || '',
        selectedMeetingIds: editingProject.meeting_ids || [],
        progress: editingProject.progress || '',
        files_json: editingProject.files_json || null,
      }
      setForm(initial)
      setFormInitial(JSON.stringify(initial))
      setShowCustomScenario(!!editingProject.usage_scenario && !options.project_scenario.includes(editingProject.usage_scenario))
    } else {
      setForm(initialState)
      setFormInitial(JSON.stringify(initialState))
      setShowCustomScenario(false)
    }
  }, [isOpen, editingProject, options.project_scenario])

  const currency = useMemo(() => getCurrencyMeta(form.currency), [form.currency])

  const updateField = useCallback(<K extends keyof ProjectFormState>(key: K, value: ProjectFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = async () => {
    if (!form.name.trim()) { return }
    const body: any = {
      name: form.name.trim(),
      customer_id: form.customer?.id || null,
      customer_name: form.customer?.name || '',
      start_date: form.start_date || null,
      termination_date: form.termination_date || null,
      currency: form.currency,
      opportunity_amount: form.opportunity_amount ? parseFloat(form.opportunity_amount) : null,
      deal_amount: form.deal_amount ? parseFloat(form.deal_amount) : null,
      product: form.selectedProducts.join(',') || null,
      cloud_provider: form.selectedClouds.join(',') || null,
      upstream_channels: form.selectedUpstreamChannels.join(',') || null,
      models: form.selectedModels.join(',') || null,
      project_scenario: form.project_scenario || null,
      usage_scenario: form.usage_scenario || null,
      sales_person: form.sales_person || null,
      tech_support_person: form.tech_support_person || null,
      status: form.status,
      monthly_call_volume: form.monthly_call_volume || null,
      progress: form.progress || null,
      files_json: form.files_json,
      meeting_ids: form.selectedMeetingIds,
    }
    await onSubmit(body)
  }

  if (!isOpen) return null

  const sections = [
    { id: 'basic', title: '项目概况', icon: Briefcase, desc: '名称 · 客户 · 时间 · 产品' },
    { id: 'business', title: '商务 & 团队', icon: DollarSign, desc: '金额 · 币种 · 销售 · 状态' },
    { id: 'maas', title: 'MaaS 配置', icon: Cloud, desc: '上游通道 · 模型 · 场景 · 调用量' },
    { id: 'relation', title: '协作 & 附件', icon: FileText, desc: '关联会议 · 进展 · 附件' },
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
                      <span className="hidden md:block text-[10px] text-gray-400 dark:text-gray-500 ml-6">{s.desc}</span>
                    </button>
                  )
                })}
              </div>
              {loading && (
                <div className="hidden md:flex items-center gap-1.5 mt-4 px-2 text-[10px] text-gray-400">
                  <div className="w-2 h-2 bg-accent-blue rounded-full animate-pulse" />
                  正在加载选项…
                </div>
              )}
            </nav>

            {/* 右侧分节内容 */}
            <div className="px-6 py-5 space-y-6 max-md:px-4">
              {activeSection === 'basic' && (
                <Section icon={Briefcase} title="项目概况" desc="项目名称、客户、生效与终止时间、涉及产品">
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

                    <FormField label="涉及产品" colSpan={2} hint="可多选" icon={Tag}>
                      <SearchableSelect
                        multiple
                        options={options.product.map((p, i) => ({ id: i, label: p, value: p }))}
                        value={form.selectedProducts}
                        onChange={(v) => updateField('selectedProducts', v as string[])}
                        placeholder="选择涉及的产品 / 解决方案"
                      />
                      {form.selectedProducts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {form.selectedProducts.map(p => (
                            <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent-blue/10 text-accent-blue text-[10px] font-semibold">
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
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

                    <FormField label={`商机金额 (${currency.unit})`}>
                      <AmountInput value={form.opportunity_amount} onChange={(v) => updateField('opportunity_amount', v)} currency={currency} />
                    </FormField>

                    <FormField label={`成交价格 (${currency.unit})`}>
                      <AmountInput value={form.deal_amount} onChange={(v) => updateField('deal_amount', v)} currency={currency} />
                    </FormField>

                    <FormField label="销售负责人" icon={Briefcase}>
                      {options.sales_person.length > 0 ? (
                        <select
                          value={form.sales_person}
                          onChange={(e) => updateField('sales_person', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all cursor-pointer"
                        >
                          <option value="">不指定</option>
                          {options.sales_person.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
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
                      {options.sales_person.length > 0 ? (
                        <select
                          value={form.tech_support_person}
                          onChange={(e) => updateField('tech_support_person', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all cursor-pointer"
                        >
                          <option value="">不指定</option>
                          {options.sales_person.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={form.tech_support_person}
                          onChange={(e) => updateField('tech_support_person', e.target.value)}
                          placeholder="输入技术支持姓名"
                          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                        />
                      )}
                    </FormField>

                    <FormField label="项目状态">
                      <select
                        value={form.status}
                        onChange={(e) => updateField('status', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all cursor-pointer"
                      >
                        <option value="">未设置</option>
                        {(options.project_status.length > 0 ? options.project_status : [STATUS_DEFAULT, '已签约', '已暂停', '已结束', '已流失']).map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                </Section>
              )}

              {activeSection === 'maas' && (
                <Section icon={Cloud} title="MaaS 配置" desc="上游供应商、模型、客户使用场景">
                  <ErrorBoundary sectionName="MaaS 配置">
                    <div className="space-y-4">
                    <FormField label="上游供应商通道" hint="本平台使用的上游通道（多选）" icon={Cloud}>
                      <ChannelChips
                        options={options.cloud}
                        selected={form.selectedUpstreamChannels}
                        onChange={(v) => updateField('selectedUpstreamChannels', v)}
                        allowCustom
                        placeholder="如：OpenAI · 阿里云百炼 · 自建集群"
                      />
                    </FormField>

                    <FormField label="使用模型" hint="本项目调用的模型（多选，可自定义）" icon={Activity}>
                      <ChannelChips
                        options={['qwen3-max', 'qwen3-plus', 'deepseek-v3.2', 'glm-4.6', 'doubao-1.5-pro', 'kimi-k2', 'gpt-5', 'gpt-5-mini', 'claude-sonnet-4.5', 'claude-haiku-4.5', 'gemini-2.5-pro', '自定义']}
                        selected={form.selectedModels}
                        onChange={(v) => updateField('selectedModels', v)}
                        allowCustom
                        placeholder="自定义后回车"
                      />
                    </FormField>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField label="项目场景" hint="业务场景分类">
                        <>
                          <select
                            value={showCustomScenario ? '__custom__' : form.project_scenario}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === '__custom__') {
                                setShowCustomScenario(true)
                                updateField('project_scenario', '')
                              } else {
                                setShowCustomScenario(false)
                                updateField('project_scenario', v)
                              }
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all cursor-pointer"
                          >
                            <option value="">不指定</option>
                            {options.project_scenario.map(s => <option key={s} value={s}>{s}</option>)}
                            <option value="__custom__">— 自定义 —</option>
                          </select>
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

                      <FormField label="预计月调用量" hint="如：1M tokens / 50 万次" icon={Activity}>
                        <input
                          type="text"
                          value={form.monthly_call_volume}
                          onChange={(e) => updateField('monthly_call_volume', e.target.value)}
                          placeholder="如：1M tokens / 50 万次 / QPS 100"
                          className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all"
                        />
                      </FormField>
                    </div>

                    <FormField label="客户使用场景" hint="详细描述客户的业务场景与诉求（自由文本）">
                      <textarea
                        value={form.usage_scenario}
                        onChange={(e) => updateField('usage_scenario', e.target.value)}
                        rows={3}
                        placeholder="如：客户为某银行，需构建智能客服系统，涉及多轮对话、知识库检索、意图识别等功能，要求延迟 < 500ms，月活 100 万"
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all resize-none"
                      />
                    </FormField>

                    <FormField label="云厂商 / 部署方式" hint="可选，标识底层基础设施" icon={Cloud}>
                      <ChannelChips
                        options={['AWS', '阿里云', '腾讯云', '华为云', 'Azure', 'GCP', '自建机房', '混合云']}
                        selected={form.selectedClouds}
                        onChange={(v) => updateField('selectedClouds', v)}
                      />
                    </FormField>
                    </div>
                  </ErrorBoundary>
                </Section>
              )}

              {activeSection === 'relation' && (
                <Section icon={FileText} title="协作 & 附件" desc="关联会议、进展记录、附件">
                  <div className="space-y-4">
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
            {form.deal_amount && <span> · {currency.symbol} {form.deal_amount} {currency.unit}</span>}
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
        {hint && <span className="text-[10px] text-gray-400 dark:text-gray-500">{hint}</span>}
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
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-medium">{currency.code}</span>
    </div>
  )
}

function ChannelChips({ options, selected, onChange, allowCustom, placeholder }: { options: string[]; selected: string[]; onChange: (v: string[]) => void; allowCustom?: boolean; placeholder?: string }) {
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
            >
              {o}
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
        <div className="text-[10px] text-gray-500 dark:text-gray-400">
          已选 {selected.length} 项
        </div>
      )}
    </div>
  )
}
