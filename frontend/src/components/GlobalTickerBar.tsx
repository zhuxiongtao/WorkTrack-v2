import { useEffect, useState, useMemo } from 'react'
import { Megaphone, X } from 'lucide-react'

interface Announcement {
  content: string
  published_at: string | null
  enabled: boolean
}

interface Props {
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function GlobalTickerBar({ fetchWithAuth }: Props) {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchWithAuth('/api/v1/news/announcement')
        if (res.ok) setAnnouncement(await res.json())
      } catch { /* silent */ }
    }
    load()
    const t = setInterval(load, 10 * 60 * 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const text = useMemo(() => {
    if (!announcement?.enabled || !announcement.content.trim()) return ''
    return stripHtml(announcement.content).slice(0, 300)
  }, [announcement])

  // 根据文本长度计算滚动时长
  const duration = useMemo(() => Math.max(20, Math.round(text.length * 0.14)), [text])

  if (!text || dismissed) return null

  return (
    <div
      className="sticky top-0 z-50 flex items-center h-7 border-b border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/10 backdrop-blur-sm shrink-0 overflow-hidden"
      style={{ minHeight: 28, maxHeight: 28 }}
    >
      {/* 左侧图标 + 标签 */}
      <div className="flex items-center gap-1.5 px-2.5 shrink-0 h-full border-r border-amber-500/30">
        <Megaphone size={10} className="text-amber-500 shrink-0" />
        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">公告</span>
      </div>

      {/* 横向滚动 */}
      <div className="flex-1 overflow-hidden h-full">
        <div
          className="flex items-center h-full whitespace-nowrap"
          style={{ animation: `globalTicker ${duration}s linear infinite`, willChange: 'transform' }}
        >
          {/* 复制两份实现无缝循环 */}
          <span className="inline-block text-[11px] font-medium text-amber-700 dark:text-amber-300 pr-24">{text}</span>
          <span className="inline-block text-[11px] font-medium text-amber-700 dark:text-amber-300 pr-24">{text}</span>
        </div>
      </div>

      {/* 关闭按钮 */}
      <button
        onClick={() => setDismissed(true)}
        className="p-1.5 shrink-0 hover:bg-amber-500/20 text-amber-500 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
        title="关闭"
      >
        <X size={10} />
      </button>
    </div>
  )
}
