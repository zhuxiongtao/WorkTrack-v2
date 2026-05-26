import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Database, Download, Upload, FileJson, CheckCircle, AlertCircle, Loader2, HardDrive } from 'lucide-react'

export default function DataExportPage() {
  const { hasPermission } = useAuth()
  const [summary, setSummary] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: Record<string, number>; skipped: Record<string, number>; errors: Record<string, number> } | null>(null)
  const [error, setError] = useState('')

  const canExport = hasPermission('data:export')
  const canImport = hasPermission('data:import')

  const loadSummary = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/data/export/summary')
      if (!res.ok) throw new Error('获取摘要失败')
      setSummary(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    setError('')
    try {
      const res = await fetch('/api/v1/data/export')
      if (!res.ok) throw new Error('导出失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="?(.+?)"?$/)?.[1] || `worktrack_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '_')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/v1/data/import', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '导入失败')
      }
      setImportResult(await res.json())
      if (summary) loadSummary()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  if (!canExport && !canImport) {
    return <div className="p-8 text-center text-gray-500">权限不足</div>
  }

  const totalRecords = summary ? Object.values(summary).reduce((a, b) => a + Math.max(b, 0), 0) : 0

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
          <Database className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">数据管理</h1>
          <p className="text-sm text-gray-500">导出备份与数据迁移</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* 导出区域 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Download className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">数据导出</h2>
        </div>
        <p className="text-sm text-gray-500">
          导出全量业务数据为 JSON 文件，可用于数据备份、迁移或审计。
        </p>

        {!summary && !loading && (
          <button
            onClick={loadSummary}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
          >
            <HardDrive className="w-4 h-4" />
            查看导出范围
          </button>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载中...
          </div>
        )}

        {summary && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                共 {Object.keys(summary).length} 个数据表，{totalRecords.toLocaleString()} 条记录
              </span>
              <button onClick={loadSummary} className="text-xs text-indigo-500 hover:underline">刷新</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
              {Object.entries(summary)
                .filter(([, count]) => count > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([name, count]) => (
                  <div key={name} className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-sm">
                    <div className="text-xs text-gray-400 truncate">{name}</div>
                    <div className="font-semibold text-gray-700 dark:text-gray-200">{count.toLocaleString()}</div>
                  </div>
                ))}
            </div>
            {Object.entries(summary).some(([_, c]) => c === -1) && (
              <p className="text-xs text-amber-500">部分表查询失败（显示 -1）</p>
            )}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={!summary || totalRecords === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium text-sm shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <FileJson className="w-4 h-4" />
          导出全部数据
        </button>
      </div>

      {/* 导入区域 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-emerald-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">数据导入</h2>
        </div>
        <p className="text-sm text-gray-500">
          从 JSON 导出文件中增量导入数据。已存在的记录（按 ID 匹配）将跳过，不会覆盖。
        </p>

        <label className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm font-medium cursor-pointer transition-all ${importing ? 'opacity-50 pointer-events-none' : 'hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/10'}`}>
          <input type="file" accept=".json" onChange={handleImport} className="hidden" disabled={importing} />
          {importing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              导入中...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 text-emerald-500" />
              选择 JSON 文件导入
            </>
          )}
        </label>

        {importResult && (
          <div className="space-y-2 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-medium text-sm">
              <CheckCircle className="w-4 h-4" />
              导入完成
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-500">新增</div>
                <div className="font-semibold text-emerald-600">
                  {Object.values(importResult.imported).reduce((a, b) => a + b, 0)} 条
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">跳过（已存在）</div>
                <div className="font-semibold text-amber-600">
                  {Object.values(importResult.skipped).reduce((a, b) => a + b, 0)} 条
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">错误</div>
                <div className="font-semibold text-red-600">
                  {Object.values(importResult.errors).reduce((a, b) => a + b, 0)} 条
                </div>
              </div>
            </div>
            {(Object.entries(importResult.imported).filter(([, v]) => v > 0).length > 0) && (
              <div className="mt-2 text-xs text-gray-500">
                导入明细：{Object.entries(importResult.imported).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
