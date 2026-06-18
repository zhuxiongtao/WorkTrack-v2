import { useState, useEffect, useCallback } from 'react'
import {
  CheckSquare, Loader2, Check, X, RotateCcw, Clock, FileText,
  ChevronRight, CircleCheck, CircleX, CircleDot, Send,
} from 'lucide-react'
import { PageHeader, EmptyState, Modal } from '../components/design-system'
import { useToast } from '../contexts/ToastContext'

/* ──── 类型 ──── */
interface ApprovalBrief {
  id: number
  flow_code: string
  title: string
  target_type: string
  target_id: number
  status: string
  current_node: string
  node_total: number
  node_index: number
  submitted_by: number
  submitted_by_name: string
  submitted_at: string
  finished_at: string | null
  can_act: boolean
}
interface ApprovalNode {
  name: string
  order: number
  status: string
  approver_ids: number[]
  approver_names: string[]
  decided_by: number | null
  decided_by_name: string
  decided_at: string | null
  is_current: boolean
}
interface ApprovalRecordItem {
  node_name: string
  action: string
  approver_id: number
  approver_name: string
  comment: string
  created_at: string
}
interface ApprovalDetail {
  id: number
  flow_code: string
  title: string
  target_type: string
  target_id: number
  status: string
  current_node_index: number
  submitted_by: number
  submitted_by_name: string
  submitted_at: string
  finished_at: string | null
  nodes: ApprovalNode[]
  records: ApprovalRecordItem[]
  can_act: boolean
  can_cancel: boolean
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '审批中', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  approved: { label: '已通过', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  rejected: { label: '已驳回', cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  cancelled: { label: '已撤回', cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' },
}
const ACTION_LABEL: Record<string, string> = {
  submit: '发起申请', approve: '通过', reject: '驳回', cancel: '撤回',
}
const TARGET_LABEL: Record<string, string> = { contract: '合同' }

function fmtTime(s: string | null): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('zh-CN', { hour12: false }) } catch { return s }
}

function statusBadge(status: string) {
  const m = STATUS_META[status] || { label: status, cls: 'text-gray-400 bg-gray-500/10 border-gray-500/30' }
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>
}

export default function ApprovalsPage() {
  const { toast: showToast, confirm: showConfirm } = useToast()
  const [tab, setTab] = useState<'pending' | 'mine'>('pending')
  const [pending, setPending] = useState<ApprovalBrief[]>([])
  const [mine, setMine] = useState<ApprovalBrief[]>([])
  const [loading, setLoading] = useState(true)

  const [detail, setDetail] = useState<ApprovalDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, mRes] = await Promise.all([
        fetch('/api/v1/approvals/pending'),
        fetch('/api/v1/approvals/mine'),
      ])
      if (pRes.ok) setPending(await pRes.json())
      if (mRes.ok) setMine(await mRes.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = async (id: number) => {
    setDetailLoading(true)
    setComment('')
    try {
      const res = await fetch(`/api/v1/approvals/${id}`)
      if (res.ok) setDetail(await res.json())
      else showToast('加载审批详情失败', 'error')
    } catch { showToast('加载审批详情失败', 'error') }
    finally { setDetailLoading(false) }
  }

  const act = async (action: 'approve' | 'reject') => {
    if (!detail) return
    if (action === 'reject' && !comment.trim()) {
      showToast('驳回请填写意见', 'error'); return
    }
    setActing(true)
    try {
      const res = await fetch(`/api/v1/approvals/${detail.id}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      })
      if (res.ok) {
        const updated = await res.json()
        setDetail(updated)
        showToast(action === 'approve' ? '已通过' : '已驳回', 'success')
        load()
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '操作失败', 'error')
      }
    } catch { showToast('操作失败', 'error') }
    finally { setActing(false) }
  }

  const cancel = async () => {
    if (!detail) return
    const ok = await showConfirm('确认撤回该审批？撤回后业务数据将回到草稿状态。')
    if (!ok) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/approvals/${detail.id}/cancel`, { method: 'POST' })
      if (res.ok) {
        setDetail(await res.json())
        showToast('已撤回', 'success')
        load()
      } else {
        const err = await res.json().catch(() => ({}))
        showToast(err.detail || '撤回失败', 'error')
      }
    } catch { showToast('撤回失败', 'error') }
    finally { setActing(false) }
  }

  const list = tab === 'pending' ? pending : mine

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        icon={CheckSquare}
        title="我的待办"
        description="集中处理待我审批的事项，并跟踪我发起的审批进度"
        tone="orange"
        stats={[
          { label: '待我审批', value: pending.length },
          { label: '我发起的', value: mine.length },
        ]}
      />

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 bg-bg-hover/60 border border-border rounded-lg p-0.5 w-fit mb-5">
        {([
          { key: 'pending' as const, label: '待我审批', icon: Clock, count: pending.length },
          { key: 'mine' as const, label: '我发起的', icon: Send, count: mine.length },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === t.key ? 'bg-bg-card text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <t.icon size={12} />{t.label}
            {t.count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* 列表 */}
      {list.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={tab === 'pending' ? '暂无待办' : '暂无发起的审批'}
          description={tab === 'pending' ? '当前没有需要您审批的事项' : '您还没有发起过审批'}
          tone="orange"
        />
      ) : (
        <div className="space-y-2">
          {list.map(item => (
            <button
              key={item.id}
              onClick={() => openDetail(item.id)}
              className="w-full text-left rounded-xl bg-bg-card border border-border/50 p-4 hover:border-border hover:bg-bg-hover/40 transition-all group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-400 flex items-center justify-center text-white shrink-0">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{item.title || `${TARGET_LABEL[item.target_type] || item.target_type} #${item.target_id}`}</span>
                      {statusBadge(item.status)}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                      {TARGET_LABEL[item.target_type] || item.target_type}
                      {item.status === 'pending' && item.current_node && (
                        <span className="ml-1.5">· 当前节点：<span className="text-amber-400">{item.current_node}</span>（{item.node_index + 1}/{item.node_total}）</span>
                      )}
                      <span className="ml-1.5">· 发起人 {item.submitted_by_name}</span>
                      <span className="ml-1.5">· {fmtTime(item.submitted_at)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.can_act && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold">待处理</span>
                  )}
                  <ChevronRight size={16} className="text-gray-600 group-hover:text-amber-400 transition-colors" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <Modal
          icon={FileText}
          title={detail.title || '审批详情'}
          subtitle={`${TARGET_LABEL[detail.target_type] || detail.target_type} · 发起人 ${detail.submitted_by_name} · ${fmtTime(detail.submitted_at)}`}
          tone="orange"
          size="2xl"
          onClose={() => setDetail(null)}
        >
          {detailLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin text-gray-400" size={22} /></div>
          ) : (
            <div className="space-y-5">
              {/* 状态条 */}
              <div className="flex items-center gap-2">
                {statusBadge(detail.status)}
                {detail.finished_at && <span className="text-[11px] text-gray-500">结束于 {fmtTime(detail.finished_at)}</span>}
              </div>

              {/* 节点进度 */}
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">审批节点</div>
                <div className="space-y-0">
                  {detail.nodes.map((n, i) => {
                    const isLast = i === detail.nodes.length - 1
                    let dot = <CircleDot size={18} className="text-gray-500" />
                    if (n.status === 'approved') dot = <CircleCheck size={18} className="text-green-400" />
                    else if (n.status === 'rejected') dot = <CircleX size={18} className="text-red-400" />
                    else if (n.is_current) dot = <CircleDot size={18} className="text-amber-400" />
                    return (
                      <div key={i} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          {dot}
                          {!isLast && <div className={`w-0.5 flex-1 my-1 ${n.status === 'approved' ? 'bg-green-500/40' : 'bg-border'}`} style={{ minHeight: 24 }} />}
                        </div>
                        <div className={`pb-4 flex-1 ${n.is_current ? '' : 'opacity-90'}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white">{n.name}</span>
                            {n.is_current && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold">当前</span>}
                            {n.status === 'approved' && <span className="text-[10px] text-green-400">已通过</span>}
                            {n.status === 'rejected' && <span className="text-[10px] text-red-400">已驳回</span>}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            审批人：{n.approver_names.length ? n.approver_names.join('、') : '（无可用审批人，自动通过）'}
                            {n.decided_by_name && <span className="ml-1.5">· {n.decided_by_name} 于 {fmtTime(n.decided_at)}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 审批历史 */}
              {detail.records.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">审批记录</div>
                  <div className="space-y-1.5">
                    {detail.records.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] text-gray-400 rounded-lg bg-bg-input/40 px-3 py-2">
                        <span className="text-gray-300 font-medium shrink-0">{r.approver_name}</span>
                        <span className="shrink-0">{ACTION_LABEL[r.action] || r.action}</span>
                        {r.comment && <span className="text-gray-500 truncate">「{r.comment}」</span>}
                        <span className="ml-auto text-gray-600 shrink-0">{fmtTime(r.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 操作区 */}
              {detail.can_act && (
                <div className="rounded-xl bg-bg-input/50 border border-border/40 p-4 space-y-3">
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="审批意见（驳回必填）"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-sm outline-none focus:border-amber-500 transition-all resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => act('approve')}
                      disabled={acting}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 text-white text-xs font-bold hover:bg-green-600 transition-all disabled:opacity-50"
                    >
                      {acting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}通过
                    </button>
                    <button
                      onClick={() => act('reject')}
                      disabled={acting}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-all disabled:opacity-50"
                    >
                      <X size={14} />驳回
                    </button>
                  </div>
                </div>
              )}

              {/* 撤回 */}
              {detail.can_cancel && !detail.can_act && (
                <button
                  onClick={cancel}
                  disabled={acting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bg-hover border border-border text-gray-300 text-xs font-medium hover:text-white hover:border-gray-500 transition-all disabled:opacity-50"
                >
                  <RotateCcw size={14} />撤回审批
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
