import type { FetchWithAuth, RoleData, PermissionData, RoleCreatePayload, RoleUpdatePayload } from './types'

export async function fetchRoles(fetchWithAuth: FetchWithAuth): Promise<RoleData[]> {
  const res = await fetchWithAuth('/api/v1/roles')
  if (!res.ok) throw new Error('获取角色列表失败')
  return res.json()
}

export async function fetchPermissions(fetchWithAuth: FetchWithAuth): Promise<PermissionData[]> {
  const res = await fetchWithAuth('/api/v1/permissions')
  if (!res.ok) throw new Error('获取权限列表失败')
  return res.json()
}

export async function createRole(
  fetchWithAuth: FetchWithAuth,
  data: RoleCreatePayload,
): Promise<RoleData> {
  const res = await fetchWithAuth('/api/v1/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '创建失败' }))
    throw new Error(err.detail || '创建角色失败')
  }
  return res.json()
}

export async function updateRole(
  fetchWithAuth: FetchWithAuth,
  id: number,
  data: RoleUpdatePayload,
): Promise<RoleData> {
  const res = await fetchWithAuth(`/api/v1/roles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '编辑失败' }))
    throw new Error(err.detail || '编辑角色失败')
  }
  return res.json()
}

export async function deleteRole(
  fetchWithAuth: FetchWithAuth,
  id: number,
): Promise<void> {
  const res = await fetchWithAuth(`/api/v1/roles/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '删除失败' }))
    throw new Error(err.detail || '删除角色失败')
  }
}
