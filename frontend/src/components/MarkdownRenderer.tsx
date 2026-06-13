import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownRendererProps {
  content: string
  className?: string
}

function isHtmlContent(str: string): boolean {
  if (!str) return false
  return /<\/?[a-z][\s\S]*>/i.test(str)
}

/**
 * 将 Markdown / HTML 文本压成干净的单行纯文本，供列表条目预览使用。
 * 去除标题井号、加粗/斜体标记、行内代码反引号、链接语法、列表符号、引用符号、HTML 标签等。
 */
export function stripMarkdown(input: string): string {
  if (!input) return ''
  let s = input
  s = s.replace(/```[\s\S]*?```/g, ' ')        // 代码块
  s = s.replace(/`([^`]+)`/g, '$1')            // 行内代码
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')  // 图片
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接保留文字
  s = s.replace(/<[^>]+>/g, ' ')               // HTML 标签
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')     // 标题
  s = s.replace(/^\s{0,3}>\s?/gm, '')          // 引用
  s = s.replace(/^\s*[-*+]\s+/gm, '')          // 无序列表
  s = s.replace(/^\s*\d+\.\s+/gm, '')          // 有序列表
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2')     // 加粗
  s = s.replace(/(\*|_)(.*?)\1/g, '$2')        // 斜体
  s = s.replace(/~~(.*?)~~/g, '$1')            // 删除线
  s = s.replace(/^\s*([-*_]\s*){3,}$/gm, ' ')  // 分割线
  s = s.replace(/[ \t]*\n+[ \t]*/g, ' ')       // 换行折叠为空格
  s = s.replace(/\s{2,}/g, ' ')                // 多空格合并
  return s.trim()
}

/**
 * 共享的 Markdown/HTML 渲染组件。
 * 自动检测内容格式：HTML 内容直接渲染，Markdown 内容走 react-markdown。
 * 用于日报、会议纪要等场景，保持与编辑器一致的渲染效果。
 */
export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  if (!content) return null

  // HTML 内容直接渲染
  if (isHtmlContent(content)) {
    return (
      <div className={`markdown-body ${className}`} dangerouslySetInnerHTML={{ __html: content }} />
    )
  }

  // Markdown 内容走 react-markdown
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold text-gray-900 dark:text-white mt-2 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold text-gray-900 dark:text-white mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-1.5 mb-0.5">{children}</h3>,
          p: ({ children }) => <p className="my-1 leading-relaxed text-gray-800 dark:text-gray-300">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-gray-800 dark:text-gray-300">{children}</li>,
          strong: ({ children }) => <strong className="font-bold text-gray-900 dark:text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-800 dark:text-gray-200">{children}</em>,
          code: ({ className: cls, children, ...props }: any) => {
            const isInline = !cls
            return isInline ? (
              <code className="px-1 py-0.5 rounded bg-bg-input border border-border text-xs text-amber-600 dark:text-[#F59E0B]" {...props}>{children}</code>
            ) : (
              <code className={`block p-2 rounded-lg bg-bg-input border border-border text-xs text-gray-700 dark:text-gray-300 overflow-x-auto ${cls || ''}`} {...props}>{children}</code>
            )
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#3B82F6] pl-3 my-1.5 text-gray-500 dark:text-gray-400 italic">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#3B82F6] underline hover:text-blue-700 dark:hover:text-blue-400">{children}</a>
          ),
          hr: () => <hr className="my-2 border-border" />,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border-collapse">{children}</table></div>,
          th: ({ children }) => <th className="border border-border px-2 py-1 bg-gray-100 dark:bg-bg-input text-gray-700 dark:text-gray-300 font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt || ''} className="max-w-full rounded-lg my-2" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
