import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

export interface CustomerOption {
  id: number
  name: string
  industry?: string
}

export interface FieldOptions {
  product: string[]
  project_scenario: string[]
  project_status: string[]
  cloud: string[]
}

export interface ContractOption {
  id: number
  title: string
  customer_name?: string
  sign_date?: string
  project_id?: number | null
}

/** 通道选项（来自通道管理） */
export interface ChannelOption {
  id: number
  name: string
  code: string
  model_type: string
  supplier_id: number
  supplier_name: string
  status: string
  kind: string
}

/** 模型目录选项（来自模型管理 - Tavily 采集+人工审校） */
export interface ModelCatalogOption {
  id: number
  name: string
  version_id: string | null
  provider: string | null
  region: string
  modality: string | null
}

export interface MeetingOption {
  id: number
  title: string
  date?: string
}

export const CURRENCY_OPTIONS = [
  { code: 'CNY', symbol: '¥', name: '人民币', unit: '万元', fullUnit: '元' },
  { code: 'USD', symbol: '$', name: '美元', unit: '万美元', fullUnit: '美元' },
  { code: 'HKD', symbol: 'HK$', name: '港币', unit: '万港币', fullUnit: '港币' },
  { code: 'EUR', symbol: '€', name: '欧元', unit: '万欧元', fullUnit: '欧元' },
  { code: 'JPY', symbol: '¥', name: '日元', unit: '万日元', fullUnit: '日元' },
] as const

export function getCurrencyMeta(code: string) {
  return CURRENCY_OPTIONS.find(c => c.code === code) || CURRENCY_OPTIONS[0]
}

const DEFAULT_AI_SCENARIOS = [
  '智能客服 / 客服机器人',
  '知识库问答（RAG）',
  '文档处理与分析',
  '代码辅助 / Copilot',
  '内容生成与创作',
  '数据分析与报告',
  '企业搜索增强',
  '工作流自动化',
  'AI Agent / 任务规划',
  '多模态理解（图文/语音）',
  '垂直行业大模型定制',
  '模型评测与对比',
]

const DEFAULT_TECH_CAPABILITIES = [
  '自建 AI 网关',
  '具备访问海外模型的网络能力',
  '聚合平台对外服务',
  '私有化部署（K8s/Docker）',
  '公有云（已有账户）',
  '裸金属 / GPU 服务器',
  '自建向量数据库 / 知识库',
  'API 网关已有',
  '混合云架构',
  '无技术团队（纯 API 接入）',
]

export function useProjectFormOptions() {
  const { fetchWithAuth } = useAuth()
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [options, setOptions] = useState<FieldOptions>({
    product: [],
    project_scenario: DEFAULT_AI_SCENARIOS,
    project_status: [],
    cloud: DEFAULT_TECH_CAPABILITIES,
  })
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogOption[]>([])
  const [modelCatalogRefreshedAt, setModelCatalogRefreshedAt] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<MeetingOption[]>([])
  const [contracts, setContracts] = useState<ContractOption[]>([])
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [custRes, optRes, meetingRes, chanRes, supRes, modelRes, modelStatusRes, contractRes] = await Promise.all([
        fetchWithAuth('/api/v1/customers/selector').catch(() => null),
        fetchWithAuth('/api/v1/settings/field-options').catch(() => null),
        fetchWithAuth('/api/v1/meetings?simple=1').catch(() => null),
        fetchWithAuth('/api/v1/channels?status=合作中').catch(() => null),
        fetchWithAuth('/api/v1/suppliers').catch(() => null),
        fetchWithAuth('/api/v1/models').catch(() => null),
        fetchWithAuth('/api/v1/models/refresh/status').catch(() => null),
        fetchWithAuth('/api/v1/contracts').catch(() => null),
      ])
      if (custRes && custRes.ok) {
        const data = await custRes.json()
        setCustomers(Array.isArray(data) ? data.map((c: any) => ({
          id: c.id, name: c.name, industry: c.industry
        })) : [])
      }
      if (optRes && optRes.ok) {
        const data = await optRes.json()
        // 后端返回扁平数组 [{id, category, value, sort_order}, ...]，按 category 归组
        const flat: Array<{ category: string; value: string; sort_order: number }> = Array.isArray(data) ? data : []
        const grouped: Record<string, string[]> = {}
        for (const item of flat) {
          if (!grouped[item.category]) grouped[item.category] = []
          grouped[item.category].push(item.value)
        }
        setOptions(prev => ({
          product: grouped.product || [],
          project_scenario: (grouped.project_scenario && grouped.project_scenario.length > 0) ? grouped.project_scenario : DEFAULT_AI_SCENARIOS,
          project_status: grouped.project_status || [],
          cloud: (grouped.cloud && grouped.cloud.length > 0) ? grouped.cloud : DEFAULT_TECH_CAPABILITIES,
        }))
      }
      if (contractRes && contractRes.ok) {
        const data = await contractRes.json()
        const items = Array.isArray(data) ? data : (data.items || [])
        setContracts(items.map((c: any) => ({
          id: c.id,
          title: c.title || c.name || `合同 #${c.id}`,
          customer_name: c.customer_name || '',
          sign_date: c.sign_date || '',
          project_id: c.project_id ?? null,
        })))
      }
      // 通道 + 供应商：组合出"通道 · 供应商 · 模型"的友好显示
      if (chanRes && chanRes.ok) {
        const chanData = await chanRes.json()
        const supData = supRes && supRes.ok ? await supRes.json() : []
        const supMap = new Map((Array.isArray(supData) ? supData : []).map((s: any) => [s.id, s.name]))
        setChannels((Array.isArray(chanData) ? chanData : []).map((c: any) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          model_type: c.model_type,
          supplier_id: c.supplier_id,
          supplier_name: (supMap.get(c.supplier_id) as string) || '未知供应商',
          status: c.status,
          kind: c.kind,
        })))
      } else {
        setChannels([])
      }
      if (meetingRes && meetingRes.ok) {
        const data = await meetingRes.json()
        const items = Array.isArray(data) ? data : (data.items || [])
        setMeetings(items.map((m: any) => ({ id: m.id, title: m.title || m.name || '未命名会议', date: m.created_at || m.date })))
      }
      // 模型目录（来自 /api/v1/models - Tavily 采集+人工审校）
      if (modelRes && modelRes.ok) {
        const data = await modelRes.json()
        setModelCatalog(Array.isArray(data) ? data : [])
      }
      if (modelStatusRes && modelStatusRes.ok) {
        try {
          const s = await modelStatusRes.json()
          setModelCatalogRefreshedAt(s?.last_refresh_at || null)
        } catch {}
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  useEffect(() => { loadAll() }, [loadAll])

  return {
    customers,
    options,
    channels,
    modelCatalog,
    modelCatalogRefreshedAt,
    meetings,
    contracts,
    loading,
    reload: loadAll,
  }
}

