import React, { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

const fmtFold = (d: number | null) =>
  d == null ? '—' : `${parseFloat((d * 10).toFixed(1))}折`

interface ValueAddedService { title: string; description: string; fee: string }

const DEFAULT_VAS: ValueAddedService[] = [
  { title: '财务支持', description: '根据提供账号进行财务对账支持', fee: '包含在基础费率中' },
  { title: '技术支持 (SLA)', description: '7×24小时专属技术对接群，响应时间 < 2小时', fee: '包含在基础费率中' },
]
const DEFAULT_SLA_TERMS = `1、数据安全权益：平台承诺客户上传的 Prompt 及生成结果仅用于实时调用，不用于模型训练，不向第三方共享。
2、可用性承诺：平台保证服务可用性不低于 99.9%（月度统计，不含计划维护窗口）。
3、并发保障：标准账号默认 QPS 为官方数值，如需更高并发可提前协商单独配置。`
const DEFAULT_DISCLAIMER = `1、生成内容合规性：由于大模型的生成具有随机性，平台不保证输出结果的绝对准确性，客户需自行对生成内容进行审核与合规性把关。
2、不可抗力：因算力中心电力故障、网络运营商故障、自然灾害等不可抗力导致的业务中断，双方互不承担违约责任，但平台需在事后及时告知并提供影响评估。
3、API 密钥安全：客户需妥善保管分配的 API_KEY，因密钥泄漏导致的账号盗用及费用损失，由客户自行承担。`
const DEFAULT_PAYMENT_TERMS = `1、结算方式：预充值/按月后付费（以本报价单约定为准）。
2、逾期处理：账户余额不足时，平台将提供 24 小时宽限期，逾期未补齐将自动停机，恢复服务需重新充值激活。`

export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const autoPrint = searchParams.get('print') === '1'

  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/api/v1/quotes/public/${token}`)
      .then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(e.detail || '链接已失效'))
        return r.json()
      })
      .then(d => {
        setData(d)
        if (autoPrint) setTimeout(() => window.print(), 800)
      })
      .catch(e => setError(typeof e === 'string' ? e : '报价单加载失败'))
  }, [token, autoPrint])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center text-gray-500 space-y-2">
        <div className="text-4xl">😕</div>
        <div className="font-semibold text-gray-700">{error}</div>
        <div className="text-sm">链接可能已过期或报价单已被删除</div>
      </div>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-400 text-sm">加载中…</div>
    </div>
  )

  const items: Record<string, unknown>[] = JSON.parse(data.items_json as string || '[]')
  const customerName = (data.customer_name as string) || ''
  const contactName = (data.contact_name as string) || ''
  const appScenario = (data.app_scenario as string) || ''
  const specialRequirements = (data.special_requirements as string) || ''
  const quoteNumber = (data.quote_number as string) || ''
  const validDays = data.valid_days as number
  const notes = (data.notes as string) || ''
  const date = new Date(data.created_at as string).toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-')

  // Provider grouping
  const providerGroups: { provider: string; items: Record<string, unknown>[] }[] = []
  const seenProviders = new Map<string, number>()
  for (const item of items) {
    const p = (item.model_provider as string) || '其他'
    if (!seenProviders.has(p)) {
      seenProviders.set(p, providerGroups.length)
      providerGroups.push({ provider: p, items: [] })
    }
    providerGroups[seenProviders.get(p)!].items.push(item)
  }

  // Clause config
  const vas: ValueAddedService[] = (() => {
    const raw = data.value_added_services as string
    if (!raw) return DEFAULT_VAS
    try { return JSON.parse(raw) } catch { return DEFAULT_VAS }
  })()
  const slaText = (data.sla_terms as string) || DEFAULT_SLA_TERMS
  const disclaimerTxt = (data.disclaimer as string) || DEFAULT_DISCLAIMER
  const paymentTxt = (data.payment_terms as string) || DEFAULT_PAYMENT_TERMS

  const validUntil = validDays ? (() => {
    const d = new Date(data.created_at as string)
    d.setDate(d.getDate() + validDays)
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
  })() : null

  const tdLabel: React.CSSProperties = { background: '#f8fafc', padding: '6px 12px', fontWeight: 600, color: '#374151', border: '1px solid #e2e8f0', fontSize: '11px', whiteSpace: 'nowrap' }
  const tdVal: React.CSSProperties = { padding: '6px 12px', border: '1px solid #e2e8f0', fontSize: '11px', color: '#1e293b' }

  const SectionHead = ({ num, text }: { num: string; text: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '20px 0 8px', borderBottom: '1px solid #cbd5e1', paddingBottom: '5px' }}>
      <div style={{ width: '3px', height: '14px', backgroundColor: '#3b82f6', borderRadius: '2px', flexShrink: 0 }} />
      <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>{num}、{text}</span>
    </div>
  )

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; background: white; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 10mm 15mm; }
        }
      `}</style>

      <div className="no-print bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <span className="text-sm text-gray-500 flex-1">
          正在查看报价单 — {customerName ? `报价对象：${customerName}` : (data.title as string) || ''}
        </span>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >打印 / 导出 PDF</button>
      </div>

      <div className="bg-white min-h-screen p-10 font-sans text-sm leading-relaxed text-gray-900 max-w-[210mm] mx-auto">
        {/* 标题行 */}
        <div style={{ textAlign: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '3px', color: '#111827' }}>AI MaaS 平台服务报价单</div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#6b7280', display: 'flex', justifyContent: 'center', gap: '28px', flexWrap: 'wrap' }}>
            {quoteNumber && <span>编号：<span style={{ color: '#1e293b', fontWeight: 600 }}>{quoteNumber}</span></span>}
            <span>报价日期：<span style={{ color: '#1e293b', fontWeight: 600 }}>{date}</span></span>
            {validUntil && <span>有效期至：<span style={{ color: '#1e293b', fontWeight: 600 }}>{validUntil}</span></span>}
          </div>
        </div>

        {/* 一、客户与项目信息 */}
        <SectionHead num="一" text="客户与项目信息" />
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <tbody>
            <tr>
              <td style={{ ...tdLabel, width: '12%' }}>客户名称</td>
              <td style={{ ...tdVal, width: '30%' }}>{customerName || '—'}</td>
              <td style={{ ...tdLabel, width: '12%' }}>联系人</td>
              <td style={tdVal}>{contactName || '—'}</td>
            </tr>
            <tr>
              <td style={tdLabel}>应用场景</td>
              <td colSpan={3} style={tdVal}>{appScenario || '—'}</td>
            </tr>
            {specialRequirements && (
              <tr>
                <td style={tdLabel}>特殊要求</td>
                <td colSpan={3} style={tdVal}>{specialRequirements}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 二、产品方案与 API 计费标准 */}
        <SectionHead num="二" text="产品方案与 API 计费标准" />
        {items.length > 0 ? (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
                  <th style={{ textAlign: 'center', padding: '7px 12px', fontWeight: 600, width: '14%' }}>模型系列</th>
                  <th style={{ textAlign: 'left', padding: '7px 12px', fontWeight: 600, width: '46%' }}>通道及模型版本</th>
                  <th style={{ textAlign: 'center', padding: '7px 12px', fontWeight: 600, width: '14%' }}>商务折扣</th>
                  <th style={{ textAlign: 'left', padding: '7px 12px', fontWeight: 600 }}>备注</th>
                </tr>
              </thead>
              <tbody>
                {providerGroups.flatMap(group =>
                  group.items.map((item, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                      {idx === 0 && (
                        <td rowSpan={group.items.length} style={{ padding: '7px 12px', border: '1px solid #e2e8f0', backgroundColor: '#f1f5f9', fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', color: '#334155' }}>
                          {group.provider}
                        </td>
                      )}
                      <td style={{ padding: '7px 12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontWeight: 500, color: '#1e293b' }}>
                          {item.channel_name
                            ? `${item.channel_name}（${item.model_name}）`
                            : item.model_name as string}
                        </div>
                        {item.model_version_id && item.model_version_id !== item.model_name && (
                          <div style={{ color: '#9ca3af', fontSize: '10px' }}>{item.model_version_id as string}</div>
                        )}
                      </td>
                      <td style={{ padding: '7px 12px', border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 700, fontSize: '13px', color: '#1d4ed8' }}>
                        {fmtFold(item.discount as number | null)}
                      </td>
                      <td style={{ padding: '7px 12px', border: '1px solid #e2e8f0', fontSize: '11px', color: '#6b7280' }}>
                        {(item.custom_note as string) || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '5px' }}>
              备注：各模型基准价格参考官网
            </div>
          </>
        ) : (
          <div style={{ border: '2px dashed #e5e7eb', borderRadius: '8px', padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '12px', margin: '8px 0' }}>
            暂无报价内容
          </div>
        )}

        {/* 三、增值服务与技术支持 */}
        {vas.length > 0 && (
          <>
            <SectionHead num="三" text="增值服务与技术支持" />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: '#374151', width: '20%', border: '1px solid #e2e8f0' }}>项目</th>
                  <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: '#374151', border: '1px solid #e2e8f0' }}>服务内容说明</th>
                  <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600, color: '#374151', width: '26%', border: '1px solid #e2e8f0' }}>费用</th>
                </tr>
              </thead>
              <tbody>
                {vas.map((s, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                    <td style={{ padding: '6px 12px', border: '1px solid #e2e8f0', fontWeight: 600, color: '#1e293b' }}>{s.title}</td>
                    <td style={{ padding: '6px 12px', border: '1px solid #e2e8f0', color: '#374151' }}>{s.description}</td>
                    <td style={{ padding: '6px 12px', border: '1px solid #e2e8f0', color: '#047857' }}>{s.fee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* 四、双方权益与服务等级协议 */}
        {slaText.trim() && (
          <>
            <SectionHead num="四" text="双方权益与服务等级协议 (SLA)" />
            <p style={{ fontSize: '11px', color: '#374151', lineHeight: '1.9', whiteSpace: 'pre-line', margin: 0 }}>{slaText}</p>
          </>
        )}

        {/* 五、免责声明与风险提示 */}
        {disclaimerTxt.trim() && (
          <>
            <SectionHead num="五" text="免责声明与风险提示" />
            <p style={{ fontSize: '11px', color: '#374151', lineHeight: '1.9', whiteSpace: 'pre-line', margin: 0 }}>{disclaimerTxt}</p>
          </>
        )}

        {/* 六、付款条款 */}
        {paymentTxt.trim() && (
          <>
            <SectionHead num="六" text="付款条款" />
            <p style={{ fontSize: '11px', color: '#374151', lineHeight: '1.9', whiteSpace: 'pre-line', margin: 0 }}>{paymentTxt}</p>
          </>
        )}

        {/* 备注 */}
        {notes && (
          <div style={{ marginTop: '16px', padding: '10px 12px', background: '#f9fafb', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>备注</div>
            <p style={{ fontSize: '11px', color: '#374151', whiteSpace: 'pre-line', margin: 0 }}>{notes}</p>
          </div>
        )}

        {/* 页脚 */}
        <div style={{ marginTop: '24px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '10px', color: '#9ca3af', textAlign: 'center' }}>
          以上报价内容经双方确认后方可生效，最终以签署合同为准。
        </div>
      </div>
    </>
  )
}
