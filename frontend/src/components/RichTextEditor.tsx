import { useEffect, useCallback, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import ImageResize from 'tiptap-extension-resize-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import { Extension } from '@tiptap/core'
import { Bold, Italic, List, ListOrdered, Quote, Code, Heading1, Heading2, Heading3, Link2, Image as ImageIcon, Table as TableIcon, Undo, Redo } from 'lucide-react'
import { marked } from 'marked'

/**
 * 飞书式 Markdown 快捷输入扩展
 * 通过 handleKeyDown 拦截 Space / Enter 并检查当前行是否匹配 Markdown 模式,
 * 匹配则立即转换为对应的富文本块（标题 / 列表 / 引用等）。
 * 不依赖 TipTap 内置 InputRules（v3 中部分扩展的 InputRules 不稳定）。
 */
const FeishuBlockInput = Extension.create({
  name: 'feishuBlockInput',

  addKeyboardShortcuts() {
    return {
      // Space: 检测行首 Markdown 语法并转为富文本块
      'Space': ({ editor }) => {
        const { $from, $to, empty } = editor.state.selection
        if (!empty || $from.pos !== $to.pos) return false

        const { parent } = $from
        // 只在段落内检测（不在标题/代码块等已转换的块内）
        if (parent.type.name !== 'paragraph') return false

        const text = parent.textContent
        // 只有当前文本内容较短时才检测（避免大段落误判）
        if (text.length > 10) return false

        // --- 标题： #  ##  ###  ---
        const headingMatch = text.match(/^(#{1,3})$/)
        if (headingMatch) {
          const level = headingMatch[1].length as 1 | 2 | 3
          // 删除 # 符号，转为标题
          editor.chain().focus().deleteRange({ from: $from.start(), to: $from.start() + headingMatch[1].length }).setHeading({ level }).run()
          return true
        }

        // --- 无序列表： -  +  *  ---
        if (text === '-' || text === '+' || text === '*') {
          editor.chain().focus().deleteRange({ from: $from.start(), to: $from.start() + 1 }).toggleBulletList().run()
          return true
        }

        // --- 有序列表： 1.  2.  ...  ---
        const olMatch = text.match(/^(\d+)\.$/)
        if (olMatch) {
          editor.chain().focus().deleteRange({ from: $from.start(), to: $from.start() + olMatch[1].length + 1 }).toggleOrderedList().run()
          return true
        }

        // --- 引用： >  ---
        if (text === '>') {
          editor.chain().focus().deleteRange({ from: $from.start(), to: $from.start() + 1 }).toggleBlockquote().run()
          return true
        }

        return false
      },

      // Enter: 连续两次换行退出列表 / 引用
      'Enter': ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false

        const parent = $from.parent
        const text = parent.textContent.trim()

        // 空列表项：退出列表
        if (parent.type.name === 'listItem' && text === '') {
          editor.chain().focus().liftListItem('listItem').run()
          return true
        }

        // 空引用：退出引用
        if (parent.type.name === 'paragraph') {
          const blockquote = $from.node(-1)
          if (blockquote?.type.name === 'blockquote' && text === '') {
            editor.chain().focus().lift('blockquote').run()
            return true
          }
        }

        return false
      },
    }
  },
})

/* ================================================================
   content 标准化
   ================================================================ */

function isHtmlLike(str: string): boolean {
  if (!str) return false
  return /<\/?[a-z][\s\S]*>/i.test(str)
}

function normalizeContent(raw: string): string {
  const v = (raw || '').replace(/\sname="[^"]*"/g, '').trim()
  if (!v) return '<p></p>'
  if (isHtmlLike(v)) return v
  if (/^#{1,6}\s|^[*>-]\s|`{3}|\[.*\]\(.*\)/m.test(v)) {
    return (marked.parse(v, { async: false }) as string || '').trim() || '<p></p>'
  }
  return v.split('\n').map(l => l ? `<p>${l}</p>` : '<p><br/></p>').join('')
}

/* ================================================================
   组件
   ================================================================ */

interface RichTextEditorProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  uploadFn?: (file: File) => Promise<string>
  className?: string
  readOnly?: boolean
  documentId?: number
  onEditorInit?: (editor: any) => void
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = '开始输入内容…',
  uploadFn,
  className = '',
  readOnly = false,
  documentId,
  onEditorInit,
}: RichTextEditorProps) {
  const initialized = useRef(false)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)
  const suppressRef = useRef(false)
  const valueRef = useRef(value)
  const lastDocIdRef = useRef<number | null>(null)

  const handleImageUpload = useCallback(async (file: File): Promise<string | null> => {
    if (uploadFn) return uploadFn(file).catch(() => null)
    return new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })
  }, [uploadFn])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({ allowBase64: true, inline: true }),
      ImageResize,
      Link.configure({ openOnClick: false, defaultProtocol: 'https' }),
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
      FeishuBlockInput,
    ],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'min-h-[200px] focus:outline-none text-gray-900 dark:text-gray-300 leading-relaxed px-4 py-3',
      },
      // ★ ProseMirror 级粘贴拦截：在默认行为之前检查 Markdown 并转为 HTML
      handlePaste: (view, event) => {
        const editor = editorRef.current
        if (!editor) return false

        // 图片优先
        const items = event.clipboardData?.items
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
              event.preventDefault()
              const blob = items[i].getAsFile()
              if (!blob) return true
              handleImageUpload(blob).then(url => {
                if (url) editor.chain().focus().setImage({ src: url }).run()
              })
              return true
            }
          }
        }

        const text = event.clipboardData?.getData('text/plain')
        if (!text || isHtmlLike(text)) return false

        // 全面检测 Markdown 特征
        const hasMd =
          /^#{1,6}\s|^[*>-]\s|^```|^\|.*\|.*\|/m.test(text)   // 块级语法
          || /\*\*|__|~~|`[^`]+`/.test(text)                     // 行内语法
          || /\[.*\]\(.*\)|!\[.*\]\(.*\)/.test(text)              // 链接/图片

        if (!hasMd) return false

        event.preventDefault()
        const html = (marked.parse(text, { async: false }) as string || '').trim()
        if (!html) return true

        suppressRef.current = true
        editor.chain().focus().insertContent(html).run()
        // ★ 手动同步：onUpdate 被 suppressRef 抑制了，必须主动回传
        const synced = editor.getHTML()
        valueRef.current = synced
        onChange(synced)
        requestAnimationFrame(() => { suppressRef.current = false })
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressRef.current) return
      const html = ed.getHTML()
      valueRef.current = html
      onChange(html)
    },
    immediatelyRender: false,
  })

  // 保存 editor 引用供 handlePaste 使用
  editorRef.current = editor

  // 将 TipTap 实例向外暴露，供父级组件行内 AI 无缝插入或替换内容使用（免除外部 HTML 字符串匹配造成的脆弱性与 bug）
  useEffect(() => {
    if (editor && onEditorInit) {
      onEditorInit(editor)
    }
  }, [editor, onEditorInit])

  // 初始化 & 外部 value 状态同步（仅在首次装载或 documentId 发生外部切换时重置 TipTap 内容，打字过程中绝不调用 setContent 从而完美保护 Undo/Redo 历史栈）
  useEffect(() => {
    if (!editor) return

    const isDocChanged = documentId !== undefined && lastDocIdRef.current !== documentId
    const isInitLoad = !initialized.current

    if (!isInitLoad && !isDocChanged) return

    initialized.current = true
    if (documentId !== undefined) {
      lastDocIdRef.current = documentId
    }

    suppressRef.current = true
    const normalized = normalizeContent(value)
    editor.commands.setContent(normalized)
    
    const synced = editor.getHTML()
    valueRef.current = synced
    if (value !== synced) onChange(synced)
    requestAnimationFrame(() => { suppressRef.current = false })
  }, [documentId, value, editor, onChange])

  // 动态同步只读状态
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly)
    }
  }, [editor, readOnly])

  if (!editor) return null

  return (
    <div className={`border transition-all duration-200 rounded-xl flex flex-col ${readOnly ? 'border-transparent bg-transparent' : 'border-border bg-white dark:bg-bg-input'} ${className}`}>
      {/* 工具栏 */}
      {!readOnly && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-gray-50 dark:bg-bg-card/50 flex-wrap flex-shrink-0">
        <button onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('bold') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Bold size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('italic') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Italic size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 1 }) ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Heading1 size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Heading2 size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Heading3 size={14} />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        <button onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('bulletList') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <List size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('orderedList') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <ListOrdered size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('blockquote') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Quote size={14} />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        <button onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('codeBlock') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Code size={14} />
        </button>
        <button onClick={() => {
          const url = prompt('输入链接地址:')
          if (url) editor.chain().focus().setLink({ href: url }).run()
        }}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('link') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <Link2 size={14} />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        <button onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0]
            if (!file) return
            const url = await handleImageUpload(file)
            if (url) editor.chain().focus().setImage({ src: url }).run()
          }
          input.click()
        }}
          className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover">
          <ImageIcon size={14} />
        </button>

        <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('table') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover'}`}>
          <TableIcon size={14} />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        <button onClick={() => editor.chain().focus().undo().run()}
          className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover"
          disabled={!editor.can().undo()}>
          <Undo size={14} />
        </button>
        <button onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-bg-hover"
          disabled={!editor.can().redo()}>
          <Redo size={14} />
        </button>
      </div>
      )}

      {/* 可滚动编辑区 */}
      <div className={`flex-1 min-h-0 relative ${readOnly ? 'overflow-visible' : 'overflow-y-auto overscroll-behavior-contain'}`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

/* ================================================================
   全局样式（只注入一次）
   ================================================================ */

const STYLE_ID = 'richtext-editor-styles'
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
    .ProseMirror { outline: none; }
    .ProseMirror p.is-editor-empty:first-child::before {
      color: #9ca3af; content: attr(data-placeholder);
      float: left; height: 0; pointer-events: none;
    }
    .ProseMirror img { max-width: 100%; border-radius: 8px; margin: 8px 0; cursor: pointer; }
    .ProseMirror img.ProseMirror-selectednode { outline: 2px solid #3B82F6; }
    .ProseMirror table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    .ProseMirror td, .ProseMirror th { border: 1px solid #d1d5db; padding: 6px 10px; min-width: 60px; }
    :root[data-theme="dark"] .ProseMirror td,
    :root[data-theme="dark"] .ProseMirror th { border-color: #374151; }
    .ProseMirror th { background: #e5e7eb; font-weight: 600; }
    :root[data-theme="dark"] .ProseMirror th { background: #1f2937; }
    .ProseMirror blockquote {
      border-left: 3px solid #3B82F6; padding-left: 12px;
      margin: 8px 0; color: #6b7280;
    }
    :root[data-theme="dark"] .ProseMirror blockquote { color: #9ca3af; }
    .ProseMirror pre {
      background: #e5e7eb; padding: 12px; border-radius: 8px; overflow-x: auto;
      border: 1px solid #d1d5db;
      font-family: ui-monospace, monospace; font-size: 0.875em;
    }
    :root[data-theme="dark"] .ProseMirror pre { background: #1f2937; border-color: #374151; }
    .ProseMirror code {
      background: #e5e7eb; padding: 2px 6px; border-radius: 4px;
      font-size: 0.85em; color: #b45309; font-family: ui-monospace, monospace;
    }
    :root[data-theme="dark"] .ProseMirror code { background: #1f2937; color: #f59e0b; }
    .ProseMirror pre code { background: none; padding: 0; }

    .ProseMirror ul { list-style: disc; padding-left: 24px; }
    .ProseMirror ol { list-style: decimal; padding-left: 24px; }
    .ProseMirror li { margin: 2px 0; }
    .ProseMirror ul ul { list-style: circle; }
    .ProseMirror ul ul ul { list-style: square; }

    .ProseMirror a { color: #3B82F6; text-decoration: underline; cursor: pointer; }
    .ProseMirror hr { border: none; border-top: 1px solid #d1d5db; margin: 16px 0; }
    :root[data-theme="dark"] .ProseMirror hr { border-color: #374151; }

    .ProseMirror h1 {
      font-size: 1.4rem; font-weight: 700; margin: 20px 0 8px;
      line-height: 1.3; padding-bottom: 4px;
      border-bottom: 1px solid #e5e7eb;
    }
    :root[data-theme="dark"] .ProseMirror h1 { border-color: #374151; }
    .ProseMirror h2 { font-size: 1.2rem; font-weight: 700; margin: 16px 0 6px; line-height: 1.3; }
    .ProseMirror h3 { font-size: 1.05rem; font-weight: 600; margin: 14px 0 4px; line-height: 1.3; }

    .ProseMirror p { margin: 4px 0; }
    .ProseMirror .tableWrapper { overflow-x: auto; }
    .ProseMirror .resize-cursor { cursor: col-resize; }
  `
  document.head.appendChild(el)
}
