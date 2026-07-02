import {
  Briefcase, Calendar, Clock, BookOpen,
  FileText, Users, UsersRound, LayoutDashboard,
  Share2, BarChart3, Home, Layers, Calculator, CheckSquare, RefreshCw, MessageSquarePlus,
  Wallet, Stamp, CalendarDays, ClipboardList, type LucideIcon,
} from 'lucide-react'

export interface MenuItem {
  to: string
  label: string
  icon: LucideIcon
  gradientFrom: string
  gradientTo: string
  permission?: string
  adminOnly?: boolean
}

export interface MenuCategory {
  id: string
  title: string
  icon: LucideIcon
  iconTone: 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'gray' | 'cyan' | 'red' | 'indigo'
  items: MenuItem[]
}

/** 业务前台菜单分类（系统管理已移至 /admin/* 管理后台） */
export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'workbench',
    title: '工作台',
    icon: Home,
    iconTone: 'blue',
    items: [
      { to: '/oa',         label: 'OA 办公',   icon: CalendarDays,   gradientFrom: '#8B5CF6', gradientTo: '#A78BFA' },
      { to: '/dashboard',  label: '数据看板',   icon: LayoutDashboard, gradientFrom: '#3B82F6', gradientTo: '#06B6D4', permission: 'dashboard:read' },
      { to: '/reports',    label: '日报周报',   icon: BookOpen,        gradientFrom: '#10B981', gradientTo: '#34D399', permission: 'report:read' },
      { to: '/team',       label: '团队管理',   icon: UsersRound,      gradientFrom: '#8B5CF6', gradientTo: '#EC4899', permission: 'user:read' },
      { to: '/meetings',   label: '会议纪要',   icon: Calendar,        gradientFrom: '#06B6D4', gradientTo: '#22D3EE', permission: 'meeting:read' },
      { to: '/approvals',  label: '我的待办',   icon: CheckSquare,     gradientFrom: '#F59E0B', gradientTo: '#F97316' },
      { to: '/tasks',      label: '定时任务',   icon: Clock,           gradientFrom: '#8B5CF6', gradientTo: '#C084FC', permission: 'task:read' },
    ],
  },
  {
    id: 'business',
    title: '业务管理',
    icon: Briefcase,
    iconTone: 'orange',
    items: [
      { to: '/projects',      label: '项目管理',   icon: Briefcase,  gradientFrom: '#F59E0B', gradientTo: '#FBBF24', permission: 'project:read' },
      { to: '/project-costs', label: '成本利润',   icon: BarChart3,  gradientFrom: '#10B981', gradientTo: '#14B8A6', permission: 'project:read' },
      { to: '/upstream',      label: '上游管理',   icon: Layers,     gradientFrom: '#3B82F6', gradientTo: '#06B6D4', permission: 'upstream:read' },
      { to: '/reconcile',      label: '财务对账',   icon: Calculator,  gradientFrom: '#8B5CF6', gradientTo: '#6366F1', permission: 'reconcile:read' },
      { to: '/model-changes',  label: '模型变更',   icon: RefreshCw,   gradientFrom: '#F59E0B', gradientTo: '#EF4444', permission: 'model:read' },
      { to: '/customers',     label: '客户管理',   icon: Users,      gradientFrom: '#EC4899', gradientTo: '#F472B6', permission: 'customer:read' },
      { to: '/contracts',     label: '合同管理',   icon: FileText,   gradientFrom: '#06B6D4', gradientTo: '#14B8A6', permission: 'contract:read' },
      { to: '/payments',      label: '付款申请',   icon: Wallet,     gradientFrom: '#10B981', gradientTo: '#059669', permission: 'payment:view_all' },
      { to: '/seals',         label: '盖章申请',   icon: Stamp,      gradientFrom: '#EF4444', gradientTo: '#F97316', permission: 'seal:view_all' },
      { to: '/quotes',        label: '报价工具',   icon: ClipboardList, gradientFrom: '#0EA5E9', gradientTo: '#38BDF8', permission: 'quote:view' },
    ],
  },
  {
    id: 'collab',
    title: '协作',
    icon: Share2,
    iconTone: 'cyan',
    items: [
      { to: '/wiki',   label: '在线文档', icon: BookOpen, gradientFrom: '#6366F1', gradientTo: '#3B82F6', permission: 'wiki:read' },
      { to: '/shared', label: '我的分享', icon: Share2,   gradientFrom: '#6366F1', gradientTo: '#8B5CF6', permission: 'share:read' },
      { to: '/feedback', label: '意见反馈', icon: MessageSquarePlus, gradientFrom: '#3B82F6', gradientTo: '#06B6D4' },
    ],
  },
]
