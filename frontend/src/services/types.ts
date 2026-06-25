// 用户管理模块共享类型定义

// === User ===
export interface UserData {
  id: number
  username: string
  name: string
  email: string | null
  is_admin: boolean
  is_active: boolean
  status: string  // 'active' | 'disabled' | 'resigned'
  use_shared_models: boolean
  can_manage_models: boolean
  failed_login_attempts: number
  locked_until: string | null
  last_login_at: string | null
  created_at: string | null
  leader_id: number | null
  department_id: number | null
  department_name: string | null
  job_title?: string | null
  first_work_date?: string | null
  hire_date?: string | null
  roles?: { id: number; name: string; code: string }[]
}

export interface SimpleUser {
  id: number
  username: string
  name: string
  department_id: number | null
}

export interface UserCreatePayload {
  username: string
  password?: string  // 留空则后端自动生成初始密码
  name: string
  email: string
  is_admin: boolean
  use_shared_models: boolean
  can_manage_models: boolean
  leader_id: number | null
  department_id: number | null
  job_title?: string | null
  first_work_date?: string | null
  hire_date?: string | null
}

export interface UserUpdatePayload {
  username?: string
  name?: string
  email?: string | null
  is_admin?: boolean
  use_shared_models?: boolean
  can_manage_models?: boolean
  leader_id?: number | null
  department_id?: number | null
  job_title?: string | null
  first_work_date?: string | null
  hire_date?: string | null
}

export interface UserListParams {
  page?: number
  page_size?: number
  search?: string
  department_id?: number | null
  role_id?: number | null
  status?: 'all' | 'active' | 'inactive' | 'disabled' | 'resigned' | 'locked'
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// === Role ===
export interface RoleData {
  id: number
  name: string
  code: string
  description: string
  is_system: boolean
  user_id: number | null
  permission_codes: string[]
  created_at: string | null
}

export interface RoleCreatePayload {
  name: string
  code: string
  description: string
  permission_codes: string[]
}

export interface RoleUpdatePayload {
  name?: string
  code?: string
  description?: string
  permission_codes?: string[]
}

// === Permission ===
export interface PermissionData {
  id: number
  code: string
  name: string
  module: string
  action: string
}

// === Department ===
export interface DepartmentFlat {
  id: number
  name: string
  manager_id: number | null
  parent_id: number | null
}

export interface DepartmentTreeNode {
  id: number
  name: string
  manager_id: number | null
  manager_name: string | null
  parent_id: number | null
  user_count: number
  children: DepartmentTreeNode[]
}

export interface DepartmentCreatePayload {
  name: string
  manager_id?: number | null
  parent_id?: number | null
}

export interface DepartmentUpdatePayload {
  name?: string
  manager_id?: number | null
  parent_id?: number | null
}

// === Report Chain ===
export interface ReportChainMember {
  id: number
  name: string
  job_title: string | null
}

export interface ReportChainResponse {
  chain: ReportChainMember[]
}

// === FetchWithAuth type ===
export type FetchWithAuth = (url: string, options?: RequestInit) => Promise<Response>

// === Module Labels ===
export const MODULE_LABELS: Record<string, string> = {
  user: '用户管理',
  project: '项目管理',
  customer: '客户管理',
  contract: '合同管理',
  upstream: '上游管理',
  reconcile: '财务对账',
  report: '日报周报',
  meeting: '会议纪要',
  ai: 'AI模型',
  wiki: 'AI文档',
  settings: '系统设置',
  model: '模型变更',
  dashboard: '数据看板',
  task: '定时任务',
  log: '运行日志',
  monitor: '运维监控',
  data: '数据管理',
  management: '管理总览',
  share: '数据分享',
  feedback: '意见反馈',
  payment: '付款申请',
  seal: '盖章申请',
}

export const PERM_GROUPS = [
  'user', 'project', 'customer', 'contract', 'upstream', 'reconcile',
  'report', 'meeting', 'ai', 'wiki', 'settings', 'model',
  'dashboard', 'task', 'log', 'monitor', 'data',
  'management', 'share', 'feedback', 'payment', 'seal',
] as const
