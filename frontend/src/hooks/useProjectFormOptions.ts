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
  sales_person: string[]
  project_status: string[]
  cloud: string[]
  tech_support?: string[]
  contract_period?: string[]
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

export function useProjectFormOptions() {
  const { fetchWithAuth } = useAuth()
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [options, setOptions] = useState<FieldOptions>({
    product: [], project_scenario: [], sales_person: [], project_status: [],
    cloud: ['AWS', '阿里云', '腾讯云', '华为云', 'Azure', 'GCP', '自建机房', '混合云'],
    tech_support: [],
    contract_period: ['月度', '季度', '半年', '1年', '2年', '3年', '自定义'],
  })
  const [channels, setChannels] = useState<ChannelOption[]>([])
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogOption[]>([])
  const [modelCatalogRefreshedAt, setModelCatalogRefreshedAt] = useState<string | null>(null)
  const [meetings, setMeetings] = useState<MeetingOption[]>([])
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [custRes, optRes, meetingRes, chanRes, supRes, modelRes, modelStatusRes] = await Promise.all([
        fetchWithAuth('/api/v1/customers/selector').catch(() => null),
        fetchWithAuth('/api/v1/settings/field-options').catch(() => null),
        fetchWithAuth('/api/v1/meetings?simple=1').catch(() => null),
        fetchWithAuth('/api/v1/channels?status=合作中').catch(() => null),
        fetchWithAuth('/api/v1/suppliers').catch(() => null),
        fetchWithAuth('/api/v1/models').catch(() => null),
        fetchWithAuth('/api/v1/models/refresh/status').catch(() => null),
      ])
      if (custRes && custRes.ok) {
        const data = await custRes.json()
        setCustomers(Array.isArray(data) ? data.map((c: any) => ({
          id: c.id, name: c.name, industry: c.industry
        })) : [])
      }
      if (optRes && optRes.ok) {
        const data = await optRes.json()
        setOptions(prev => ({
          product: data.product || [],
          project_scenario: data.project_scenario || [],
          sales_person: data.sales_person || [],
          tech_support: data.tech_support || data.sales_person || [],
          project_status: data.project_status || [],
          // 云厂商/部署方式：API 给了就用，没给就保底（避免空数组导致下拉完全没预设）
          cloud: (Array.isArray(data.cloud) && data.cloud.length > 0) ? data.cloud : prev.cloud,
          contract_period: data.contract_period || prev.contract_period,
        }))
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
    loading,
    reload: loadAll,
  }
}

