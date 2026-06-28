import { useState, useEffect, useCallback, useRef } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import SearchableSelect from '../components/SearchableSelect'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Plus, Trash2, ChevronRight, ChevronDown, FileText, FolderOpen,
  ArrowLeft, Loader2, X, Check, BookOpen, Maximize2, Minimize2,
  Sun, Moon, Monitor, Edit3, Share2, Users, Shield, Copy, Globe,
  Lock, Info, Calendar, UserCheck, ShieldAlert, Key, Clock, RefreshCw,
  Sparkles, Send, ArrowRightLeft, CornerDownLeft, Building2, Search,
  Crown, ArrowUpRight
} from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/ThemeContext'
import RichTextEditor from '../components/RichTextEditor'
import TocPanel from '../components/TocPanel'
import type { DepartmentTreeNode } from '../services/types'

/**
 * 将 AI 返回的 Markdown 文本转为安全的富文本 HTML，供 TipTap 插入 / 文档追加使用。
 * AI 输出多为 Markdown（列表、加粗、标题等），过去直接插入或仅做 \n→<br/> 替换，
 * 导致编辑器里出现 `- **xx**` 这类未渲染的原始语法。此处统一走 marked 解析 + DOMPurify 净化。
 */
function aiMarkdownToHtml(content: string): string {
  if (!content) return ''
  const html = (marked.parse(content, { async: false }) as string || '').trim()
  return DOMPurify.sanitize(html)
}

interface WikiSpace {
  id: number
  name: string
  description: string
  owner_id: number
  is_public: boolean
  cover_type: string
  cover_url: string
  share_password: string | null
  share_expires_at: string | null
  created_at: string
  updated_at: string
  is_owner?: boolean
  is_shared?: boolean
  is_page_collaborative?: boolean
}

interface WikiPageTreeNode {
  id: number
  title: string
  parent_id: number | null
  sort_order: number
  children: WikiPageTreeNode[]
}

interface WikiPageDetail {
  id: number
  space_id: number
  parent_id: number | null
  title: string
  content: string
  sort_order: number
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
  creator_name?: string
  editor_names?: string[]
  my_permission?: string
}

interface UserListItem {
  id: number
  username: string
  name: string
}

interface CollaboratorItem {
  id: number
  target_type: string
  target_id: number
  subject_type: 'user' | 'group' | 'department'
  subject_id: number
  permission: 'viewer' | 'editor' | 'admin'
  subject_name: string
  subject_username: string
}

const PRESET_COVERS = [
  { id: 'gradient-1', gradient: 'from-emerald-500 to-teal-600', icon: '#059669' },
  { id: 'gradient-2', gradient: 'from-violet-500 to-purple-700', icon: '#7C3AED' },
  { id: 'gradient-3', gradient: 'from-amber-400 to-orange-600', icon: '#D97706' },
  { id: 'gradient-4', gradient: 'from-rose-400 to-pink-600', icon: '#DB2777' },
  { id: 'gradient-5', gradient: 'from-sky-400 to-blue-600', icon: '#2563EB' },
  { id: 'gradient-6', gradient: 'from-slate-600 to-slate-800', icon: '#475569' },
]

const getAvatarColor = (name: string) => {
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const colors = [
    'from-blue-500/20 to-indigo-500/20 text-blue-500 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
    'from-emerald-500/20 to-teal-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
    'from-purple-500/20 to-pink-500/20 text-purple-500 dark:text-purple-400 border-purple-200 dark:border-purple-500/30',
    'from-amber-500/20 to-orange-500/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    'from-rose-500/20 to-red-500/20 text-rose-500 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
    'from-cyan-500/20 to-blue-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/30',
  ]
  return colors[hash % colors.length]
}

function findDeptNode(tree: DepartmentTreeNode[], id: number): DepartmentTreeNode | null {
  for (const node of tree) {
    if (node.id === id) return node
    const found = findDeptNode(node.children, id)
    if (found) return found
  }
  return null
}

function flattenDepts(tree: DepartmentTreeNode[]): { id: number; name: string; parent_id: number | null }[] {
  const result: { id: number; name: string; parent_id: number | null }[] = []
  const walk = (nodes: DepartmentTreeNode[]) => {
    for (const n of nodes) {
      result.push({ id: n.id, name: n.name, parent_id: n.parent_id })
      walk(n.children)
    }
  }
  walk(tree)
  return result
}

function CollabDeptNode({ node, selectedDeptId, level, onSelect }: {
  node: DepartmentTreeNode
  selectedDeptId: number | null
  level: number
  onSelect: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children && node.children.length > 0
  const isSelected = selectedDeptId === node.id

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 py-2 px-2 cursor-pointer transition-all text-xs border border-transparent rounded-lg ${
          isSelected
            ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue font-bold'
            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-bg-hover/40'
        }`}
        style={{ paddingLeft: `${8 + level * 16}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          className={`shrink-0 p-0.5 rounded transition-colors ${
            hasChildren ? 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200' : 'text-transparent pointer-events-none'
          }`}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Building2 size={13} className="shrink-0 text-amber-500" />
        <span className="truncate flex-1">{node.name}</span>
        <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">{node.user_count}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map(child => (
            <CollabDeptNode
              key={child.id}
              node={child}
              selectedDeptId={selectedDeptId}
              level={level + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CollabDeptMembers({ deptId, departmentTree, deptUsers, onAdd }: {
  deptId: number
  departmentTree: DepartmentTreeNode[]
  deptUsers: UserListItem[]
  onAdd: (type: 'user' | 'department', id: number) => void
  permission: string
}) {
  const dept = findDeptNode(departmentTree, deptId)

  return (
    <div className="py-2">
      {dept && (
        <button
          onClick={() => onAdd('department', deptId)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs hover:bg-accent-blue/5 dark:hover:bg-accent-blue/10 transition-colors cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 flex items-center justify-center shrink-0">
            <Building2 size={14} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <span className="text-gray-800 dark:text-gray-200 font-bold block truncate">{dept.name}</span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">整个部门 · {dept.user_count} 人</span>
          </div>
          <span className="shrink-0 px-2.5 py-1 rounded-lg bg-accent-blue/10 text-accent-blue text-[11px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
            + 添加部门
          </span>
        </button>
      )}
      {deptUsers.length > 0 && (
        <div className="border-t border-gray-100 dark:border-border/10 mt-1 pt-1">
          {deptUsers.map(u => (
            <button
              key={u.id}
              onClick={() => onAdd('user', u.id)}
              className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-accent-blue/5 dark:hover:bg-accent-blue/10 transition-colors cursor-pointer group"
            >
              <div className={`w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-[11px] font-bold border shrink-0 ${getAvatarColor(u.name || u.username)}`}>
                {(u.name || u.username)[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <span className="text-gray-800 dark:text-gray-200 font-semibold block truncate">{u.name || u.username}</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">@{u.username}</span>
              </div>
              <span className="shrink-0 w-6 h-6 rounded-md bg-accent-blue/10 text-accent-blue text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                +
              </span>
            </button>
          ))}
        </div>
      )}
      {deptUsers.length === 0 && dept && (
        <div className="text-center py-6 text-gray-400 text-xs">该部门暂无成员</div>
      )}
    </div>
  )
}

function CollabSearchResults({ search, allUsers, departmentTree, onAdd }: {
  search: string
  allUsers: UserListItem[]
  departmentTree: DepartmentTreeNode[]
  onAdd: (type: 'user' | 'department', id: number) => void
  permission: string
}) {
  const k = search.toLowerCase()
  const matchedUsers = allUsers.filter(u =>
    (u.name && u.name.toLowerCase().includes(k)) || u.username.toLowerCase().includes(k)
  )
  const allDepts = flattenDepts(departmentTree)
  const matchedDepts = allDepts.filter(d => d.name.toLowerCase().includes(k))

  if (matchedUsers.length === 0 && matchedDepts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <Search size={20} className="opacity-30 mb-2" />
        <span className="text-xs">未找到匹配结果</span>
      </div>
    )
  }

  return (
    <div className="py-2">
      {matchedDepts.length > 0 && (
        <div>
          <span className="block px-3 py-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">部门</span>
          {matchedDepts.map(d => (
            <button
              key={d.id}
              onClick={() => onAdd('department', d.id)}
              className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-accent-blue/5 dark:hover:bg-accent-blue/10 transition-colors cursor-pointer group"
            >
              <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 flex items-center justify-center shrink-0">
                <Building2 size={13} className="text-amber-500" />
              </div>
              <span className="flex-1 min-w-0 text-left text-gray-800 dark:text-gray-200 font-semibold truncate">{d.name}</span>
              <span className="shrink-0 px-2 py-1 rounded-lg bg-accent-blue/10 text-accent-blue text-[11px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                + 添加
              </span>
            </button>
          ))}
        </div>
      )}
      {matchedUsers.length > 0 && (
        <div className={matchedDepts.length > 0 ? 'border-t border-gray-100 dark:border-border/10 mt-1 pt-1' : ''}>
          <span className="block px-3 py-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">成员</span>
          {matchedUsers.map(u => (
            <button
              key={u.id}
              onClick={() => onAdd('user', u.id)}
              className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-accent-blue/5 dark:hover:bg-accent-blue/10 transition-colors cursor-pointer group"
            >
              <div className={`w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center text-[11px] font-bold border shrink-0 ${getAvatarColor(u.name || u.username)}`}>
                {(u.name || u.username)[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <span className="text-gray-800 dark:text-gray-200 font-semibold block truncate">{u.name || u.username}</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">@{u.username}</span>
              </div>
              <span className="shrink-0 w-6 h-6 rounded-md bg-accent-blue/10 text-accent-blue text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                +
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const API = {
  async get<T>(url: string): Promise<T> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  async post<T>(url: string, body: any): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  async put<T>(url: string, body: any): Promise<T> {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  async del(url: string) {
    const res = await fetch(url, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(await res.text())
  },
}

export default function WikiPage() {
  const { user: currentUser } = useAuth()
  const { toast: showToast } = useToast()
  const { theme, resolvedTheme, toggle: toggleTheme } = useTheme()
  const navigate = useNavigate()
  const { spaceId: spaceIdParam } = useParams<{ spaceId: string }>()
  const [searchParams] = useSearchParams()
  const spaceId = spaceIdParam ? parseInt(spaceIdParam, 10) : null
  const pageIdFromUrl = searchParams.get('page')

  const [spaces, setSpaces] = useState<WikiSpace[]>([])
  const [loading, setLoading] = useState(true)

  // 当前选中的空间
  const selectedSpace = spaceId ? spaces.find(s => s.id === spaceId) || null : null

  const [pageTree, setPageTree] = useState<WikiPageTreeNode[]>([])
  const [treeLoading, setTreeLoading] = useState(false)

  // 当前页面、编辑状态与内容
  const [editingPage, setEditingPage] = useState<WikiPageDetail | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [editorTitle, setEditorTitle] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isEditingMode, setIsEditingMode] = useState(false) // 双模式切换核心状态

  // 协作者与分享模态框状态
  const [showShareModal, setShowShareModal] = useState(false)
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([])
  const [loadingCollaborators, setLoadingCollaborators] = useState(false)
  const [allUsersList, setAllUsersList] = useState<UserListItem[]>([])
  const [departmentTree, setDepartmentTree] = useState<DepartmentTreeNode[]>([])
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null)
  const [deptUsers, setDeptUsers] = useState<UserListItem[]>([])
  const [collabSearch, setCollabSearch] = useState('')
  const [selectedPermission, setSelectedPermission] = useState<'viewer' | 'editor' | 'admin'>('viewer')
  
  // 外链分享高级参数配置
  const [isSpacePublic, setIsSpacePublic] = useState(false)
  const [shareScope, setShareScope] = useState<'space' | 'descendants' | 'single'>('space') // 分享范围
  const [sharePassword, setSharePassword] = useState('') // 共享提取密码
  const [usePassword, setUsePassword] = useState(false) // 是否启用密码
  const [shareExpiresAt, setShareExpiresAt] = useState('') // 共享失效到期时间
  const [expireMode, setExpireMode] = useState<'permanent' | 'custom'>('permanent') // 共享有效期
  const [autoSaving, setAutoSaving] = useState(false)

  // AI 划词辅助与智能侧边写作助手状态
  const [selectedText, setSelectedText] = useState('')
  const [showAiToolbar, setShowAiToolbar] = useState(false)
  const [aiToolbarCoords, setAiToolbarCoords] = useState<{ x: number; y: number } | null>(null)
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false)
  const [aiInput, setAiInput] = useState('')
  const [aiHistory, setAiHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  
  // 行内直接 AI 协同、润色、翻译相关状态（对标 Notion AI，实现直接在原文处处理、选择替换或追加）
  const [inlineAiActive, setInlineAiActive] = useState(false)
  const [inlineAiLoading, setInlineAiLoading] = useState(false)
  const [inlineAiResult, setInlineAiResult] = useState('')
  const [inlineAiActionName, setInlineAiActionName] = useState('')

  // 未保存变更追踪
  const savedRef = useRef({ title: '', content: '' })
  const loadingPageIdRef = useRef<number | null>(null)
  const editingPageRef = useRef<WikiPageDetail | null>(null)
  useEffect(() => { editingPageRef.current = editingPage }, [editingPage])
  const isInitialMountRef = useRef(true)
  const editorInstanceRef = useRef<any>(null)

  const isDirty = isEditingMode && editingPage !== null && (editorTitle !== savedRef.current.title || editorContent !== savedRef.current.content)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const pendingActionRef = useRef<(() => void) | null>(null)

  // 基于行级协作角色判定，控制页面上的按钮显示（Viewers 强力隐藏编辑与删除）
  const canEdit = editingPage && (editingPage.my_permission === 'editor' || editingPage.my_permission === 'admin')
  const canDelete = editingPage && (editingPage.my_permission === 'admin' || editingPage.created_by === currentUser?.id)
  const canManagePermissions = editingPage && (editingPage.my_permission === 'admin' || editingPage.created_by === currentUser?.id)

  // 浏览器关闭/刷新拦截
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // 导航守护：有未保存变更时弹窗确认
  const navigateWithGuard = useCallback((action: () => void) => {
    if (isDirty) {
      pendingActionRef.current = action
      setShowUnsavedDialog(true)
    } else {
      action()
    }
  }, [isDirty])

  // 动态高度：测量父容器高度
  const containerRef = useRef<HTMLDivElement>(null)

  // 对话框
  const [showSpaceDialog, setShowSpaceDialog] = useState(false)
  const [showEditSpaceDialog, setShowEditSpaceDialog] = useState(false)
  const [editingSpace, setEditingSpace] = useState<WikiSpace | null>(null)
  const [showPageDialog, setShowPageDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: 'space' | 'page'; id: number; name: string } | null>(null)
  const [spaceForm, setSpaceForm] = useState({ name: '', description: '', cover_type: 'gradient-1', cover_url: '' })
  const [pageForm, setPageForm] = useState({ title: '', parent_id: null as number | null })

  const loadSpaces = useCallback(async () => {
    try {
      setLoading(true)
      const data = await API.get<WikiSpace[]>('/api/v1/wiki/spaces')
      setSpaces(data)
    } catch (e) {
      showToast('加载在线文档空间失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const loadPageTree = useCallback(async (spaceId: number) => {
    try {
      setTreeLoading(true)
      const data = await API.get<WikiPageTreeNode[]>(`/api/v1/wiki/spaces/${spaceId}/pages`)
      setPageTree(data)
    } catch (e) {
      showToast('加载在线文档树失败', 'error')
    } finally {
      setTreeLoading(false)
    }
  }, [showToast])

  const loadPage = useCallback(async (pageId: number) => {
    if (loadingPageIdRef.current === pageId && editingPageRef.current?.id === pageId) return
    loadingPageIdRef.current = pageId
    try {
      const data = await API.get<WikiPageDetail>(`/api/v1/wiki/pages/${pageId}`)
      
      // 极其关键的跨空间隔离防护
      if (selectedSpace && data.space_id !== selectedSpace.id) {
        navigate(`/wiki/${selectedSpace.id}`, { replace: true })
        loadingPageIdRef.current = null
        return
      }

      setEditingPage(data)
      setEditorTitle(data.title)
      setEditorContent(data.content)
      savedRef.current = { title: data.title, content: data.content }
      setIsFullscreen(false)
      setIsEditingMode(false) // 切换页面默认回到只读阅读模式
      // 同步 pageId 到浏览器 URL 查询参数，保障页面刷新、后退后依然保留当前阅读/编辑页面
      navigate(`/wiki/${data.space_id}?page=${pageId}`, { replace: true })
    } catch (e) {
      showToast('加载在线文档失败', 'error')
      loadingPageIdRef.current = null
    }
  }, [showToast, navigate, selectedSpace])

  useEffect(() => { loadSpaces() }, [loadSpaces])

  // spaceId 无效时重定向回列表
  useEffect(() => {
    if (!loading && spaceId && spaces.length > 0 && !selectedSpace) {
      navigate('/wiki', { replace: true })
    }
  }, [loading, spaceId, spaces, selectedSpace, navigate])

  useEffect(() => {
    if (selectedSpace) {
      loadPageTree(selectedSpace.id)
      setIsSpacePublic(selectedSpace.is_public)
      setSharePassword(selectedSpace.share_password || '')
      setUsePassword(!!selectedSpace.share_password)
      setShareExpiresAt(formatDatetimeForInput(selectedSpace.share_expires_at))
    }
  }, [selectedSpace, loadPageTree])

  // 监听并解析 URL 中的 page 查询参数
  useEffect(() => {
    if (selectedSpace && pageIdFromUrl) {
      const pid = parseInt(pageIdFromUrl, 10)
      if (!isNaN(pid)) {
        // 跨空间安全隔离拦截
        if (editingPageRef.current && editingPageRef.current.space_id !== selectedSpace.id) {
          loadingPageIdRef.current = null
          isInitialMountRef.current = false
          navigate(`/wiki/${selectedSpace.id}`, { replace: true })
          return
        }

        // 仅在首次装载或必要时加载
        if (isInitialMountRef.current || (editingPageRef.current && editingPageRef.current.id !== pid)) {
          isInitialMountRef.current = false
          loadPage(pid)
        }
      }
    } else if (selectedSpace && !pageIdFromUrl) {
      // 首次加载且 URL 无 page 参，重置状态
      if (isInitialMountRef.current) {
        setEditingPage(null)
        isInitialMountRef.current = false
      }
    }
  }, [selectedSpace, pageIdFromUrl, loadPage, navigate])

  // 将 ISO 时间字符串转为 <input type="datetime-local"> 格式
  const formatDatetimeForInput = (isoString: string | null): string => {
    if (!isoString) return ''
    const date = new Date(isoString)
    const tzoffset = date.getTimezoneOffset() * 60000
    const localISOTime = (new Date(date.getTime() - tzoffset)).toISOString().slice(0, 16)
    return localISOTime
  }

  // ===== 空间操作 =====
  const handleCreateSpace = async () => {
    try {
      const data = await API.post<WikiSpace>('/api/v1/wiki/spaces', spaceForm)
      setSpaces(prev => [data, ...prev])
      setShowSpaceDialog(false)
      setSpaceForm({ name: '', description: '', cover_type: 'gradient-1', cover_url: '' })
      showToast('在线文档空间已创建', 'success')
    } catch (e: any) {
      showToast(e.message || '创建失败', 'error')
    }
  }

  const handleEditSpace = (space: WikiSpace) => {
    setEditingSpace(space)
    setSpaceForm({ name: space.name, description: space.description, cover_type: space.cover_type, cover_url: space.cover_url })
    setShowEditSpaceDialog(true)
  }

  const handleUpdateSpace = async () => {
    if (!editingSpace) return
    try {
      await API.put(`/api/v1/wiki/spaces/${editingSpace.id}`, spaceForm)
      setSpaces(prev => prev.map(s => s.id === editingSpace.id ? { ...s, ...spaceForm } : s))
      setShowEditSpaceDialog(false)
      setEditingSpace(null)
      setSpaceForm({ name: '', description: '', cover_type: 'gradient-1', cover_url: '' })
      showToast('在线文档空间已更新', 'success')
    } catch (e: any) {
      showToast(e.message || '更新失败', 'error')
    }
  }

  // 静默后台自动保存函数（不退出编辑状态，维持打字连贯性）
  const savePageSilent = useCallback(async () => {
    if (!editingPage) return
    try {
      setAutoSaving(true)
      await API.put(`/api/v1/wiki/pages/${editingPage.id}`, {
        title: editorTitle,
        content: editorContent,
      })
      savedRef.current = { title: editorTitle, content: editorContent }
      // 局部静默同步完后刷新左侧
      loadPageTree(selectedSpace!.id)
    } catch {
      // 静默失败，不做干扰
    } finally {
      setAutoSaving(false)
    }
  }, [editingPage, editorTitle, editorContent, selectedSpace, loadPageTree])

  // 自动保存防抖监听（3 秒不打字则自动向数据库同步草稿）
  useEffect(() => {
    if (!isEditingMode || !isDirty || !editingPage) return

    const timer = setTimeout(() => {
      savePageSilent()
    }, 3000)

    return () => clearTimeout(timer)
  }, [editorTitle, editorContent, isEditingMode, isDirty, editingPage, savePageSilent])

  const handleDeleteSpace = async () => {
    if (!showDeleteConfirm || showDeleteConfirm.type !== 'space') return
    try {
      await API.del(`/api/v1/wiki/spaces/${showDeleteConfirm.id}`)
      setSpaces(prev => prev.filter(s => s.id !== showDeleteConfirm.id))
      if (selectedSpace?.id === showDeleteConfirm.id) {
        navigate('/wiki')
        setEditingPage(null)
      }
      showToast('文档空间已被彻底删除', 'success')
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('页面')) {
        showToast('请先清空当前空间下的所有文档，才能删除该空间', 'error')
      } else {
        showToast(e.message || '空间删除失败', 'error')
      }
    } finally {
      setShowDeleteConfirm(null)
    }
  }

  // ===== 页面操作 =====
  const handleCreatePage = async () => {
    if (!selectedSpace) return
    try {
      await API.post('/api/v1/wiki/pages', {
        space_id: selectedSpace.id,
        parent_id: pageForm.parent_id,
        title: pageForm.title,
        content: '',
      })
      setShowPageDialog(false)
      setPageForm({ title: '', parent_id: null })
      loadPageTree(selectedSpace.id)
      showToast('在线文档已创建', 'success')
    } catch (e: any) {
      showToast(e.message || '文档创建失败', 'error')
    }
  }

  const handleDeletePage = async () => {
    if (!showDeleteConfirm || showDeleteConfirm.type !== 'page') return
    try {
      await API.del(`/api/v1/wiki/pages/${showDeleteConfirm.id}`)
      if (editingPage?.id === showDeleteConfirm.id) setEditingPage(null)
      showToast('在线文档及版本记录已删除', 'success')
      if (selectedSpace) loadPageTree(selectedSpace.id)
    } catch (e: any) {
      showToast(e.message || '删除失败', 'error')
    } finally {
      setShowDeleteConfirm(null)
    }
  }

  // ===== 协作者与公共链接分享逻辑 =====
  const openShare = async () => {
    if (!editingPage || !selectedSpace) return
    setShowShareModal(true)
    setIsSpacePublic(selectedSpace.is_public)
    // 不要从后端读取加密后的密码！只判断是否启用了密码，密码框初始化为空
    setSharePassword('')
    setUsePassword(!!selectedSpace.share_password)
    setShareExpiresAt(formatDatetimeForInput(selectedSpace.share_expires_at))
    setExpireMode(selectedSpace.share_expires_at ? 'custom' : 'permanent')
    loadCollaboratorsAndUsers()
  }

  const loadCollaboratorsAndUsers = async () => {
    if (!editingPage) return
    setLoadingCollaborators(true)
    try {
      const [perms, users, deptTree] = await Promise.all([
        API.get<CollaboratorItem[]>(`/api/v1/wiki/pages/${editingPage.id}/permissions`),
        API.get<UserListItem[]>('/api/v1/users/simple?scope=all'),
        API.get<DepartmentTreeNode[]>('/api/v1/users/departments/tree')
      ])
      setCollaborators(Array.isArray(perms) ? perms : [])
      setAllUsersList(Array.isArray(users) ? users : [])
      setDepartmentTree(Array.isArray(deptTree) ? deptTree : [])
    } catch {
      showToast('加载授权协作者列表失败', 'error')
    } finally {
      setLoadingCollaborators(false)
    }
  }

  const loadDeptUsers = async (deptId: number) => {
    try {
      const users = await API.get<UserListItem[]>(`/api/v1/users/simple?scope=all&department_id=${deptId}`)
      setDeptUsers(Array.isArray(users) ? users : [])
    } catch {
      setDeptUsers([])
    }
  }

  // 封装一键即时同步共享配置到云端
  const syncShareConfig = async (newPublic: boolean, newUsePass: boolean, newPass: string, newExpireMode: string, newExpireAt: string) => {
    if (!selectedSpace) return
    try {
      const payload = {
        is_public: newPublic,
        share_password: newUsePass ? (newPass.trim() || null) : null,
        share_expires_at: (newExpireMode === 'custom' && newExpireAt && !isNaN(Date.parse(newExpireAt))) ? new Date(newExpireAt).toISOString() : null
      }
      await API.put(`/api/v1/wiki/spaces/${selectedSpace.id}`, payload)
      setSpaces(prev => prev.map(s => s.id === selectedSpace.id ? { ...s, ...payload } : s))
    } catch {
      showToast('同步共享配置失败，请检查网络连接', 'error')
    }
  }

  // 复制专属共享外链
  const handleCopyShareLink = async () => {
    if (!editingPage || !selectedSpace) return

    // 生成带范围 scope 查询参数的在线浏览地址
    let shareUrl = `${window.location.protocol}//${window.location.host}/wiki/public/${selectedSpace.id}/${editingPage.id}?scope=${shareScope}`
    
    try {
      // 尝试使用 Clipboard API 复制
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl)
      } else {
        // 备用方案：创建临时 textarea 复制
        const textArea = document.createElement('textarea')
        textArea.value = shareUrl
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        try {
          document.execCommand('copy')
        } finally {
          textArea.remove()
        }
      }
      
      let scopeText = '整知识库空间'
      if (shareScope === 'single') scopeText = '仅当前文档单页'
      if (shareScope === 'descendants') scopeText = '当前页及所有子文档'

      let passText = sharePassword.trim() && usePassword ? ` (提取码: ${sharePassword.trim()})` : ''
      showToast(`外链 [${scopeText}] 已复制${passText}，访客免登录即可阅读`, 'success')
    } catch (e) {
      // 复制失败时，显示弹窗让用户手动复制
      const copyPrompt = window.prompt('复制失败，请手动复制以下链接：', shareUrl)
      if (copyPrompt === null) return

      let passText = sharePassword.trim() && usePassword ? ` (提取码: ${sharePassword.trim()})` : ''
      showToast(`链接已显示，您可以手动复制${passText}`, 'info')
    }
  }

  const handleAddCollaborator = async (subjectType: 'user' | 'department', subjectId: number) => {
    if (!editingPage) return
    try {
      await API.post(`/api/v1/wiki/pages/${editingPage.id}/permissions`, {
        target_type: 'page',
        target_id: editingPage.id,
        subject_type: subjectType,
        subject_id: subjectId,
        permission: selectedPermission
      })
      loadCollaboratorsAndUsers()
      showToast('协作者已加入并授权成功', 'success')
    } catch (e: any) {
      showToast(e.message || '授权失败', 'error')
    }
  }

  const handleRemoveCollaborator = async (permId: number) => {
    try {
      await API.del(`/api/v1/wiki/permissions/${permId}`)
      loadCollaboratorsAndUsers()
      showToast('协作者权限已被解除', 'success')
    } catch {
      showToast('移除协作者失败', 'error')
    }
  }

  // ===== 划词 AI 辅助与对话机器人逻辑 =====
  const handleTextSelection = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    // 阻止划词面板在点击 AI 功能按钮、AI 侧边栏本身时被误解关闭
    if (target.closest('.ai-prevent-deselect')) return

    const selection = window.getSelection()
    if (!selection) return
    const text = selection.toString().trim()
    
    if (text && text.length > 1) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setSelectedText(text)
      setAiToolbarCoords({
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY - 44
      })
      setShowAiToolbar(true)
    } else {
      setShowAiToolbar(false)
    }
  }, [])

  // 仅在当前用户具有编辑权限且【文档正处于活动编辑状态 (isEditingMode === true)】时，才允许注册划词监听并展示 AI 智囊工具箱，实现只读阅读、外部外链完全隔离，从底层避开只读下写入导致的 bug
  useEffect(() => {
    if (!canEdit || !isEditingMode) {
      setShowAiToolbar(false)
      setAiSidebarOpen(false)
      return
    }
    document.addEventListener('mouseup', handleTextSelection)

    // 划词工具栏打开时，鼠标按下非编辑器 / 非 AI 面板区域 = 取消选定 + 自动关闭工具栏
    const handleDocumentMouseDown = (e: MouseEvent) => {
      // 暂存：等 mouseup 之后才决定是否关闭（避免用户在编辑器内拖选时被误关）
      const target = e.target as HTMLElement
      // 点击在 AI 面板/侧边栏内部：忽略（让面板自己处理）
      if (target.closest('.ai-prevent-deselect')) return
      // 点击在编辑器内（含富文本框、TocPanel 区域）：忽略（划词或点击会触发 mouseup 重新判断）
      if (target.closest('.ProseMirror') || target.closest('[contenteditable="true"]') || target.closest('.ai-editor-zone')) return
      // 点击在工具栏/按钮上：忽略
      if (target.closest('button') || target.closest('input') || target.closest('textarea')) return
      // 其他位置（页面空白、左侧文档树等）：延迟判断，等 mouseup 之后检查是否真的有新选区
      setTimeout(() => {
        const sel = window.getSelection()
        const newText = sel?.toString().trim() || ''
        if (!newText || newText.length <= 1) {
          // 没有新选区 = 用户在取消选定 → 关闭 AI 工具栏
          setShowAiToolbar(false)
          setInlineAiActive(false)
          // 同时清空浏览器选区
          sel?.removeAllRanges()
        }
      }, 50)
    }
    document.addEventListener('mousedown', handleDocumentMouseDown)

    // ESC 键关闭 AI 工具栏
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showAiToolbar) {
        setShowAiToolbar(false)
        setInlineAiActive(false)
        window.getSelection()?.removeAllRanges()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mouseup', handleTextSelection)
      document.removeEventListener('mousedown', handleDocumentMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleTextSelection, canEdit, isEditingMode, showAiToolbar])

  // AI 翻译目标语言选择（仅保留中英两种）
  const TRANSLATE_LANGS: Array<{ code: string; label: string; emoji: string; prompt: string }> = [
    { code: 'zh-CN', label: '简体中文', emoji: '🇨🇳', prompt: '简体中文' },
    { code: 'en',    label: '英文',     emoji: '🇺🇸', prompt: '英文 (English)' },
  ]
  const [showTranslatePicker, setShowTranslatePicker] = useState(false)
  const [lastTargetLang, setLastTargetLang] = useState(TRANSLATE_LANGS[0]) // 记住上次选择，默认简体中文

  // 简易语言自动检测：仅用于「智能判断」翻译目标（中 vs 英）
  const detectSourceLang = (text: string): string => {
    if (!text) return '未知'
    // 简体中文
    if (/[\u4e00-\u9fff]/.test(text)) return '简体中文'
    // 拉丁字母默认按英文
    if (/^[A-Za-z\s\.,!?'"\-]+$/.test(text.trim())) return '英文'
    return '其他'
  }

  // 执行翻译（带目标语言）
  const handleTranslate = (targetLang: typeof TRANSLATE_LANGS[number]) => {
    setShowTranslatePicker(false)
    setLastTargetLang(targetLang)
    handleAiAction('translate', targetLang)
  }

  // 执行行内直接 AI 协同处理（对标 Notion AI，直接原地渲染、可选择覆盖替换或插入下方，极优交互体验）
  const handleAiAction = async (action: string, translateTarget?: typeof TRANSLATE_LANGS[number]) => {
    if (!selectedText) return
    setInlineAiActive(true) // 开启行内直接处理面板
    setInlineAiLoading(true)
    setInlineAiResult('')

    let actionLabel = 'AI 协同处理中'
    let prompt = ''
    if (action === 'polish') { actionLabel = '精修润色'; prompt = `请帮我精修、润色和修改以下选中的文案，使其表达得更生动、专业和得体。请直接输出润色后的纯文本内容，不要有任何多余的解释、前言或双引号括起：\n"${selectedText}"` }
    if (action === 'summarize') { actionLabel = '核心提炼'; prompt = `请帮我提炼和总结以下选中的内容，用精炼的语言概括出核心要点，直接输出总结结果，不要任何多余解释：\n"${selectedText}"` }
    if (action === 'translate') {
      const target = translateTarget || lastTargetLang
      const sourceLang = detectSourceLang(selectedText)
      // 智能判断：源语言 = 目标语言 时自动切换为另一种语言（避免无意义自译）
      const finalTarget = (sourceLang === '简体中文' && target.code === 'zh-CN')
        || (sourceLang === '英文' && target.code === 'en')
          ? TRANSLATE_LANGS.find(l => l.code !== target.code) || TRANSLATE_LANGS[0]
          : target
      actionLabel = `智能翻译（${sourceLang} → ${finalTarget.label}）`
      prompt = `请帮我将以下选中的【${sourceLang}】内容，翻译成地道的【${finalTarget.prompt}】。要求：\n1. 准确传达原文含义，符合目标语言的表达习惯\n2. 保持专业术语、人名、数字的准确性\n3. 直接输出翻译后的纯文本（不要用 Markdown 代码块包裹），不要任何中文解释或前言。\n\n【原文】\n"""\n${selectedText}\n"""`
    }
    if (action === 'extend') { actionLabel = '逻辑续写'; prompt = `请以此文本为背景和思路，接着往下进行续写和扩写，输出一段连贯的相关内容正文，不要任何解释或前言：\n"${selectedText}"` }
    if (action === 'explain') { actionLabel = '概念解释'; prompt = `请帮我详细解释、分析以下选中的专业名词或概念背景：\n"${selectedText}"` }

    setInlineAiActionName(actionLabel)

    try {
      const res = await API.post<any>('/api/v1/ai/chat', { message: prompt, history: [] })
      if (res && res.reply) {
        setInlineAiResult(res.reply)
      }
    } catch {
      showToast('AI 协同失败，请检查模型供应商是否配置正确', 'error')
      setInlineAiActive(false)
    } finally {
      setInlineAiLoading(false)
    }
  }

  // 100% 满足需求：直接替换选中正文 (Notion AI 同款，调用 TipTap 原生命令，实现 100% 成功替换与完美高可读性)
  const handleReplaceSelectionInline = (content: string) => {
    if (editorInstanceRef.current) {
      // AI 结果为 Markdown，先转 HTML 再插入，避免编辑器内出现未渲染的原始语法
      editorInstanceRef.current.chain().focus().insertContent(aiMarkdownToHtml(content)).run()
      setInlineAiActive(false)
      setShowAiToolbar(false)
      showToast('已成功将选定段落替换覆盖为 AI 生成成果', 'success')
    } else {
      showToast('替换失败，未检测到正文编辑器活动实例', 'error')
    }
  }

  // 100% 满足需求：插入到选中段落下方 (Notion AI 同款，调用 TipTap 句法命令，100% 在选区终点后方插入新段落)
  const handleInsertBelowInline = (content: string) => {
    if (editorInstanceRef.current) {
      const editor = editorInstanceRef.current
      // AI 结果为 Markdown，先转 HTML（保留列表/加粗/标题等结构）再插入
      const insertHtml = `<p></p>${aiMarkdownToHtml(content)}`
      // 在当前鼠标划词选择的结束锚点（selection.to）处直接插入 HTML 段落
      editor.chain().focus().insertContentAt(editor.state.selection.to, insertHtml).run()
      setInlineAiActive(false)
      setShowAiToolbar(false)
      showToast('AI 协作内容已成功插入到所选段落正下方', 'success')
    } else {
      showToast('插入失败，未检测到活动编辑器实例', 'error')
    }
  }

  // 一键复制 AI 生成结果到剪贴板
  const [inlineAiCopied, setInlineAiCopied] = useState(false)
  const handleCopyInlineResult = async (content: string) => {
    if (!content) {
      showToast('暂无内容可复制', 'warning')
      return
    }
    try {
      // 优先使用现代剪贴板 API（需要 HTTPS / localhost / 127.0.0.1）
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content)
      } else {
        // 降级方案：临时 textarea + execCommand
        const ta = document.createElement('textarea')
        ta.value = content
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setInlineAiCopied(true)
      showToast('已复制到剪贴板', 'success')
      setTimeout(() => setInlineAiCopied(false), 1800)
    } catch {
      showToast('复制失败，请手动选中复制', 'error')
    }
  }

  // 自由对话提交（支持自动关联划词选定的段落内容，提供上下文精确写作理解）
  const handleSendAiMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!aiInput.trim() || aiLoading) return
    
    setAiLoading(true)
    const userMsg = aiInput.trim()
    setAiInput('')
    
    // 自动将选定文本融入为系统提示，实现精准的划词段落上下文协同
    let finalPrompt = userMsg
    if (selectedText) {
      finalPrompt = `【我选中的文档正文段落】：\n"""\n${selectedText}\n"""\n\n【我的协作指令】：\n${userMsg}`
    }
    
    // 在聊天历史中仅展示用户输入的简短指令，避免超长参考文案污染侧边栏聊天气泡，保持界面简洁高档
    const nextHistory = [...aiHistory, { role: 'user', content: userMsg } as const]
    setAiHistory(nextHistory)

    try {
      const res = await API.post<any>('/api/v1/ai/chat', {
        message: finalPrompt,
        history: aiHistory.map(h => ({ role: h.role, content: h.content }))
      })
      if (res && res.reply) {
        setAiHistory([...nextHistory, { role: 'assistant', content: res.reply }])
      }
    } catch {
      showToast('AI 对话失败，请检查模型配置', 'error')
    } finally {
      setAiLoading(false)
    }
  }

  // 一键插入文档末尾（保留富文本样式块）
  const handleAppendToDoc = (content: string) => {
    // AI 结果为 Markdown，转 HTML 后再包裹样式块，保留列表/加粗/标题等结构
    const formattedHtml = `<p></p><div style="background-color: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); padding: 16px; border-radius: 12px; margin: 16px 0;"><p style="font-weight: bold; color: rgb(37, 99, 235); font-size: 11px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">✨ AI 写作智囊协作生成：</p><div style="line-height: 1.6;">${aiMarkdownToHtml(content)}</div></div><p></p>`
    setEditorContent(prev => prev + formattedHtml)
    showToast('AI 内容已无损追加到当前文档末尾', 'success')
  }

  // 一键替换正文选中文字
  const handleReplaceSelection = (content: string) => {
    if (!selectedText) {
      showToast('未检测到您划词选中的内容，无法替换', 'warning')
      return
    }
    // AI 结果为 Markdown，转为渲染后的 HTML 再替换
    const html = aiMarkdownToHtml(content)
    // 优先走 TipTap 实例替换当前选区（结构正确且即时生效）；否则回退到对 HTML 字符串做替换
    if (editorInstanceRef.current && editorInstanceRef.current.state.selection.empty === false) {
      editorInstanceRef.current.chain().focus().insertContent(html).run()
    } else {
      setEditorContent(prev => prev.replace(selectedText, html))
    }
    setSelectedText(content) // 将选中参考更新
    showToast('已用 AI 写作结果替换选中正文', 'success')
  }

  // ===== Tree 递归渲染 =====
  const TreeNode = ({ node, depth = 0 }: { node: WikiPageTreeNode; depth?: number }) => {
    const [expanded, setExpanded] = useState(true)
    const hasChildren = node.children.length > 0

    return (
      <div className="select-none">
        <div
          className={`flex items-center gap-1.5 py-2 px-2.5 rounded-lg cursor-pointer hover:bg-gray-150 dark:hover:bg-bg-hover group text-xs font-semibold ${
            editingPage?.id === node.id ? 'bg-accent-blue/10 text-accent-blue font-bold shadow-sm' : 'text-gray-700 dark:text-gray-300'
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => navigateWithGuard(() => loadPage(node.id))}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
              className="p-0.5 rounded hover:bg-white dark:hover:bg-bg-card text-gray-400"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <FileText size={13} className="text-gray-400 dark:text-gray-500 shrink-0" />
          <span className="truncate flex-1">{node.title || '无标题文档'}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowDeleteConfirm({ type: 'page', id: node.id, name: node.title })
            }}
            className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title="删除页面"
          >
            <Trash2 size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setPageForm({ title: '', parent_id: node.id })
              setShowPageDialog(true)
            }}
            className="p-1 rounded hover:bg-white dark:hover:bg-bg-card opacity-0 group-hover:opacity-100 transition-opacity"
            title="添加子页面"
          >
            <Plus size={11} />
          </button>
        </div>
        {expanded && hasChildren && node.children.map(child => (
          <TreeNode key={child.id} node={child} depth={depth + 1} />
        ))}
      </div>
    )
  }

  // ===== 知识空间主视图 =====
  if (!selectedSpace) {
    return (
      <div className="space-y-6 pb-12 animate-fadeIn text-gray-800 dark:text-gray-100">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/10 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">在线文档空间</h2>
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue font-medium border border-accent-blue/20">
                <BookOpen size={11} /> 知识空间
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-medium">创建、协同、编写和共享具备大模型支持的轻量化业务手册和知识文档</p>
          </div>
          <button
            onClick={() => setShowSpaceDialog(true)}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-4.5 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-bold hover:bg-blue-600 transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> 创建新知识库
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-24">
            <Loader2 size={32} className="animate-spin text-accent-blue" />
          </div>
        )}

        {!loading && spaces.length === 0 && (
          <div className="relative text-center py-20 rounded-3xl bg-gradient-to-br from-gray-50 via-white to-blue-50/40 dark:from-gray-900/60 dark:via-gray-900/40 dark:to-blue-950/30 border border-dashed border-gray-300 dark:border-white/10 overflow-hidden">
            <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-accent-blue/5 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-purple-500/5 blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-accent-blue/15 to-purple-500/15 border border-accent-blue/20 mb-4">
                <FolderOpen size={36} className="text-accent-blue opacity-70" strokeWidth={1.5} />
              </div>
              <p className="text-base font-bold text-gray-700 dark:text-gray-200">暂无任何知识库 / 文档空间</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">立即创建一个，解锁在线级的深度编辑和 AI 协同体验吧</p>
            </div>
          </div>
        )}

        {/* 分离展示个人文档库与共享/协作空间 */}
        {(() => {
          const mySpaces = spaces.filter(s => s.is_owner !== false)
          const sharedSpaces = spaces.filter(s => s.is_owner === false)

          const renderCard = (space: WikiSpace) => {
            const cover = PRESET_COVERS.find(c => c.id === space.cover_type) || PRESET_COVERS[0]
            const initial = (space.name?.trim()?.charAt(0) || '?').toUpperCase()
            // 身份徽章（顶左）
            let roleBadge: { icon: JSX.Element; text: string; cls: string; title: string }
            if (space.is_owner === false) {
              if (space.is_page_collaborative) {
                roleBadge = { icon: <FileText size={9} strokeWidth={2.5} />, text: '协作', cls: 'bg-blue-500/20 text-blue-50 border-blue-300/40', title: '该空间的某些单页文档已授权给您协助编辑' }
              } else {
                roleBadge = { icon: <Users size={9} strokeWidth={2.5} />, text: '共享', cls: 'bg-purple-500/20 text-purple-50 border-purple-300/40', title: '整个在线文档库（整个空间）已被共享给您' }
              }
            } else if (space.is_public) {
              roleBadge = { icon: <Globe size={9} strokeWidth={2.5} />, text: '公开', cls: 'bg-emerald-500/20 text-emerald-50 border-emerald-300/40', title: '任何拥有链接的人可访问' }
            } else {
              roleBadge = { icon: <Lock size={9} strokeWidth={2.5} />, text: '私域', cls: 'bg-slate-700/40 text-slate-50 border-slate-400/40', title: '仅授权成员可访问' }
            }
            return (
              <div
                key={space.id}
                onClick={() => navigate(`/wiki/${space.id}`)}
                className="group cursor-pointer select-none"
              >
                <div className="relative rounded-2xl overflow-hidden bg-white dark:bg-gray-900/60 border border-gray-200/70 dark:border-white/10 shadow-sm hover:shadow-2xl hover:shadow-accent-blue/10 hover:-translate-y-1 hover:border-accent-blue/40 dark:hover:border-accent-blue/40 transition-all duration-300 ease-out flex flex-col">
                  {/* ===== 海报式封面 ===== */}
                  <div className={`relative h-28 bg-gradient-to-br ${cover.gradient} overflow-hidden`}>
                    {/* 装饰 1：径向光斑 */}
                    <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/25 blur-2xl group-hover:scale-110 transition-transform duration-700" />
                    <div className="absolute -bottom-8 -left-8 w-28 h-28 rounded-full bg-black/15 blur-xl" />
                    {/* 装饰 2：细网格背景 */}
                    <svg className="absolute inset-0 w-full h-full opacity-50" viewBox="0 0 200 112" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <pattern id={`grid-${space.id}`} x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
                          <path d="M 16 0 L 0 0 0 16" fill="none" stroke="white" strokeOpacity="0.18" strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="200" height="112" fill={`url(#grid-${space.id})`} />
                    </svg>
                    {/* 装饰 3：底部柔化过渡到内容区 */}
                    <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-black/10 pointer-events-none" />
                    {/* 身份徽章（顶左，毛玻璃） */}
                    <div className="absolute top-2.5 left-2.5 z-10">
                      <span title={roleBadge.title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border backdrop-blur-md tracking-wide shadow-sm ${roleBadge.cls}`}>
                        {roleBadge.icon}{roleBadge.text}
                      </span>
                    </div>
                    {/* 所有者小标识（顶右，默认显示） */}
                    {space.is_owner !== false ? (
                      <div className="absolute top-2.5 right-2.5 z-10 transition-all duration-300 group-hover:opacity-0 group-hover:scale-75 group-hover:translate-x-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-white/25 text-white border border-white/40 backdrop-blur-md shadow-sm">
                          <Crown size={8} strokeWidth={2.5} /> 所有者
                        </span>
                      </div>
                    ) : null}
                    {/* 中央悬浮字母徽章：叠在封面与内容交界处 */}
                    <div className="absolute -bottom-5 left-4 z-20 w-11 h-11 rounded-xl bg-white dark:bg-gray-900 shadow-lg shadow-black/15 border-[3px] border-white dark:border-gray-800 flex items-center justify-center text-[15px] font-black group-hover:scale-110 group-hover:-rotate-6 transition-all duration-300 ease-out" style={{ color: cover.icon }}>
                      {initial}
                    </div>
                  </div>

                  {/* ===== 主体内容 ===== */}
                  <div className="pt-7 px-4 pb-2.5 flex flex-col gap-1.5 flex-1">
                    <h3 className="text-[15px] font-bold text-gray-900 dark:text-white line-clamp-1 leading-snug tracking-tight group-hover:text-accent-blue transition-colors">
                      {space.name}
                    </h3>
                    {space.description ? (
                      <p className="text-xs line-clamp-2 text-gray-500 dark:text-gray-400 leading-relaxed min-h-[2.6em]">
                        {space.description}
                      </p>
                    ) : (
                      <p className="text-xs italic text-gray-300 dark:text-gray-600 leading-relaxed min-h-[2.6em] flex items-center">
                        暂无描述 — 点击卡片进入，开始你的第一个知识库
                      </p>
                    )}
                  </div>

                  {/* ===== 底部元数据条 ===== */}
                  <div className="px-4 py-2 border-t border-gray-100 dark:border-white/5 flex items-center justify-between text-[11px] bg-gray-50/40 dark:bg-white/[0.015]">
                    <span className="flex items-center gap-1 text-gray-400 dark:text-gray-500 font-mono tabular-nums">
                      <Clock size={10} />
                      {new Date(space.updated_at).toLocaleDateString('zh-CN')}
                    </span>
                    <span className="flex items-center gap-0.5 text-accent-blue font-bold opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                      进入 <ArrowUpRight size={11} strokeWidth={2.5} />
                    </span>
                  </div>

                  {/* ===== 悬浮操作按钮（顶右，hover 浮入） ===== */}
                  {space.is_owner !== false && (
                    <div className="absolute top-2.5 right-2.5 z-30 flex items-center gap-1 opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEditSpace(space)
                        }}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-lg bg-white/95 dark:bg-gray-900/95 hover:bg-accent-blue hover:text-[#fff] text-gray-700 dark:text-gray-100 backdrop-blur-md shadow-lg border border-white/60 dark:border-white/15 transition-all hover:scale-110 cursor-pointer"
                        title="编辑空间基本信息"
                        aria-label="编辑"
                      >
                        <Edit3 size={12} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowDeleteConfirm({ type: 'space', id: space.id, name: space.name })
                        }}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-lg bg-white/95 dark:bg-gray-900/95 hover:bg-red-500 hover:text-[#fff] text-gray-700 dark:text-gray-100 backdrop-blur-md shadow-lg border border-white/60 dark:border-white/15 transition-all hover:scale-110 cursor-pointer"
                        title="注销空间"
                        aria-label="删除"
                      >
                        <Trash2 size={12} strokeWidth={2.2} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          }

          return (
            <div className="space-y-6">
              {/* 1. 个人空间列表 */}
              {mySpaces.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1.5 select-none pl-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
                    我创建的文档空间 ({mySpaces.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {mySpaces.map(renderCard)}
                  </div>
                </div>
              )}

              {/* 2. 共享与协作空间列表 */}
              {sharedSpaces.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-gray-150 dark:border-border/10">
                  <h3 className="text-xs font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1.5 select-none pl-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                    参与协作与共享空间 ({sharedSpaces.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {sharedSpaces.map(renderCard)}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* 新建空间对话框 */}
        {showSpaceDialog && createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4 max-md:px-0" onClick={() => setShowSpaceDialog(false)}>
            <div className="bg-bg-card rounded-2xl max-md:rounded-none p-6 max-md:p-4 w-full max-w-md max-md:max-w-full max-md:h-full max-md:overflow-y-auto border border-gray-200 dark:border-border/50 shadow-2xl animate-scaleIn" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold mb-4 flex items-center gap-1.5 text-gray-900 dark:text-gray-100">
                <Plus size={18} className="text-accent-blue" />
                新建知识库空间
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">知识库名称 *</label>
                  <input
                    type="text"
                    placeholder="e.g. 内部规范文档"
                    value={spaceForm.name}
                    onChange={e => setSpaceForm(prev => ({ ...prev, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && spaceForm.name.trim()) handleCreateSpace() }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">说明/功能描述</label>
                  <textarea
                    placeholder="简单的功能描述（可选）"
                    value={spaceForm.description}
                    onChange={e => setSpaceForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/40 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 resize-none font-semibold"
                  />
                </div>

                {/* 封面选择 */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2">定制空间封面</p>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {PRESET_COVERS.map(cover => (
                      <button
                        key={cover.id}
                        type="button"
                        onClick={() => setSpaceForm(prev => ({ ...prev, cover_type: cover.id }))}
                        className={`relative aspect-[3/4] rounded-lg bg-gradient-to-br ${cover.gradient} flex items-center justify-center hover:scale-105 transition-transform cursor-pointer ${
                          spaceForm.cover_type === cover.id ? 'ring-2 ring-accent-blue ring-offset-2 ring-offset-bg-card' : ''
                        }`}
                      >
                        {spaceForm.cover_type === cover.id && (
                          <Check size={14} className="text-white drop-shadow" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 mt-5 pt-3 border-t border-gray-100 dark:border-border/10 bg-gray-50/50 dark:bg-bg-hover/10 rounded-b-2xl">
                <button onClick={() => setShowSpaceDialog(false)} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">取消</button>
                <button onClick={handleCreateSpace} disabled={!spaceForm.name.trim()}
                  className="px-4 py-2 text-xs bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold transition-colors cursor-pointer shadow-sm"
                >建立空间</button>
              </div>
            </div>
          </div>
        , document.body)}

        {/* 编辑空间对话框 */}
        {showEditSpaceDialog && createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4 max-md:px-0" onClick={() => { setShowEditSpaceDialog(false); setEditingSpace(null) }}>
            <div className="bg-bg-card rounded-2xl max-md:rounded-none p-6 max-md:p-4 w-full max-w-md max-md:max-w-full max-md:h-full max-md:overflow-y-auto border border-gray-200 dark:border-border/50 shadow-2xl animate-scaleIn" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold mb-4 flex items-center gap-1.5 text-gray-900 dark:text-gray-100">
                <Edit3 size={18} className="text-accent-blue" />
                更新空间配置
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">空间名称 *</label>
                  <input
                    type="text"
                    placeholder="空间名称"
                    value={spaceForm.name}
                    onChange={e => setSpaceForm(prev => ({ ...prev, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && spaceForm.name.trim()) handleUpdateSpace() }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">说明/功能描述</label>
                  <textarea
                    placeholder="描述（可选）"
                    value={spaceForm.description}
                    onChange={e => setSpaceForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/40 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 resize-none font-semibold"
                  />
                </div>

                {/* 封面选择 */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2">更换封面图</p>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {PRESET_COVERS.map(cover => (
                      <button
                        key={cover.id}
                        type="button"
                        onClick={() => setSpaceForm(prev => ({ ...prev, cover_type: cover.id }))}
                        className={`relative aspect-[3/4] rounded-lg bg-gradient-to-br ${cover.gradient} flex items-center justify-center hover:scale-105 transition-transform cursor-pointer ${
                          spaceForm.cover_type === cover.id ? 'ring-2 ring-accent-blue ring-offset-2 ring-offset-bg-card' : ''
                        }`}
                      >
                        {spaceForm.cover_type === cover.id && (
                          <Check size={14} className="text-white drop-shadow" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 mt-5 pt-3 border-t border-gray-150 dark:border-border/10 bg-gray-50/50 dark:bg-bg-hover/10 rounded-b-2xl">
                <button onClick={() => { setShowEditSpaceDialog(false); setEditingSpace(null) }} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm">放弃更改</button>
                <button onClick={handleUpdateSpace} disabled={!spaceForm.name.trim()}
                  className="px-4 py-2 text-xs bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold transition-colors cursor-pointer shadow-sm"
                >保存配置</button>
              </div>
            </div>
          </div>
        , document.body)}

        {/* 删除确认空间 */}
        {showDeleteConfirm && createPortal(
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4 max-md:px-0" onClick={() => setShowDeleteConfirm(null)}>
            <div className="bg-bg-card rounded-2xl max-md:rounded-none p-6 max-md:p-4 w-full max-w-sm max-md:max-w-full border border-gray-200 dark:border-border/40 shadow-2xl animate-scaleIn" onClick={e => e.stopPropagation()}>
              <h2 className="text-base font-bold mb-2 text-gray-900 dark:text-gray-100">确认删除吗？</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
                确定要物理注销该空间「{showDeleteConfirm.name}」？请在操作前确保组内所有的层级文档已经注销完毕，此项毁灭性删除动作将不可退回。
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 dark:border-border/30 rounded-lg cursor-pointer">取消</button>
                <button onClick={handleDeleteSpace}
                  className="px-4 py-2 text-xs bg-red-500 text-[#fff] font-bold rounded-lg hover:bg-red-600 shadow-sm cursor-pointer"
                >确认彻底删除</button>
              </div>
            </div>
          </div>
        , document.body)}
      </div>
    )
  }

  // ===== 空间详情视图（侧边栏树状 + 核心编辑器） =====
  return (
    <div
      ref={containerRef}
      className={`flex w-full h-[calc(100vh-50px)] md:h-[calc(100vh-65px)] max-h-[calc(100vh-50px)] md:max-h-[calc(100vh-65px)] mb-[-24px] md:mb-[-48px] overflow-hidden rounded-2xl border border-gray-200 dark:border-border/30 bg-bg-card shadow-sm ${
        isFullscreen ? 'fixed inset-0 z-[60] bg-bg-main animate-fadeIn h-screen max-h-screen border-none rounded-none' : ''
      }`}
    >
      {/* 左侧面板：目录树 + 内容目录 */}
      {!isFullscreen && (
        <div className="w-56 lg:w-64 max-md:hidden flex-shrink-0 border-r border-gray-200 dark:border-border bg-bg-sidebar flex flex-col">
          {/* 空间头部 */}
          <div className="p-3 border-b border-gray-200 dark:border-border bg-gray-50/50 dark:bg-transparent">
            <button
              onClick={() => navigateWithGuard(() => { navigate('/wiki'); setEditingPage(null) })}
              className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 mb-2.5 transition-colors cursor-pointer"
            >
              <ArrowLeft size={12} /> 返回空间列表
            </button>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-gray-900 dark:text-gray-200 text-xs truncate flex-1" title={selectedSpace.name}>{selectedSpace.name}</h2>
              <button
                onClick={() => { setPageForm({ title: '', parent_id: null }); setShowPageDialog(true) }}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-card text-gray-400 hover:text-gray-200 flex-shrink-0 cursor-pointer"
                title="新建最上层在线文档"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* 页面层级树 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {treeLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-accent-blue" /></div>
            ) : pageTree.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-[11px] italic">空间无在线文档</p>
                <button
                  onClick={() => { setPageForm({ title: '', parent_id: null }); setShowPageDialog(true) }}
                  className="mt-2 text-[11px] text-accent-blue hover:underline font-bold"
                >
                  创建首篇文档
                </button>
              </div>
            ) : (
              pageTree.map(node => <TreeNode key={node.id} node={node} />)
            )}
          </div>
        </div>
      )}

      {/* 中间核心编辑器/阅读面板 */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg-card">
        {editingPage ? (
          <>
            {/* 中间编辑/阅读功能控制栏 */}
             <div className={`flex items-center gap-3 px-4 lg:px-6 py-2.5 max-md:px-3 max-md:py-2 max-md:gap-1.5 border-b border-border bg-bg-card backdrop-blur flex-shrink-0 ${isFullscreen ? 'px-6 shadow-sm' : ''}`}>
              {isFullscreen && (
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 mr-2 flex-shrink-0 cursor-pointer font-bold"
                >
                  <ArrowLeft size={13} /> 退出全屏
                </button>
              )}
              
              {/* 顶栏左侧面包屑层级展现（规范） */}
              <div className="flex-1 min-w-0 flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 select-none">
                <FileText size={14} className="text-accent-blue flex-shrink-0" />
                <span className="truncate">在线文档库 / {selectedSpace.name}</span>
              </div>

               <div className="flex items-center gap-1.5 flex-shrink-0 select-none">
                {/* 1. 分享按钮：只有空间管理员、创作者可进行协作者和外链管理 */}
                {canManagePermissions && (
                  <>
                    <button
                      onClick={openShare}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-card text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 flex items-center gap-1 text-xs font-semibold cursor-pointer border border-transparent hover:border-gray-200 dark:hover:border-border/20 shadow-sm"
                      title="共享链接与协作者权限"
                    >
                      <Share2 size={14} className="text-accent-blue" />
                      <span className="max-md:hidden">分享</span>
                    </button>
                    <div className="w-px h-4 bg-gray-200 dark:bg-border/60 mx-1 hidden sm:block" />
                  </>
                )}

                {/* 2. 双模式无缝切换按钮 (一键切换只读与编辑) */}
                {isEditingMode ? (
                  <button
                    onClick={() => {
                      if (isDirty) savePageSilent()
                      setIsEditingMode(false)
                      showToast('编辑已完成，内容已同步保存至云端', 'success')
                    }}
                    className="px-3 py-1.5 bg-accent-blue hover:bg-blue-600 text-[#fff] text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer shadow-sm transition-colors"
                  >
                    <Check size={12} />
                    <span>完成</span>
                  </button>
                ) : (
                  canEdit && (
                    <button
                      onClick={() => setIsEditingMode(true)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-card text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 flex items-center gap-1 text-xs font-semibold cursor-pointer border border-transparent hover:border-gray-200 dark:hover:border-border/20 shadow-sm"
                      title="切换到在线编辑状态"
                    >
                      <Edit3 size={14} />
                      <span className="max-md:hidden">编辑</span>
                    </button>
                  )
                )}

                {canEdit && <div className="w-px h-4 bg-gray-200 dark:bg-border/60 mx-1" />}

                {/* 3. 同步刷新当前文档内容按钮 */}
                <button
                  onClick={() => {
                    if (editingPage) {
                      loadPage(editingPage.id)
                      loadPageTree(selectedSpace!.id)
                      showToast('文档内容及目录已同步刷新', 'success')
                    }
                  }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-card text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
                  title="重新加载刷新当前页数据"
                >
                  <RefreshCw size={14} />
                </button>

                {canDelete && <div className="w-px h-4 bg-gray-200 dark:bg-border/60 mx-1" />}

                {/* 更多小工具 — 删除按钮 */}
                {canDelete && (
                  <button
                    onClick={() => {
                      setShowDeleteConfirm({ type: 'page', id: editingPage.id, name: editingPage.title })
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-400 cursor-pointer"
                    title="移入回收站"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-card text-gray-500 dark:hover:text-gray-200 cursor-pointer"
                  title={isFullscreen ? '退出全屏' : '全屏静默阅读'}
                >
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <button
                  onClick={toggleTheme}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-card text-gray-500 dark:hover:text-gray-200 cursor-pointer"
                  title={theme === 'dark' ? '切换浅色' : theme === 'light' ? '跟随系统' : '切换深色'}
                >
                  {theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Monitor size={14} />}
                </button>
              </div>
            </div>

            {/* 编辑器与正文主区域 */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 flex min-h-0 relative">
                {/* 1. 富文本核心容器（升级为高档浅色软灰/深色灰蓝背景，模拟工作台画布底色） */}
                <div 
                  className="flex-1 overflow-y-auto bg-gray-50/50 dark:bg-[#101520]/40 pt-4 pb-1 md:pt-6 md:pb-1 lg:pt-8 lg:pb-1" 
                  onDoubleClick={() => { if (!isEditingMode && canEdit) setIsEditingMode(true) }}
                >
                  <div className="mx-auto w-full px-4 sm:px-8 md:px-12 lg:px-16 xl:px-24 2xl:px-32 max-w-[1200px] bg-white dark:bg-bg-card border border-transparent dark:border-border/30 rounded-2xl max-md:rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all duration-300 p-6 md:p-8 lg:p-10 xl:p-12 max-md:p-4 min-h-[calc(100vh-80px)] md:min-h-[calc(100vh-100px)] flex flex-col relative">
                    
                    {/* 右上角悬浮自动保存状态徽标 */}
                    {isEditingMode && (
                      <div className="absolute top-4 right-4 text-xs font-semibold select-none flex items-center gap-1.5 animate-fadeIn">
                        {autoSaving ? (
                          <span className="flex items-center gap-1.5 text-blue-500 dark:text-blue-400">
                            <Loader2 size={12} className="animate-spin" />
                            <span>云端保存中...</span>
                          </span>
                        ) : isDirty ? (
                          <span className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            <span>草稿未保存</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-100 dark:border-emerald-500/20 shadow-sm animate-pulse">
                            <Check size={12} />
                            <span>已自动保存</span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* 纸张内的头部大标题/资料区 (在阅读和编辑模式下都统一内嵌在此) */}
                    <div className="mb-8 border-b border-gray-150 dark:border-border/15 pb-6 select-none">
                      {isEditingMode ? (
                        <input
                          type="text"
                          value={editorTitle}
                          onChange={e => setEditorTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && editorTitle.trim()) savePageSilent() }}
                          className="w-full text-3xl md:text-4xl font-extrabold bg-transparent border-transparent px-0 outline-none focus:ring-0 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 font-sans"
                          placeholder="请输入文档标题"
                        />
                      ) : (
                        <h2 className="text-3xl md:text-4xl max-md:text-xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight leading-tight mb-4">
                          {editorTitle || '无标题在线文档'}
                        </h2>
                      )}

                      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 dark:text-gray-500 mt-2">
                        <span className="flex items-center gap-1.5 font-semibold">
                          <UserCheck size={12} className="text-emerald-500" />
                          <span>
                            创建者：{editingPage.creator_name || '未知'}
                            {editingPage.editor_names && editingPage.editor_names.length > 1 && (
                              <span className="ml-3 pl-3 border-l border-gray-200 dark:border-border/30 text-gray-500 dark:text-gray-400">
                                协作者：{editingPage.editor_names.filter(name => name !== editingPage.creator_name).join('、')}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 font-mono">
                          <Calendar size={12} />
                          <span>{editingPage.updated_at ? `更新于 ${new Date(editingPage.updated_at).toLocaleString('zh-CN')}` : '刚刚'}</span>
                        </span>
                      </div>
                    </div>

                    {/* 正文编辑器 */}
                    <div className="flex-1 min-h-0">
                      <RichTextEditor
                        documentId={editingPage.id}
                        onEditorInit={editor => { editorInstanceRef.current = editor }}
                        value={editorContent}
                        onChange={setEditorContent}
                        placeholder="双击正文区域，开始随心所欲录入并支持 Markdown 快捷指令（#、- 等）…"
                        className="!rounded-none !border-0 !bg-transparent min-h-[500px]"
                        readOnly={!isEditingMode} // 只读静默渲染
                      />
                    </div>
                  </div>
                </div>

                {/* 3. 悬浮目录大纲面板（放置在右侧，契合 Notion / 飞书习惯） */}
                <TocPanel html={editorContent} inline={false} className="border-l border-gray-200 dark:border-border bg-gray-50/10 dark:bg-transparent shrink-0 max-md:hidden" />
              </div>

              {/* 4. 飞书/Notion AI 同款：行内直接 AI 协同处理面板 (Floating Inline AI Co-author Workspace) */}
              {showAiToolbar && aiToolbarCoords && (
                inlineAiActive ? (
                  /* 行内直接处理中的高档 Card 面板 */
                  <div
                    className="fixed z-[100] w-80 max-md:w-[calc(100vw-2rem)] bg-white/95 dark:bg-gray-950/95 text-gray-900 dark:text-white p-4.5 max-md:p-3 rounded-2xl max-md:rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 backdrop-blur-xl ai-prevent-deselect animate-scaleIn flex flex-col gap-3"
                    style={{
                      left: `${aiToolbarCoords.x}px`,
                      top: `${aiToolbarCoords.y}px`,
                      transform: 'translate(-50%, -100%)',
                    }}
                  >
                    <div className="flex items-center justify-between border-b border-gray-200 dark:border-white/10 pb-1.5 select-none">
                      <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                        <Sparkles size={11} className="animate-pulse" />
                        AI 在线协同 ➜ {inlineAiActionName}
                      </span>
                      <button
                        onClick={() => { setInlineAiActive(false); setShowAiToolbar(false) }}
                        className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>

                    <div className="text-xs leading-relaxed max-h-48 overflow-y-auto pr-1">
                      {inlineAiLoading ? (
                        <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-bold py-6 justify-center animate-pulse">
                          <Loader2 size={13} className="animate-spin text-purple-600 dark:text-purple-400" />
                          <span>正在同步撰写中，请稍候...</span>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap font-medium">{inlineAiResult}</p>
                      )}
                    </div>

                    {!inlineAiLoading && inlineAiResult && (
                      <div className="flex items-center justify-between border-t border-gray-200 dark:border-white/10 pt-2.5 select-none">
                        {/* 左侧：辅助操作（复制 / 放弃） */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleCopyInlineResult(inlineAiResult)}
                            className={`group/copy relative w-8 h-8 inline-flex items-center justify-center rounded-lg text-[11px] font-bold cursor-pointer transition-all border ${
                              inlineAiCopied
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                                : 'bg-gray-50 hover:bg-gray-100 text-gray-700 dark:bg-white/5 dark:hover:bg-white/15 dark:text-white border-gray-200 dark:border-white/10'
                            }`}
                            title="复制 AI 生成的全部正文到剪贴板"
                            aria-label="复制结果"
                          >
                            {inlineAiCopied ? <Check size={14} /> : <Copy size={14} />}
                            {/* 悬停提示气泡（使用任意值避免被 .text-white 强制覆盖） */}
                            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-900 dark:bg-gray-700 text-[#fff] whitespace-nowrap opacity-0 group-hover/copy:opacity-100 transition-opacity shadow-md z-10">
                              {inlineAiCopied ? '已复制' : '复制'}
                            </span>
                          </button>
                          <button
                            onClick={() => { setInlineAiActive(false); setShowAiToolbar(false) }}
                            className="group/abort relative w-8 h-8 inline-flex items-center justify-center rounded-lg bg-gray-50 hover:bg-red-50 text-gray-700 hover:text-red-600 dark:bg-white/5 dark:hover:bg-red-500/15 dark:text-white dark:hover:text-red-400 border border-gray-200 dark:border-white/10 cursor-pointer transition-all"
                            title="放弃本次 AI 写作结果（不写入文档）"
                            aria-label="放弃"
                          >
                            <X size={14} />
                            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-900 dark:bg-gray-700 text-[#fff] whitespace-nowrap opacity-0 group-hover/abort:opacity-100 transition-opacity shadow-md z-10">
                              放弃
                            </span>
                          </button>
                        </div>

                        {/* 右侧：写入操作（插入 / 替换） */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleInsertBelowInline(inlineAiResult)}
                            className="group/insert relative w-8 h-8 inline-flex items-center justify-center rounded-lg bg-emerald-50 hover:bg-emerald-500 text-emerald-700 hover:text-white dark:bg-emerald-500/15 dark:hover:bg-emerald-500 dark:text-emerald-400 dark:hover:text-white border border-emerald-200 hover:border-emerald-500 dark:border-emerald-500/25 cursor-pointer transition-all"
                            title="在您选中的段落正下方插入 AI 生成的新正文"
                            aria-label="插入下方"
                          >
                            <CornerDownLeft size={14} />
                            <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-900 dark:bg-gray-700 text-[#fff] whitespace-nowrap opacity-0 group-hover/insert:opacity-100 transition-opacity shadow-md z-10">
                              插入下方
                            </span>
                          </button>
                          <button
                            onClick={() => handleReplaceSelectionInline(inlineAiResult)}
                            className="group/replace relative w-8 h-8 inline-flex items-center justify-center rounded-lg bg-accent-blue hover:bg-blue-600 text-[#fff] border border-accent-blue cursor-pointer transition-all shadow-sm"
                            title="直接用 AI 生成的结果覆盖替换您当前选中的文字"
                            aria-label="覆盖替换"
                          >
                            <RefreshCw size={14} />
                            <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-900 dark:bg-gray-700 text-[#fff] whitespace-nowrap opacity-0 group-hover/replace:opacity-100 transition-opacity shadow-md z-10">
                              覆盖替换
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* 初始 5 个便捷 AI 工具按钮栏 */
                  <div
                    className="fixed z-[100] flex items-center gap-0.5 bg-white/95 dark:bg-gray-950/95 text-gray-900 dark:text-white p-1 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 backdrop-blur-xl ai-prevent-deselect animate-scaleIn"
                    style={{
                      left: `${aiToolbarCoords.x}px`,
                      top: `${aiToolbarCoords.y}px`,
                      transform: 'translate(-50%, -100%)',
                    }}
                  >
                    <button onClick={() => handleAiAction('polish')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/15 text-[11px] font-bold cursor-pointer transition-colors" title="精修润色">
                      <Sparkles size={11} className="text-purple-600 dark:text-purple-400" />
                      润色
                    </button>
                    <button onClick={() => handleAiAction('summarize')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/15 text-[11px] font-bold cursor-pointer transition-colors" title="核心提炼">
                      总结
                    </button>
                    <div className="relative">
                      <button onClick={() => setShowTranslatePicker(v => !v)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/15 text-[11px] font-bold cursor-pointer transition-colors" title="翻译为指定语言（点击选择）">
                        翻译
                        <ChevronDown size={10} className="opacity-70" />
                      </button>
                      {showTranslatePicker && (
                        <>
                          <div className="fixed inset-0 z-[99]" onClick={() => setShowTranslatePicker(false)} />
                          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-[100] w-44 max-md:w-40 rounded-xl bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 shadow-2xl backdrop-blur-xl overflow-hidden animate-scaleIn p-1.5">
                            <div className="px-2 py-1 text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                              选择目标语言
                            </div>
                            {TRANSLATE_LANGS.map(lang => (
                              <button
                                key={lang.code}
                                onClick={() => handleTranslate(lang)}
                                className={`group/lang w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                                  lastTargetLang.code === lang.code
                                    ? 'bg-accent-blue/10 text-accent-blue dark:bg-accent-blue/20'
                                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10'
                                }`}
                              >
                                <span className="text-base leading-none">{lang.emoji}</span>
                                <span className="flex-1 text-left">{lang.label}</span>
                                {lastTargetLang.code === lang.code && (
                                  <Check size={11} className="text-accent-blue" />
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <button onClick={() => handleAiAction('extend')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/15 text-[11px] font-bold cursor-pointer transition-colors" title="逻辑续写">
                      续写
                    </button>
                    <button onClick={() => handleAiAction('explain')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/15 text-[11px] font-bold cursor-pointer transition-colors" title="解释概念">
                      解释
                    </button>
                  </div>
                )
              )}

              {/* 5. 飞书同款：智能写作侧边栏协助面板 (AI Copilot Sidebar Panel) */}
              {aiSidebarOpen && (
                <div className="w-80 lg:w-96 max-md:fixed max-md:inset-0 max-md:w-full max-md:z-50 max-md:animate-slideUp flex-shrink-0 border-l border-gray-200 dark:border-border max-md:border-l-0 bg-bg-sidebar max-md:bg-bg-card flex flex-col h-full ai-prevent-deselect animate-slideLeft">
                  {/* 头部 */}
                  <div className="p-4 border-b border-gray-200 dark:border-border bg-gray-50/50 dark:bg-transparent flex items-center justify-between select-none shrink-0">
                    <div className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-gray-100 text-xs">
                      <Sparkles size={14} className="text-purple-500 animate-pulse animate-duration-1000" />
                      <span>AI 智能写作协同助手</span>
                    </div>
                    <button onClick={() => { setAiSidebarOpen(false); setAiHistory([]) }} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-bg-card text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer transition-colors"><X size={14} /></button>
                  </div>

                  {/* 对话历史记录 */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4.5">
                    {aiHistory.length === 0 ? (
                      <div className="text-center py-20 text-gray-400 select-none">
                        <Sparkles size={28} className="mx-auto text-purple-400 opacity-40 mb-2.5 animate-bounce" />
                        <p className="text-xs font-bold text-gray-800 dark:text-gray-300">我是您的 AI 智能写作智囊</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 max-w-[80%] mx-auto leading-relaxed">
                          用鼠标在左边划词选中任何文本，即可一键呼唤我进行润色、总结或翻译！也可以直接在下方与我打字协同。
                        </p>
                      </div>
                    ) : (
                      aiHistory.map((h, i) => (
                        <div key={i} className={`flex flex-col ${h.role === 'user' ? 'items-end' : 'items-start'}`}>
                          <span className="text-[11px] text-gray-400 mb-1 font-semibold select-none">{h.role === 'user' ? '我的指令' : 'AI 协作草稿'}</span>
                          <div className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[90%] border shadow-sm ${
                            h.role === 'user'
                              ? 'bg-accent-blue/10 text-gray-900 dark:text-gray-100 border-accent-blue/15 rounded-tr-none font-semibold'
                              : 'bg-white dark:bg-bg-card text-gray-800 dark:text-gray-200 border-gray-150 dark:border-border/40 rounded-tl-none font-medium'
                          }`}>
                            <p className="whitespace-pre-wrap">{h.content}</p>
                            
                            {/* 如果是 AI 解答，提供"一键替换"和"一键追加"按钮 */}
                            {h.role === 'assistant' && (
                              <div className="mt-3.5 pt-2.5 border-t border-gray-100 dark:border-border/10 flex items-center gap-2 flex-wrap select-none">
                                <button
                                  onClick={() => handleReplaceSelection(h.content)}
                                  className="px-2.5 py-1.5 rounded bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/15 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                                  title="直接用此段回答替换您的划词选中区域"
                                >
                                  <ArrowRightLeft size={10} />
                                  替换选中
                                </button>
                                <button
                                  onClick={() => handleAppendToDoc(h.content)}
                                  className="px-2.5 py-1.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-bg-hover dark:hover:bg-bg-card border border-gray-200 dark:border-border/40 text-gray-600 dark:text-gray-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                                  title="在此篇文档的末尾追加此段内容"
                                >
                                  <CornerDownLeft size={10} />
                                  追加至文档末尾
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    
                    {aiLoading && (
                      <div className="flex flex-col items-start animate-pulse">
                        <span className="text-[11px] text-gray-400 mb-1">AI 写作智囊正在深度思考编写中...</span>
                        <div className="p-3.5 rounded-xl bg-purple-500/5 border border-purple-500/10 flex items-center gap-2 text-xs text-purple-500 font-bold">
                          <Loader2 size={13} className="animate-spin text-purple-500" />
                          正在协同生成文案，请稍等...
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 问答输入框（带自动关联的划词段落高亮标识，对标一流协作系统） */}
                  <div className="border-t border-gray-150 dark:border-border bg-gray-50/50 dark:bg-bg-card/30 p-3.5 flex flex-col gap-2 shrink-0">
                    {selectedText && (
                      <div className="px-3 py-1.5 bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-500/15 rounded-xl text-[11px] text-purple-600 dark:text-purple-400 font-bold flex items-center gap-1.5 select-none animate-slideDown max-w-full truncate shadow-sm">
                        <Sparkles size={11} className="text-purple-500 animate-pulse shrink-0" />
                        <span className="truncate flex-1">已关联选中的段落: "{selectedText}"</span>
                        <button 
                          type="button"
                          onClick={() => setSelectedText('')} 
                          className="p-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900 text-purple-400 hover:text-purple-600 transition-colors shrink-0 cursor-pointer"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    )}
                    <form onSubmit={handleSendAiMessage} className="flex items-center gap-2 w-full">
                      <input
                        type="text"
                        placeholder={selectedText ? "把这段改得更简练、更专业些..." : "直接向我发问，或帮我写个..."}
                        value={aiInput}
                        onChange={e => setAiInput(e.target.value)}
                        className="flex-1 h-9 px-3.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 font-semibold placeholder-gray-400 dark:placeholder-gray-500"
                      />
                      <button
                        type="submit"
                        disabled={aiLoading || !aiInput.trim()}
                        className="w-9 h-9 rounded-xl bg-accent-blue text-white flex items-center justify-center hover:bg-blue-600 disabled:opacity-40 transition-colors shadow-sm cursor-pointer shrink-0"
                      >
                        <Send size={14} />
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 select-none">
            <div className="text-center">
              <FileText size={48} className="mx-auto mb-3 opacity-30 text-accent-blue" />
              <p className="text-sm font-semibold">请从左侧栏选择文档开始深度阅读</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">或点击左侧加号直接建立新的在线云文档</p>
            </div>
          </div>
        )}
      </div>

      {/* ===== 模态框 1：新建页面对话框 ===== */}
      {showPageDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4 max-md:px-0" onClick={() => setShowPageDialog(false)}>
          <div className="bg-bg-card rounded-2xl max-md:rounded-none p-6 max-md:p-4 w-full max-w-sm max-md:max-w-full border border-gray-200 dark:border-border/50 shadow-2xl animate-scaleIn" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
              <FileText size={18} className="text-accent-blue" />
              创建在线云文档
            </h2>
            <input
              type="text"
              placeholder="请输入文档标题..."
              value={pageForm.title}
              onChange={e => setPageForm(prev => ({ ...prev, title: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && pageForm.title.trim()) handleCreatePage() }}
              className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-semibold"
              autoFocus
            />
            <div className="flex justify-end gap-2.5 mt-5">
              <button onClick={() => setShowPageDialog(false)} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 rounded-lg cursor-pointer font-semibold shadow-sm">放弃</button>
              <button onClick={handleCreatePage} disabled={!pageForm.title.trim()}
                className="px-4 py-2 text-xs bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-bold transition-colors cursor-pointer shadow-sm"
              >立即创建</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 模态框 2：删除页面/空间确认弹窗 ===== */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4 max-md:px-0" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-bg-card rounded-2xl max-md:rounded-none p-6 max-md:p-4 w-full max-w-sm max-md:max-w-full border border-gray-200 dark:border-border/50 shadow-2xl animate-scaleIn" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-2 text-gray-900 dark:text-gray-100 flex items-center gap-1">
              <ShieldAlert size={18} className="text-red-500" />
              确认彻底删除文档吗？
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
              确定要删除{showDeleteConfirm.type === 'space' ? '空间' : '文档'}「{showDeleteConfirm.name}」吗？
              {showDeleteConfirm.type === 'page' && '该文档下的所有子级级联文档、历史多版本快照也将被一并物理注销且不可寻回。'}
              此动作不可逆转。
            </p>
            <div className="flex justify-end gap-2.5">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 dark:border-border/30 rounded-lg cursor-pointer font-semibold">放弃</button>
              <button onClick={showDeleteConfirm.type === 'space' ? handleDeleteSpace : handleDeletePage}
                className="px-4 py-2 text-xs bg-red-500 text-[#fff] font-bold rounded-lg hover:bg-red-600 shadow-sm cursor-pointer"
              >确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 模态框 3：未保存确认离场弹窗 ===== */}
      {showUnsavedDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4 max-md:px-0" onClick={() => setShowUnsavedDialog(false)}>
          <div className="bg-bg-card rounded-2xl max-md:rounded-none p-6 max-md:p-4 w-full max-w-sm max-md:max-w-full border border-gray-200 dark:border-border/50 shadow-2xl animate-scaleIn" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-2 text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
              <Info size={18} className="text-amber-500" />
              检测到未保存内容
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
              您当前正在编辑的文档中存在尚未发布的临时草稿。直接离开将丢失最新的修改内容。
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => { setShowUnsavedDialog(false); pendingActionRef.current = null }}
                className="px-4 py-2 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 rounded-lg cursor-pointer font-semibold"
              >
                继续留在页面
              </button>
              <button
                onClick={() => {
                  setShowUnsavedDialog(false)
                  pendingActionRef.current?.()
                  pendingActionRef.current = null
                }}
                className="px-4 py-2 text-xs bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 border border-red-200 dark:border-red-500/20 rounded-lg font-semibold cursor-pointer shadow-sm"
              >
                放弃最新修改并离开
              </button>
              <button
                onClick={async () => {
                  setShowUnsavedDialog(false)
                  await savePageSilent()
                  pendingActionRef.current?.()
                  pendingActionRef.current = null
                }}
                className="px-4 py-2 text-xs bg-accent-blue text-white font-bold rounded-lg hover:bg-blue-600 cursor-pointer shadow-sm"
              >
                自动保存草稿并离去
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 飞书级全新模态框 4：分享与协作者权限管理 (Ultimate Redesigned Share & Permissions Modal) ===== */}
      {showShareModal && editingPage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center px-4 max-md:px-0" onClick={() => setShowShareModal(false)}>
          <div className="bg-bg-card rounded-2xl max-md:rounded-none w-full max-w-lg max-md:max-w-full max-md:h-full border border-gray-150 dark:border-border/50 shadow-2xl flex flex-col overflow-hidden max-h-[85vh] max-md:max-h-full animate-scaleIn" onClick={e => e.stopPropagation()}>
            {/* 头 */}
            <div className="flex items-center justify-between px-6 max-md:px-4 py-4 border-b border-gray-150 dark:border-border/15 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center text-accent-blue">
                  <Share2 size={16} />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">分享文档与协作者管理</h3>
              </div>
              <button onClick={() => setShowShareModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-hover text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"><X size={16} /></button>
            </div>

            {/* 模态框主体 */}
            <div className="flex-1 overflow-y-auto p-6 max-md:p-4 space-y-6">
              {/* 模块 1：一键外链公开分享区 */}
              <div className="space-y-3.5 pb-5 border-b border-gray-150 dark:border-border/15">
                <span className="text-xs font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
                  <Globe size={14} className="text-accent-blue" />
                  外链共享
                </span>

                <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50 dark:bg-bg-hover/10 border border-gray-150 dark:border-border/20 transition-all hover:bg-gray-100/30 dark:hover:bg-bg-hover/20">
                  <div className="min-w-0 pr-4">
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200 block">开启公开分享外链</span>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                      启用后，整空间将可以通过特定的文档链接向互联网公开，任何访客在无需登录的情况下均具有该文档只读权限。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextPublic = !isSpacePublic
                      setIsSpacePublic(nextPublic)
                      await syncShareConfig(nextPublic, usePassword, sharePassword, expireMode, shareExpiresAt)
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isSpacePublic ? 'bg-accent-blue' : 'bg-gray-300 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        isSpacePublic ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {isSpacePublic && (
                  <div className="space-y-4.5 bg-gray-50/50 dark:bg-bg-hover/5 p-4 rounded-xl border border-gray-150 dark:border-border/10 animate-slideDown">
                    {/* 分享访问范围选择 */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1.5">共享访问范围</label>
                      <SearchableSelect
                        options={[
                          { value: 'space', label: '整知识库空间所有文档' },
                          { value: 'descendants', label: '当前页及所有子文档' },
                          { value: 'single', label: '仅当前文档页面' },
                        ]}
                        value={shareScope}
                        onChange={(v) => setShareScope((v === null ? 'space' : String(v)) as any)}
                      />
                    </div>

                    {/* 链接有效期配置 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 border-t border-gray-150 dark:border-border/10 pt-3">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1.5">链接有效期</label>
                        <SearchableSelect
                          options={[
                            { value: 'permanent', label: '永久有效' },
                            { value: 'custom', label: '设置到期时间' },
                          ]}
                          value={expireMode}
                          onChange={async (v) => {
                            const val = (v === null ? 'permanent' : String(v)) as 'permanent' | 'custom'
                            setExpireMode(val)
                            let nextExpire = shareExpiresAt
                            if (val === 'permanent') {
                              nextExpire = ''
                              setShareExpiresAt('')
                            }
                            await syncShareConfig(isSpacePublic, usePassword, sharePassword, val, nextExpire)
                          }}
                        />
                      </div>

                      {expireMode === 'custom' ? (
                        <div className="animate-slideDown">
                          <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1"><Clock size={12} /> 共享到期时间</label>
                          <input
                            type="datetime-local"
                            value={shareExpiresAt}
                            onChange={e => setShareExpiresAt(e.target.value)}
                            onBlur={async () => {
                              await syncShareConfig(isSpacePublic, usePassword, sharePassword, expireMode, shareExpiresAt)
                            }}
                            style={{ colorScheme: resolvedTheme }}
                            className="w-full px-2.5 py-1 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-xs text-gray-700 dark:text-gray-200 outline-none focus:border-accent-blue font-semibold font-mono"
                          />
                        </div>
                      ) : (
                        <div className="animate-slideDown">
                          <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1"><Clock size={12} /> 有效期状态</label>
                          <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 shadow-sm h-[30px]">
                            <Check size={12} />
                            链接永久有效
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 密码保护控制 */}
                    <div className="pt-2 border-t border-gray-200 dark:border-border/10 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><Key size={12} /> 启用共享提取密码</span>
                        <button
                          type="button"
                          onClick={async () => {
                            const nextUsePass = !usePassword
                            setUsePassword(nextUsePass)
                            // 如果是启用密码且当前密码为空，先随机生成一个再同步
                            let passwordToUse = sharePassword
                            if (nextUsePass && !passwordToUse.trim()) {
                              // 随机生成一个 4 位密码
                              const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                              let res = ''
                              for (let i = 0; i < 4; i++) res += chars[Math.floor(Math.random() * chars.length)]
                              passwordToUse = res
                              setSharePassword(res)
                            }
                            await syncShareConfig(isSpacePublic, nextUsePass, passwordToUse, expireMode, shareExpiresAt)
                          }}
                          className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            usePassword ? 'bg-accent-blue' : 'bg-gray-300 dark:bg-gray-750'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              usePassword ? 'translate-x-3' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      {usePassword && (
                        <div className="flex gap-2 items-center animate-slideDown">
                          <input
                            type="text"
                            placeholder="请输入 4 位提取密码..."
                            value={sharePassword}
                            onChange={e => setSharePassword(e.target.value)}
                            onBlur={async () => {
                              // 只有密码不为空时才同步
                              if (sharePassword.trim()) {
                                await syncShareConfig(isSpacePublic, usePassword, sharePassword, expireMode, shareExpiresAt)
                              }
                            }}
                            onKeyDown={async e => {
                              if (e.key === 'Enter' && sharePassword.trim()) {
                                await syncShareConfig(isSpacePublic, usePassword, sharePassword, expireMode, shareExpiresAt)
                              }
                            }}
                            className="flex-1 px-3 py-1.5 rounded-xl bg-white dark:bg-bg-input border border-gray-200 dark:border-border/60 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue font-mono font-bold tracking-widest text-center"
                            maxLength={10}
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              // 随机生成一个 4 位纯数字/大写字母密码作为示例提取码
                              const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                              let res = ''
                              for (let i = 0; i < 4; i++) res += chars[Math.floor(Math.random() * chars.length)]
                              setSharePassword(res)
                              await syncShareConfig(isSpacePublic, usePassword, res, expireMode, shareExpiresAt)
                            }}
                            className="p-1 px-2.5 h-[28px] text-[11px] bg-bg-hover hover:bg-gray-200 dark:hover:bg-bg-card border border-gray-200 dark:border-border/40 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg cursor-pointer font-bold"
                          >
                            随机生成
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 保存与复制外链 */}
                    <div className="flex gap-2.5 pt-3 border-t border-gray-200 dark:border-border/10 justify-end">
                      <button
                        onClick={handleCopyShareLink}
                        className="px-3.5 py-2 bg-accent-blue text-white rounded-xl hover:bg-blue-600 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold shrink-0 shadow-sm"
                      >
                        <Copy size={13} />
                        复制外链
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 模块 2：成员协作者授权新增区 - 飞书风格组织架构选择器 */}
              <div className="space-y-3.5 pb-5 border-b border-gray-150 dark:border-border/15">
                <span className="text-xs font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
                  <Users size={14} className="text-emerald-500" />
                  新增协作者
                </span>

                <div className="bg-gray-50/50 dark:bg-bg-hover/5 rounded-xl border border-gray-150 dark:border-border/10 shadow-sm animate-slideDown overflow-hidden">
                  {/* 搜索栏 */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200/60 dark:border-border/40 bg-white dark:bg-bg-card">
                    <Search size={14} className="text-gray-400 dark:text-gray-500 shrink-0" />
                    <input
                      type="text"
                      value={collabSearch}
                      onChange={e => setCollabSearch(e.target.value)}
                      placeholder="搜索成员或部门..."
                      className="bg-transparent text-sm text-gray-800 dark:text-gray-300 outline-none flex-1 placeholder-gray-400 dark:placeholder-gray-600"
                    />
                    {collabSearch && (
                      <button onClick={() => setCollabSearch('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* 主体：左侧部门树 + 右侧成员列表 */}
                  <div className="flex min-h-[200px] max-h-[280px]">
                    {/* 左侧：部门树 */}
                    <div className="w-[200px] shrink-0 border-r border-gray-200/60 dark:border-border/40 overflow-y-auto bg-white dark:bg-bg-card/50">
                      {departmentTree.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                          <Building2 size={22} className="opacity-40 mb-2" />
                          <span className="text-xs">暂无部门</span>
                        </div>
                      ) : (
                        <div className="py-1">
                          {departmentTree.map(node => (
                            <CollabDeptNode
                              key={node.id}
                              node={node}
                              selectedDeptId={selectedDeptId}
                              level={0}
                              onSelect={(id) => {
                                setSelectedDeptId(prev => prev === id ? null : id)
                                if (id !== selectedDeptId) loadDeptUsers(id)
                                else setDeptUsers([])
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 右侧：成员列表 / 搜索结果 */}
                    <div className="flex-1 overflow-y-auto bg-gray-50/30 dark:bg-bg-hover/5">
                      {collabSearch.trim() ? (
                        <CollabSearchResults
                          search={collabSearch}
                          allUsers={allUsersList}
                          departmentTree={departmentTree}
                          onAdd={handleAddCollaborator}
                          permission={selectedPermission}
                        />
                      ) : selectedDeptId ? (
                        <CollabDeptMembers
                          deptId={selectedDeptId}
                          departmentTree={departmentTree}
                          deptUsers={deptUsers}
                          onAdd={handleAddCollaborator}
                          permission={selectedPermission}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8">
                          <Building2 size={24} className="opacity-30 mb-2" />
                          <span className="text-xs">选择左侧部门浏览成员</span>
                          <span className="text-[11px] mt-1">或使用顶部搜索</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 底部：权限选择 */}
                  <div className="flex items-center gap-3 px-3 py-2.5 border-t border-gray-200/60 dark:border-border/40 bg-white dark:bg-bg-card">
                    <span className="text-[11px] font-bold text-gray-600 dark:text-gray-400 shrink-0">赋予角色</span>
                    <div className="flex-1">
                      <SearchableSelect
                        options={[
                          { value: 'viewer', label: '查看者 (只读)' },
                          { value: 'editor', label: '编辑者 (可写)' },
                          { value: 'admin', label: '管理员 (统筹)' },
                        ]}
                        value={selectedPermission}
                        onChange={(v) => setSelectedPermission((v === null ? 'viewer' : String(v)) as any)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 模块 3：当前授权协作者列表管理区 */}
              <div className="space-y-3.5">
                <span className="text-xs font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5">
                  <Shield size={14} className="text-amber-500" />
                  已授权协作者 ({collaborators.length})
                </span>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {loadingCollaborators ? (
                    <div className="text-center py-6 text-gray-400 flex items-center justify-center gap-1.5">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">正在刷新权限名单...</span>
                    </div>
                  ) : collaborators.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">暂无协作者，当前仅空间所有者具有编辑权限</p>
                  ) : (
                    collaborators.map(p => {
                      let displayName = p.subject_name || p.subject_username || `${p.subject_type === 'department' ? '部门' : p.subject_type === 'group' ? '用户组' : '用户'} #${p.subject_id}`
                      let details = ''
                      if (p.subject_type === 'user') {
                        details = p.subject_username ? `@${p.subject_username}` : ''
                      } else if (p.subject_type === 'department') {
                        details = '整个部门'
                      } else {
                        details = '用户组'
                      }

                      return (
                        <div key={p.id} className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50 dark:bg-bg-hover/15 border border-gray-150 dark:border-border/20 text-xs">
                          <div className="flex items-center gap-3 min-w-0">
                            {p.subject_type === 'department' ? (
                              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 flex items-center justify-center shrink-0">
                                <Building2 size={14} className="text-amber-500" />
                              </div>
                            ) : p.subject_type === 'group' ? (
                              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 flex items-center justify-center shrink-0">
                                <Users size={14} className="text-emerald-500" />
                              </div>
                            ) : (
                              <div className={`w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-[11px] font-bold border shrink-0 ${getAvatarColor(displayName)}`}>
                                {displayName[0].toUpperCase()}
                              </div>
                            )}

                            <div className="min-w-0">
                              <span className="text-gray-800 dark:text-gray-200 font-bold block truncate">{displayName}</span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono block mt-0.5">{details}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                              p.permission === 'admin'
                                ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                : p.permission === 'editor'
                                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                : 'bg-gray-50 dark:bg-gray-500/10 text-gray-500 dark:text-gray-400'
                            }`}>
                              {p.permission === 'admin' ? '空间管理员' : p.permission === 'editor' ? '协作者' : '只读查看者'}
                            </span>

                            {/* 移除 */}
                            <button
                              onClick={() => handleRemoveCollaborator(p.id)}
                              className="p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
                              title="解除协作者特权"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* 脚 */}
            <div className="px-6 max-md:px-4 py-4 border-t border-gray-150 dark:border-border/15 shrink-0 bg-gray-50/50 dark:bg-bg-hover/10 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="px-4 py-2 rounded-lg bg-bg-hover hover:bg-gray-200 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-border/30 transition-colors cursor-pointer font-semibold shadow-sm"
              >
                关闭协同配置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
