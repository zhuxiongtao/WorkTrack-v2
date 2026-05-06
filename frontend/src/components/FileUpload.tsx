import { useState, useRef, useCallback } from 'react'
import { X, FileText, Paperclip, Loader2 } from 'lucide-react'

export interface FileInfo {
  name: string
  path: string
  size: number
  type: string
  url: string
}

interface FileUploadProps {
  /** 现有附件列表 JSON */
  filesJson?: string | null
  /** 附件变化回调，传入新的 JSON 字符串 */
  onChange?: (filesJson: string | null) => void
  /** 是否禁用 */
  disabled?: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function isImage(type: string): boolean {
  return type.startsWith('image/')
}

export default function FileUpload({ filesJson, onChange, disabled }: FileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 解析现有文件
  const files: FileInfo[] = (() => {
    if (!filesJson) return []
    try {
      return JSON.parse(filesJson) as FileInfo[]
    } catch {
      return []
    }
  })()

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const token = localStorage.getItem('auth_token')
      const res = await fetch('/api/v1/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!res.ok) {
        let detail = `服务器错误 (${res.status})`
        try {
          const err = await res.json()
          detail = err.detail || detail
        } catch {
          // 后端返回非 JSON（如 HTML 错误页），尝试提取文本摘要
          const text = await res.text()
          detail = `[${res.status}] ${text.slice(0, 100)}`
        }
        throw new Error(detail)
      }

      const uploaded: FileInfo = await res.json()
      const updated = [...files, uploaded]
      onChange?.(JSON.stringify(updated))
    } catch (err: any) {
      console.error('File upload error:', err)
      alert(err.message || '文件上传失败')
    } finally {
      setUploading(false)
    }
  }, [files, onChange])

  const removeFile = useCallback((index: number) => {
    const updated = files.filter((_, i) => i !== index)
    onChange?.(updated.length > 0 ? JSON.stringify(updated) : null)
  }, [files, onChange])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (selected && selected.length > 0) {
      uploadFile(selected[0])
      e.target.value = ''  // 允许重复上传同名文件
    }
  }, [uploadFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files
    if (dropped && dropped.length > 0) {
      uploadFile(dropped[0])
    }
  }, [uploadFile])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    // 仅处理粘贴图片
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (blob) {
          // 给粘贴的图片生成文件名
          const ext = item.type.split('/')[1] || 'png'
          const file = new File([blob], `paste_${Date.now()}.${ext}`, { type: item.type })
          uploadFile(file)
        }
        break  // 一次粘贴只处理第一张图片
      }
    }
  }, [uploadFile])

  return (
    <div className="space-y-2" onPaste={handlePaste}>
      {/* 已有附件列表 */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, idx) => (
            <div
              key={idx}
              className="group relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-hover border border-border text-xs"
            >
              {isImage(file.type) ? (
                <a href={file.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={file.url}
                    alt={file.name}
                    className="w-8 h-8 rounded object-cover border border-border"
                  />
                </a>
              ) : (
                <FileText size={16} className="text-gray-500 shrink-0" />
              )}
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white truncate max-w-[120px]"
                title={file.name}
              >
                {file.name}
              </a>
              <span className="text-gray-600 text-[10px]">{formatSize(file.size)}</span>
              {!disabled && (
                <button
                  onClick={() => removeFile(idx)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500/80 hover:bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="删除附件"
                >
                  <X size={10} className="text-white" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 上传区域 */}
      {!disabled && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed 
            cursor-pointer transition-colors text-xs text-gray-500 hover:text-gray-300 hover:border-gray-600
            ${dragOver ? 'border-accent-blue bg-accent-blue/5 text-accent-blue' : 'border-gray-700'}
            ${uploading ? 'pointer-events-none opacity-60' : ''}
          `}
          title="支持拖拽、粘贴截图、点击上传"
        >
          {uploading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>上传中...</span>
            </>
          ) : (
            <>
              <Paperclip size={14} />
              <span>拖拽文件 / 粘贴截图 / 点击上传</span>
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.json,.zip,.rar,.mp3,.wav,.mp4,.webm"
      />
    </div>
  )
}
