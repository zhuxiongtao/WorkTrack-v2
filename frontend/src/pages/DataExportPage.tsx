import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  Database, Download, Upload, FileJson, FileSpreadsheet, CheckCircle, AlertCircle,
  Loader2, HardDrive, FileText, Clock, Eye, History,
} from 'lucide-react'

type TabKey = 'excel' | 'backup' | 'restore'

interface ExcelModule {
  key: string
  title: string
  domain: string
  domain_label: string
  count: number
  has_sub_sheets: boolean
}

interface BackupRecord {
  id: number
  backup_type: string
  filename: string
  file_path: string
  size_bytes: number
  size_label: string
  model_count: number
  record_count: number
  modules: string | null
  operator_id: number
  operator_name: string
  note: string | null
  file_exists: boolean
  created_at: string | null
}

interface RestoreResult {
  dry_run: boolean
  strategy: string
  would_import: Record<string, number>
  would_skip: Record<string, number>
  imported: Record<string, number>
  skipped: Record<string, number>
  errors: Record<string, number>
  total_would_import: number
  total_would_skip: number
  total_imported: number
  total_skipped: number
}

export default function DataExportPage() {
  const { fetchWithAuth, hasPermission } = useAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('excel')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const canExport = hasPermission('data:export')
  const canImport = hasPermission('data:import')

  if (!canExport && !canImport) {
    return <div className="p-8 text-center text-gray-500 dark:text-gray-400">权限不足</div>
  }

  const showError = (msg: string) => { setError(msg); setSuccess('') }
  const showSuccess = (msg: string) => { setSuccess(msg); setError('') }

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-accent-blue/10 border border-accent-blue/20">
          <Database className="w-6 h-6 text-accent-blue" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">数据管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">模块导出 · 全量备份 · 数据恢复</p>
        </div>
      </div>

      {/* 提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-1 p-1 rounded-lg bg-bg-hover/50 border border-border">
        {([
          { key: 'excel' as TabKey, label: '模块导出', icon: FileSpreadsheet },
          { key: 'backup' as TabKey, label: '全量备份', icon: HardDrive },
          { key: 'restore' as TabKey, label: '数据恢复', icon: Upload },
        ]).map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                active
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-transparent'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'excel' && <ExcelExportTab fetchWithAuth={fetchWithAuth} canExport={canExport} onError={showError} onSuccess={showSuccess} />}
      {activeTab === 'backup' && <BackupTab fetchWithAuth={fetchWithAuth} canExport={canExport} onError={showError} onSuccess={showSuccess} />}
      {activeTab === 'restore' && <RestoreTab fetchWithAuth={fetchWithAuth} canImport={canImport} onError={showError} onSuccess={showSuccess} />}
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// Tab 1: Excel 模块导出
// ══════════════════════════════════════════════════════════════
function ExcelExportTab({ fetchWithAuth, canExport, onError, onSuccess }: any) {
  const [modules, setModules] = useState<ExcelModule[]>([])
  const [domains, setDomains] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const loadModules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth('/api/v1/data/excel/modules')
      if (!res.ok) throw new Error('获取模块列表失败')
      const data = await res.json()
      setModules(data.modules || [])
      setDomains(data.domains || {})
    } catch (e: any) {
      onError(e.message)
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth, onError])

  useEffect(() => { loadModules() }, [loadModules])

  const toggleModule = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleDomain = (domain: string) => {
    const domainModules = modules.filter(m => m.domain === domain)
    const allSelected = domainModules.every(m => selected.has(m.key))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) {
        domainModules.forEach(m => next.delete(m.key))
      } else {
        domainModules.forEach(m => next.add(m.key))
      }
      return next
    })
  }

  const handleExport = async () => {
    if (selected.size === 0) { onError('请至少选择一个模块'); return }
    setExporting(true)
    try {
      const body: any = { modules: Array.from(selected) }
      if (dateFrom) body.date_from = dateFrom
      if (dateTo) body.date_to = dateTo

      const res = await fetchWithAuth('/api/v1/data/excel/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '导出失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="?(.+?)"?$/)?.[1] || `excel_export_${Date.now()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      onSuccess(`导出成功：${selected.size} 个模块`)
      loadModules() // 刷新记录数
    } catch (e: any) {
      onError(e.message)
    } finally {
      setExporting(false)
    }
  }

  const totalRecords = modules.filter(m => selected.has(m.key)).reduce((a, m) => a + Math.max(m.count, 0), 0)
  const domainKeys = [...new Set(modules.map(m => m.domain))]

  if (!canExport) return <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">无导出权限</div>

  return (
    <div className="space-y-4">
      {/* 时间范围筛选 */}
      <div className="bg-bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={15} className="text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">时间范围筛选（可选）</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-200 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15"
          />
          <span className="text-gray-400 text-sm">至</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-bg-input border border-border text-sm text-gray-700 dark:text-gray-200 focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo('') }}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* 模块列表（按业务域分组） */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          加载中...
        </div>
      ) : (
        <div className="space-y-3">
          {domainKeys.map(domain => {
            const domainModules = modules.filter(m => m.domain === domain)
            const allSelected = domainModules.every(m => selected.has(m.key))
            const someSelected = domainModules.some(m => selected.has(m.key))
            return (
              <div key={domain} className="bg-bg-card border border-border rounded-lg overflow-hidden">
                {/* 域标题 */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-bg-hover/30 border-b border-border">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = !allSelected && someSelected }}
                      onChange={() => toggleDomain(domain)}
                      className="w-4 h-4 accent-blue-500"
                    />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {domains[domain] || domain}
                    </span>
                    <span className="text-xs text-gray-400">
                      ({domainModules.length} 个模块)
                    </span>
                  </label>
                </div>
                {/* 模块网格 */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3">
                  {domainModules.map(m => {
                    const isSelected = selected.has(m.key)
                    return (
                      <label
                        key={m.key}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-accent-blue/40 bg-accent-blue/5'
                            : 'border-border bg-bg-hover/20 hover:border-accent-blue/20'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleModule(m.key)}
                          className="w-3.5 h-3.5 accent-blue-500 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                            {m.title}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {m.count >= 0 ? `${m.count} 条` : '查询失败'}
                            {m.has_sub_sheets && ' · 含子表'}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 底部操作栏 */}
      <div className="sticky bottom-0 bg-bg-card border border-border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          已选 <span className="font-semibold text-accent-blue">{selected.size}</span> 个模块，
          约 <span className="font-semibold text-gray-700 dark:text-gray-200">{totalRecords.toLocaleString()}</span> 条记录
        </div>
        <button
          onClick={handleExport}
          disabled={selected.size === 0 || exporting}
          className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all w-full sm:w-auto"
        >
          {exporting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 导出中...</>
          ) : (
            <><FileSpreadsheet className="w-4 h-4" /> 导出 Excel</>
          )}
        </button>
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// Tab 2: 全量备份
// ══════════════════════════════════════════════════════════════
function BackupTab({ fetchWithAuth, canExport, onError, onSuccess }: any) {
  const [summary, setSummary] = useState<Record<string, number> | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [backingUp, setBackingUp] = useState<'json' | 'sql' | null>(null)
  const [history, setHistory] = useState<BackupRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const res = await fetchWithAuth('/api/v1/data/export/summary')
      if (!res.ok) throw new Error('获取摘要失败')
      setSummary(await res.json())
    } catch (e: any) {
      onError(e.message)
    } finally {
      setLoadingSummary(false)
    }
  }, [fetchWithAuth, onError])

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await fetchWithAuth('/api/v1/data/backup/history')
      if (!res.ok) throw new Error('获取备份历史失败')
      const data = await res.json()
      setHistory(Array.isArray(data) ? data : [])
    } catch (e: any) {
      onError(e.message)
    } finally {
      setLoadingHistory(false)
    }
  }, [fetchWithAuth, onError])

  useEffect(() => { loadSummary(); loadHistory() }, [loadSummary, loadHistory])

  const handleJsonBackup = async () => {
    setBackingUp('json')
    try {
      const res = await fetchWithAuth('/api/v1/data/backup/json')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '备份失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="?(.+?)"?$/)?.[1] || `backup_json_${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      onSuccess('JSON 全量备份完成')
      loadHistory()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBackingUp(null)
    }
  }

  const handleSqlBackup = async () => {
    setBackingUp('sql')
    try {
      const res = await fetchWithAuth('/api/v1/data/backup/sql')
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '备份失败')
      }
      const data = await res.json()
      onSuccess(data.message || 'SQL 备份完成')
      loadHistory()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setBackingUp(null)
    }
  }

  const handleDownload = async (record: BackupRecord) => {
    try {
      const res = await fetchWithAuth(`/api/v1/data/backup/${record.id}/download`)
      if (!res.ok) throw new Error('下载失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = record.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      onError(e.message)
    }
  }

  const totalRecords = summary ? Object.values(summary).reduce((a, b) => a + Math.max(b, 0), 0) : 0
  const backupTypeLabel: Record<string, string> = { json: 'JSON', sql: 'SQL', excel: 'Excel' }
  const backupTypeColor: Record<string, string> = {
    json: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
    sql: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
    excel: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
  }

  if (!canExport) return <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">无备份权限</div>

  return (
    <div className="space-y-4">
      {/* 备份操作区 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* JSON 备份 */}
        <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10">
              <FileJson className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">JSON 结构化备份</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">按模型导出，可选择性恢复</p>
            </div>
          </div>
          <button
            onClick={handleJsonBackup}
            disabled={!!backingUp}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 transition-all"
          >
            {backingUp === 'json' ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 备份中...</>
            ) : (
              <><Download className="w-4 h-4" /> JSON 全量备份</>
            )}
          </button>
        </div>

        {/* SQL 备份 */}
        <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10">
              <HardDrive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">SQL 整库快照</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">pg_dump 完整备份，含索引/约束</p>
            </div>
          </div>
          <button
            onClick={handleSqlBackup}
            disabled={!!backingUp}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-bg-card text-gray-700 dark:text-gray-200 text-sm font-medium hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-50 transition-all"
          >
            {backingUp === 'sql' ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 备份中...</>
            ) : (
              <><HardDrive className="w-4 h-4" /> SQL Dump 备份</>
            )}
          </button>
        </div>
      </div>

      {/* 备份范围摘要 */}
      <div className="bg-bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">备份范围摘要</span>
          </div>
          <button onClick={loadSummary} className="text-xs text-accent-blue hover:underline">
            {loadingSummary ? '加载中...' : '刷新'}
          </button>
        </div>
        {summary && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            共 {Object.keys(summary).length} 个数据表，{totalRecords.toLocaleString()} 条记录
          </div>
        )}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5 max-h-40 overflow-y-auto">
            {Object.entries(summary)
              .filter(([, count]) => count > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([name, count]) => (
                <div key={name} className="px-2 py-1 rounded bg-bg-hover/40 text-xs">
                  <div className="text-gray-400 truncate">{name}</div>
                  <div className="font-semibold text-gray-700 dark:text-gray-200">{count.toLocaleString()}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 备份历史 */}
      <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">备份历史</span>
          </div>
          <button onClick={loadHistory} className="text-xs text-accent-blue hover:underline">
            {loadingHistory ? '加载中...' : '刷新'}
          </button>
        </div>
        {history.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            暂无备份记录
          </div>
        ) : (
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {history.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover/30">
                <div className={`px-2 py-0.5 rounded text-[10px] font-medium border ${backupTypeColor[r.backup_type] || backupTypeColor.json}`}>
                  {backupTypeLabel[r.backup_type] || r.backup_type}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                    {r.filename}
                  </div>
                  <div className="text-[10px] text-gray-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{r.size_label}</span>
                    {r.record_count > 0 && <span>· {r.record_count.toLocaleString()} 条</span>}
                    <span>· {r.operator_name}</span>
                    <span>· {r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : ''}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(r)}
                  disabled={!r.file_exists}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-accent-blue hover:bg-accent-blue/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  title={r.file_exists ? '下载' : '文件已清理'}
                >
                  <Download size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// Tab 3: 数据恢复
// ══════════════════════════════════════════════════════════════
function RestoreTab({ fetchWithAuth, canImport, onError, onSuccess }: any) {
  const [file, setFile] = useState<File | null>(null)
  const [strategy, setStrategy] = useState<'skip' | 'insert_only'>('skip')
  const [dryRunResult, setDryRunResult] = useState<RestoreResult | null>(null)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)
  const [processing, setProcessing] = useState<'dry' | 'restore' | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setDryRunResult(null)
      setRestoreResult(null)
    }
    e.target.value = ''
  }

  const doRequest = async (dryRun: boolean) => {
    if (!file) { onError('请先选择文件'); return }
    setProcessing(dryRun ? 'dry' : 'restore')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const url = `/api/v1/data/restore?strategy=${strategy}&dry_run=${dryRun}`
      const res = await fetchWithAuth(url, { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || '操作失败')
      }
      const result: RestoreResult = await res.json()
      if (dryRun) {
        setDryRunResult(result)
      } else {
        setRestoreResult(result)
        onSuccess(`恢复完成：新增 ${result.total_imported} 条，跳过 ${result.total_skipped} 条`)
      }
    } catch (e: any) {
      onError(e.message)
    } finally {
      setProcessing(null)
    }
  }

  const renderResult = (result: RestoreResult, isDry: boolean) => {
    const importedCount = isDry ? result.total_would_import : result.total_imported
    const skippedCount = isDry ? result.total_would_skip : result.total_skipped
    const errorCount = Object.values(result.errors).reduce((a, b) => a + b, 0)

    return (
      <div className={`space-y-3 p-4 rounded-lg border ${
        isDry
          ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
          : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
      }`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          {isDry ? (
            <><Eye className="w-4 h-4 text-amber-600 dark:text-amber-400" /> 预检查结果</>
          ) : (
            <><CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> 恢复完成</>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{isDry ? '将新增' : '已新增'}</div>
            <div className="font-semibold text-emerald-600 dark:text-emerald-400">{importedCount} 条</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{isDry ? '将跳过' : '已跳过'}</div>
            <div className="font-semibold text-amber-600 dark:text-amber-400">{skippedCount} 条</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">错误</div>
            <div className="font-semibold text-red-600 dark:text-red-400">{errorCount} 条</div>
          </div>
        </div>
        {/* 明细 */}
        {isDry && result.total_would_import > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            将新增明细：{Object.entries(result.would_import).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join('，')}
          </div>
        )}
        {!isDry && result.total_imported > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            新增明细：{Object.entries(result.imported).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join('，')}
          </div>
        )}
        {errorCount > 0 && (
          <div className="text-xs text-red-500 dark:text-red-400">
            错误明细：{Object.entries(result.errors).map(([k, v]) => `${k}: ${v}`).join('，')}
          </div>
        )}
      </div>
    )
  }

  if (!canImport) return <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">无恢复权限</div>

  return (
    <div className="space-y-4">
      {/* 文件选择 */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">选择备份文件</span>
        </div>
        <label className={`flex items-center justify-center gap-2 px-5 py-3 rounded-lg border-2 border-dashed border-border text-sm font-medium cursor-pointer transition-all hover:border-accent-blue/50 hover:bg-accent-blue/5`}>
          <input type="file" accept=".json" onChange={handleFileChange} className="hidden" />
          <FileText className="w-4 h-4 text-gray-400" />
          {file ? file.name : '选择 JSON 备份文件'}
        </label>
        {file && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            文件大小：{(file.size / 1024).toFixed(1)} KB
          </div>
        )}
      </div>

      {/* 策略选择 */}
      <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">导入策略</span>
        </div>
        <div className="space-y-2">
          <label className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
            strategy === 'skip' ? 'border-accent-blue/40 bg-accent-blue/5' : 'border-border hover:border-accent-blue/20'
          }`}>
            <input
              type="radio"
              checked={strategy === 'skip'}
              onChange={() => setStrategy('skip')}
              className="mt-0.5 w-4 h-4 accent-blue-500"
            />
            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-200">跳过已存在（推荐）</div>
              <div className="text-[10px] text-gray-400">已存在的 ID 跳过，仅导入新数据，最安全</div>
            </div>
          </label>
          <label className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
            strategy === 'insert_only' ? 'border-accent-blue/40 bg-accent-blue/5' : 'border-border hover:border-accent-blue/20'
          }`}>
            <input
              type="radio"
              checked={strategy === 'insert_only'}
              onChange={() => setStrategy('insert_only')}
              className="mt-0.5 w-4 h-4 accent-blue-500"
            />
            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-200">仅新增</div>
              <div className="text-[10px] text-gray-400">仅导入新 ID，已存在跳过，不覆盖任何现有数据</div>
            </div>
          </label>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <button
          onClick={() => doRequest(true)}
          disabled={!file || !!processing}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-bg-card text-gray-700 dark:text-gray-200 text-sm font-medium hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {processing === 'dry' ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 预检查中...</>
          ) : (
            <><Eye className="w-4 h-4" /> 预检查</>
          )}
        </button>
        <button
          onClick={() => doRequest(false)}
          disabled={!file || !!processing || !dryRunResult}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {processing === 'restore' ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 恢复中...</>
          ) : (
            <><Upload className="w-4 h-4" /> 确认恢复</>
          )}
        </button>
      </div>

      {!dryRunResult && (
        <div className="text-xs text-gray-400 text-center">
          建议先点击「预检查」查看将导入的数据量，确认无误后再「确认恢复」
        </div>
      )}

      {/* 结果展示 */}
      {dryRunResult && renderResult(dryRunResult, true)}
      {restoreResult && renderResult(restoreResult, false)}
    </div>
  )
}
