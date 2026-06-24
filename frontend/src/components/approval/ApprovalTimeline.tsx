import { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, RotateCcw, UserCheck, Send, ChevronDown, ChevronUp } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'

/* ──── 类型 ──── */
interface ApprovalNode {
  name: string
  order: number
  status: string          // pending | approved | rejected | skipped
  node_kind?: string      // approval | execution
  action_label?: string   // 执行节点动作文案
  approver_names: string[]
  decided_by_name: string
  decided_at: string | null
  is_current: boolean
}
interface ApprovalRecord {
  node_name: string
  action: string          // submit | approve | reject | cancel
  approver_name: string
  comment: string
  created_at: string
}
interface ApprovalDetail {
  id: number
  title: string
  status: string          // pending | approved | rejected | cancelled
  submitted_by_name: string
  submitted_at: string
  finished_at: string | null
  nodes: ApprovalNode[]
  records: ApprovalRecord[]
  can_act: boolean
  can_cancel: boolean
}

/* ──── 工具 ──── */
const fmtTime = (s: string | null) =>
  s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

const ACTION_LABEL: Record<string, string> = {
  submit: '提交审批', approve: '审批通过', reject: '审批驳回', cancel: '撤回审批',
}
const ACTION_COLOR: Record<string, string> = {
  submit: 'text-blue-600 dark:text-blue-400',
  approve: 'text-emerald-600 dark:text-emerald-400',
  reject: 'text-red-600 dark:text-red-400',
  cancel: 'text-gray-500',
}

function NodeIcon({ status, isCurrent }: { status: string; isCurrent: boolean }) {
  if (status === 'approved' || status === 'skipped') return <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
  if (status === 'rejected') return <XCircle size={16} className="text-red-600 dark:text-red-400 shrink-0" />
  if (isCurrent) return <Clock size={16} className="text-amber-600 dark:text-amber-400 shrink-0 animate-pulse" />
  return <Clock size={16} className="text-gray-600 shrink-0" />
}

/* ──── 主组件 ──── */
interface ApprovalTimelineProps {
  targetType: string
  targetId: number
  /** 审批动作完成后回调（如需刷新父组件状态） */
  onChanged?: () => void
}

export function ApprovalTimeline({ targetType, targetId, onChanged }: ApprovalTimelineProps) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<ApprovalDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [acting, setActing] = useState(false)
  const [showDetail, setShowDetail] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/approvals/by-target/${targetType}/${targetId}`)
      if (res.status === 404) { setDetail(null); return }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setDetail(data)
      setShowDetail(data.status === 'pending')
    } catch {
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [targetType, targetId])

  useEffect(() => { load() }, [load])

  async function act(action: 'approve' | 'reject') {
    if (!detail) return
    if (action === 'reject' && !comment.trim()) { toast('驳回时请填写意见', 'warning'); return }
    setActing(true)
    try {
      const res = await fetch(`/api/v1/approvals/${detail.id}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      })
      if (!res.ok) { const e = await res.json(); toast(e.detail || '操作失败', 'error'); return }
      setDetail(await res.json())
      setComment('')
      toast(action === 'approve' ? '已审批通过' : '已驳回', action === 'approve' ? 'success' : 'warning')
      onChanged?.()
    } catch { toast('操作失败', 'error') } finally { setActing(false) }
  }

  async function cancel() {
    if (!detail) return
    if (!confirm('确认撤回该审批？')) return
    setActing(true)
    try {
      const res = await fetch(`/api/v1/approvals/${detail.id}/cancel`, { method: 'POST' })
      if (!res.ok) { const e = await res.json(); toast(e.detail || '撤回失败', 'error'); return }
      setDetail(await res.json())
      toast('审批已撤回', 'success')
      onChanged?.()
    } catch { toast('撤回失败', 'error') } finally { setActing(false) }
  }

  if (loading) return (
    <div className="flex items-center gap-2 py-3 text-xs text-gray-500">
      <Loader2 size={12} className="animate-spin" /> 加载审批进度…
    </div>
  )
  if (!detail) return null

  const instStatus = detail.status
  const instColor = instStatus === 'approved' ? 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
    : instStatus === 'rejected' ? 'text-red-600 dark:text-red-400 border-red-500/40 bg-red-500/10'
    : instStatus === 'cancelled' ? 'text-gray-600 dark:text-gray-400 border-gray-500/40 bg-gray-500/10'
    : 'text-amber-700 dark:text-amber-400 border-amber-500/40 bg-amber-500/10'
  const instLabel = { pending: '审批中', approved: '已通过', rejected: '已驳回', cancelled: '已撤回' }[instStatus] || instStatus

  const isPending = instStatus === 'pending'

  return (
    <div className="mt-3 rounded-xl border border-border bg-bg-primary/50 overflow-hidden">
      {/* 头部 — 审批结束时作为整体折叠开关 */}
      <div
        className={`flex items-center justify-between px-3.5 py-2.5 ${isPending ? 'border-b border-border/50' : 'cursor-pointer hover:bg-bg-hover/20 transition-colors'} ${showDetail && !isPending ? 'border-b border-border/50' : ''}`}
        onClick={isPending ? undefined : () => setShowDetail(v => !v)}
      >
        <div className="flex items-center gap-2">
          <UserCheck size={13} className="text-gray-500" />
          <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">审批进度</span>
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${instColor}`}>{instLabel}</span>
          {!isPending && !showDetail && detail.finished_at && (
            <span className="text-[11px] text-gray-500">· {fmtTime(detail.finished_at)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">
            {detail.submitted_by_name} 于 {fmtTime(detail.submitted_at)} 提交
          </span>
          {!isPending && (showDetail ? <ChevronUp size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />)}
        </div>
      </div>

      {/* 展开内容：节点 + 操作 + 记录 */}
      {showDetail && (
        <>
          {/* 节点时间线 */}
          <div className="px-3.5 py-3">
            <div className="relative">
              {detail.nodes.length > 1 && (
                <div className="absolute left-[7px] top-5 bottom-1 w-px bg-border/60" />
              )}
              <div className="space-y-3">
                {detail.nodes.map((node, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <div className="relative z-10 mt-0.5">
                      <NodeIcon status={node.status} isCurrent={node.is_current} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${
                          node.is_current ? 'text-amber-700 dark:text-amber-300' :
                          node.status === 'approved' || node.status === 'skipped' ? 'text-emerald-700 dark:text-emerald-300' :
                          node.status === 'rejected' ? 'text-red-600 dark:text-red-300' : 'text-gray-500'
                        }`}>
                          {node.name}
                        </span>
                        {node.is_current && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-bold">
                            待审
                          </span>
                        )}
                        {(node.status === 'approved' || node.status === 'skipped' || node.status === 'rejected') && node.decided_at && (
                          <span className="text-[11px] text-gray-500">{fmtTime(node.decided_at)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-gray-500">
                          审批人：{node.approver_names.join('、') || '—'}
                        </span>
                        {node.decided_by_name && (
                          <span className="text-[11px] text-gray-500">
                            · 由 <span className="text-gray-700 dark:text-gray-300">{node.decided_by_name}</span> 操作
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {detail.finished_at && (
              <div className="mt-2.5 text-[11px] text-gray-500 pl-[22px]">
                {instStatus === 'approved' ? '✓ 审批完成于 ' : instStatus === 'rejected' ? '✕ 驳回于 ' : ''}
                {fmtTime(detail.finished_at)}
              </div>
            )}
          </div>

          {/* 审批人操作区 */}
          {detail.can_act && isPending && (() => {
            const curNode = detail.nodes.find(n => n.is_current)
            const isExec = curNode?.node_kind === 'execution'
            const approveLabel = isExec ? (curNode?.action_label || '确认完成') : '通过'
            const rejectLabel = isExec ? '退回' : '驳回'
            return (
              <div className="border-t border-border/50 px-3.5 py-3 bg-amber-500/3">
                <p className={`text-[11px] mb-2 font-semibold ${isExec ? 'text-blue-600 dark:text-blue-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {isExec ? `执行节点：请线下完成「${curNode?.name}」后确认` : '轮到你审批了'}
                </p>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={isExec ? '备注（退回时必填）' : '审批意见（驳回时必填）'}
                  rows={2}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-bg-input border border-border/60 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-accent-blue/50 resize-none"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => act('approve')}
                    disabled={acting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold disabled:opacity-50 transition-colors ${
                      isExec
                        ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/25'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                    }`}
                  >
                    {acting ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                    {approveLabel}
                  </button>
                  <button
                    onClick={() => act('reject')}
                    disabled={acting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-[11px] font-bold hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                  >
                    {acting ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
                    {rejectLabel}
                  </button>
                </div>
              </div>
            )
          })()}

          {/* 撤回按钮（发起人） */}
          {detail.can_cancel && isPending && (
            <div className="border-t border-border/50 px-3.5 py-2 flex justify-end">
              <button
                onClick={cancel}
                disabled={acting}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-orange-300 hover:bg-orange-500/10 border border-border transition-colors"
              >
                <RotateCcw size={10} />撤回审批
              </button>
            </div>
          )}

          {/* 审批记录 */}
          {detail.records.length > 0 && (
            <div className="border-t border-border/50 px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-1">
                <Send size={10} />审批记录
              </div>
              {detail.records.map((r, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="w-1 h-1 rounded-full bg-gray-600 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-gray-700 dark:text-gray-300 font-medium">{r.approver_name}</span>
                      <span className={`text-[11px] font-semibold ${ACTION_COLOR[r.action] || 'text-gray-400'}`}>
                        {ACTION_LABEL[r.action] || r.action}
                      </span>
                      <span className="text-[11px] text-gray-500">{fmtTime(r.created_at)}</span>
                    </div>
                    {r.comment && (
                      <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">「{r.comment}」</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
