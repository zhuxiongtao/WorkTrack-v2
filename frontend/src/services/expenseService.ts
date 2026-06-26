// 报销 V2 相关服务
import { apiFetch, apiPost, apiPut, apiDelete } from './api'

export type ExpenseItem = {
  id?: number
  name: string
  expense_type: string
  department_id?: number | null
  city?: string
  expense_date?: string | null  // YYYY-MM-DD
  amount: number
  note?: string
  remark?: string
  attachments?: string | null
  sort_order?: number
  department_name?: string
  created_at?: string
  updated_at?: string
}

export type ExpenseRelation = {
  id?: number
  target_type: 'business_trip' | 'leave' | 'purchase'
  target_id: number
  relation_note?: string
  target_title?: string
  target_meta?: Record<string, any>
  created_at?: string
}

export type LegalEntity = {
  id: number
  name: string
  short_name: string
  tax_id?: string | null
  balance: number
  is_default: boolean
  is_active: boolean
  sort_order: number
}

export type EmployeeLoan = {
  id: number
  user_id: number
  user_name?: string
  entity_id: number
  entity_name?: string
  amount: number
  used_amount: number
  remaining: number
  loan_date: string
  reason: string
  status: string
}

export type Expense = {
  id: number
  user_id: number
  user_name?: string
  title: string
  expense_type: string
  amount: number
  amount_unit: string
  currency: string
  expense_date: string
  reason: string
  attachments?: string | null
  status: string
  paid_at?: string | null
  paid_by?: number | null
  // V2
  invoice_entity_id?: number | null
  invoice_entity_name?: string | null
  priority_offset_loan: boolean
  offset_loan_amount: number
  account_balance: number
  company_should_pay: number
  actual_pay_amount: number
  company_owes_personal: number
  items: ExpenseItem[]
  relations: ExpenseRelation[]
  created_at: string
  updated_at: string
}

export type RelationCandidate = {
  id: number
  title: string
  [k: string]: any
}

export type InvoiceCompanyInfo = {
  name: string
  short_name: string
  tax_id: string
  source: 'legal_entity' | 'preference'
}

export const expenseService = {
  // 公司基础信息（系统偏好 / 默认开票公司）
  getInvoiceCompany: () => apiFetch<InvoiceCompanyInfo>('/api/v1/settings/invoice-company'),
  updateInvoiceCompany: (payload: { name: string; short_name?: string; tax_id?: string }) =>
    apiPut<{ name: string; short_name: string; tax_id: string; message: string }>(
      '/api/v1/settings/invoice-company',
      payload
    ),

  // 公司主体
  listLegalEntities: (includeInactive = false) =>
    apiFetch<LegalEntity[]>(`/api/v1/legal-entities?include_inactive=${includeInactive}`),
  createLegalEntity: (body: Partial<LegalEntity>) =>
    apiPost<LegalEntity>(`/api/v1/legal-entities`, body),
  updateLegalEntity: (id: number, body: Partial<LegalEntity>) =>
    apiPut<LegalEntity>(`/api/v1/legal-entities/${id}`, body),
  deleteLegalEntity: (id: number) => apiDelete(`/api/v1/legal-entities/${id}`),

  // 员工借款
  listMyActiveLoans: (entityId?: number) => {
    const q = entityId ? `?entity_id=${entityId}` : ''
    return apiFetch<EmployeeLoan[]>(`/api/v1/employee-loans/my-active${q}`)
  },
  listAllLoans: (userId?: number, onlyActive = false) => {
    const params = new URLSearchParams()
    if (userId) params.set('user_id', String(userId))
    if (onlyActive) params.set('only_active', 'true')
    return apiFetch<EmployeeLoan[]>(`/api/v1/employee-loans?${params}`)
  },
  createLoan: (body: {
    user_id: number
    entity_id: number
    amount: number
    loan_date: string
    reason?: string
  }) => apiPost<EmployeeLoan>(`/api/v1/employee-loans`, body),
  updateLoan: (id: number, body: Partial<EmployeeLoan>) =>
    apiPut<EmployeeLoan>(`/api/v1/employee-loans/${id}`, body),
  deleteLoan: (id: number) => apiDelete(`/api/v1/employee-loans/${id}`),

  // 报销
  list: (params: { scope?: 'mine' | 'all'; status?: string; expense_type?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.scope) q.set('scope', params.scope)
    if (params.status) q.set('status', params.status)
    if (params.expense_type) q.set('expense_type', params.expense_type)
    return apiFetch<Expense[]>(`/api/v1/expenses?${q}`)
  },
  get: (id: number) => apiFetch<Expense>(`/api/v1/expenses/${id}`),
  create: (body: Partial<Expense>) => apiPost<Expense>(`/api/v1/expenses`, body),
  update: (id: number, body: Partial<Expense>) =>
    apiPut<Expense>(`/api/v1/expenses/${id}`, body),
  remove: (id: number) => apiDelete(`/api/v1/expenses/${id}`),
  submit: (id: number) => apiPost<Expense>(`/api/v1/expenses/${id}/submit`, {}),

  // 关联候选
  listRelationCandidates: (targetType: string) =>
    apiFetch<RelationCandidate[]>(`/api/v1/expenses/relations/candidates?target_type=${targetType}`),
}
