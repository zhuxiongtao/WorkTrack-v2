import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  FileText, BookOpen, Key, Calendar, Sun, Moon,
  ChevronRight, ChevronDown, Loader2, Clock, Info, Check, UserCheck
} from 'lucide-react'
import { useToast } from '../contexts/ToastContext'
import { useTheme } from '../contexts/ThemeContext'
import RichTextEditor from '../components/RichTextEditor'
import TocPanel from '../components/TocPanel'

interface PublicPageTreeNode {
  id: number
  title: string
  parent_id: number | null
  sort_order: number
  children: PublicPageTreeNode[]
}

interface PublicPageDetail {
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
}

export default function PublicWikiPage() {
  const { spaceId: spaceIdStr, pageId: pageIdStr } = useParams<{ spaceId: string, pageId: string }>()
  const [searchParams] = useSearchParams()
  const spaceId = spaceIdStr ? parseInt(spaceIdStr, 10) : null
  const initialPageId = pageIdStr ? parseInt(pageIdStr, 10) : null
  const scope = searchParams.get('scope') || 'space'

  const [activePageId, setActivePageId] = useState<number | null>(initialPageId)
  const { theme, toggle: toggleTheme } = useTheme()
  const { toast: showToast } = useToast()

  // 提取密码与失效状态控制
  const [password, setPassword] = useState<string>(() => sessionStorage.getItem(`wiki_pass_${spaceId}`) || '')
  const [inputPass, setInputPass] = useState('')
  const [passRequired, setPassRequired] = useState(false)
  const [isExpired, setIsExpired] = useState(false)
  const [verifying, setVerifying] = useState(false)

  // 页面内容
  const [pageTree, setPageTree] = useState<PublicPageTreeNode[]>([])
  const [pageDetail, setPageDetail] = useState<PublicPageDetail | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  // 获取页面树结构
  const loadPageTree = useCallback(async (pwd?: string) => {
    if (!spaceId) return
    setTreeLoading(true)
    const currentPass = pwd !== undefined ? pwd : password
    
    let queryParts = []
    if (currentPass) queryParts.push(`password=${currentPass}`)
    if (initialPageId) queryParts.push(`page_id=${initialPageId}`)
    if (scope) queryParts.push(`scope=${scope}`)
    
    const url = `/api/v1/wiki/public/spaces/${spaceId}/pages` + (queryParts.length ? `?${queryParts.join('&')}` : '')
    try {
      const res = await fetch(url)
      if (res.status === 401) {
        setPassRequired(true)
        setTreeLoading(false)
        return
      }
      if (res.status === 410) {
        setIsExpired(true)
        setTreeLoading(false)
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setPageTree(Array.isArray(data) ? data : [])
      setPassRequired(false)
    } catch {
      setPageTree([])
    } finally {
      setTreeLoading(false)
    }
  }, [spaceId, password, initialPageId, scope])

  // 获取特定文档详情
  const loadPageDetail = useCallback(async (pid: number, pwd?: string) => {
    setDetailLoading(true)
    const currentPass = pwd !== undefined ? pwd : password
    
    let queryParts = []
    if (currentPass) queryParts.push(`password=${currentPass}`)
    if (initialPageId) queryParts.push(`shared_page_id=${initialPageId}`)
    if (scope) queryParts.push(`scope=${scope}`)
    
    const url = `/api/v1/wiki/public/pages/${pid}` + (queryParts.length ? `?${queryParts.join('&')}` : '')
    try {
      const res = await fetch(url)
      if (res.status === 401) {
        setPassRequired(true)
        setDetailLoading(false)
        return
      }
      if (res.status === 410) {
        setIsExpired(true)
        setDetailLoading(false)
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setPageDetail(data)
      setPassRequired(false)
    } catch {
      setPageDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }, [password, initialPageId, scope])

  // 初始化拉取
  useEffect(() => {
    if (spaceId) {
      loadPageTree()
    }
  }, [spaceId, loadPageTree])

  useEffect(() => {
    if (activePageId && !passRequired && !isExpired) {
      loadPageDetail(activePageId)
    }
  }, [activePageId, passRequired, isExpired, loadPageDetail])

  // 提交提取码校验
  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputPass.trim() || !spaceId) return
    setVerifying(true)
    try {
      const res = await fetch(`/api/v1/wiki/public/spaces/${spaceId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: inputPass.trim() })
      })
      if (res.status === 410) {
        setIsExpired(true)
        return
      }
      if (!res.ok) {
        showToast('提取密码错误，请重新输入', 'error')
        return
      }
      // 成功，将密码存储于 sessionStorage 避免刷新丢失
      sessionStorage.setItem(`wiki_pass_${spaceId}`, inputPass.trim())
      setPassword(inputPass.trim())
      setPassRequired(false)
      showToast('提取成功', 'success')
      // 触发数据加载
      loadPageTree(inputPass.trim())
      if (activePageId) loadPageDetail(activePageId, inputPass.trim())
    } catch {
      showToast('密码校验失败', 'error')
    } finally {
      setVerifying(false)
    }
  }

  // ===== Tree 递归渲染 =====
  const TreeNode = ({ node, depth = 0 }: { node: PublicPageTreeNode; depth?: number }) => {
    const [expanded, setExpanded] = useState(true)
    const hasChildren = node.children.length > 0

    return (
      <div className="select-none">
        <div
          className={`flex items-center gap-1.5 py-2 px-2.5 rounded-lg cursor-pointer hover:bg-gray-150 dark:hover:bg-bg-hover group text-xs font-semibold ${
            activePageId === node.id ? 'bg-accent-blue/10 text-accent-blue font-bold shadow-sm' : 'text-gray-700 dark:text-gray-300'
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => {
            setActivePageId(node.id)
            loadPageDetail(node.id)
          }}
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
        </div>
        {expanded && hasChildren && node.children.map(child => (
          <TreeNode key={child.id} node={child} depth={depth + 1} />
        ))}
      </div>
    )
  }

  // 1. 链接失效页面
  if (isExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-bg-main text-gray-800 dark:text-gray-100 p-4">
        <div className="w-full max-w-md bg-white dark:bg-bg-card border border-gray-150 dark:border-border p-8 rounded-2xl shadow-xl text-center space-y-4 animate-scaleIn">
          <Clock size={48} className="mx-auto text-red-500 animate-pulse" />
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-gray-100">共享链接已失效</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            由于该在线文档空间的共享期限已到期，此共享页面已自动失效销毁。如有疑问请联系创建人重新授权。
          </p>
        </div>
      </div>
    )
  }

  // 2. 提取码验证页面
  if (passRequired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-bg-main text-gray-800 dark:text-gray-100 p-4">
        <div className="w-full max-w-sm bg-white dark:bg-bg-card border border-gray-150 dark:border-border p-6 rounded-2xl shadow-xl space-y-4 animate-scaleIn">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 flex items-center justify-center text-accent-blue shrink-0">
              <Key size={16} />
            </div>
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100">加密文档空间提取</h3>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            该在线文档已被创建者设为私密加密共享。请输入 4 位或自定义提取码以解锁访问权限。
          </p>
          <form onSubmit={handleVerifyPassword} className="space-y-3.5">
            <input
              type="text"
              placeholder="请输入提取码/共享密码"
              value={inputPass}
              onChange={e => setInputPass(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-bg-input border border-gray-200 dark:border-border/60 text-sm text-center tracking-widest font-mono text-gray-800 dark:text-gray-100 outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/15 transition-all placeholder-gray-400 dark:placeholder-gray-600 font-bold"
              maxLength={20}
              autoFocus
            />
            <button
              type="submit"
              disabled={verifying || !inputPass.trim()}
              className="w-full py-2.5 bg-accent-blue text-white text-xs font-bold rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1 cursor-pointer shadow-sm"
            >
              {verifying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              确认提取文档
            </button>
          </form>
        </div>
      </div>
    )
  }

  // 3. 正常文档渲染主视图
  return (
    <div className="min-h-screen max-h-screen h-screen flex overflow-hidden bg-white dark:bg-bg-card text-gray-800 dark:text-gray-100 font-sans">
      {/* 左侧公共层级目录树 */}
      <div className="w-56 lg:w-64 border-r border-gray-150 dark:border-border bg-gray-50 dark:bg-bg-sidebar flex flex-col shrink-0 select-none">
        <div className="p-4 border-b border-gray-150 dark:border-border bg-gray-100/50 dark:bg-transparent">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-accent-blue shrink-0 animate-pulse" />
            <h2 className="font-bold text-gray-900 dark:text-gray-200 text-sm truncate flex-1">公开文档空间</h2>
          </div>
        </div>

        {/* 目录树树列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {treeLoading ? (
            <div className="flex justify-center py-12"><Loader2 size={16} className="animate-spin text-accent-blue" /></div>
          ) : pageTree.length === 0 ? (
            <p className="text-[10px] text-gray-400 text-center py-8 italic">空间内暂无公开文档</p>
          ) : (
            pageTree.map(node => <TreeNode key={node.id} node={node} />)
          )}
        </div>
      </div>

      {/* 右侧核心文档主视图区 */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg-card">
        {/* 顶栏控制栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-shrink-0 bg-bg-card backdrop-blur select-none">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={15} className="text-accent-blue flex-shrink-0" />
            <span className="text-sm font-bold text-gray-900 dark:text-gray-200 truncate">{pageDetail?.title || '无标题文档'}</span>
          </div>

          {/* 切换主题 */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-bg-card text-gray-400 hover:text-gray-800 transition-colors cursor-pointer border border-transparent hover:border-gray-200 dark:hover:border-border/10 shadow-sm"
            title={theme === 'dark' ? '进入浅色呼吸模式' : '进入护眼深色模式'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>

        {/* 文档内容呈现 */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 lg:p-12 relative flex">
          {pageDetail ? (
            <>
              {/* 大纲悬浮目录 */}
              <TocPanel html={pageDetail.content} inline />

              {/* 正文和标题 */}
              <div className="flex-1 max-w-3xl mx-auto space-y-6">
                <div className="border-b border-gray-150 dark:border-border pb-4 select-none">
                  <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight leading-tight mb-3">
                    {pageDetail.title || '无标题文档'}
                  </h1>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      <span>{pageDetail.updated_at ? `更新于 ${new Date(pageDetail.updated_at).toLocaleDateString('zh-CN')}` : '刚刚'}</span>
                    </span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <UserCheck size={12} className="text-emerald-500" />
                      <span>
                        作者：{pageDetail.creator_name || '未知'}
                        {pageDetail.editor_names && pageDetail.editor_names.length > 1 && (
                          <span className="ml-3 pl-3 border-l border-gray-200 dark:border-border/30 text-gray-500 dark:text-gray-400 font-normal">
                            协作：{pageDetail.editor_names.filter(name => name !== pageDetail.creator_name).join('、')}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-50 dark:bg-accent-blue/10 text-blue-600 dark:text-blue-400 font-bold border border-blue-200 dark:border-accent-blue/20">
                      <Info size={11} /> 访客只读
                    </span>
                  </div>
                </div>

                <div className="pb-16">
                  <RichTextEditor
                    value={pageDetail.content}
                    onChange={() => {}}
                    className="!rounded-none !border-0 !bg-transparent min-h-[500px]"
                    readOnly={true} // 外链访问强制设为只读
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 select-none">
              {detailLoading ? (
                <div className="text-center space-y-1">
                  <Loader2 size={24} className="animate-spin text-accent-blue mx-auto" />
                  <p className="text-xs">加载内容中...</p>
                </div>
              ) : (
                <div className="text-center">
                  <FileText size={48} className="mx-auto opacity-30 text-accent-blue mb-2" />
                  <p className="text-sm font-semibold">请从左侧栏选择文档以展开深度阅读</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
