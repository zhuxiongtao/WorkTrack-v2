import type {
  FetchWithAuth,
  DepartmentFlat,
  DepartmentTreeNode,
  DepartmentCreatePayload,
  DepartmentUpdatePayload,
  ReportChainResponse,
} from './types'
import type { RoleData } from './types'

export async function fetchDepartmentTree(fetchWithAuth: FetchWithAuth): Promise<DepartmentTreeNode[]> {
  const res = await fetchWithAuth('/api/v1/users/departments/tree')
  if (!res.ok) throw new Error('获取部门树失败')
  return res.json()
}

export async function fetchDepartmentsFlat(fetchWithAuth: FetchWithAuth): Promise<DepartmentFlat[]> {
  const res = await fetchWithAuth('/api/v1/users/departments')
  if (!res.ok) throw new Error('获取部门列表失败')
  return res.json()
}

export async function createDepartment(
  fetchWithAuth: FetchWithAuth,
  data: DepartmentCreatePayload,
): Promise<DepartmentFlat> {
  const res = await fetchWithAuth('/api/v1/users/departments', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '创建失败' }))
    throw new Error(err.detail || '创建部门失败')
  }
  return res.json()
}

export async function updateDepartment(
  fetchWithAuth: FetchWithAuth,
  id: number,
  data: DepartmentUpdatePayload,
): Promise<DepartmentFlat> {
  const res = await fetchWithAuth(`/api/v1/users/departments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '编辑失败' }))
    throw new Error(err.detail || '编辑部门失败')
  }
  return res.json()
}

export async function deleteDepartment(
  fetchWithAuth: FetchWithAuth,
  id: number,
): Promise<void> {
  const res = await fetchWithAuth(`/api/v1/users/departments/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '删除失败' }))
    throw new Error(err.detail || '删除部门失败')
  }
}

export async function moveDepartment(
  fetchWithAuth: FetchWithAuth,
  deptId: number,
  newParentId: number | null,
): Promise<DepartmentFlat> {
  const res = await fetchWithAuth(`/api/v1/users/departments/${deptId}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ parent_id: newParentId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '移动失败' }))
    throw new Error(err.detail || '移动部门失败')
  }
  return res.json()
}

export async function fetchReportChain(
  fetchWithAuth: FetchWithAuth,
  userId: number,
): Promise<ReportChainResponse> {
  const res = await fetchWithAuth(`/api/v1/users/${userId}/report-chain`)
  if (!res.ok) throw new Error('获取汇报链失败')
  return res.json()
}

// ===== 部门角色 =====
export async function fetchDepartmentRoles(
  fetchWithAuth: FetchWithAuth,
  deptId: number,
): Promise<RoleData[]> {
  const res = await fetchWithAuth(`/api/v1/users/departments/${deptId}/roles`)
  if (!res.ok) throw new Error('获取部门角色失败')
  return res.json()
}

export async function setDepartmentRoles(
  fetchWithAuth: FetchWithAuth,
  deptId: number,
  roleIds: number[],
): Promise<{ message: string }> {
  const res = await fetchWithAuth(`/api/v1/users/departments/${deptId}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ role_ids: roleIds }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '设置失败' }))
    throw new Error(err.detail || '设置部门角色失败')
  }
  return res.json()
}
