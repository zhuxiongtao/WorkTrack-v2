import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  FileText, Plus, Trash2, Search, ChevronDown, ChevronRight,
  Printer, RotateCcw, Building2, Phone, Mail, Globe, MapPin,
  Package, Layers, Hash, Zap, Info, Settings2, Save, Loader2,
  Clock, FolderOpen, X, Copy, Download, ExternalLink,
} from 'lucide-react'
import { PageHeader } from '../components/design-system'
import SearchableSelect from '../components/SearchableSelect'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

/* ──── 类型 ──── */
interface QuoteChannel {
  id: number; name: string; code: string
  supplier_id: number; supplier_name: string
  api_protocol: string; status: string; computed_status: string
  cost_discount: number | null; markup: number | null
  scope_type: string; model_family: string | null; model_id: number | null
  sla: Record<string, number>
}
interface QuoteModel {
  id: number; name: string; version_id: string | null; provider: string | null
  modality: string | null
  input_price: number | null; output_price: number | null
  cache_read_price: number | null; cache_write_price: number | null
  price_currency: string
}
interface CompanyInfo {
  company_name: string; company_phone: string; company_email: string
  company_website: string; company_address: string
  platform_name: string; platform_intro: string
  value_added_services: string; sla_terms: string; disclaimer: string; payment_terms: string
}
type CompanyBasicInfo = Pick<CompanyInfo,
  'company_name' | 'company_phone' | 'company_email' | 'company_website' |
  'company_address' | 'platform_name' | 'platform_intro'>
interface ValueAddedService { title: string; description: string; fee: string }
interface QuoteItem {
  id: string
  model: QuoteModel
  channel: QuoteChannel | null
  discount: number | null
  custom_note: string
}
interface SavedQuote {
  id: number; title: string | null; customer_name: string | null
  valid_days: number; notes: string | null; items_json: string
  share_token: string | null
  expires_at: string; created_at: string; updated_at: string
  quote_number: string | null; contact_name: string | null
  app_scenario: string | null; special_requirements: string | null
  settlement_method: string | null
}

/* ──── 工具函数 ──── */
const fmtPrice = (p: number | null, currency = 'USD') =>
  p == null ? '—' : `${currency === 'USD' ? '$' : '¥'}${p.toFixed(p < 1 ? 3 : 2)}`

const fmtFold = (d: number | null) =>
  d == null ? '—' : `${parseFloat((d * 10).toFixed(1))}折`

const sellRate = (ch: QuoteChannel | null) =>
  ch?.cost_discount != null ? ch.cost_discount + (ch.markup ?? 0) : null

const sellPrice = (official: number | null, ch: QuoteChannel | null) => {
  const r = sellRate(ch)
  if (official == null || r == null) return null
  return official * r
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', RMB: '¥', USD: '$' }
function priceSymbol(currency?: string | null): string {
  return CURRENCY_SYMBOL[(currency || 'USD').toUpperCase()] ?? `${currency} `
}

function channelCoversModel(ch: QuoteChannel, m: QuoteModel): boolean {
  if (ch.computed_status === '已过期' || ch.computed_status === '已终止') return false
  if (ch.scope_type === 'all') return true
  if (ch.scope_type === 'single') return ch.model_id === m.id
  if (ch.scope_type === 'family' && ch.model_family && m.provider) {
    return ch.model_family === m.provider
  }
  return false
}

const PROTOCOL_LABELS: Record<string, string> = {
  openai_compat: 'OpenAI 兼容', native: '原生 API', proxy: '代理转发', other: '其他',
}

/* ──── 默认条款内容 ──── */
const DEFAULT_VAS: ValueAddedService[] = [
  { title: '财务支持', description: '根据提供账号进行财务对账支持', fee: '包含在基础费率中' },
  { title: '技术支持 (SLA)', description: '7×24小时专属技术对接群，响应时间 < 2小时', fee: '包含在基础费率中' },
]
const DEFAULT_SLA_TERMS = `1、数据安全权益：平台承诺客户上传的 Prompt 及生成结果仅用于实时调用，不用于模型训练，不向第三方共享。
2、可用性承诺：平台保证服务可用性不低于 99.9%（月度统计，不含计划维护窗口）。
3、并发保障：标准账号默认 QPS 为官方数值，如需更高并发可提前协商单独配置。`
const DEFAULT_DISCLAIMER = `1、生成内容合规性：由于大模型的生成具有随机性，平台不保证输出结果的绝对准确性，客户需自行对生成内容进行审核与合规性把关。
2、不可抗力：因算力中心电力故障、网络运营商故障、自然灾害等不可抗力导致的业务中断，双方互不承担违约责任，但平台需在事后及时告知并提供影响评估。
3、API 密钥安全：客户需妥善保管分配的 API_KEY，因密钥泄漏导致的账号盗用及费用损失，由客户自行承担。`
const DEFAULT_PAYMENT_TERMS = `1、结算方式：预充值/按月后付费（以本报价单约定为准）。
2、逾期处理：账户余额不足时，平台将提供 24 小时宽限期，逾期未补齐将自动停机，恢复服务需重新充值激活。`

/* ──── 报价单文档组件 ──── */
export function QuoteDocument({ items, info, customerName, contactName, appScenario, specialRequirements, quoteNumber, validDays, notes, date, settlementMethod }: {
  items: QuoteItem[]; info: CompanyInfo | null; customerName: string
  contactName: string; appScenario: string; specialRequirements: string
  quoteNumber: string; validDays: string; notes: string; date: string
  settlementMethod: string
}) {
  // 按 provider 分组，保持首次出现顺序
  const providerGroups: { provider: string; items: QuoteItem[] }[] = []
  const seenProviders = new Map<string, number>()
  for (const item of items) {
    const p = item.model.provider || '其他'
    if (!seenProviders.has(p)) {
      seenProviders.set(p, providerGroups.length)
      providerGroups.push({ provider: p, items: [] })
    }
    providerGroups[seenProviders.get(p)!].items.push(item)
  }

  // 解析条款配置，空时使用默认值
  const vas: ValueAddedService[] = (() => {
    if (!info?.value_added_services) return DEFAULT_VAS
    try { return JSON.parse(info.value_added_services) } catch { return DEFAULT_VAS }
  })()
  const slaText = info?.sla_terms || DEFAULT_SLA_TERMS
  const disclaimerTxt = info?.disclaimer || DEFAULT_DISCLAIMER
  const paymentTxt = (() => {
    const base = info?.payment_terms || DEFAULT_PAYMENT_TERMS
    if (!settlementMethod) return base
    // 替换第一行结算方式
    return base.replace(/^1、结算方式：[^\n]+/, `1、结算方式：${settlementMethod}。`)
  })()

  // 有效期截止日
  const validUntil = validDays ? (() => {
    const d = new Date()
    d.setDate(d.getDate() + parseInt(validDays || '30'))
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
  })() : null

  const SectionHead = ({ num, text }: { num: string; text: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '20px 0 8px', borderBottom: '1px solid #cbd5e1', paddingBottom: '5px' }}>
      <div style={{ width: '3px', height: '14px', backgroundColor: '#3b82f6', borderRadius: '2px', flexShrink: 0 }} />
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>{num}、{text}</span>
    </div>
  )

  const tdLabel: React.CSSProperties = { background: '#f8fafc', padding: '6px 12px', fontWeight: 600, color: '#374151', border: '1px solid #e2e8f0', fontSize: '11px', whiteSpace: 'nowrap' }
  const tdVal: React.CSSProperties = { padding: '6px 12px', border: '1px solid #e2e8f0', fontSize: '11px', color: '#1e293b' }

  return (
    <div id="quote-print-area" className="bg-white text-gray-900 p-8 font-sans text-sm leading-relaxed">
      {/* 标题行 */}
      <div style={{ textAlign: 'center', marginBottom: '14px' }}>
        <div style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '3px', color: '#111827' }}>AI MaaS 平台服务报价单</div>
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280', display: 'flex', justifyContent: 'center', gap: '28px', flexWrap: 'wrap' }}>
          {quoteNumber && <span>编号：<span style={{ color: '#1e293b', fontWeight: 600 }}>{quoteNumber}</span></span>}
          <span>报价日期：<span style={{ color: '#1e293b', fontWeight: 600 }}>{date}</span></span>
          {validUntil && <span>有效期至：<span style={{ color: '#1e293b', fontWeight: 600 }}>{validUntil}</span></span>}
        </div>
      </div>

      {/* 一、客户与项目信息 */}
      <SectionHead num="一" text="客户与项目信息" />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
        <tbody>
          <tr>
            <td style={{ ...tdLabel, width: '11%' }}>客户名称</td>
            <td style={{ ...tdVal, width: '22%' }}>{customerName || '—'}</td>
            <td style={{ ...tdLabel, width: '11%' }}>联系人</td>
            <td style={{ ...tdVal, width: '22%' }}>{contactName || '—'}</td>
            <td style={{ ...tdLabel, width: '11%' }}>应用场景</td>
            <td style={tdVal}>{appScenario || '—'}</td>
          </tr>
          {specialRequirements && (
            <tr>
              <td style={tdLabel}>特殊要求</td>
              <td colSpan={5} style={tdVal}>{specialRequirements}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 二、产品方案与 API 计费标准 */}
      <SectionHead num="二" text="产品方案与 API 计费标准" />
      {items.length > 0 ? (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
                <th style={{ textAlign: 'center', padding: '7px 12px', fontWeight: 600, width: '14%' }}>模型系列</th>
                <th style={{ textAlign: 'left', padding: '7px 12px', fontWeight: 600, width: '46%' }}>通道及模型版本</th>
                <th style={{ textAlign: 'center', padding: '7px 12px', fontWeight: 600, width: '14%' }}>商务折扣</th>
                <th style={{ textAlign: 'left', padding: '7px 12px', fontWeight: 600 }}>备注</th>
              </tr>
            </thead>
            <tbody>
              {providerGroups.flatMap(group =>
                group.items.map((item, idx) => (
                  <tr key={item.id} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                    {idx === 0 && (
                      <td rowSpan={group.items.length} style={{ padding: '7px 12px', border: '1px solid #e2e8f0', backgroundColor: '#f1f5f9', fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', color: '#334155' }}>
                        {group.provider}
                      </td>
                    )}
                    <td style={{ padding: '7px 12px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontWeight: 500, color: '#1e293b' }}>
                        {item.channel ? `${item.channel.name}（${item.model.name}）` : item.model.name}
                      </div>
                      {item.model.version_id && item.model.version_id !== item.model.name && (
                        <div style={{ color: '#9ca3af', fontSize: '10px' }}>{item.model.version_id}</div>
                      )}
                    </td>
                    <td style={{ padding: '7px 12px', border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 700, fontSize: '13px', color: '#1d4ed8' }}>
                      {fmtFold(item.discount)}
                    </td>
                    <td style={{ padding: '7px 12px', border: '1px solid #e2e8f0', fontSize: '11px', color: '#6b7280' }}>
                      {item.custom_note || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '5px' }}>
            备注：各模型基准价格参考官网
          </div>
        </>
      ) : (
        <div style={{ border: '2px dashed #e5e7eb', borderRadius: '8px', padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '12px', margin: '8px 0' }}>
          暂未添加报价模型
        </div>
      )}

      {/* 三、增值服务与技术支持 */}
      {vas.length > 0 && (
        <>
          <SectionHead num="三" text="增值服务与技术支持" />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: '#374151', width: '20%', border: '1px solid #e2e8f0' }}>项目</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: '#374151', border: '1px solid #e2e8f0' }}>服务内容说明</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: '#374151', width: '26%', border: '1px solid #e2e8f0' }}>费用</th>
              </tr>
            </thead>
            <tbody>
              {vas.map((s, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                  <td style={{ padding: '6px 12px', border: '1px solid #e2e8f0', fontWeight: 600, color: '#1e293b' }}>{s.title}</td>
                  <td style={{ padding: '6px 12px', border: '1px solid #e2e8f0', color: '#374151' }}>{s.description}</td>
                  <td style={{ padding: '6px 12px', border: '1px solid #e2e8f0', color: '#047857' }}>{s.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 四、双方权益与服务等级协议 */}
      {slaText.trim() && (
        <>
          <SectionHead num="四" text="双方权益与服务等级协议 (SLA)" />
          <p style={{ fontSize: '11px', color: '#374151', lineHeight: '1.9', whiteSpace: 'pre-line', margin: 0 }}>{slaText}</p>
        </>
      )}

      {/* 五、免责声明与风险提示 */}
      {disclaimerTxt.trim() && (
        <>
          <SectionHead num="五" text="免责声明与风险提示" />
          <p style={{ fontSize: '11px', color: '#374151', lineHeight: '1.9', whiteSpace: 'pre-line', margin: 0 }}>{disclaimerTxt}</p>
        </>
      )}

      {/* 六、付款条款 */}
      {paymentTxt.trim() && (
        <>
          <SectionHead num="六" text="付款条款" />
          <p style={{ fontSize: '11px', color: '#374151', lineHeight: '1.9', whiteSpace: 'pre-line', margin: 0 }}>{paymentTxt}</p>
        </>
      )}

      {/* 备注 */}
      {notes && (
        <div style={{ marginTop: '16px', padding: '10px 12px', background: '#f9fafb', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>备注</div>
          <p style={{ fontSize: '11px', color: '#374151', whiteSpace: 'pre-line', margin: 0 }}>{notes}</p>
        </div>
      )}

      {/* 页脚 */}
      <div style={{ marginTop: '24px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '10px', color: '#9ca3af', textAlign: 'center' }}>
        以上报价内容经双方确认后方可生效，最终以签署合同为准。
      </div>
    </div>
  )
}

/* ──── 主页面 ──── */
export default function QuotePage() {
  const { fetchWithAuth, hasPermission } = useAuth()
  const { toast: showToast } = useToast()

  const [channels, setChannels] = useState<QuoteChannel[]>([])
  const [models, setModels] = useState<QuoteModel[]>([])
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // 报价内容
  const [items, setItems] = useState<QuoteItem[]>([])
  const [customerName, setCustomerName] = useState('')
  const [validDays, setValidDays] = useState('30')
  const [notes, setNotes] = useState('')
  // 新增报价字段
  const [quoteNumber, setQuoteNumber] = useState('')
  const [contactName, setContactName] = useState('')
  const [appScenario, setAppScenario] = useState('')
  const [specialRequirements, setSpecialRequirements] = useState('')
  const [settlementMethod, setSettlementMethod] = useState('预充值')

  const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')

  // 我的报价单历史
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [savingQuote, setSavingQuote] = useState(false)
  const [currentQuoteId, setCurrentQuoteId] = useState<number | null>(null)
  const [currentShareToken, setCurrentShareToken] = useState<string | null>(null)
  const [showShareLink, setShowShareLink] = useState(false)

  // 公司信息内嵌编辑
  const [infoExpanded, setInfoExpanded] = useState(false)
  const [infoForm, setInfoForm] = useState<CompanyBasicInfo>({
    company_name: '', company_phone: '', company_email: '',
    company_website: '', company_address: '', platform_name: '', platform_intro: '',
  })
  const [infoSaving, setInfoSaving] = useState(false)

  // 条款模板编辑
  const [clauseExpanded, setClauseExpanded] = useState(false)
  const [vaServices, setVaServices] = useState<ValueAddedService[]>([])
  const [slaTerms, setSlaTerms] = useState('')
  const [disclaimerText, setDisclaimerText] = useState('')
  const [paymentTermsText, setPaymentTermsText] = useState('')
  const [clauseSaving, setClauseSaving] = useState(false)

  // 模型搜索
  const [modelSearch, setModelSearch] = useState('')
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())

  // 加载数据
  const loadSavedQuotes = useCallback(async () => {
    const r = await fetchWithAuth('/api/v1/quotes/')
    if (r.ok) setSavedQuotes(await r.json())
  }, [fetchWithAuth])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [optRes, infoRes] = await Promise.all([
        fetchWithAuth('/api/v1/quotes/options'),
        fetchWithAuth('/api/v1/quotes/company-info'),
      ])
      if (optRes.ok) {
        const d = await optRes.json()
        setChannels(d.channels || [])
        setModels(d.models || [])
        const providers = [...new Set((d.models || []).map((m: QuoteModel) => m.provider || '其他'))]
        setExpandedProviders(new Set(providers as string[]))
      }
      if (infoRes.ok) {
        const info = await infoRes.json()
        setCompanyInfo({
          company_name: info.company_name || '',
          company_phone: info.company_phone || '',
          company_email: info.company_email || '',
          company_website: info.company_website || '',
          company_address: info.company_address || '',
          platform_name: info.platform_name || '',
          platform_intro: info.platform_intro || '',
          value_added_services: info.value_added_services || '',
          sla_terms: info.sla_terms || '',
          disclaimer: info.disclaimer || '',
          payment_terms: info.payment_terms || '',
        })
        setInfoForm({
          company_name: info.company_name || '',
          company_phone: info.company_phone || '',
          company_email: info.company_email || '',
          company_website: info.company_website || '',
          company_address: info.company_address || '',
          platform_name: info.platform_name || '',
          platform_intro: info.platform_intro || '',
        })
        try { setVaServices(JSON.parse(info.value_added_services || '[]')) } catch { setVaServices([]) }
        setSlaTerms(info.sla_terms || '')
        setDisclaimerText(info.disclaimer || '')
        setPaymentTermsText(info.payment_terms || '')
      }
      await loadSavedQuotes()
    } catch {
      showToast('加载报价数据失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, showToast, loadSavedQuotes])

  useEffect(() => { loadData() }, [loadData])

  // 按 provider 分组模型
  const grouped = useMemo(() => {
    const q = modelSearch.toLowerCase()
    const filtered = models.filter(m =>
      !q || m.name.toLowerCase().includes(q) || (m.provider?.toLowerCase().includes(q)) ||
      (m.version_id?.toLowerCase().includes(q))
    )
    const map = new Map<string, QuoteModel[]>()
    for (const m of filtered) {
      const key = m.provider || '其他'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return map
  }, [models, modelSearch])

  // 添加模型到报价单
  const addModel = (model: QuoteModel) => {
    if (items.some(it => it.model.id === model.id)) {
      showToast('该模型已在报价单中', 'error'); return
    }
    const defaultCh = channels.find(ch => channelCoversModel(ch, model) && ch.status === '合作中') || null
    setItems(prev => [...prev, {
      id: `${model.id}-${Date.now()}`,
      model, channel: defaultCh,
      discount: sellRate(defaultCh),
      custom_note: '',
    }])
  }

  const removeItem = (id: string) => setItems(prev => prev.filter(it => it.id !== id))

  const updateItem = (id: string, patch: Partial<QuoteItem>) =>
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))

  const reset = () => {
    setItems([]); setCustomerName(''); setValidDays('30'); setNotes('')
    setQuoteNumber(''); setContactName(''); setAppScenario(''); setSpecialRequirements('')
    setCurrentQuoteId(null); setCurrentShareToken(null); setShowShareLink(false)
  }

  const saveCompanyInfo = async () => {
    setInfoSaving(true)
    try {
      const r = await fetchWithAuth('/api/v1/quotes/company-info', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(infoForm),
      })
      if (!r.ok) throw new Error()
      setCompanyInfo(prev => prev ? { ...prev, ...infoForm } : { ...infoForm, value_added_services: '', sla_terms: '', disclaimer: '', payment_terms: '' })
      setInfoExpanded(false)
      showToast('公司信息已保存', 'success')
    } catch {
      showToast('保存失败', 'error')
    } finally {
      setInfoSaving(false)
    }
  }

  const saveClauseConfig = async () => {
    setClauseSaving(true)
    try {
      const vasJson = vaServices.length > 0 ? JSON.stringify(vaServices) : ''
      const r = await fetchWithAuth('/api/v1/quotes/company-info', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value_added_services: vasJson,
          sla_terms: slaTerms,
          disclaimer: disclaimerText,
          payment_terms: paymentTermsText,
        }),
      })
      if (!r.ok) throw new Error()
      setCompanyInfo(prev => prev ? {
        ...prev, value_added_services: vasJson,
        sla_terms: slaTerms, disclaimer: disclaimerText, payment_terms: paymentTermsText,
      } : prev)
      setClauseExpanded(false)
      showToast('条款模板已保存', 'success')
    } catch {
      showToast('保存失败', 'error')
    } finally {
      setClauseSaving(false)
    }
  }

  const handleSaveQuote = async () => {
    if (items.length === 0) { showToast('请先添加报价模型', 'error'); return }
    setSavingQuote(true)
    try {
      const snapshot = items.map(it => ({
        model_id: it.model.id, model_name: it.model.name,
        model_version_id: it.model.version_id, model_provider: it.model.provider,
        model_input_price: it.model.input_price, model_output_price: it.model.output_price,
        model_cache_read_price: it.model.cache_read_price,
        model_price_currency: it.model.price_currency,
        channel_id: it.channel?.id ?? null, channel_name: it.channel?.name ?? null,
        channel_code: it.channel?.code ?? null,
        channel_api_protocol: it.channel?.api_protocol ?? null,
        channel_cost_discount: it.channel?.cost_discount ?? null,
        channel_markup: it.channel?.markup ?? null,
        channel_sla: it.channel?.sla ?? {},
        discount: it.discount,
        custom_note: it.custom_note,
      }))
      const autoTitle = customerName
        ? `${customerName} - ${new Date().toLocaleDateString('zh-CN')}`
        : `报价单 ${new Date().toLocaleDateString('zh-CN')}`
      const body = {
        title: autoTitle, customer_name: customerName, valid_days: parseInt(validDays), notes,
        items: snapshot,
        // quote_number: omit for new quotes — backend auto-generates TJ-MaaS-XXXXX
        // for updates, the existing number is preserved via the PUT handler
        contact_name: contactName || null,
        app_scenario: appScenario || null,
        special_requirements: specialRequirements || null,
        settlement_method: settlementMethod || null,
      }

      let r
      if (currentQuoteId) {
        r = await fetchWithAuth(`/api/v1/quotes/${currentQuoteId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (r.ok) {
          const d = await r.json()
          if (d.share_token) setCurrentShareToken(d.share_token)
        }
      } else {
        r = await fetchWithAuth('/api/v1/quotes/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (r.ok) {
          const d = await r.json()
          setCurrentQuoteId(d.id)
          setCurrentShareToken(d.share_token ?? null)
          if (d.quote_number) setQuoteNumber(d.quote_number)
        }
      }
      if (!r!.ok) throw new Error()
      await loadSavedQuotes()
      setShowShareLink(true)
      showToast('报价单已保存', 'success')
    } catch {
      showToast('保存失败', 'error')
    } finally {
      setSavingQuote(false)
    }
  }

  const handleLoadQuote = (q: SavedQuote) => {
    const parsed: QuoteItem[] = JSON.parse(q.items_json).map((it: Record<string, unknown>, idx: number) => {
      const model: QuoteModel = {
        id: it.model_id as number, name: it.model_name as string,
        version_id: it.model_version_id as string | null,
        provider: it.model_provider as string | null, modality: null,
        input_price: it.model_input_price as number | null,
        output_price: it.model_output_price as number | null,
        cache_read_price: it.model_cache_read_price as number | null,
        cache_write_price: null, price_currency: (it.model_price_currency as string) || 'USD',
      }
      const channel: QuoteChannel | null = it.channel_id ? {
        id: it.channel_id as number, name: it.channel_name as string,
        code: it.channel_code as string, supplier_id: 0, supplier_name: '',
        api_protocol: it.channel_api_protocol as string, status: '', computed_status: '',
        cost_discount: it.channel_cost_discount as number | null,
        markup: it.channel_markup as number | null,
        scope_type: '', model_family: null, model_id: null,
        sla: (it.channel_sla as Record<string, number>) || {},
      } : null
      const savedDiscount = it.discount as number | null | undefined
      const discount = savedDiscount != null ? savedDiscount : (channel ? (channel.cost_discount != null ? (channel.cost_discount + (channel.markup ?? 0)) : null) : null)
      return { id: `loaded-${idx}-${Date.now()}`, model, channel, discount, custom_note: (it.custom_note as string) || '' }
    })
    setItems(parsed)
    setCustomerName(q.customer_name || '')
    setValidDays(String(q.valid_days))
    setNotes(q.notes || '')
    setQuoteNumber(q.quote_number || '')
    setContactName(q.contact_name || '')
    setAppScenario(q.app_scenario || '')
    setSpecialRequirements(q.special_requirements || '')
    setSettlementMethod(q.settlement_method || '预充值')
    setCurrentQuoteId(q.id)
    setCurrentShareToken(q.share_token ?? null)
    setShowShareLink(false)
    setHistoryExpanded(false)
    showToast(`已加载：${q.title || '报价单'}`, 'success')
  }

  const handleDeleteQuote = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const r = await fetchWithAuth(`/api/v1/quotes/${id}`, { method: 'DELETE' })
    if (r.ok) {
      setSavedQuotes(prev => prev.filter(q => q.id !== id))
      if (currentQuoteId === id) { setCurrentQuoteId(null) }
      showToast('已删除', 'success')
    }
  }

  const [exportingPdf, setExportingPdf] = useState(false)

  const handleExportPdf = async () => {
    const el = document.getElementById('quote-print-area')
    if (!el) { showToast('找不到报价单内容', 'error'); return }
    setExportingPdf(true)
    showToast('正在生成 PDF…', 'info')
    const clone = el.cloneNode(true) as HTMLElement
    Object.assign(clone.style, {
      position: 'fixed', top: '-9999px', left: '0',
      width: '794px', transform: 'none', zIndex: '-1',
      backgroundColor: '#ffffff',
      minHeight: 'auto',
    })
    document.body.appendChild(clone)
    try {
      const canvas = await html2canvas(clone, {
        scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false,
        onclone: (_doc, el) => {
          const s = el.ownerDocument.createElement('style')
          s.textContent = `:root{
            --color-white:#fff;--color-black:#000;
            --color-gray-50:#f9fafb;--color-gray-100:#f3f4f6;--color-gray-200:#e5e7eb;
            --color-gray-300:#d1d5db;--color-gray-400:#9ca3af;--color-gray-500:#6b7280;
            --color-gray-600:#4b5563;--color-gray-700:#374151;--color-gray-800:#1f2937;
            --color-gray-900:#111827;--color-gray-950:#030712;
            --color-blue-50:#eff6ff;--color-blue-100:#dbeafe;--color-blue-200:#bfdbfe;
            --color-blue-300:#93c5fd;--color-blue-400:#60a5fa;--color-blue-500:#3b82f6;
            --color-blue-600:#2563eb;--color-blue-700:#1d4ed8;--color-blue-800:#1e40af;
            --color-blue-900:#1e3a8a;--color-blue-950:#172554;
            --color-slate-50:#f8fafc;--color-slate-100:#f1f5f9;--color-slate-200:#e2e8f0;
            --color-slate-300:#cbd5e1;--color-slate-400:#94a3b8;--color-slate-500:#64748b;
            --color-slate-600:#475569;--color-slate-700:#334155;--color-slate-800:#1e293b;
            --color-slate-900:#0f172a;--color-slate-950:#020617;
          }`
          el.ownerDocument.head.appendChild(s)
        },
      })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgW = pageW
      const imgH = (canvas.height * pageW) / canvas.width
      let y = 0
      let remaining = imgH
      while (remaining > 1) {
        pdf.addImage(imgData, 'PNG', 0, -y, imgW, imgH)
        remaining -= pageH
        if (remaining > 1) { pdf.addPage(); y += pageH }
      }
      const name = customerName ? `报价单_${customerName}.pdf` : '报价单.pdf'
      pdf.save(name)
    } catch (err) {
      showToast(`PDF 生成失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      document.body.removeChild(clone)
      setExportingPdf(false)
    }
  }

  const shareUrl = currentShareToken ? `${window.location.origin}/quote/${currentShareToken}` : null

  const inpCls = 'w-full px-3 py-2 rounded-lg bg-white dark:bg-bg-input border border-border text-sm outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all text-gray-900 dark:text-white'

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500">加载中…</div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-4 no-print">
      <PageHeader
        title="报价单"
        description="根据通道和模型配置生成客户报价"
        icon={FileText}
        right={
          <div className="flex gap-2">
            <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg hover:border-accent-blue/50 hover:text-accent-blue transition-colors">
              <RotateCcw size={14} />重置
            </button>
            {hasPermission('quote:create') && (
              <button onClick={handleSaveQuote} disabled={savingQuote} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-60 transition-colors">
                {savingQuote ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {currentQuoteId ? '更新保存' : '保存'}
              </button>
            )}
            {hasPermission('quote:create') && (
              <button onClick={handleExportPdf} disabled={exportingPdf} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-accent-blue text-white rounded-lg hover:bg-blue-600 shadow-sm hover:shadow-lg hover:shadow-blue-500/30 transition-all font-medium disabled:opacity-60">
                {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                下载 PDF
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">

        {/* ──── 左侧配置面板 ──── */}
        <div className="space-y-4">

          {/* 分享链接卡片 */}
          {shareUrl && (
            <div className="bg-bg-card border border-accent-blue/25 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">分享链接</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => window.open(shareUrl, '_blank')} className="p-1 text-gray-400 hover:text-accent-blue hover:bg-accent-blue/10 rounded transition-colors" title="在新标签页打开"><ExternalLink size={12} /></button>
                  <button onClick={() => setCurrentShareToken(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"><X size={12} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-accent-blue truncate flex-1 bg-accent-blue/5 px-2 py-1 rounded select-all">{shareUrl}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(shareUrl); showToast('链接已复制', 'success') }}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg hover:border-accent-blue/50 hover:text-accent-blue transition-colors"
                ><Copy size={11} />复制</button>
              </div>
            </div>
          )}

          {/* 报价信息 */}
          <div className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">报价信息</div>
              {quoteNumber && (
                <span className="font-mono text-xs text-accent-blue bg-accent-blue/8 px-2 py-0.5 rounded border border-accent-blue/20">{quoteNumber}</span>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">有效期（天）</label>
              <SearchableSelect
                options={[{value:'7',label:'7天'},{value:'15',label:'15天'},{value:'30',label:'30天'},{value:'60',label:'60天'},{value:'90',label:'90天'}]}
                value={validDays} onChange={v => setValidDays(v == null ? '30' : String(v))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">报价对象</label>
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="客户公司名称" className={inpCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">联系人</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="客户联系人" className={inpCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">应用场景</label>
                <input value={appScenario} onChange={e => setAppScenario(e.target.value)} placeholder="如：智能客服" className={inpCls} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">结算方式</label>
              <SearchableSelect
                options={[
                  { value: '预充值', label: '预充值' },
                  { value: '按月后付费', label: '按月后付费' },
                  { value: '按季度后付费', label: '按季度后付费' },
                  { value: '按年付费', label: '按年付费' },
                  { value: '预付款 + 月结', label: '预付款 + 月结' },
                ]}
                value={settlementMethod}
                onChange={v => setSettlementMethod(v == null ? '预充值' : String(v))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">特殊要求</label>
              <input value={specialRequirements} onChange={e => setSpecialRequirements(e.target.value)} placeholder="针对模型的特殊要求（可选）" className={inpCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">备注</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="附加说明…" className={`${inpCls} resize-none`} />
            </div>
          </div>

          {/* 模型选择 */}
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">添加模型</div>
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={modelSearch} onChange={e => setModelSearch(e.target.value)} placeholder="搜索模型名/供应商…" className={`${inpCls} pl-8`} />
            </div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
              {grouped.size === 0 && (
                <div className="text-center text-gray-400 text-xs py-8">无匹配模型</div>
              )}
              {[...grouped.entries()].map(([provider, pModels]) => (
                <div key={provider}>
                  <button
                    onClick={() => setExpandedProviders(prev => {
                      const n = new Set(prev)
                      n.has(provider) ? n.delete(provider) : n.add(provider)
                      return n
                    })}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-bg-hover transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <Building2 size={11} className="text-gray-400" />
                      {provider}
                      <span className="text-gray-400 font-normal">({pModels.length})</span>
                    </div>
                    {expandedProviders.has(provider) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  {expandedProviders.has(provider) && (
                    <div className="ml-3 space-y-0.5 mb-1">
                      {pModels.map(m => {
                        const alreadyAdded = items.some(it => it.model.id === m.id)
                        const covChannels = channels.filter(ch => channelCoversModel(ch, m))
                        return (
                          <div key={m.id}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${alreadyAdded ? 'opacity-40 cursor-not-allowed' : 'hover:bg-accent-blue/10 hover:text-accent-blue'}`}
                            onClick={() => !alreadyAdded && addModel(m)}
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-gray-800 dark:text-gray-200 truncate">{m.name}</div>
                              <div className="text-gray-400 flex items-center gap-2 mt-0.5">
                                {m.input_price != null && <span>{priceSymbol(m.price_currency)}{m.input_price}/1M↑</span>}
                                {m.output_price != null && <span>{priceSymbol(m.price_currency)}{m.output_price}/1M↓</span>}
                                <span>{covChannels.length} 个通道</span>
                              </div>
                            </div>
                            <Plus size={13} className="shrink-0 ml-2 text-accent-blue opacity-0 group-hover:opacity-100" />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 我的报价单历史 */}
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setHistoryExpanded(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <FolderOpen size={13} className="text-gray-400" />
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">我的报价单</span>
                {savedQuotes.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue border border-accent-blue/20">{savedQuotes.length}</span>
                )}
              </div>
              {historyExpanded ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
            </button>
            {historyExpanded && (
              <div className="border-t border-border">
                {savedQuotes.length > 3 && (
                  <div className="px-3 py-2 border-b border-border">
                    <div className="relative">
                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        value={historySearch}
                        onChange={e => setHistorySearch(e.target.value)}
                        placeholder="搜索报价单…"
                        className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg bg-bg-hover border border-border outline-none focus:border-accent-blue transition-colors"
                      />
                    </div>
                  </div>
                )}
                {savedQuotes.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">暂无保存的报价单</div>
                ) : (
                  <div className="divide-y divide-border max-h-[280px] overflow-y-auto">
                    {savedQuotes.filter(q => {
                      if (!historySearch) return true
                      const q2 = historySearch.toLowerCase()
                      return (q.title || '').toLowerCase().includes(q2) || (q.customer_name || '').toLowerCase().includes(q2)
                    }).map(q => {
                      const expireDate = new Date(q.expires_at)
                      const daysLeft = Math.ceil((expireDate.getTime() - Date.now()) / 86400000)
                      const isActive = currentQuoteId === q.id
                      return (
                        <div
                          key={q.id}
                          onClick={() => handleLoadQuote(q)}
                          className={`flex items-start justify-between px-4 py-2.5 cursor-pointer transition-colors group ${isActive ? 'bg-accent-blue/10' : 'hover:bg-bg-hover'}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs font-medium truncate ${isActive ? 'text-accent-blue' : 'text-gray-800 dark:text-gray-200'}`}>
                              {q.title || '未命名报价单'}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-400">
                              <Clock size={9} />
                              <span>{new Date(q.created_at).toLocaleDateString('zh-CN')}</span>
                              {daysLeft <= 30 && (
                                <span className="text-amber-500">{daysLeft}天后过期</span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 ml-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            {q.share_token && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); window.open(`${window.location.origin}/quote/${q.share_token}`, '_blank') }}
                                  className="p-1 text-gray-400 hover:text-accent-blue hover:bg-accent-blue/10 rounded transition-all"
                                  title="在新标签页查看"
                                ><ExternalLink size={11} /></button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}/quote/${q.share_token}`); showToast('链接已复制', 'success') }}
                                  className="p-1 text-gray-400 hover:text-accent-blue hover:bg-accent-blue/10 rounded transition-all"
                                  title="复制分享链接"
                                ><Globe size={11} /></button>
                              </>
                            )}
                            <button
                              onClick={(e) => handleDeleteQuote(q.id, e)}
                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-all"
                            ><X size={11} /></button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 公司/平台信息配置（可折叠） */}
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setInfoExpanded(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings2 size={13} className="text-gray-400" />
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">公司 / 平台信息</span>
                {!companyInfo?.company_name && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">未配置</span>
                )}
                {companyInfo?.company_name && (
                  <span className="text-xs text-gray-500 truncate max-w-[120px]">{companyInfo.company_name}</span>
                )}
              </div>
              {infoExpanded ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
            </button>

            {infoExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Building2 size={10} />公司名称</label>
                    <input value={infoForm.company_name} onChange={e => setInfoForm(p => ({...p, company_name: e.target.value}))} placeholder="某科技有限公司" className={inpCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Globe size={10} />平台名称</label>
                    <input value={infoForm.platform_name} onChange={e => setInfoForm(p => ({...p, platform_name: e.target.value}))} placeholder="AI 接入平台" className={inpCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Phone size={10} />联系电话</label>
                    <input value={infoForm.company_phone} onChange={e => setInfoForm(p => ({...p, company_phone: e.target.value}))} placeholder="400-xxx-xxxx" className={inpCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Mail size={10} />联系邮箱</label>
                    <input value={infoForm.company_email} onChange={e => setInfoForm(p => ({...p, company_email: e.target.value}))} placeholder="sales@company.com" className={inpCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><Globe size={10} />官网地址</label>
                    <input value={infoForm.company_website} onChange={e => setInfoForm(p => ({...p, company_website: e.target.value}))} placeholder="https://company.com" className={inpCls} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-1 flex items-center gap-1"><MapPin size={10} />公司地址</label>
                    <input value={infoForm.company_address} onChange={e => setInfoForm(p => ({...p, company_address: e.target.value}))} placeholder="省市区街道" className={inpCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">平台简介</label>
                  <textarea value={infoForm.platform_intro} onChange={e => setInfoForm(p => ({...p, platform_intro: e.target.value}))} rows={2} placeholder="平台特色与优势…" className={`${inpCls} resize-none`} />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setInfoExpanded(false)} className="px-3 py-1.5 text-xs border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg hover:border-accent-blue/50 hover:text-accent-blue transition-colors">取消</button>
                  <button onClick={saveCompanyInfo} disabled={infoSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-60 transition-colors">
                    {infoSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 条款模板（可折叠） */}
          <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setClauseExpanded(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <FileText size={13} className="text-gray-400" />
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">条款模板</span>
                <span className="text-[10px] text-gray-400">增值服务 / SLA / 免责声明 / 付款</span>
              </div>
              {clauseExpanded ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />}
            </button>
            {clauseExpanded && (
              <div className="px-4 pb-4 space-y-4 border-t border-border pt-3">
                {/* 增值服务 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] text-gray-600 font-semibold">三、增值服务与技术支持</label>
                    <button
                      onClick={() => setVaServices(p => [...p, { title: '', description: '', fee: '' }])}
                      className="text-[10px] text-accent-blue hover:underline flex items-center gap-0.5"
                    ><Plus size={10} />添加行</button>
                  </div>
                  <div className="space-y-1.5">
                    {vaServices.length === 0 && (
                      <div className="text-[10px] text-gray-400 text-center py-2 border border-dashed border-border rounded">留空将使用默认内容</div>
                    )}
                    {vaServices.map((s, i) => (
                      <div key={i} className="grid grid-cols-[1fr_2fr_1fr_auto] gap-1 items-center">
                        <input
                          value={s.title}
                          onChange={e => { const n = [...vaServices]; n[i] = {...n[i], title: e.target.value}; setVaServices(n) }}
                          placeholder="项目"
                          className="w-full px-2 py-1 rounded bg-white dark:bg-bg-input border border-border text-[10px] outline-none focus:border-accent-blue"
                        />
                        <input
                          value={s.description}
                          onChange={e => { const n = [...vaServices]; n[i] = {...n[i], description: e.target.value}; setVaServices(n) }}
                          placeholder="内容说明"
                          className="w-full px-2 py-1 rounded bg-white dark:bg-bg-input border border-border text-[10px] outline-none focus:border-accent-blue"
                        />
                        <input
                          value={s.fee}
                          onChange={e => { const n = [...vaServices]; n[i] = {...n[i], fee: e.target.value}; setVaServices(n) }}
                          placeholder="费用"
                          className="w-full px-2 py-1 rounded bg-white dark:bg-bg-input border border-border text-[10px] outline-none focus:border-accent-blue"
                        />
                        <button onClick={() => setVaServices(p => p.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 font-semibold mb-1">四、SLA 条款</label>
                  <textarea value={slaTerms} onChange={e => setSlaTerms(e.target.value)} rows={3} placeholder="留空将使用默认内容" className={`${inpCls} resize-none text-xs`} />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 font-semibold mb-1">五、免责声明</label>
                  <textarea value={disclaimerText} onChange={e => setDisclaimerText(e.target.value)} rows={3} placeholder="留空将使用默认内容" className={`${inpCls} resize-none text-xs`} />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-600 font-semibold mb-1">六、付款条款</label>
                  <textarea value={paymentTermsText} onChange={e => setPaymentTermsText(e.target.value)} rows={2} placeholder="留空将使用默认内容" className={`${inpCls} resize-none text-xs`} />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setClauseExpanded(false)} className="px-3 py-1.5 text-xs border border-border bg-bg-card text-gray-600 dark:text-gray-400 rounded-lg hover:border-accent-blue/50 hover:text-accent-blue transition-colors">取消</button>
                  <button onClick={saveClauseConfig} disabled={clauseSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-60 transition-colors">
                    {clauseSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ──── 右侧：报价明细 + 预览 ──── */}
        <div className="space-y-4">

          {/* 已选模型明细（可编辑） */}
          {items.length > 0 && (
            <div className="bg-bg-card border border-border rounded-xl">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between rounded-t-xl">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">报价明细 ({items.length})</div>
              </div>
              <div className="divide-y divide-border">
                {items.map(item => {
                  const availableChannels = channels.filter(ch => channelCoversModel(ch, item.model))
                  const sr = item.discount
                  return (
                    <div key={item.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-sm text-gray-900 dark:text-white">{item.model.name}</div>
                          <div className="text-xs text-gray-500">{item.model.provider}</div>
                        </div>
                        <button onClick={() => removeItem(item.id)} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={13} /></button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block text-[11px] text-gray-500 mb-1">选择通道</label>
                          <SearchableSelect
                            options={[
                              { value: -1, label: '不绑定通道' },
                              ...availableChannels.map(ch => ({
                                value: ch.id,
                                label: `${ch.name}${ch.code ? ` (${ch.code})` : ''}`,
                                hint: `${ch.supplier_name} · ${ch.computed_status}${ch.cost_discount != null ? ` · 售${fmtFold(ch.cost_discount + (ch.markup ?? 0))}` : ''}`,
                              }))
                            ]}
                            value={item.channel?.id ?? -1}
                            onChange={v => {
                              const cid = v as number
                              const newCh = cid === -1 ? null : (channels.find(c => c.id === cid) ?? null)
                              updateItem(item.id, { channel: newCh, discount: sellRate(newCh) })
                            }}
                            size="sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-gray-500 mb-1">
                            折扣（折）
                            {item.channel?.cost_discount != null && (
                              <button
                                onClick={() => updateItem(item.id, { discount: sellRate(item.channel) })}
                                className="ml-1 text-accent-blue hover:underline"
                                title={`重置为通道默认 ${fmtFold(sellRate(item.channel))}`}
                              >重置</button>
                            )}
                          </label>
                          <input
                            type="number" step="0.1" min="0.1" max="10"
                            value={item.discount != null ? parseFloat((item.discount * 10).toFixed(1)) : ''}
                            onChange={e => {
                              const v = parseFloat(e.target.value)
                              updateItem(item.id, { discount: isNaN(v) ? null : v / 10 })
                            }}
                            placeholder={item.channel?.cost_discount != null ? String(parseFloat(((sellRate(item.channel) ?? 0) * 10).toFixed(1))) : '—'}
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-bg-input border border-border text-xs outline-none focus:border-accent-blue transition-all text-gray-900 dark:text-white"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">备注</label>
                        <input value={item.custom_note} onChange={e => updateItem(item.id, { custom_note: e.target.value })}
                          placeholder="可选说明" className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-bg-input border border-border text-xs outline-none focus:border-accent-blue transition-all text-gray-900 dark:text-white" />
                      </div>

                      <div className="flex items-center gap-4 text-[11px] flex-wrap">
                        <span className="text-gray-500">官方价：
                          {item.model.input_price != null && <span className="ml-1 text-gray-700 dark:text-gray-300">↑{priceSymbol(item.model.price_currency)}{item.model.input_price}/1M</span>}
                          {item.model.output_price != null && <span className="ml-1 text-gray-700 dark:text-gray-300">↓{priceSymbol(item.model.price_currency)}{item.model.output_price}/1M</span>}
                        </span>
                        {sr != null && (
                          <span className="text-accent-blue font-semibold">报价{fmtFold(sr)}：
                            {item.model.input_price != null && <span className="ml-1">↑{priceSymbol(item.model.price_currency)}{(item.model.input_price * sr).toFixed(3)}/1M</span>}
                            {item.model.output_price != null && <span className="ml-1">↓{priceSymbol(item.model.price_currency)}{(item.model.output_price * sr).toFixed(3)}/1M</span>}
                          </span>
                        )}
                        {item.channel?.sla && Object.keys(item.channel.sla).length > 0 && (
                          <span className="text-gray-400 flex items-center gap-1"><Zap size={10} />含 SLA</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 报价单预览 */}
          <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 bg-gray-50 no-print">
              <Layers size={13} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-600">报价单预览</span>
              <span className="text-[11px] text-gray-400 ml-1">（导出后与此预览一致）</span>
            </div>
            <div className="scale-[0.85] origin-top-left w-[117.6%]">
              <QuoteDocument
                items={items} info={companyInfo}
                customerName={customerName} contactName={contactName}
                appScenario={appScenario} specialRequirements={specialRequirements}
                quoteNumber={quoteNumber} validDays={validDays} notes={notes} date={today}
                settlementMethod={settlementMethod}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
