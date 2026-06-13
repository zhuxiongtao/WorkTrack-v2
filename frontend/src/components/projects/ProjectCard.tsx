import {
  Building2, Calendar, ArrowUpRight, Wrench, FileText
} from 'lucide-react'

const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  '进行中':   { label: '进行中', bg: 'bg-blue-50 dark:bg-blue-500/15',   text: 'text-blue-700 dark:text-blue-300',  dot: 'bg-blue-500' },
  '已签约':   { label: '已签约', bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  '已成交':   { label: '已成交', bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  '已暂停':   { label: '已暂停', bg: 'bg-amber-50 dark:bg-amber-500/15',  text: 'text-amber-700 dark:text-amber-300',  dot: 'bg-amber-500' },
  '已流失':   { label: '已流失', bg: 'bg-gray-100 dark:bg-gray-500/15',  text: 'text-gray-600 dark:text-gray-400',  dot: 'bg-gray-400' },
  '已结束':   { label: '已结束', bg: 'bg-gray-100 dark:bg-gray-500/15',  text: 'text-gray-600 dark:text-gray-400',  dot: 'bg-gray-400' },
  '待启动':   { label: '待启动', bg: 'bg-purple-50 dark:bg-purple-500/15', text: 'text-purple-700 dark:text-purple-300', dot: 'bg-purple-500' },
  'POC':      { label: 'POC',    bg: 'bg-purple-50 dark:bg-purple-500/15', text: 'text-purple-700 dark:text-purple-300', dot: 'bg-purple-500' },
}

function getStatus(status: string) {
  return STATUS_META[status] || { label: status, bg: 'bg-cyan-50 dark:bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300', dot: 'bg-cyan-500' }
}

export const CURRENCY_META: Record<string, { symbol: string; shortUnit: string }> = {
  CNY: { symbol: '¥',  shortUnit: '万' },
  USD: { symbol: '$',  shortUnit: '万' },
  HKD: { symbol: 'HK$', shortUnit: '万' },
  EUR: { symbol: '€',  shortUnit: '万' },
  JPY: { symbol: '¥',  shortUnit: '万' },
}

export function formatAmount(value: number | null, currency: string): { display: string; symbol: string; unit: string; hasValue: boolean } {
  if (value == null) return { display: '—', symbol: '', unit: '', hasValue: false }
  const meta = CURRENCY_META[currency] || CURRENCY_META.CNY
  const num = Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return { display: num, symbol: meta.symbol, unit: meta.shortUnit, hasValue: true }
}

function splitList(s: string | null | undefined): string[] {
  if (!s) return []
  return s.split(',').map(x => x.trim()).filter(Boolean)
}

function formatDate(s: string | null): string {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) }
  catch { return s }
}

function formatDateShort(s: string | null): string {
  if (!s) return ''
  try {
    const d = new Date(s)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  } catch { return s }
}

function daysUntil(s: string | null): number | null {
  if (!s) return null
  const t = new Date(s).getTime()
  if (isNaN(t)) return null
  return Math.floor((t - Date.now()) / (1000 * 60 * 60 * 24))
}

export interface ProjectCardData {
  id: number
  name: string
  customer_name: string
  customer_id: number | null
  product: string | null
  project_scenario: string | null
  sales_person: string | null
  tech_support_person: string | null
  status: string
  currency: string
  opportunity_amount: number | null
  deal_amount: number | null
  cloud_provider: string | null
  upstream_channels: string | null
  models: string | null
  monthly_call_volume: string | null
  contract_period: string | null
  discount_rate: number | null
  usage_scenario: string | null
  start_date: string | null
  termination_date: string | null
  deadline: string | null
  contract_count?: number
}

interface ProjectCardProps {
  project: ProjectCardData
  onOpen: () => void
  onOpenCustomer?: (customerId: number) => void
  onOpenContracts?: (projectId: number) => void
}

export function ProjectCard({ project: p, onOpen, onOpenCustomer, onOpenContracts }: ProjectCardProps) {
  const op = formatAmount(p.opportunity_amount, p.currency)
  const deal = formatAmount(p.deal_amount, p.currency)
  const daysToTerm = daysUntil(p.termination_date)
  const termUrgency = daysToTerm == null ? null : daysToTerm < 0 ? 'overdue' : daysToTerm <= 14 ? 'soon' : 'ok'
  const status = getStatus(p.status)
  const products = splitList(p.product)
  const channels = splitList(p.upstream_channels)

  return (
    <div
      onClick={onOpen}
      className="group relative flex flex-col rounded-xl bg-white dark:bg-bg-card
                 border border-gray-200/80 dark:border-border/50
                 hover:border-[#3B82F6]/40 dark:hover:border-[#3B82F6]/40
                 hover:shadow-md hover:-translate-y-0.5
                 transition-all duration-200 cursor-pointer overflow-hidden"
    >
      {/* 顶部色条（4px，状态色）—— 视觉锚点 + 状态色编码 */}
      <div className={`h-1 w-full ${status.dot}`} />

      <div className="p-4 flex flex-col gap-3">
        {/* 标题行：项目名 + 状态 badge */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="text-[14px] font-bold text-gray-900 dark:text-gray-50 leading-snug line-clamp-2 group-hover:text-[#3B82F6] transition-colors">
              {p.name}
            </h4>
            {p.usage_scenario && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                {p.usage_scenario}
              </p>
            )}
          </div>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.text} shrink-0`}>
            {status.label}
          </span>
          <ArrowUpRight
            size={14}
            className="text-gray-300 dark:text-gray-600 group-hover:text-[#3B82F6] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5"
          />
        </div>

        {/* 客户 + 销售 + 技术支持：两行克制呈现 */}
        <div className="flex flex-col gap-1 text-[12px] min-w-0">
          <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 min-w-0">
            {p.customer_name ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (p.customer_id && onOpenCustomer) onOpenCustomer(p.customer_id) }}
                className={`flex items-center gap-1 min-w-0 ${p.customer_id ? 'hover:text-[#3B82F6] transition-colors' : 'cursor-default'}`}
              >
                <Building2 size={11} className="shrink-0" />
                <span className="truncate font-medium">{p.customer_name}</span>
              </button>
            ) : (
              <span className="text-gray-400">未指定客户</span>
            )}
          </div>
          {(p.sales_person || p.tech_support_person) && (
            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-500 text-[11px] min-w-0 flex-wrap">
              {p.sales_person && (
                <span className="inline-flex items-center gap-0.5 min-w-0">
                  <span className="text-[9px] text-gray-400 dark:text-gray-600 shrink-0">销售</span>
                  <span className="truncate">{p.sales_person}</span>
                </span>
              )}
              {p.sales_person && p.tech_support_person && <span className="text-gray-300 dark:text-gray-600">·</span>}
              {p.tech_support_person && (
                <span className="inline-flex items-center gap-0.5 min-w-0">
                  <Wrench size={9} className="shrink-0 text-gray-400" />
                  <span className="truncate">{p.tech_support_person}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* 财务双指标：商机 / 成交（大字号 + 颜色编码）*/}
        {(op.hasValue || deal.hasValue) && (
          <div className="grid grid-cols-2 gap-2 -mx-1">
            {op.hasValue && (
              <div className="rounded-md bg-blue-50/60 dark:bg-blue-500/5 px-2.5 py-1.5">
                <div className="text-[9px] text-blue-600/70 dark:text-blue-400/70 font-semibold uppercase tracking-wider">商机</div>
                <div className="text-[15px] font-black text-blue-700 dark:text-blue-300 tabular-nums tracking-tight leading-tight mt-0.5">
                  {op.symbol}{op.display}<span className="text-[10px] font-normal ml-0.5 opacity-70">{op.unit}</span>
                </div>
              </div>
            )}
            {deal.hasValue && (
              <div className="rounded-md bg-emerald-50/60 dark:bg-emerald-500/5 px-2.5 py-1.5">
                <div className="text-[9px] text-emerald-600/70 dark:text-emerald-400/70 font-semibold uppercase tracking-wider">成交</div>
                <div className="text-[15px] font-black text-emerald-700 dark:text-emerald-300 tabular-nums tracking-tight leading-tight mt-0.5">
                  {deal.symbol}{deal.display}<span className="text-[10px] font-normal ml-0.5 opacity-70">{deal.unit}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 标签行：场景 · 产品 · 合同期 · 关联合同数 */}
        <div className="flex items-center flex-wrap gap-1 text-[10px]">
          {p.project_scenario && (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-bg-hover text-gray-600 dark:text-gray-400">{p.project_scenario}</span>
          )}
          {products.slice(0, 2).map((pr) => (
            <span key={pr} className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300">{pr}</span>
          ))}
          {products.length > 2 && <span className="text-gray-400">+{products.length - 2}</span>}
          {p.contract_period && (
            <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300">{p.contract_period}</span>
          )}
          {channels.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">{channels[0]}{channels.length > 1 ? `+${channels.length - 1}` : ''}</span>
          )}
          {/* 关联合同数徽章（点击跳合同页） */}
          {p.contract_count != null && p.contract_count > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); if (onOpenContracts) onOpenContracts(p.id) }}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
              title="查看关联合同"
            >
              <FileText size={9} />
              {p.contract_count} 份合同
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

/** 列表视图行（紧凑表格行） */
export function ProjectRow({ project: p, onOpen, onOpenCustomer }: ProjectCardProps) {
  const op = formatAmount(p.opportunity_amount, p.currency)
  const deal = formatAmount(p.deal_amount, p.currency)
  const daysToTerm = daysUntil(p.termination_date)
  const termUrgency = daysToTerm == null ? null : daysToTerm < 0 ? 'overdue' : daysToTerm <= 14 ? 'soon' : 'ok'
  const status = getStatus(p.status)
  const products = splitList(p.product)
  const channels = splitList(p.upstream_channels)

  return (
    <tr
      onClick={onOpen}
      className="group hover:bg-bg-hover/40 transition-colors cursor-pointer"
    >
      {/* 项目 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1 h-7 rounded-full ${status.dot} shrink-0`} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-gray-900 dark:text-white truncate group-hover:text-[#3B82F6] transition-colors">{p.name}</div>
            {p.usage_scenario && <div className="text-[10px] text-gray-500 dark:text-gray-500 truncate mt-0.5">{p.usage_scenario}</div>}
          </div>
        </div>
      </td>
      {/* 客户/销售 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="text-[12px] text-gray-700 dark:text-gray-300 truncate max-w-[180px]">
          {p.customer_name ? (
            <button
              onClick={(e) => { e.stopPropagation(); if (p.customer_id && onOpenCustomer) onOpenCustomer(p.customer_id) }}
              className={`${p.customer_id ? 'hover:text-[#3B82F6] cursor-pointer' : 'cursor-default'}`}
            >
              {p.customer_name}
            </button>
          ) : <span className="text-gray-400">—</span>}
        </div>
        {p.sales_person && <div className="text-[10px] text-gray-500 dark:text-gray-500 truncate mt-0.5 max-w-[180px]">{p.sales_person}</div>}
      </td>
      {/* 状态 */}
      <td className="px-4 py-2.5 align-middle whitespace-nowrap">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
      </td>
      {/* 商机 */}
      <td className="px-4 py-2.5 align-middle text-right whitespace-nowrap">
        {op.hasValue ? (
          <div className="text-[13px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">{op.symbol}{op.display}<span className="text-[10px] ml-0.5 opacity-70">{op.unit}</span></div>
        ) : <span className="text-gray-400">—</span>}
      </td>
      {/* 成交 */}
      <td className="px-4 py-2.5 align-middle text-right whitespace-nowrap">
        {deal.hasValue ? (
          <div className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{deal.symbol}{deal.display}<span className="text-[10px] ml-0.5 opacity-70">{deal.unit}</span></div>
        ) : <span className="text-gray-400">—</span>}
      </td>
      {/* 产品/渠道 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="flex items-center gap-1 flex-wrap max-w-[200px]">
          {products.slice(0, 2).map((pr) => (
            <span key={pr} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 whitespace-nowrap">{pr}</span>
          ))}
          {products.length > 2 && <span className="text-[9px] text-gray-400">+{products.length - 2}</span>}
          {channels.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 whitespace-nowrap">{channels[0]}{channels.length > 1 ? `+${channels.length - 1}` : ''}</span>
          )}
          {products.length === 0 && channels.length === 0 && <span className="text-gray-400">—</span>}
        </div>
      </td>
      {/* 合同周期 */}
      <td className="px-4 py-2.5 align-middle whitespace-nowrap">
        {p.contract_period ? <span className="text-[11px] text-purple-600 dark:text-purple-300 font-medium">{p.contract_period}</span> : <span className="text-gray-400">—</span>}
      </td>
      {/* 关联合同数（点击跳合同页） */}
      <td className="px-4 py-2.5 align-middle whitespace-nowrap">
        {p.contract_count != null && p.contract_count > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); if (onOpenContracts) onOpenContracts(p.id) }}
            className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors font-semibold"
            title="查看关联合同"
          >
            <FileText size={10} />{p.contract_count}
          </button>
        ) : <span className="text-gray-400 text-[11px]">—</span>}
      </td>
    </tr>
  )
}
