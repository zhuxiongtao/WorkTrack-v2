import type { FetchWithAuth, UserData, UserListParams, PaginatedResponse, SimpleUser, UserCreatePayload, UserUpdatePayload } from './types'

export async function fetchUsers(
  fetchWithAuth: FetchWithAuth,
  params?: UserListParams,
): Promise<PaginatedResponse<UserData> | UserData[]> {
  const queryParts: string[] = []

  if (params?.page && params.page > 0) {
    queryParts.push(`page=${params.page}`)
    queryParts.push(`page_size=${params.page_size ?? 20}`)
  }
  if (params?.search && params.search.trim()) {
    queryParts.push(`search=${encodeURIComponent(params.search.trim())}`)
  }
  if (params?.department_id != null) {
    queryParts.push(`department_id=${params.department_id}`)
  }
  if (params?.role_id != null) {
    queryParts.push(`role_id=${params.role_id}`)
  }
  if (params?.status && params.status !== 'all') {
    queryParts.push(`status=${params.status}`)
  }

  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
  const res = await fetchWithAuth(`/api/v1/users${query}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(err.detail || '获取用户列表失败')
  }
  return res.json()
}

export async function fetchSimpleUsers(fetchWithAuth: FetchWithAuth): Promise<SimpleUser[]> {
  const res = await fetchWithAuth('/api/v1/users/simple')
  if (!res.ok) throw new Error('获取用户列表失败')
  return res.json()
}

export async function createUser(
  fetchWithAuth: FetchWithAuth,
  data: UserCreatePayload,
): Promise<UserData> {
  const res = await fetchWithAuth('/api/v1/users', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '创建失败' }))
    throw new Error(err.detail || '创建用户失败')
  }
  return res.json()
}

export async function updateUser(
  fetchWithAuth: FetchWithAuth,
  id: number,
  data: UserUpdatePayload,
): Promise<UserData> {
  const res = await fetchWithAuth(`/api/v1/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '编辑失败' }))
    throw new Error(err.detail || '编辑用户失败')
  }
  return res.json()
}

export async function toggleUserActive(
  fetchWithAuth: FetchWithAuth,
  id: number,
): Promise<{ id: number; is_active: boolean; status: string; message: string }> {
  const res = await fetchWithAuth(`/api/v1/users/${id}/toggle-active`, { method: 'PUT' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '操作失败' }))
    throw new Error(err.detail || '切换用户状态失败')
  }
  return res.json()
}

export async function setUserStatus(
  fetchWithAuth: FetchWithAuth,
  id: number,
  status: string,
): Promise<{ id: number; status: string; is_active: boolean; message: string }> {
  const res = await fetchWithAuth(`/api/v1/users/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '操作失败' }))
    throw new Error(err.detail || '设置用户状态失败')
  }
  return res.json()
}

export async function resetUserPassword(
  fetchWithAuth: FetchWithAuth,
  id: number,
  newPassword: string,
): Promise<{ message: string }> {
  const res = await fetchWithAuth(`/api/v1/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '重置失败' }))
    throw new Error(err.detail || '重置密码失败')
  }
  return res.json()
}

export async function deleteUser(
  fetchWithAuth: FetchWithAuth,
  id: number,
): Promise<void> {
  const res = await fetchWithAuth(`/api/v1/users/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '删除失败' }))
    throw new Error(err.detail || '删除用户失败')
  }
}
