import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Table as TableIcon,
  Undo, Redo, Printer, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Heading1, Heading2, Heading3,
} from 'lucide-react'

// 注入 A4 编辑器专用样式（全局只注入一次）
const A4_STYLE_ID = 'contract-doc-editor-styles'
if (typeof document !== 'undefined' && !document.getElementById(A4_STYLE_ID)) {
  const el = document.createElement('style')
  el.id = A4_STYLE_ID
  el.textContent = `
    .contract-doc-area .ProseMirror {
      outline: none;
      min-height: 1003px; /* A4 = 1123px - top/bottom 60px*2 */
      font-family: 'SimSun', '宋体', 'Source Han Serif CN', serif;
      font-size: 14px;
      line-height: 2;
      color: #111827;
    }
    .contract-doc-area .ProseMirror p { margin: 2px 0; }
    .contract-doc-area .ProseMirror h1 {
      font-size: 18px; font-weight: 700; text-align: center;
      margin: 16px 0 8px; line-height: 1.4;
    }
    .contract-doc-area .ProseMirror h2 {
      font-size: 15px; font-weight: 700;
      margin: 14px 0 6px; line-height: 1.4;
    }
    .contract-doc-area .ProseMirror h3 {
      font-size: 14px; font-weight: 700;
      margin: 10px 0 4px; line-height: 1.4;
    }
    .contract-doc-area .ProseMirror ul { list-style: disc; padding-left: 28px; }
    .contract-doc-area .ProseMirror ol { list-style: decimal; padding-left: 28px; }
    .contract-doc-area .ProseMirror li { margin: 3px 0; }
    .contract-doc-area .ProseMirror table {
      border-collapse: collapse; width: 100%; margin: 12px 0;
    }
    .contract-doc-area .ProseMirror td,
    .contract-doc-area .ProseMirror th {
      border: 1px solid #374151; padding: 6px 10px; min-width: 60px;
    }
    .contract-doc-area .ProseMirror th {
      background: #f3f4f6; font-weight: 600; text-align: center;
    }
    .contract-doc-area .ProseMirror .tableWrapper { overflow-x: auto; }
    .contract-doc-area .ProseMirror hr {
      border: none; border-top: 1px solid #9ca3af; margin: 16px 0;
    }
    /* 虚拟分页线 */
    .contract-page-break {
      width: 100%; border: none;
      border-top: 2px dashed #d1d5db;
      margin: 0;
      pointer-events: none;
    }
    /* 打印时样式 */
    @media print {
      .contract-doc-area .ProseMirror h1 { page-break-after: avoid; }
      .contract-doc-area .ProseMirror table { page-break-inside: avoid; }
    }
  `
  document.head.appendChild(el)
}

function printContract(html: string, title: string) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.write(`<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: A4; margin: 20mm 25mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'SimSun', '宋体', serif;
      font-size: 14px; line-height: 2;
      color: #111; margin: 0; padding: 0;
    }
    h1 { font-size: 18px; font-weight: bold; text-align: center; margin: 16px 0 8px; }
    h2 { font-size: 15px; font-weight: bold; margin: 14px 0 6px; }
    h3 { font-size: 14px; font-weight: bold; margin: 10px 0 4px; }
    p { margin: 2px 0; }
    ul { list-style: disc; padding-left: 28px; }
    ol { list-style: decimal; padding-left: 28px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { border: 1px solid #374151; padding: 6px 10px; }
    th { background: #f3f4f6; font-weight: 600; text-align: center; }
  </style>
</head>
<body>${html}</body>
</html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); w.close() }, 400)
}

interface ContractDocEditorProps {
  value: string
  onChange: (html: string) => void
  title?: string
  readOnly?: boolean
}

export default function ContractDocEditor({ value, onChange, title = '合同', readOnly = false }: ContractDocEditorProps) {
  const initialized = useRef(false)
  const suppressRef = useRef(false)
  const valueRef = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
    ],
    content: '<p></p>',
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
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

  // 初始化内容
  useEffect(() => {
    if (!editor || initialized.current) return
    initialized.current = true
    suppressRef.current = true
    editor.commands.setContent(value || '<p></p>')
    requestAnimationFrame(() => { suppressRef.current = false })
  }, [editor, value])

  // 只读状态同步
  useEffect(() => {
    if (editor) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  if (!editor) return null

  const ToolBtn = ({ onClick, active, title: t, children }: { onClick: () => void; active?: boolean; title?: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={t}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10'}`}
    >
      {children}
    </button>
  )

  const Sep = () => <div className="w-px h-4 bg-gray-300 dark:bg-white/20 mx-0.5" />

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-100 dark:bg-[#1a1a1a]">
      {/* 工具栏 */}
      {!readOnly && (
        <div className="flex items-center gap-0.5 px-3 py-1.5 bg-white dark:bg-[#232323] border-b border-gray-200 dark:border-white/10 flex-wrap shrink-0 shadow-sm">
          {/* 历史 */}
          <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="撤销 (Ctrl+Z)">
            <Undo size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="重做 (Ctrl+Y)">
            <Redo size={13} />
          </ToolBtn>
          <Sep />
          {/* 标题 */}
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="大标题">
            <Heading1 size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="中标题">
            <Heading2 size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="小标题">
            <Heading3 size={13} />
          </ToolBtn>
          <Sep />
          {/* 格式 */}
          <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="加粗 (Ctrl+B)">
            <Bold size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="斜体 (Ctrl+I)">
            <Italic size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="下划线 (Ctrl+U)">
            <UnderlineIcon size={13} />
          </ToolBtn>
          <Sep />
          {/* 对齐 */}
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="左对齐">
            <AlignLeft size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="居中">
            <AlignCenter size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="右对齐">
            <AlignRight size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="两端对齐">
            <AlignJustify size={13} />
          </ToolBtn>
          <Sep />
          {/* 列表 */}
          <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="无序列表">
            <List size={13} />
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="有序列表">
            <ListOrdered size={13} />
          </ToolBtn>
          <Sep />
          {/* 表格 */}
          <ToolBtn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="插入表格">
            <TableIcon size={13} />
          </ToolBtn>
          {/* 打印 */}
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => printContract(editor.getHTML(), title)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/20 text-xs font-medium transition-colors"
              title="打印合同（调用系统打印机）"
            >
              <Printer size={13} />打印预览
            </button>
          </div>
        </div>
      )}

      {/* A4 纸张区域 */}
      <div className="flex-1 overflow-y-auto py-8 px-4 flex justify-center items-start" style={{ background: '#e5e7eb' }}>
        {/* A4 页面纸张：210mm ≈ 794px @ 96dpi，留白 60px 四周 */}
        <div
          className="contract-doc-area bg-white shadow-xl self-start"
          style={{
            width: '794px',
            minHeight: '1123px',
            padding: '60px 80px',
            borderRadius: '2px',
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
