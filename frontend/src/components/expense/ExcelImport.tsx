// 报销明细 Excel 导入组件
// 使用 SheetJS (xlsx) 从 CDN 动态加载，解析 .xlsx / .xls / .csv
// 模板列：报销名称 | 类别 | 城市 | 费用日期 | 金额 | 费用说明 | 备注 | 费用使用部门（部门名）
// 部门名将解析为 department_id（需外部传入 departments 列表）
import { useState, useRef } from 'react'
import { Upload, X, Download, AlertTriangle } from 'lucide-react'

declare global {
  interface Window {
    XLSX?: any
  }
}

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
]

const SCRIPT_LOADED = { done: false, loading: null as Promise<void> | null }

function loadSheetJS(): Promise<void> {
  if (SCRIPT_LOADED.done) return Promise.resolve()
  if (SCRIPT_LOADED.loading) return SCRIPT_LOADED.loading
  SCRIPT_LOADED.loading = new Promise<void>((resolve, reject) => {
    let i = 0
    const tryLoad = () => {
      if (i >= CDN_URLS.length) {
        reject(new Error('无法加载 Excel 解析库，请检查网络'))
        return
      }
      const s = document.createElement('script')
      s.src = CDN_URLS[i++]
      s.async = true
      s.onload = () => {
        if (window.XLSX) {
          SCRIPT_LOADED.done = true
          resolve()
        } else {
          tryLoad()
        }
      }
      s.onerror = tryLoad
      document.head.appendChild(s)
    }
    tryLoad()
  })
  return SCRIPT_LOADED.loading
}

export type ExcelRow = {
  name: string
  expense_type: string
  city: string
  expense_date: string | null
  amount: number
  note: string
  remark: string
  department_name: string
}

type Props = {
  onImported: (rows: ExcelRow[]) => void
  templateHref?: string
  /** 部门列表（用于将部门名解析为 id 时可选） */
  departments?: Array<{ id: number; name: string }>
}

const TEMPLATE_HEADERS = [
  '报销名称', '类别', '城市', '费用日期', '金额', '费用说明', '备注', '费用使用部门',
]

function templateCsv() {
  const sample = [
    '机票', '交通', '北京', '2026-06-12', '1200', '北京客户拜访去程', '含税', '营销中心-技术支持部',
    '酒店', '差旅', '北京', '2026-06-13', '800', '2 晚', '远石协议酒店', '营销中心-技术支持部',
  ]
  const lines = [TEMPLATE_HEADERS.join(','), ...sample.map((c) => `"${c}"`)]
  return '﻿' + lines.join('\n')
}

export default function ExcelImport({ onImported, departments: _departments }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ExcelRow[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setError(null)
    setBusy(true)
    setFileName(file.name)
    try {
      await loadSheetJS()
      const XLSX = window.XLSX
      if (!XLSX) throw new Error('Excel 解析库未就绪')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (rows.length < 2) {
        throw new Error('文件中没有数据行')
      }
      // 找表头
      const headerRow = rows[0].map((h: any) => String(h).trim())
      const colIndex: Record<string, number> = {}
      TEMPLATE_HEADERS.forEach((h) => {
        const idx = headerRow.findIndex((c) => c === h)
        if (idx >= 0) colIndex[h] = idx
      })
      if (colIndex['金额'] === undefined || colIndex['类别'] === undefined) {
        throw new Error('请使用模板：必须包含「金额」和「类别」列')
      }
      const out: ExcelRow[] = []
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]
        const amount = parseFloat(String(r[colIndex['金额']] ?? '').replace(/[^\d.-]/g, ''))
        if (!Number.isFinite(amount) || amount === 0) continue
        const dateRaw = colIndex['费用日期'] !== undefined ? r[colIndex['费用日期']] : ''
        let dateStr: string | null = null
        if (dateRaw instanceof Date) {
          dateStr = dateRaw.toISOString().slice(0, 10)
        } else if (typeof dateRaw === 'string' && dateRaw) {
          // 接受 2026-06-12 / 2026/06/12 / Excel 序列号
          const s = dateRaw.trim()
          const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
          if (m) dateStr = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
          else if (/^\d+$/.test(s) && s.length <= 5) {
            // Excel 序列号 → 日期
            const serial = parseInt(s, 10)
            const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
            dateStr = d.toISOString().slice(0, 10)
          }
        }
        out.push({
          name: String(r[colIndex['报销名称']] ?? '').trim() || '未命名',
          expense_type: String(r[colIndex['类别']] ?? '其他').trim() || '其他',
          city: String(r[colIndex['城市']] ?? '').trim(),
          expense_date: dateStr,
          amount,
          note: String(r[colIndex['费用说明']] ?? '').trim(),
          remark: String(r[colIndex['备注']] ?? '').trim(),
          department_name: String(r[colIndex['费用使用部门']] ?? '').trim(),
        })
      }
      if (out.length === 0) throw new Error('未解析到有效数据行')
      setPreview(out)
    } catch (e: any) {
      setError(e.message || '解析失败')
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }

  const downloadTemplate = () => {
    const blob = new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '报销明细模板.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const confirm = () => {
    if (preview && preview.length) {
      onImported(preview)
      setOpen(false)
      setPreview(null)
      setFileName(null)
    }
  }

  const cancel = () => {
    setOpen(false)
    setPreview(null)
    setFileName(null)
    setError(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs rounded-lg border border-border bg-bg-card text-gray-600 dark:text-gray-400 hover:border-accent-blue/50 hover:text-accent-blue flex items-center gap-1.5"
      >
        <Upload size={14} />
        从 Excel 中导入
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-bg-card rounded-xl shadow-2xl w-[640px] max-w-[92vw] max-h-[88vh] flex flex-col">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold">从 Excel / CSV 导入报销明细</h3>
              <button onClick={cancel} className="p-1 rounded hover:bg-bg-hover text-gray-500">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 flex-1 overflow-auto">
              <div className="flex items-center gap-3 mb-4">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={onFile}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs rounded-lg bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {busy ? '解析中…' : '选择文件'}
                </button>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border bg-bg-card text-gray-600 hover:border-accent-blue/50 hover:text-accent-blue flex items-center gap-1.5"
                >
                  <Download size={14} />
                  下载 CSV 模板
                </button>
                {fileName && <span className="text-xs text-gray-500">已选：{fileName}</span>}
              </div>
              {error && (
                <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>{error}</div>
                </div>
              )}
              {preview && preview.length > 0 && (
                <div className="text-xs text-gray-500 mb-2">
                  解析到 <span className="text-accent-blue font-medium">{preview.length}</span> 条明细
                </div>
              )}
              {preview && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-bg-hover sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left">#</th>
                          <th className="px-2 py-1.5 text-left">报销名称</th>
                          <th className="px-2 py-1.5 text-left">类别</th>
                          <th className="px-2 py-1.5 text-left">城市</th>
                          <th className="px-2 py-1.5 text-left">费用日期</th>
                          <th className="px-2 py-1.5 text-right">金额</th>
                          <th className="px-2 py-1.5 text-left">费用说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((r, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-2 py-1.5 text-gray-500">{i + 1}</td>
                            <td className="px-2 py-1.5">{r.name}</td>
                            <td className="px-2 py-1.5">{r.expense_type}</td>
                            <td className="px-2 py-1.5">{r.city || '-'}</td>
                            <td className="px-2 py-1.5">{r.expense_date || '-'}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{r.amount.toFixed(2)}</td>
                            <td className="px-2 py-1.5">{r.note || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={cancel}
                className="px-4 py-1.5 text-xs rounded-lg border border-border bg-bg-card text-gray-600 hover:border-accent-blue/50 hover:text-accent-blue"
              >
                取消
              </button>
              <button
                onClick={confirm}
                disabled={!preview?.length}
                className="px-4 py-1.5 text-xs rounded-lg bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-50"
              >
                导入 ({preview?.length || 0} 条)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
