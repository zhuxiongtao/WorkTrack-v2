import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, StatusBadge, IconBox, EmptyState } from '../components/design-system'
import { Cpu, RefreshCw, Globe, Zap, Check, X, Edit3, ExternalLink, Calendar, Sparkles, Loader2, AlertCircle, DollarSign } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'

interface ModelCatalogItem {
  id: number
  name: string
  version_id: string | null
  provider: string | null
  region: string
  modality: string | null
  release_date: string | null
  description: string | null
  source_url: string | null
  confidence: number | null
  is_active: boolean
  last_seen_at: string | null
  reviewed_at: string | null
  reviewed_by: number | null
  // 官网公开定价（USD/1M tokens，手动维护）
  input_price: number | null
  output_price: number | null
  cache_read_price: number | null
  cache_write_price: number | null
  created_at: string
  updated_at: string
}

function fmtP(v: number | null | undefined) {
  if (v == null) return null
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
}

interface RefreshStatus {
  last_refresh_at: string | null
  last_refresh_status: string | null
  last_refresh_count: number
  last_error: string | null
  next_run_at: string | null
  enabled: boolean
  cron: string
}

export default function ModelCatalogPage() {
  const { fetchWithAuth } = useAuth()
  const [items, setItems] = useState<ModelCatalogItem[]>([])
  const [status, setStatus] = useState<RefreshStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<ModelCatalogItem>>({})
  const [tab, setTab] = useState<'pending' | 'active' | 'all'>('pending')
  const [regionFilter, setRegionFilter] = useState<string>('')
  const [providerFilter, setProviderFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 3000)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [allRes, statusRes] = await Promise.all([
        fetchWithAuth('/api/v1/models/all?include_inactive=true'),
        fetchWithAuth('/api/v1/models/refresh/status'),
      ])
      if (allRes?.ok) setItems(await allRes.json())
      else setError('加载模型列表失败')
      if (statusRes?.ok) setStatus(await statusRes.json())
    } catch (e: any) {
      setError(e?.message || '网络错误')
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  useEffect(() => { loadData() }, [loadData])

  const handleManualRefresh = async () => {
    setRefreshing(true)
    try {
      const r = await fetchWithAuth('/api/v1/models/refresh', { method: 'POST' })
      if (r?.ok) {
        const d = await r.json()
        const tip = d.translated > 0
          ? `刷新成功: 新增 ${d.inserted}, 更新 ${d.updated}, 自动翻译 ${d.translated}, 耗时 ${d.duration_ms}ms`
          : `刷新成功: 新增 ${d.inserted}, 更新 ${d.updated}, 耗时 ${d.duration_ms}ms`
        showToast('ok', tip)
        await loadData()
      } else {
        const err = await r?.json().catch(() => ({ detail: '未知错误' }))
        showToast('err', err?.detail || '刷新失败')
      }
    } catch (e: any) {
      showToast('err', e?.message || '请求失败')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSave = async (id: number) => {
    try {
      const r = await fetchWithAuth(`/api/v1/models/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editDraft),
      })
      if (r?.ok) {
        showToast('ok', '已保存')
        setEditingId(null)
        setEditDraft({})
        await loadData()
      } else {
        const err = await r?.json().catch(() => ({ detail: '保存失败' }))
        showToast('err', err?.detail || '保存失败')
      }
    } catch (e: any) {
      showToast('err', e?.message || '请求失败')
    }
  }

  const handleToggleActive = async (item: ModelCatalogItem) => {
    try {
      const r = await fetchWithAuth(`/api/v1/models/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !item.is_active }),
      })
      if (r?.ok) {
        showToast('ok', !item.is_active ? '已启用' : '已停用')
        await loadData()
      }
    } catch (e: any) {
      showToast('err', e?.message || '请求失败')
    }
  }

  const handleDelete = async (item: ModelCatalogItem) => {
    if (!confirm(`确定删除模型「${item.name}」?此操作不可恢复。`)) return
    try {
      const r = await fetchWithAuth(`/api/v1/models/${item.id}`, { method: 'DELETE' })
      if (r?.ok) {
        showToast('ok', '已删除')
        await loadData()
      }
    } catch (e: any) {
      showToast('err', e?.message || '请求失败')
    }
  }

  // 筛选
  const filteredItems = useMemo(() => {
    let list = items
    if (tab === 'pending') list = list.filter(x => !x.is_active)
    else if (tab === 'active') list = list.filter(x => x.is_active)
    if (regionFilter) list = list.filter(x => x.region === regionFilter)
    if (providerFilter) list = list.filter(x => x.provider === providerFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(x =>
        x.name.toLowerCase().includes(q) ||
        (x.provider || '').toLowerCase().includes(q) ||
        (x.version_id || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, tab, regionFilter, providerFilter, search])

  const providers = useMemo(() => {
    const set = new Set<string>()
    items.forEach(i => i.provider && set.add(i.provider))
    return Array.from(set).sort()
  }, [items])

  const stats = useMemo(() => {
    return {
      total: items.length,
      pending: items.filter(x => !x.is_active).length,
      active: items.filter(x => x.is_active).length,
      domestic: items.filter(x => x.region === 'domestic' && x.is_active).length,
      international: items.filter(x => x.region === 'international' && x.is_active).length,
    }
  }, [items])

  const formatDate = (s: string | null | undefined) => {
    if (!s) return '—'
    try {
      return new Date(s).toLocaleString('zh-CN', { hour12: false })
    } catch { return s }
  }
  const timeAgo = (s: string | null | undefined) => {
    if (!s) return '—'
    const diff = Date.now() - new Date(s).getTime()
    if (diff < 0) return '刚刚'
    const m = Math.floor(diff / 60000)
    if (m < 1) return '刚刚'
    if (m < 60) return `${m} 分钟前`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} 小时前`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d} 天前`
    return new Date(s).toLocaleDateString('zh-CN')
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={Cpu}
        title="模型管理"
        description="Tavily 自动联网采集国内外知名大模型，管理员审校后才对业务可见"
      />

      {/* 状态条 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="总采集数" value={stats.total} icon={Cpu} tone="blue" />
        <StatCard label="待审校" value={stats.pending} icon={AlertCircle} tone="orange" />
        <StatCard label="已激活" value={stats.active} icon={Check} tone="green" />
        <StatCard label="国内 (活跃)" value={stats.domestic} icon={Globe} tone="cyan" />
        <StatCard label="国际 (活跃)" value={stats.international} icon={Zap} tone="purple" />
      </div>

      {/* 刷新控制 */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 text-sm">
            <Sparkles size={18} className="text-accent-blue" />
            <div>
              <div className="text-gray-700 dark:text-gray-200 font-semibold">
                上次刷新: {status?.last_refresh_at ? timeAgo(status.last_refresh_at) : '从未刷新'}
                {status?.last_refresh_status && (
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    status.last_refresh_status === 'success'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                  }`}>
                    {status.last_refresh_status}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                定时规则: <code className="px-1 bg-bg-input rounded">{status?.cron || '0 3 * * 1'}</code>
                {' · '}
                下次执行: {status?.next_run_at ? formatDate(status.next_run_at) : '—'}
                {' · '}
                状态: {status?.enabled ? '✅ 已启用' : '⛔ 已停用'}
              </div>
              {status?.last_error && (
                <div className="text-xs text-rose-500 mt-1">⚠ {status.last_error}</div>
              )}
            </div>
          </div>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold flex items-center gap-1.5 hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {refreshing ? '采集中...' : '立即刷新'}
          </button>
        </div>
      </div>

      {/* Tab + 筛选 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-bg-input p-1 rounded-lg">
          {(['pending', 'active', 'all'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                tab === t
                  ? 'bg-accent-blue text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'pending' && `待审校 (${stats.pending})`}
              {t === 'active' && `已激活 (${stats.active})`}
              {t === 'all' && `全部 (${stats.total})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SearchableSelect
            options={[
              { value: '', label: '全部地域' },
              { value: 'domestic', label: '国内' },
              { value: 'international', label: '国际' },
            ]}
            value={regionFilter}
            onChange={(v) => setRegionFilter(v === null ? '' : String(v))}
          />
          <SearchableSelect
            options={[
              { value: '', label: '全部提供方' },
              ...providers.map(p => ({ value: p, label: p })),
            ]}
            value={providerFilter}
            onChange={(v) => setProviderFilter(v === null ? '' : String(v))}
          />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索名称/提供方/version_id"
            className="px-2 py-1.5 text-xs rounded-md bg-bg-input border border-border outline-none w-56"
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-16 text-gray-500">
            <Loader2 size={24} className="animate-spin mx-auto mb-2" />加载中...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-rose-500">
            <AlertCircle size={24} className="mx-auto mb-2" />{error}
            <button onClick={loadData} className="ml-3 text-accent-blue underline text-sm">重试</button>
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={Cpu}
            title={tab === 'pending' ? '暂无待审校模型' : tab === 'active' ? '暂无已激活模型' : '暂无模型'}
            description={tab === 'pending' ? '点击右上角"立即刷新"调用 Tavily 联网采集最新模型' : '尝试切换其他 Tab 或修改筛选条件'}
          />
        ) : (
          filteredItems.map(item => {
            const isEditing = editingId === item.id
            return (
              <div
                key={item.id}
                className={`bg-bg-card border rounded-xl p-4 transition-all ${
                  item.is_active
                    ? 'border-emerald-500/30 shadow-sm'
                    : 'border-border hover:border-accent-blue/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <IconBox
                        icon={Cpu}
                        size="md"
                        tone={item.region === 'domestic' ? 'red' : 'blue'}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isEditing ? (
                            <input
                              value={editDraft.name ?? ''}
                              onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
                              className="px-2 py-0.5 text-sm font-bold rounded bg-bg-input border border-border outline-none"
                            />
                          ) : (
                            <h3 className="text-base font-bold text-gray-900 dark:text-white">{item.name}</h3>
                          )}
                          {item.version_id && (
                            isEditing ? (
                              <input
                                value={editDraft.version_id ?? ''}
                                onChange={e => setEditDraft({ ...editDraft, version_id: e.target.value || null })}
                                placeholder="version_id"
                                className="px-1.5 py-0.5 text-xs font-mono rounded bg-bg-input border border-border outline-none w-48"
                              />
                            ) : (
                              <code className="px-1.5 py-0.5 text-[11px] font-mono rounded bg-bg-input text-gray-500">
                                {item.version_id}
                              </code>
                            )
                          )}
                          <StatusBadge variant={item.is_active ? 'success' : 'neutral'}>
                            {item.is_active ? '已激活' : '待审校'}
                          </StatusBadge>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                            item.region === 'domestic'
                              ? 'bg-rose-500/15 text-rose-500'
                              : 'bg-cyan-500/15 text-cyan-500'
                          }`}>
                            {item.region === 'domestic' ? '国内' : '国际'}
                          </span>
                          {item.modality && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-500">
                              {item.modality}
                            </span>
                          )}
                          {item.confidence != null && (
                            <span className="text-[11px] text-gray-500">
                              置信度 {(item.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                          {isEditing ? (
                            <>
                              <input
                                value={editDraft.provider ?? ''}
                                onChange={e => setEditDraft({ ...editDraft, provider: e.target.value || null })}
                                placeholder="提供方"
                                className="px-1.5 py-0.5 text-xs rounded bg-bg-input border border-border outline-none w-32"
                              />
                              <input
                                type="date"
                                value={editDraft.release_date ?? ''}
                                onChange={e => setEditDraft({ ...editDraft, release_date: e.target.value || null })}
                                className="px-1.5 py-0.5 text-xs rounded bg-bg-input border border-border outline-none"
                              />
                            </>
                          ) : (
                            <>
                              {item.provider && <span>🏢 {item.provider}</span>}
                              {item.release_date && (
                                <span className="flex items-center gap-0.5"><Calendar size={10} />{item.release_date}</span>
                              )}
                              <span>🕒 最后出现: {timeAgo(item.last_seen_at)}</span>
                              {item.reviewed_at && <span>✅ 审校: {timeAgo(item.reviewed_at)}</span>}
                            </>
                          )}
                        </div>
                        {(item.description || (isEditing && editDraft.description !== undefined)) && (
                          isEditing ? (
                            <textarea
                              value={editDraft.description ?? ''}
                              onChange={e => setEditDraft({ ...editDraft, description: e.target.value })}
                              rows={2}
                              className="mt-2 w-full px-2 py-1 text-xs rounded bg-bg-input border border-border outline-none resize-none"
                            />
                          ) : (
                            <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                              {item.description}
                            </p>
                          )
                        )}
                        {/* 官网定价（USD/1M tokens） */}
                        {isEditing ? (
                          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                            {[
                              { key: 'input_price' as const, label: '输入价 $/1M' },
                              { key: 'output_price' as const, label: '输出价 $/1M' },
                              { key: 'cache_read_price' as const, label: '缓存读 $/1M' },
                              { key: 'cache_write_price' as const, label: '缓存写 $/1M' },
                            ].map(({ key, label }) => (
                              <div key={key}>
                                <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editDraft[key] ?? ''}
                                  onChange={e => setEditDraft({ ...editDraft, [key]: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                  placeholder="—"
                                  className="w-full px-1.5 py-0.5 text-xs rounded bg-bg-input border border-border outline-none"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (item.input_price != null || item.output_price != null || item.cache_read_price != null || item.cache_write_price != null) ? (
                          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px]">
                            <span className="flex items-center gap-0.5 text-gray-500">
                              <DollarSign size={10} />官网定价:
                            </span>
                            {item.input_price != null && (
                              <span className="text-emerald-500 font-mono font-semibold">输入 {fmtP(item.input_price)}/1M</span>
                            )}
                            {item.output_price != null && (
                              <span className="text-orange-500 font-mono font-semibold">输出 {fmtP(item.output_price)}/1M</span>
                            )}
                            {item.cache_read_price != null && (
                              <span className="text-blue-400 font-mono">缓存读 {fmtP(item.cache_read_price)}/1M</span>
                            )}
                            {item.cache_write_price != null && (
                              <span className="text-violet-400 font-mono">缓存写 {fmtP(item.cache_write_price)}/1M</span>
                            )}
                          </div>
                        ) : null}
                        {item.source_url && !isEditing && (
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-accent-blue hover:underline"
                          >
                            <ExternalLink size={10} />来源
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleSave(item.id)}
                          className="px-2.5 py-1 text-xs rounded-md bg-emerald-500 text-white hover:brightness-110"
                        >
                          <Check size={12} className="inline mr-0.5" />保存
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditDraft({}) }}
                          className="px-2.5 py-1 text-xs rounded-md bg-bg-input text-gray-600 hover:bg-bg-hover"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleToggleActive(item)}
                          className={`px-2.5 py-1 text-xs rounded-md ${
                            item.is_active
                              ? 'bg-bg-input text-rose-500 hover:bg-rose-500/15'
                              : 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25'
                          }`}
                        >
                          {item.is_active ? '停用' : '启用'}
                        </button>
                        <button
                          onClick={() => { setEditingId(item.id); setEditDraft(item) }}
                          className="p-1.5 text-xs rounded-md bg-bg-input text-gray-500 hover:text-gray-700"
                          title="编辑"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="p-1.5 text-xs rounded-md bg-bg-input text-rose-500 hover:bg-rose-500/15"
                          title="删除"
                        >
                          <X size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg shadow-lg text-sm font-semibold ${
          toast.kind === 'ok' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
        }`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: 'blue' | 'green' | 'orange' | 'cyan' | 'purple' }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-3 flex items-center gap-3">
      <IconBox icon={Icon} size="lg" tone={tone} />
      <div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  )
}
