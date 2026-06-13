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
  contract_period?: string[]
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
    product: [], project_scenario: [], sales_person: [], project_status: [], cloud: [], contract_period: ['月度', '季度', '半年', '1年', '2年', '3年', '自定义']
  })
  const [meetings, setMeetings] = useState<MeetingOption[]>([])
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [custRes, optRes, meetingRes] = await Promise.all([
        fetchWithAuth('/api/v1/customers?scope=all').catch(() => null),
        fetchWithAuth('/api/v1/settings/field-options').catch(() => null),
        fetchWithAuth('/api/v1/meetings?simple=1').catch(() => null),
      ])
      if (custRes && custRes.ok) {
        const data = await custRes.json()
        setCustomers(Array.isArray(data) ? data.map((c: any) => ({
          id: c.id, name: c.name, industry: c.industry
        })) : [])
      }
      if (optRes && optRes.ok) {
        const data = await optRes.json()
        setOptions({
          product: data.product || [],
          project_scenario: data.project_scenario || [],
          sales_person: data.sales_person || [],
          project_status: data.project_status || [],
          cloud: data.cloud || [],
          contract_period: data.contract_period || ['月度', '季度', '半年', '1年', '2年', '3年', '自定义'],
        })
      }
      if (meetingRes && meetingRes.ok) {
        const data = await meetingRes.json()
        const items = Array.isArray(data) ? data : (data.items || [])
        setMeetings(items.map((m: any) => ({ id: m.id, title: m.title || m.name || '未命名会议', date: m.created_at || m.date })))
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }, [fetchWithAuth])

  useEffect(() => { loadAll() }, [loadAll])

  return { customers, options, meetings, loading, reload: loadAll }
}
