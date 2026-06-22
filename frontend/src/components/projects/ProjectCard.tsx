import {
  Building2, Wrench, FileText, Cloud, Zap, BarChart3, Calendar, AlertTriangle, Clock, TrendingUp,
} from 'lucide-react'

const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  '进行中':   { label: '进行中', bg: 'bg-blue-50 dark:bg-blue-500/15',      text: 'text-blue-700 dark:text-blue-300',      dot: 'bg-blue-500' },
  '已签约':   { label: '已签约', bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  '已成交':   { label: '已成交', bg: 'bg-emerald-50 dark:bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  '已暂停':   { label: '已暂停', bg: 'bg-amber-50 dark:bg-amber-500/15',    text: 'text-amber-700 dark:text-amber-300',    dot: 'bg-amber-500' },
  '已流失':   { label: '已流失', bg: 'bg-gray-100 dark:bg-gray-500/15',     text: 'text-gray-600 dark:text-gray-400',      dot: 'bg-gray-400' },
  '已结束':   { label: '已结束', bg: 'bg-gray-100 dark:bg-gray-500/15',     text: 'text-gray-600 dark:text-gray-400',      dot: 'bg-gray-400' },
  '待启动':   { label: '待启动', bg: 'bg-purple-50 dark:bg-purple-500/15',  text: 'text-purple-700 dark:text-purple-300',  dot: 'bg-purple-500' },
  'POC':      { label: 'POC',    bg: 'bg-purple-50 dark:bg-purple-500/15',  text: 'text-purple-700 dark:text-purple-300',  dot: 'bg-purple-500' },
}

function getStatus(status: string) {
  return STATUS_META[status] || { label: status, bg: 'bg-cyan-50 dark:bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300', dot: 'bg-cyan-500' }
}

export const CURRENCY_META: Record<string, { symbol: string; shortUnit: string }> = {
  CNY: { symbol: '¥',   shortUnit: '万' },
  USD: { symbol: '$',   shortUnit: '万' },
  HKD: { symbol: 'HK$', shortUnit: '万' },
  EUR: { symbol: '€',   shortUnit: '万' },
  JPY: { symbol: '¥',   shortUnit: '万' },
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
  cost_amount: number | null
  gross_margin: number | null
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
  const status = getStatus(p.status)
  const products = splitList(p.product)
  const channels = splitList(p.upstream_channels)
  const models = splitList(p.models)
  const clouds = splitList(p.cloud_provider)

  // 时间节点计算
  const keyDate = p.termination_date || p.deadline
  const daysToKey = daysUntil(keyDate)
  const isOverdue = daysToKey != null && daysToKey < 0
  const isSoon = daysToKey != null && daysToKey >= 0 && daysToKey <= 30
  const dateLabel = p.termination_date ? '到期' : p.deadline ? '截止' : null

  return (
    <div
      onClick={onOpen}
      className="group relative flex flex-col rounded-xl bg-white dark:bg-bg-card
                 border border-gray-200/80 dark:border-border/50
                 hover:border-[#3B82F6]/40 dark:hover:border-[#3B82F6]/40
                 hover:shadow-md hover:-translate-y-0.5
                 transition-all duration-200 cursor-pointer overflow-hidden"
    >
      {/* 状态色条 */}
      <div className={`h-1 w-full ${status.dot}`} />

      <div className="p-4 flex flex-col gap-3">
        {/* 标题 + 状态 */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-50 leading-snug line-clamp-2 group-hover:text-[#3B82F6] transition-colors">
              {p.name}
            </h4>
            {p.usage_scenario && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{p.usage_scenario}</p>
            )}
          </div>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.text} shrink-0`}>
            {status.label}
          </span>
        </div>

        {/* 客户 + 销售 + 技术支持 */}
        <div className="flex flex-col gap-1 text-xs min-w-0">
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
                <span className="inline-flex items-center gap-0.5">
                  <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">销售</span>
                  <span className="truncate">{p.sales_person}</span>
                </span>
              )}
              {p.sales_person && p.tech_support_person && <span className="text-gray-300 dark:text-gray-600">·</span>}
              {p.tech_support_person && (
                <span className="inline-flex items-center gap-0.5">
                  <Wrench size={9} className="shrink-0 text-gray-400" />
                  <span className="truncate">{p.tech_support_person}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* 财务双指标 */}
        {(op.hasValue || deal.hasValue) && (
          <div className="grid grid-cols-2 gap-2 -mx-1">
            {op.hasValue && (
              <div className="rounded-md bg-blue-50/60 dark:bg-blue-500/5 px-2.5 py-1.5">
                <div className="text-[11px] text-blue-600/70 dark:text-blue-400/70 font-semibold uppercase tracking-wider">商机</div>
                <div className="text-[15px] font-black text-blue-700 dark:text-blue-300 tabular-nums tracking-tight leading-tight mt-0.5">
                  {op.symbol}{op.display}<span className="text-[11px] font-normal ml-0.5 opacity-70">{op.unit}</span>
                </div>
              </div>
            )}
            {deal.hasValue && (
              <div className="rounded-md bg-emerald-50/60 dark:bg-emerald-500/5 px-2.5 py-1.5">
                <div className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 font-semibold uppercase tracking-wider">成交</div>
                <div className="text-[15px] font-black text-emerald-700 dark:text-emerald-300 tabular-nums tracking-tight leading-tight mt-0.5">
                  {deal.symbol}{deal.display}<span className="text-[11px] font-normal ml-0.5 opacity-70">{deal.unit}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI 模型 + 云服务商 */}
        {(models.length > 0 || clouds.length > 0 || p.monthly_call_volume) && (
          <div className="flex items-center flex-wrap gap-1 text-[11px] pb-1 border-b border-gray-100 dark:border-border/40">
            {p.gross_margin != null && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 font-semibold" title="毛利率">
                <TrendingUp size={8} className="shrink-0" />{p.gross_margin}%
              </span>
            )}
            {models.slice(0, 2).map((m) => (
              <span key={m} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 font-mono">
                <Zap size={8} className="shrink-0" />{m}
              </span>
            ))}
            {models.length > 2 && <span className="text-gray-400">+{models.length - 2}</span>}
            {clouds.slice(0, 1).map((c) => (
              <span key={c} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <Cloud size={8} className="shrink-0" />{c}
              </span>
            ))}
            {p.monthly_call_volume && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <BarChart3 size={8} className="shrink-0" />{p.monthly_call_volume}/月
              </span>
            )}
          </div>
        )}

        {/* 场景·产品·渠道·合同期·合同数 */}
        <div className="flex items-center flex-wrap gap-1 text-[11px]">
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
          {p.contract_count != null && p.contract_count > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); if (onOpenContracts) onOpenContracts(p.id) }}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
              title="查看关联合同"
            >
              <FileText size={9} />{p.contract_count} 份合同
            </button>
          )}
        </div>

        {/* 时间节点底栏 */}
        {(p.start_date || keyDate) && (
          <div className={`-mx-4 -mb-4 px-4 py-2 flex items-center gap-2 text-[11px] border-t ${
            isOverdue
              ? 'border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5'
              : isSoon
                ? 'border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5'
                : 'border-gray-100 dark:border-border/40 bg-gray-50/50 dark:bg-bg-hover/20'
          }`}>
            {isOverdue ? (
              <AlertTriangle size={10} className="text-red-500 shrink-0" />
            ) : isSoon ? (
              <Clock size={10} className="text-amber-500 shrink-0" />
            ) : (
              <Calendar size={10} className="text-gray-400 shrink-0" />
            )}
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              {p.start_date && (
                <span className="text-gray-500 dark:text-gray-500">{formatDateShort(p.start_date)}</span>
              )}
              {p.start_date && keyDate && <span className="text-gray-300 dark:text-gray-600">→</span>}
              {keyDate && (
                <span className={
                  isOverdue ? 'text-red-600 dark:text-red-400 font-semibold' :
                  isSoon ? 'text-amber-600 dark:text-amber-400 font-semibold' :
                  'text-gray-500 dark:text-gray-400'
                }>
                  {dateLabel} {formatDateShort(keyDate)}
                  {daysToKey != null && (
                    <span className="ml-1 opacity-70">
                      {isOverdue ? `（已逾期 ${Math.abs(daysToKey)} 天）` : `（${daysToKey} 天后）`}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 列表视图行（紧凑表格行） */
export function ProjectRow({ project: p, onOpen, onOpenCustomer, onOpenContracts }: ProjectCardProps) {
  const op = formatAmount(p.opportunity_amount, p.currency)
  const deal = formatAmount(p.deal_amount, p.currency)
  const status = getStatus(p.status)
  const products = splitList(p.product)
  const channels = splitList(p.upstream_channels)
  const models = splitList(p.models)
  const clouds = splitList(p.cloud_provider)

  // 时间节点
  const keyDate = p.termination_date || p.deadline
  const daysToKey = daysUntil(keyDate)
  const isOverdue = daysToKey != null && daysToKey < 0
  const isSoon = daysToKey != null && daysToKey >= 0 && daysToKey <= 30
  const dateLabel = p.termination_date ? '到期' : p.deadline ? '截止' : ''

  return (
    <tr onClick={onOpen} className="group hover:bg-bg-hover/40 transition-colors cursor-pointer">
      {/* 项目名 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1 h-7 rounded-full ${status.dot} shrink-0`} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-gray-900 dark:text-white truncate group-hover:text-[#3B82F6] transition-colors">{p.name}</div>
            {p.project_scenario && (
              <div className="text-[11px] text-gray-500 truncate mt-0.5">{p.project_scenario}</div>
            )}
          </div>
        </div>
      </td>

      {/* 客户 / 负责人 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="min-w-0">
          {p.customer_name ? (
            <button
              onClick={(e) => { e.stopPropagation(); if (p.customer_id && onOpenCustomer) onOpenCustomer(p.customer_id) }}
              className={`text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[160px] block ${p.customer_id ? 'hover:text-[#3B82F6] cursor-pointer' : 'cursor-default'}`}
            >
              {p.customer_name}
            </button>
          ) : <span className="text-gray-400 text-xs">—</span>}
          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-500 flex-wrap">
            {p.sales_person && (
              <span className="inline-flex items-center gap-0.5">
                <span className="text-gray-400">销</span>{p.sales_person}
              </span>
            )}
            {p.sales_person && p.tech_support_person && <span className="text-gray-300 dark:text-gray-600">·</span>}
            {p.tech_support_person && (
              <span className="inline-flex items-center gap-0.5">
                <Wrench size={9} className="text-gray-400" />{p.tech_support_person}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* 状态 */}
      <td className="px-4 py-2.5 align-middle whitespace-nowrap">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
      </td>

      {/* 商机 */}
      <td className="px-4 py-2.5 align-middle text-right whitespace-nowrap">
        {op.hasValue ? (
          <div className="text-[13px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">{op.symbol}{op.display}<span className="text-[11px] ml-0.5 opacity-70">{op.unit}</span></div>
        ) : <span className="text-gray-400">—</span>}
      </td>

      {/* 成交 */}
      <td className="px-4 py-2.5 align-middle text-right whitespace-nowrap">
        {deal.hasValue ? (
          <div>
            <div className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{deal.symbol}{deal.display}<span className="text-[11px] ml-0.5 opacity-70">{deal.unit}</span></div>
            {p.gross_margin != null && (
              <div className="text-[11px] text-green-600 dark:text-green-400 tabular-nums mt-0.5">毛利 {p.gross_margin}%</div>
            )}
          </div>
        ) : <span className="text-gray-400">—</span>}
      </td>

      {/* 产品 / 模型 / 渠道 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="flex flex-col gap-1 max-w-[220px]">
          {/* 产品 + 渠道 */}
          {(products.length > 0 || channels.length > 0) && (
            <div className="flex items-center gap-1 flex-wrap">
              {products.slice(0, 2).map((pr) => (
                <span key={pr} className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 whitespace-nowrap">{pr}</span>
              ))}
              {products.length > 2 && <span className="text-[11px] text-gray-400">+{products.length - 2}</span>}
              {channels.slice(0, 1).map((c) => (
                <span key={c} className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 whitespace-nowrap">{c}{channels.length > 1 ? `+${channels.length - 1}` : ''}</span>
              ))}
            </div>
          )}
          {/* AI 模型 + 云服务商 */}
          {(models.length > 0 || clouds.length > 0) && (
            <div className="flex items-center gap-1 flex-wrap">
              {models.slice(0, 2).map((m) => (
                <span key={m} className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 font-mono whitespace-nowrap">
                  <Zap size={8} />{m}
                </span>
              ))}
              {models.length > 2 && <span className="text-[11px] text-gray-400">+{models.length - 2}</span>}
              {clouds.slice(0, 1).map((c) => (
                <span key={c} className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-300 whitespace-nowrap">
                  <Cloud size={8} />{c}
                </span>
              ))}
            </div>
          )}
          {products.length === 0 && channels.length === 0 && models.length === 0 && clouds.length === 0 && (
            <span className="text-gray-400 text-[11px]">—</span>
          )}
        </div>
      </td>

      {/* 调用量 + 时间节点 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="flex flex-col gap-1 min-w-[110px]">
          {p.monthly_call_volume && (
            <div className="inline-flex items-center gap-0.5 text-[11px] text-cyan-600 dark:text-cyan-400">
              <BarChart3 size={9} className="shrink-0" />{p.monthly_call_volume}/月
            </div>
          )}
          {keyDate && (
            <div className={`inline-flex items-center gap-0.5 text-[11px] ${
              isOverdue ? 'text-red-500 dark:text-red-400 font-semibold'
                : isSoon ? 'text-amber-500 dark:text-amber-400 font-semibold'
                : 'text-gray-500 dark:text-gray-500'
            }`}>
              {isOverdue ? <AlertTriangle size={9} className="shrink-0" /> : isSoon ? <Clock size={9} className="shrink-0" /> : <Calendar size={9} className="shrink-0" />}
              {dateLabel} {formatDateShort(keyDate)}
            </div>
          )}
          {p.start_date && !keyDate && (
            <div className="inline-flex items-center gap-0.5 text-[11px] text-gray-500">
              <Calendar size={9} className="shrink-0" />始 {formatDateShort(p.start_date)}
            </div>
          )}
          {!p.monthly_call_volume && !keyDate && !p.start_date && (
            <span className="text-gray-400 text-[11px]">—</span>
          )}
        </div>
      </td>

      {/* 合同期 + 合同数 */}
      <td className="px-4 py-2.5 align-middle whitespace-nowrap">
        <div className="flex flex-col gap-0.5">
          {p.contract_period && (
            <span className="text-[11px] text-purple-600 dark:text-purple-300 font-medium">{p.contract_period}</span>
          )}
          {p.contract_count != null && p.contract_count > 0 ? (
            <button
              onClick={(e) => { e.stopPropagation(); if (onOpenContracts) onOpenContracts(p.id) }}
              className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors font-semibold w-fit"
              title="查看关联合同"
            >
              <FileText size={9} />{p.contract_count} 份
            </button>
          ) : !p.contract_period ? <span className="text-gray-400 text-[11px]">—</span> : null}
        </div>
      </td>
    </tr>
  )
}
