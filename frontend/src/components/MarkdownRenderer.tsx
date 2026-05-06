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
          h1: ({ children }) => <h1 className="text-base font-bold text-white mt-2 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold text-white mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-200 mt-1.5 mb-0.5">{children}</h3>,
          p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-gray-300">{children}</li>,
          strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
          code: ({ className: cls, children, ...props }: any) => {
            const isInline = !cls
            return isInline ? (
              <code className="px-1 py-0.5 rounded bg-bg-input text-xs text-[#F59E0B]" {...props}>{children}</code>
            ) : (
              <code className={`block p-2 rounded-lg bg-bg-input text-xs text-gray-300 overflow-x-auto ${cls || ''}`} {...props}>{children}</code>
            )
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#3B82F6] pl-3 my-1.5 text-gray-400 italic">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#3B82F6] underline hover:text-blue-400">{children}</a>
          ),
          hr: () => <hr className="my-2 border-border" />,
          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border-collapse">{children}</table></div>,
          th: ({ children }) => <th className="border border-border px-2 py-1 bg-bg-input text-gray-300">{children}</th>,
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
