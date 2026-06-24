import {
  Building2, Wrench, FileText, Cloud, Zap, BarChart3, TrendingUp, Sparkles, Clock,
} from 'lucide-react'

// ─── 状态配置（含卡片级别色彩）───────────────────────────────────────────────
const STATUS_META: Record<string, {
  label: string
  badge: string        // badge 文字+背景
  bar: string          // 左侧竖条颜色
  cardTint: string     // 卡片淡底色（仅 dark 模式加深一点）
}> = {
  '进行中': {
    label: '进行中',
    badge: 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
    bar: 'bg-blue-500',
    cardTint: 'bg-white dark:bg-blue-950/20',
  },
  '已签约': {
    label: '已签约',
    badge: 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    cardTint: 'bg-white dark:bg-emerald-950/20',
  },
  '已成交': {
    label: '已成交',
    badge: 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    cardTint: 'bg-white dark:bg-emerald-950/20',
  },
  '已暂停': {
    label: '已暂停',
    badge: 'bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-400',
    cardTint: 'bg-white dark:bg-amber-950/20',
  },
  '已流失': {
    label: '已流失',
    badge: 'bg-gray-100 dark:bg-gray-500/20 text-gray-500 dark:text-gray-400',
    bar: 'bg-gray-400',
    cardTint: 'bg-gray-50/50 dark:bg-gray-900/30',
  },
  '已结束': {
    label: '已结束',
    badge: 'bg-gray-100 dark:bg-gray-500/20 text-gray-500 dark:text-gray-400',
    bar: 'bg-gray-400',
    cardTint: 'bg-gray-50/50 dark:bg-gray-900/30',
  },
  '待启动': {
    label: '待启动',
    badge: 'bg-purple-50 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
    bar: 'bg-purple-500',
    cardTint: 'bg-white dark:bg-purple-950/20',
  },
  'POC': {
    label: 'POC',
    badge: 'bg-purple-50 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300',
    bar: 'bg-purple-500',
    cardTint: 'bg-white dark:bg-purple-950/20',
  },
}

function getStatus(status: string) {
  return STATUS_META[status] ?? {
    label: status,
    badge: 'bg-cyan-50 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
    bar: 'bg-cyan-500',
    cardTint: 'bg-white dark:bg-cyan-950/20',
  }
}

// ─── 货币 ────────────────────────────────────────────────────────────────────
export const CURRENCY_META: Record<string, { symbol: string; shortUnit: string }> = {
  CNY: { symbol: '¥',   shortUnit: '万' },
  USD: { symbol: '$',   shortUnit: '万' },
  HKD: { symbol: 'HK$', shortUnit: '万' },
  EUR: { symbol: '€',   shortUnit: '万' },
  JPY: { symbol: '¥',   shortUnit: '万' },
}

export function formatAmount(
  value: number | null,
  currency: string,
  unit?: string | null,
): { display: string; symbol: string; unit: string; hasValue: boolean } {
  if (value == null) return { display: '—', symbol: '', unit: '', hasValue: false }
  const meta = CURRENCY_META[currency] || CURRENCY_META.CNY
  const resolvedUnit = unit || '万元'
  const num = Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return { display: num, symbol: meta.symbol, unit: resolvedUnit, hasValue: true }
}

function splitList(s: string | null | undefined): string[] {
  if (!s) return []
  return s.split(',').map(x => x.trim()).filter(Boolean)
}

// ─── 提取最新进展摘要 ────────────────────────────────────────────────────────
// progress 格式：每条以 **[YYYY-MM-DD]** 开头，条目间用 \n\n---\n\n 分隔
function latestProgress(progress: string | null | undefined): { date: string; text: string } | null {
  if (!progress?.trim()) return null
  const blocks = progress.split(/\n{0,2}---\n{0,2}/).map(b => b.trim()).filter(Boolean)
  const last = blocks[blocks.length - 1]
  if (!last) return null
  // 提取日期（**[2026-06-24]** 格式）
  const dateMatch = last.match(/\*\*\[(\d{4}-\d{2}-\d{2})\]\*\*/)
  const date = dateMatch ? dateMatch[1] : ''
  // 提取正文：去掉日期标记后的首行非空内容
  const body = last.replace(/\*\*\[\d{4}-\d{2}-\d{2}\]\*\*\s*/, '').replace(/\*\*/g, '').trim()
  const firstLine = body.split('\n').find(l => l.trim()) || body
  const snippet = firstLine.slice(0, 80) + (firstLine.length > 80 ? '…' : '')
  return snippet ? { date, text: snippet } : null
}

// ─── 提取 AI 分析摘要 ────────────────────────────────────────────────────────
function aiSnippet(analysis: string | null | undefined): string | null {
  if (!analysis?.trim()) return null
  // 去掉 Markdown 标记后取首句（句号/换行截断）
  const clean = analysis.replace(/[#*`>]/g, '').trim()
  const firstSentence = clean.split(/[。\n]/)[0].trim()
  if (!firstSentence) return null
  return firstSentence.slice(0, 72) + (firstSentence.length > 72 ? '…' : '')
}

// ─── 接口 ─────────────────────────────────────────────────────────────────────
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
  opportunity_amount_unit?: string | null
  deal_amount: number | null
  deal_amount_unit?: string | null
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
  // Phase 1 新增
  progress: string | null
  analysis: string | null
}

interface ProjectCardProps {
  project: ProjectCardData
  onOpen: () => void
  onOpenCustomer?: (customerId: number) => void
  onOpenContracts?: (projectId: number) => void
}

// ═══════════════════════════════════════════════════════════════════════════════
// 卡片视图
// ═══════════════════════════════════════════════════════════════════════════════
export function ProjectCard({ project: p, onOpen, onOpenCustomer, onOpenContracts }: ProjectCardProps) {
  const op = formatAmount(p.opportunity_amount, p.currency, p.opportunity_amount_unit)
  const deal = formatAmount(p.deal_amount, p.currency, p.deal_amount_unit)
  const st = getStatus(p.status)
  const models = splitList(p.models)
  const clouds = splitList(p.cloud_provider)
  const channels = splitList(p.upstream_channels)
  const progress = latestProgress(p.progress)
  const aiText = aiSnippet(p.analysis)
  const hasBottom = !!(progress || aiText)

  return (
    <div
      onClick={onOpen}
      className={`group relative flex rounded-xl border border-gray-200/80 dark:border-border/50
                  hover:border-[#3B82F6]/40 dark:hover:border-[#3B82F6]/50
                  hover:shadow-md hover:-translate-y-0.5
                  transition-all duration-200 cursor-pointer overflow-hidden
                  ${st.cardTint}`}
    >
      {/* 左侧状态竖条 */}
      <div className={`w-1 shrink-0 ${st.bar}`} />

      <div className="flex-1 min-w-0 flex flex-col p-4 gap-3">

        {/* ── 标题 + 状态 ── */}
        <div className="flex items-start gap-2">
          <h4 className="flex-1 min-w-0 text-sm font-bold text-gray-900 dark:text-gray-50 leading-snug line-clamp-2 group-hover:text-[#3B82F6] transition-colors">
            {p.name}
          </h4>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.badge}`}>
            {st.label}
          </span>
        </div>

        {/* ── 客户 + 负责人 ── */}
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
                  <span className="text-gray-400 shrink-0">销售</span>
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

        {/* ── 财务双指标 ── */}
        {(op.hasValue || deal.hasValue) && (
          <div className="grid grid-cols-2 gap-2 -mx-1">
            {op.hasValue && (
              <div className="rounded-md bg-blue-50/60 dark:bg-blue-500/5 px-2.5 py-1.5">
                <div className="text-[10px] text-blue-600/70 dark:text-blue-400/70 font-semibold uppercase tracking-wider">商机</div>
                <div className="text-[15px] font-black text-blue-700 dark:text-blue-300 tabular-nums tracking-tight leading-tight mt-0.5">
                  {op.symbol}{op.display}<span className="text-[11px] font-normal ml-0.5 opacity-70">{op.unit}</span>
                </div>
              </div>
            )}
            {deal.hasValue && (
              <div className="rounded-md bg-emerald-50/60 dark:bg-emerald-500/5 px-2.5 py-1.5">
                <div className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70 font-semibold uppercase tracking-wider">成交</div>
                <div className="text-[15px] font-black text-emerald-700 dark:text-emerald-300 tabular-nums tracking-tight leading-tight mt-0.5">
                  {deal.symbol}{deal.display}<span className="text-[11px] font-normal ml-0.5 opacity-70">{deal.unit}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 技术标签：模型 / 云 / 调用量 / 毛利 ── */}
        {(models.length > 0 || clouds.length > 0 || p.monthly_call_volume || p.gross_margin != null) && (
          <div className="flex items-center flex-wrap gap-1 text-[11px]">
            {p.gross_margin != null && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 font-semibold">
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

        {/* ── 业务标签：场景 / 渠道 / 合同期 / 合同数 ── */}
        <div className="flex items-center flex-wrap gap-1 text-[11px]">
          {p.project_scenario && (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-bg-hover text-gray-600 dark:text-gray-400">{p.project_scenario}</span>
          )}
          {p.contract_period && (
            <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300">{p.contract_period}</span>
          )}
          {channels.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
              {channels[0]}{channels.length > 1 ? `+${channels.length - 1}` : ''}
            </span>
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

        {/* ── 进展 & AI 摘要底部区（有内容才渲染）── */}
        {hasBottom && (
          <div className="mt-1 pt-2.5 border-t border-gray-100 dark:border-border/30 space-y-1.5">
            {progress && (
              <div className="flex items-start gap-1.5 min-w-0">
                <Clock size={10} className="text-gray-400 dark:text-gray-500 shrink-0 mt-px" />
                <div className="min-w-0 flex-1">
                  {progress.date && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1 shrink-0">{progress.date}</span>
                  )}
                  <span className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug line-clamp-2">{progress.text}</span>
                </div>
              </div>
            )}
            {aiText && (
              <div className="flex items-start gap-1.5 min-w-0">
                <Sparkles size={10} className="text-[#3B82F6] shrink-0 mt-px" />
                <span className="text-[11px] text-gray-500 dark:text-gray-500 leading-snug line-clamp-1 italic">{aiText}</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
// 列表视图行（紧凑表格行）
// ═══════════════════════════════════════════════════════════════════════════════
export function ProjectRow({ project: p, onOpen, onOpenCustomer, onOpenContracts }: ProjectCardProps) {
  const op = formatAmount(p.opportunity_amount, p.currency, p.opportunity_amount_unit)
  const deal = formatAmount(p.deal_amount, p.currency, p.deal_amount_unit)
  const st = getStatus(p.status)
  const models = splitList(p.models)
  const clouds = splitList(p.cloud_provider)
  const channels = splitList(p.upstream_channels)
  const progress = latestProgress(p.progress)
  const aiText = aiSnippet(p.analysis)

  return (
    <tr onClick={onOpen} className="group hover:bg-bg-hover/40 transition-colors cursor-pointer">
      {/* 项目名 + 最新进展 */}
      <td className="px-4 py-2.5 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1 h-7 rounded-full ${st.bar} shrink-0`} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-gray-900 dark:text-white truncate group-hover:text-[#3B82F6] transition-colors">{p.name}</div>
            {progress ? (
              <div className="flex items-center gap-1 text-[11px] text-gray-500 truncate mt-0.5">
                <Clock size={9} className="shrink-0 text-gray-400" />
                {progress.date && <span className="text-gray-400 shrink-0">{progress.date}</span>}
                <span className="truncate">{progress.text}</span>
              </div>
            ) : p.project_scenario ? (
              <div className="text-[11px] text-gray-500 truncate mt-0.5">{p.project_scenario}</div>
            ) : null}
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
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.badge}`}>{st.label}</span>
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
          <div className="flex flex-wrap gap-1">
            {models.slice(0, 2).map((m) => (
              <span key={m} className="text-[11px] px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 font-mono inline-flex items-center gap-0.5">
                <Zap size={8} />{m}
              </span>
            ))}
            {models.length > 2 && <span className="text-[11px] text-gray-400">+{models.length - 2}</span>}
            {clouds.slice(0, 1).map((c) => (
              <span key={c} className="text-[11px] px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 inline-flex items-center gap-0.5">
                <Cloud size={8} />{c}
              </span>
            ))}
            {channels.length > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                {channels[0]}{channels.length > 1 ? `+${channels.length - 1}` : ''}
              </span>
            )}
          </div>
          {p.monthly_call_volume && (
            <span className="text-[11px] text-gray-500 inline-flex items-center gap-0.5">
              <BarChart3 size={9} className="text-gray-400" />{p.monthly_call_volume}/月
            </span>
          )}
        </div>
      </td>

      {/* AI 分析摘要 */}
      <td className="px-4 py-2.5 align-middle max-w-[200px]">
        {aiText ? (
          <div className="flex items-start gap-1 min-w-0">
            <Sparkles size={10} className="text-[#3B82F6] shrink-0 mt-px" />
            <span className="text-[11px] text-gray-500 dark:text-gray-500 truncate italic">{aiText}</span>
          </div>
        ) : <span className="text-gray-300 dark:text-gray-700 text-[11px]">—</span>}
      </td>

      {/* 合同 */}
      <td className="px-4 py-2.5 align-middle whitespace-nowrap">
        {p.contract_count != null && p.contract_count > 0 ? (
          <button
            onClick={(e) => { e.stopPropagation(); if (onOpenContracts) onOpenContracts(p.id) }}
            className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors inline-flex items-center gap-0.5"
          >
            <FileText size={9} />{p.contract_count} 份
          </button>
        ) : <span className="text-gray-400 text-xs">—</span>}
      </td>
    </tr>
  )
}
