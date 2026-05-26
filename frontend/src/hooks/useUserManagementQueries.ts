import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import type { UserListParams, UserCreatePayload, UserUpdatePayload, RoleCreatePayload, RoleUpdatePayload, DepartmentCreatePayload, DepartmentUpdatePayload, UserData, PaginatedResponse } from '../services/types'
import { fetchUsers, fetchSimpleUsers, createUser, updateUser, toggleUserActive, setUserStatus, resetUserPassword, deleteUser } from '../services/userService'
import { fetchRoles, fetchPermissions, createRole, updateRole, deleteRole } from '../services/roleService'
import { fetchDepartmentTree, createDepartment, updateDepartment, deleteDepartment, fetchDepartmentsFlat, fetchDepartmentRoles, setDepartmentRoles } from '../services/departmentService'

// ===== 用户查询 =====
export function useUserListQuery(params: UserListParams) {
  const { fetchWithAuth } = useAuth()
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => fetchUsers(fetchWithAuth, params),
  })
}

export function useUsersSimpleQuery() {
  const { fetchWithAuth } = useAuth()
  return useQuery({
    queryKey: ['users', 'simple'],
    queryFn: () => fetchSimpleUsers(fetchWithAuth),
    staleTime: 120_000,
  })
}

// ===== 角色/权限查询 =====
export function useRolesQuery() {
  const { fetchWithAuth } = useAuth()
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => fetchRoles(fetchWithAuth),
  })
}

export function usePermissionsQuery() {
  const { fetchWithAuth } = useAuth()
  return useQuery({
    queryKey: ['permissions'],
    queryFn: () => fetchPermissions(fetchWithAuth),
    staleTime: 300_000,
  })
}

// ===== 部门查询 =====
export function useDepartmentTreeQuery() {
  const { fetchWithAuth } = useAuth()
  return useQuery({
    queryKey: ['departments', 'tree'],
    queryFn: () => fetchDepartmentTree(fetchWithAuth),
    staleTime: 60_000,
  })
}

export function useDepartmentsFlatQuery() {
  const { fetchWithAuth } = useAuth()
  return useQuery({
    queryKey: ['departments', 'flat'],
    queryFn: () => fetchDepartmentsFlat(fetchWithAuth),
    staleTime: 120_000,
  })
}

// ===== 用户变更 =====
export function useCreateUserMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (data: UserCreatePayload) => createUser(fetchWithAuth, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast('用户创建成功', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useUpdateUserMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UserUpdatePayload }) => updateUser(fetchWithAuth, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast('用户信息已更新', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useToggleUserActiveMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (id: number) => toggleUserActive(fetchWithAuth, id),
    onMutate: async (id) => {
      // 乐观更新：立即翻转 is_active
      await queryClient.cancelQueries({ queryKey: ['users'] })
      const previousQueries = queryClient.getQueriesData({ queryKey: ['users'] })
      
      queryClient.setQueriesData({ queryKey: ['users'] }, (old: unknown) => {
        if (!old) return old
        if (typeof old === 'object' && old !== null && 'items' in old) {
          const paginated = old as PaginatedResponse<UserData>
          return {
            ...paginated,
            items: paginated.items.map((u: UserData) =>
              u.id === id ? { ...u, is_active: !u.is_active, status: !u.is_active ? 'active' : 'disabled' } : u
            ),
          }
        }
        if (Array.isArray(old)) {
          return old.map((u: UserData) =>
            u.id === id ? { ...u, is_active: !u.is_active, status: !u.is_active ? 'active' : 'disabled' } : u
          )
        }
        return old
      })
      return { previousQueries }
    },
    onError: (_err, _id, context) => {
      if (context?.previousQueries) {
        for (const [key, data] of context.previousQueries) {
          queryClient.setQueryData(key, data)
        }
      }
      toast('操作失败', 'error')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useSetUserStatusMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => setUserStatus(fetchWithAuth, id, status),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast(data.message, 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useResetPasswordMutation() {
  const { fetchWithAuth } = useAuth()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      resetUserPassword(fetchWithAuth, id, newPassword),
    onSuccess: () => toast('密码已成功重置', 'success'),
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useDeleteUserMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (id: number) => deleteUser(fetchWithAuth, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast('用户及关联数据已删除', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

// ===== 角色变更 =====
export function useCreateRoleMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (data: RoleCreatePayload) => createRole(fetchWithAuth, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast('角色创建成功', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useUpdateRoleMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: RoleUpdatePayload }) => updateRole(fetchWithAuth, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast('角色已更新', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useDeleteRoleMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (id: number) => deleteRole(fetchWithAuth, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      toast('角色已删除', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

// ===== 部门变更 =====
export function useCreateDepartmentMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (data: DepartmentCreatePayload) => createDepartment(fetchWithAuth, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast('部门创建成功', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useUpdateDepartmentMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: DepartmentUpdatePayload }) =>
      updateDepartment(fetchWithAuth, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast('部门已更新', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

export function useDeleteDepartmentMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (id: number) => deleteDepartment(fetchWithAuth, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast('部门已删除', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}

// ===== 部门角色 =====
export function useDepartmentRolesQuery(deptId: number | null) {
  const { fetchWithAuth } = useAuth()
  return useQuery({
    queryKey: ['departments', deptId, 'roles'],
    queryFn: () => fetchDepartmentRoles(fetchWithAuth, deptId!),
    enabled: deptId !== null,
  })
}

export function useSetDepartmentRolesMutation() {
  const { fetchWithAuth } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ deptId, roleIds }: { deptId: number; roleIds: number[] }) =>
      setDepartmentRoles(fetchWithAuth, deptId, roleIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['departments', variables.deptId, 'roles'] })
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast('部门角色已成功更新', 'success')
    },
    onError: (err: Error) => toast(err.message, 'error'),
  })
}
