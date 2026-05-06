import { useState, useEffect, useCallback, useRef } from 'react'
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
import { Bold, Italic, List, ListOrdered, Quote, Code, Heading1, Heading2, Heading3, Link2, Image as ImageIcon, Table as TableIcon, Undo, Redo, Eye, FileText } from 'lucide-react'
import TurndownService from 'turndown'
import { marked } from 'marked'

interface RichTextEditorProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  uploadFn?: (file: File) => Promise<string>
  className?: string
}

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})
turndownService.escape = (str: string) => str

function isHtmlLike(str: string): boolean {
  if (!str) return false
  return /<\/?[a-z][\s\S]*>/i.test(str)
}

function looksLikeMarkdown(str: string): boolean {
  if (!str || isHtmlLike(str)) return false
  return /^#{1,6}\s|^[-*+]\s|^\d+\.\s|^\*\*|^\*|^\[|\[.*\]\(.*\)|!\[.*\]\(.*\)|^```|^>\s|^---/m.test(str)
}

function plainTextToHtml(text: string): string {
  return text.split('\n').map(line => `<p>${line || '<br/>'}</p>`).join('')
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = '开始输入内容...',
  uploadFn,
  className = '',
}: RichTextEditorProps) {
  // 只根据首次 value 决定初始模式
  const initialMode = useRef<'markdown' | 'rich'>(
    value && looksLikeMarkdown(value) ? 'markdown' : 'rich'
  )
  const [mode, setMode] = useState<'markdown' | 'rich'>(initialMode.current)
  const [mdSource, setMdSource] = useState(value || '')
  const skipNextOnChange = useRef(false)
  const isSyncing = useRef(false)
  const prevValueRef = useRef(value)
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null)

  const handleImageUpload = useCallback(async (file: File): Promise<string | null> => {
    if (uploadFn) {
      return uploadFn(file).catch(() => null)
    }
    return new Promise<string>((resolve) => {
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
    ],
    content: (() => {
      if (!value) return ''
      if (isHtmlLike(value)) return value
      // 纯文本或简单内容：转 HTML
      return plainTextToHtml(value)
    })(),
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none min-h-[200px] focus:outline-none text-gray-300 leading-relaxed',
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (mode !== 'rich' || isSyncing.current) return
      skipNextOnChange.current = true
      onChange(ed.getHTML())
    },
  })

  editorRef.current = editor

  // 同步：Markdown -> 富文本
  const syncMdToRich = useCallback(() => {
    if (!editor || isSyncing.current) return
    isSyncing.current = true
    skipNextOnChange.current = true

    const html = marked(mdSource) as string
    editor.commands.setContent(html)
    isSyncing.current = false
  }, [editor, mdSource])

  // 同步：富文本 -> Markdown
  const syncRichToMd = useCallback(() => {
    if (!editor || isSyncing.current) return
    isSyncing.current = true

    const html = editor.getHTML()
    const md = turndownService.turndown(html)
    setMdSource(md)
    onChange(md)
    isSyncing.current = false
  }, [editor, onChange])

  // 模式切换
  const handleModeToggle = useCallback(() => {
    if (mode === 'markdown') {
      syncMdToRich()
      setMode('rich')
    } else {
      syncRichToMd()
      setMode('markdown')
    }
  }, [mode, syncMdToRich, syncRichToMd])

  // 外部 value 变化时更新编辑器内容
  useEffect(() => {
    if (!editor) return
    const cur = editor.getHTML()
    const prev = prevValueRef.current
    if (value === prev || value === cur) {
      prevValueRef.current = value
      return
    }
    prevValueRef.current = value

    if (mode === 'markdown') {
      // 在 Markdown 模式下，只更新文本源
      if (value !== mdSource) {
        setMdSource(value)
      }
    } else {
      // 在富文本模式下，更新编辑器内容
      if (value && !isSyncing.current) {
        if (isHtmlLike(value)) {
          editor.commands.setContent(value)
        } else {
          editor.commands.setContent(plainTextToHtml(value))
        }
      }
    }
  }, [value, editor, mode, mdSource])

  // Markdown 模式下 value 变化时更新 mdSource
  useEffect(() => {
    if (mode === 'markdown' && value !== mdSource) {
      setMdSource(value)
    }
  }, [value, mode, mdSource])

  // 粘贴图片
  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (mode !== 'rich' || !editor) return
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue
        const url = await handleImageUpload(blob)
        if (url) {
          editor.chain().focus().setImage({ src: url }).run()
        }
        break
      }
    }
  }

  if (!editor) return null

  return (
    <div className={`border border-border rounded-xl overflow-hidden bg-bg-input ${className}`}>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg-card/50 flex-wrap">
        <button onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('bold') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <Bold size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('italic') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <Italic size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 1 }) ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <Heading1 size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <Heading2 size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <Heading3 size={14} />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        <button onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('bulletList') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <List size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('orderedList') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <ListOrdered size={14} />
        </button>
        <button onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('blockquote') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <Quote size={14} />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        <button onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('codeBlock') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <Code size={14} />
        </button>
        <button onClick={() => {
          const url = prompt('输入链接地址:')
          if (url) editor.chain().focus().setLink({ href: url }).run()
        }}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('link') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
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
          className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-white hover:bg-bg-hover">
          <ImageIcon size={14} />
        </button>

        <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          className={`p-1.5 rounded-lg transition-colors ${editor.isActive('table') ? 'bg-[#3B82F6]/20 text-[#3B82F6]' : 'text-gray-500 hover:text-white hover:bg-bg-hover'}`}>
          <TableIcon size={14} />
        </button>

        <div className="w-px h-4 bg-border/50 mx-0.5" />

        <button onClick={() => editor.chain().focus().undo().run()}
          className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-white hover:bg-bg-hover"
          disabled={!editor.can().undo()}>
          <Undo size={14} />
        </button>
        <button onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-lg transition-colors text-gray-500 hover:text-white hover:bg-bg-hover"
          disabled={!editor.can().redo()}>
          <Redo size={14} />
        </button>

        <div className="flex-1" />

        <button
          onClick={handleModeToggle}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] transition-colors ${
            mode === 'rich'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30'
              : 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30'
          }`}>
          {mode === 'rich' ? <Eye size={11} /> : <FileText size={11} />}
          {mode === 'rich' ? 'Markdown' : '富文本'}
        </button>
      </div>

      {mode === 'rich' ? (
        <div className={`relative ${className}`} onPaste={handlePaste}>
          <EditorContent editor={editor} />
          <style>{`
            .ProseMirror { min-height: inherit; padding: 1rem; outline: none; color: #d1d5db; }
            .ProseMirror p.is-editor-empty:first-child::before { color: #4b5563; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
            .ProseMirror img { max-width: 100%; border-radius: 8px; margin: 8px 0; cursor: pointer; }
            .ProseMirror img.ProseMirror-selectednode { outline: 2px solid #3B82F6; }
            .ProseMirror table { border-collapse: collapse; width: 100%; margin: 8px 0; }
            .ProseMirror td, .ProseMirror th { border: 1px solid #374151; padding: 6px 10px; min-width: 60px; }
            .ProseMirror th { background: #1f2937; }
            .ProseMirror blockquote { border-left: 3px solid #3B82F6; padding-left: 12px; margin: 8px 0; color: #9ca3af; }
            .ProseMirror pre { background: #1f2937; padding: 12px; border-radius: 8px; overflow-x: auto; }
            .ProseMirror code { background: #1f2937; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; color: #f59e0b; }
            .ProseMirror pre code { background: none; padding: 0; }
            .ProseMirror ul { list-style: disc; padding-left: 20px; }
            .ProseMirror ol { list-style: decimal; padding-left: 20px; }
            .ProseMirror a { color: #3B82F6; text-decoration: underline; }
            .ProseMirror hr { border: none; border-top: 1px solid #374151; margin: 12px 0; }
            .ProseMirror h1 { font-size: 1.25rem; font-weight: bold; color: white; margin: 8px 0 4px; }
            .ProseMirror h2 { font-size: 1.1rem; font-weight: bold; color: white; margin: 8px 0 4px; }
            .ProseMirror h3 { font-size: 1rem; font-weight: 600; color: #d1d5db; margin: 6px 0 2px; }
            .ProseMirror .tableWrapper { overflow-x: auto; }
            .ProseMirror .resize-cursor { cursor: col-resize; }
          `}</style>
        </div>
      ) : (
        <textarea
          value={mdSource}
          onChange={(e) => {
            setMdSource(e.target.value)
            onChange(e.target.value)
          }}
          placeholder={placeholder}
          className="w-full min-h-[200px] p-4 bg-transparent text-sm text-gray-300 outline-none resize-none font-mono leading-relaxed placeholder-gray-600"
        />
      )}
    </div>
  )
}
