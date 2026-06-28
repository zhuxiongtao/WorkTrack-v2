import { useEffect, useState, useRef } from 'react'
import { Newspaper, Loader2, RefreshCw } from 'lucide-react'

// ============= 类型定义 =============
export interface NewsItem {
  id: number
  title: string
  url: string
  source: string
  description: string
  category: string  // official / social / community / media / other
  pub_date: string | null
  fetched_at: string | null
}

interface MarqueeBannerProps {
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>
}

// ============= 分类颜色映射 =============
// 浅色用饱和的实色背景+深字；深色用半透明 + 淡字
const CATEGORY_STYLES: Record<string, { label: string; cls: string }> = {
  official:  { label: '官方', cls: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30' },
  social:    { label: '社交', cls: 'bg-pink-100 text-pink-700 border-pink-300 dark:bg-pink-500/20 dark:text-pink-300 dark:border-pink-500/30' },
  community: { label: '社区', cls: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30' },
  media:     { label: '媒体', cls: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30' },
  other:     { label: '资讯', cls: 'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30' },
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

// ============= 单条资讯行（固定高度，整列对齐）=============
function NewsRow({ n, onClick }: { n: NewsItem; onClick: () => void }) {
  const cs = CATEGORY_STYLES[n.category] || CATEGORY_STYLES.other
  return (
    <a
      href={n.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="group flex items-center gap-2 px-3 h-[22px] hover:bg-cyan-50 dark:hover:bg-cyan-500/5 transition-colors cursor-pointer border-b border-gray-200 dark:border-border/5 last:border-b-0"
      title={n.title}
    >
      <span className={`shrink-0 text-[11px] px-1.5 py-px rounded border font-bold leading-[14px] ${cs.cls}`}>
        {cs.label}
      </span>
      <span className="flex-1 min-w-0 truncate text-[11px] text-gray-800 group-hover:text-cyan-700 dark:text-gray-300 dark:group-hover:text-cyan-300 transition-colors">
        {n.title}
      </span>
      <span className="text-[11px] text-gray-500 dark:text-gray-600 shrink-0 hidden xl:inline-block max-w-[120px] truncate">
        {n.source.replace(/[（(].*?[)）]/g, '').replace(/^X[:：]\s*/i, '').slice(0, 12)}
      </span>
      <span className="text-[11px] text-gray-500 dark:text-gray-600 shrink-0 tabular-nums">
        {formatTimeAgo(n.pub_date)}
      </span>
    </a>
  )
}

// ============= 主组件 =============
export function MarqueeBanner({ fetchWithAuth }: MarqueeBannerProps) {
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // 滚动列表的 ref + RAF 状态
  const listRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const offsetRef = useRef(0)         // 累计 translateY 偏移（px）
  const hoveringRef = useRef(false)   // 鼠标是否在列表上
  const rafRef = useRef<number | null>(null)

  const loadAll = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const nRes = await fetchWithAuth('/api/v1/news/feed?limit=50')
      if (nRes.ok) {
        const n = await nRes.json()
        setNewsItems(n.items || [])
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadAll()
    const t = setInterval(() => loadAll(), 10 * 60 * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 自动滚动（RAF 驱动）=====
  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    offsetRef.current = 0
    inner.style.transform = 'translateY(0)'

    const apply = () => {
      if (inner) inner.style.transform = `translateY(-${offsetRef.current}px)`
    }
    const halfH = () => (inner.scrollHeight / 2) || 0
    const tick = () => {
      if (!hoveringRef.current) {
        offsetRef.current += 0.2 // ~12px/s，较慢的阅读速度
        const half = halfH()
        if (half > 0 && offsetRef.current >= half) offsetRef.current = 0
        apply()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [newsItems])

  // ===== 鼠标滚轮：手动上下滚动 =====
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const inner = innerRef.current
      if (!inner) return
      const half = inner.scrollHeight / 2
      if (half <= 0) return
      offsetRef.current += e.deltaY
      // 无缝循环：超出 [0, half) 区间则环绕
      if (offsetRef.current < 0) offsetRef.current += half
      if (offsetRef.current >= half) offsetRef.current -= half
      inner.style.transform = `translateY(-${offsetRef.current}px)`
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [newsItems])

  const onListEnter = () => { hoveringRef.current = true }
  const onListLeave = () => { hoveringRef.current = false }

  const hasContent = newsItems.length > 0
  if (loading && !hasContent) {
    return (
      <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
        <Loader2 size={12} className="animate-spin text-gray-500" />
        <span className="text-[11px] text-gray-500">加载信息流...</span>
      </div>
    )
  }
  if (!hasContent) return null

  return (
    <>
      <div className="hidden lg:flex flex-col w-[440px] xl:w-[560px] 2xl:w-[680px] shrink-0">
        {/* 顶部：公告 + AI 资讯 小标题（行内，紧凑）*/}
        <div className="flex items-center justify-between mb-1 px-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Newspaper size={11} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
            <span className="text-[11px] font-bold text-cyan-700 dark:text-cyan-300 shrink-0">AI 资讯</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-600 truncate">· 来源 aihot.virxact.com</span>
          </div>
          <button
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors shrink-0"
            title="手动刷新"
          >
            <RefreshCw size={9} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* ===== AI 资讯列表（无外框，融入 hero 背景，固定高度视口）===== */}
        {newsItems.length > 0 && (
          <div
            ref={listRef}
            onMouseEnter={onListEnter}
            onMouseLeave={onListLeave}
            className="relative h-[132px] overflow-hidden ticker-mask cursor-ns-resize"
            title="滚轮上下滚动，移开后自动继续"
          >
            <div ref={innerRef} className="will-change-transform">
              {newsItems.slice(0, 20).map((n) => (
                <NewsRow key={n.id} n={n} onClick={() => {}} />
              ))}
              {/* 复制一份实现无缝循环 */}
              {newsItems.slice(0, 20).map((n) => (
                <NewsRow key={`dup-${n.id}`} n={n} onClick={() => {}} />
              ))}
            </div>
          </div>
        )}
      </div>

    </>
  )
}
