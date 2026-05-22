import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ChevronRight, ChevronDown, List } from 'lucide-react'

interface TocItem {
  level: number
  text: string
  id: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function extractHeadings(html: string): TocItem[] {
  if (!html) return []
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const headings = doc.querySelectorAll('h1, h2, h3')
    return Array.from(headings).map(h => ({
      level: parseInt(h.tagName[1]),
      text: h.textContent?.trim() || '',
      id: slugify(h.textContent?.trim() || ''),
    }))
  } catch {
    return []
  }
}

interface TocPanelProps {
  html: string
  className?: string
  /** 嵌入模式下不显示外层边框和背景 */
  embedded?: boolean
  /** 内联模式：放在编辑区正文左侧（飞书风格） */
  inline?: boolean
}

export default function TocPanel({ html, className = '', embedded = false, inline = false }: TocPanelProps) {
  const [activeId, setActiveId] = useState<string>('')
  const [collapsed, setCollapsed] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const isClickScrollingRef = useRef(false)
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<Set<string>>(new Set())

  const items = useMemo(() => extractHeadings(html), [html])

  // 决定当前标题是否应该在目录树中折叠隐藏（递归级联计算）
  const visibleItems = useMemo(() => {
    const visible: TocItem[] = []
    let collapseThresholdLevel = 100 // 当前被折叠的最高等级
    
    for (const item of items) {
      if (item.level > collapseThresholdLevel) {
        continue // 如果当前项的等级小于等于（即比它小/后代），说明处于折叠范围中，忽略它
      }
      collapseThresholdLevel = 100 // 恢复无折叠状态
      
      visible.push(item)
      if (collapsedHeadingIds.has(item.id)) {
        collapseThresholdLevel = item.level // 标记此级别及子级均处于折叠中
      }
    }
    return visible
  }, [items, collapsedHeadingIds])

  // 滚动监听：高亮当前可见标题
  const setupObserver = useCallback(() => {
    observerRef.current?.disconnect()

    const editorDom = document.querySelector('.ProseMirror')
    if (!editorDom) return

    const headingElements = Array.from(editorDom.querySelectorAll('h1, h2, h3'))
    if (headingElements.length === 0) return

    const headings: { id: string; el: Element }[] = []
    headingElements.forEach(el => {
      const id = slugify(el.textContent?.trim() || '')
      if (id) headings.push({ id, el })
    })

    // 向上递归寻找具备 overflow-y-auto 的真正滚动父容器（防止布局嵌套导致绑定错误）
    let scrollContainer: HTMLElement | null = editorDom.parentElement as HTMLElement | null
    while (scrollContainer) {
      const style = window.getComputedStyle(scrollContainer)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' || scrollContainer.classList.contains('overflow-y-auto')) {
        break
      }
      scrollContainer = scrollContainer.parentElement
    }
    if (!scrollContainer) return

    const io = new IntersectionObserver(
      entries => {
        // 如果是点击引起的滚动，完全屏蔽 IntersectionObserver 拦截，防止高亮项出现跳动和错乱
        if (isClickScrollingRef.current) return

        // 找第一个进入视口的标题
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = slugify(entry.target.textContent?.trim() || '')
            if (id) {
              setActiveId(id)
              return
            }
          }
        }
        // 如果没有标题在视口内，找最后一个在上方的标题
        const scrollTop = scrollContainer.scrollTop
        let closest: string | null = null
        let closestDist = Infinity
        for (const h of headings) {
          const rect = h.el.getBoundingClientRect()
          const containerRect = scrollContainer.getBoundingClientRect()
          const dist = rect.top - containerRect.top
          if (dist <= 60 && dist > -60 && dist < closestDist) {
            closestDist = dist
            closest = h.id
          }
        }
        if (closest) setActiveId(closest)
      },
      {
        root: scrollContainer,
        rootMargin: '-60px 0px -60% 0px',
        threshold: 0,
      },
    )

    headings.forEach(({ el }) => io.observe(el))
    observerRef.current = io
  }, [])

  useEffect(() => {
    // 内容变化后延迟重新绑定（等 DOM 更新）
    const timer = setTimeout(setupObserver, 200)
    return () => {
      clearTimeout(timer)
      observerRef.current?.disconnect()
    }
  }, [html, setupObserver])

  const handleClick = useCallback((item: TocItem) => {
    const editorDom = document.querySelector('.ProseMirror')
    if (!editorDom) return
    // 向上递归寻找具备 overflow-y-auto 的真正滚动父容器
    let scrollContainer: HTMLElement | null = editorDom.parentElement as HTMLElement | null
    while (scrollContainer) {
      const style = window.getComputedStyle(scrollContainer)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' || scrollContainer.classList.contains('overflow-y-auto')) {
        break
      }
      scrollContainer = scrollContainer.parentElement
    }
    if (!scrollContainer) return

    const headings = Array.from(editorDom.querySelectorAll('h1, h2, h3'))
    for (const h of headings) {
      if (slugify(h.textContent?.trim() || '') === item.id) {
        isClickScrollingRef.current = true
        setActiveId(item.id) // 极其关键：点击后瞬间高亮当前项，无缝提供飞书级的瞬间零延迟反馈

        const containerRect = scrollContainer.getBoundingClientRect()
        const headingRect = h.getBoundingClientRect()
        const offset = headingRect.top - containerRect.top + scrollContainer.scrollTop - 16
        scrollContainer.scrollTo({ top: offset, behavior: 'smooth' })

        // 500ms 后释放拦截锁（等待平滑滑动完全结束）
        setTimeout(() => {
          isClickScrollingRef.current = false
        }, 500)
        break
      }
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div className={`flex-shrink-0 flex flex-col ${inline ? 'border-r border-border' : embedded ? 'max-h-[40%]' : 'border-l border-border bg-bg-sidebar/50'} ${collapsed ? 'w-8' : inline ? 'w-48 lg:w-52' : embedded ? '' : 'w-48 lg:w-56'} transition-all duration-200 ${className}`}>
      {/* 头部 */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-border">
        {!collapsed && (
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 truncate">
            目录
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-bg-card text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0"
          title={collapsed ? '展开目录' : '收起目录'}
        >
          <List size={14} />
        </button>
      </div>

      {/* 目录列表 */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 select-none">
          {visibleItems.map((item) => {
            const originalIndex = items.findIndex(it => it.id === item.id)
            const hasChild = originalIndex !== -1 && originalIndex < items.length - 1 && items[originalIndex + 1].level > item.level
            const isCollapsed = collapsedHeadingIds.has(item.id)

            return (
              <div
                key={item.id}
                onClick={() => handleClick(item)}
                className={`w-full flex items-center justify-between gap-1 text-xs py-1.5 px-2 rounded transition-all cursor-pointer truncate ${
                  activeId === item.id
                    ? 'bg-accent-blue/10 text-accent-blue font-bold shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-bg-card'
                }`}
                style={{ paddingLeft: `${(item.level - 1) * 12 + 6}px` }}
                title={item.text}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {/* 折叠控制尖角按钮 */}
                  {hasChild ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation() // 阻断 handleClick 页面滑动事件，仅处理折叠
                        setCollapsedHeadingIds(prev => {
                          const next = new Set(prev)
                          if (next.has(item.id)) next.delete(item.id)
                          else next.add(item.id)
                          return next
                        })
                      }}
                      className="p-0.5 rounded hover:bg-bg-hover text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0 transition-all duration-150 cursor-pointer"
                    >
                      {isCollapsed ? <ChevronRight size={9} /> : <ChevronDown size={9} />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" /> // 对齐占位
                  )}
                  <span className="truncate">{item.text}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
