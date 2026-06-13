import {
  Briefcase, Calendar, Settings, Clock, BookOpen,
  FileText, Users, Shield, LayoutDashboard, Activity, Database,
  Share2, BarChart3, Home, Building2, Network, Calculator, type LucideIcon,
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
  iconTone: 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'gray' | 'cyan' | 'red'
  items: MenuItem[]
}

/** 4 大分类（AI 中心已上移到 L1 顶部卡 + 右下角 FAB，不再列入） */
export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'workbench',
    title: '工作台',
    icon: Home,
    iconTone: 'blue',
    items: [
      { to: '/dashboard', label: '数据看板', icon: LayoutDashboard, gradientFrom: '#3B82F6', gradientTo: '#06B6D4', permission: 'dashboard:read' },
      { to: '/reports',   label: '日报周报', icon: BookOpen,         gradientFrom: '#10B981', gradientTo: '#34D399', permission: 'report:read' },
      { to: '/meetings',  label: '会议纪要', icon: Calendar,         gradientFrom: '#06B6D4', gradientTo: '#22D3EE', permission: 'meeting:read' },
      { to: '/tasks',     label: '定时任务', icon: Clock,            gradientFrom: '#8B5CF6', gradientTo: '#C084FC', permission: 'task:read' },
    ],
  },
  {
    id: 'business',
    title: '业务管理',
    icon: Briefcase,
    iconTone: 'orange',
    items: [
      { to: '/projects',  label: '项目管理', icon: Briefcase, gradientFrom: '#F59E0B', gradientTo: '#FBBF24', permission: 'project:read' },
      { to: '/project-costs', label: '成本利润', icon: BarChart3, gradientFrom: '#10B981', gradientTo: '#14B8A6', permission: 'project:read' },
      { to: '/suppliers', label: '供应商管理', icon: Building2, gradientFrom: '#3B82F6', gradientTo: '#06B6D4', permission: 'project:read' },
      { to: '/channels',  label: '通道管理',   icon: Network,   gradientFrom: '#06B6D4', gradientTo: '#0EA5E9', permission: 'project:read' },
      { to: '/reconcile', label: '对账核算',   icon: Calculator, gradientFrom: '#8B5CF6', gradientTo: '#6366F1', permission: 'project:read' },
      { to: '/customers', label: '客户管理', icon: Users,     gradientFrom: '#EC4899', gradientTo: '#F472B6', permission: 'customer:read' },
      { to: '/contracts', label: '合同管理', icon: FileText,  gradientFrom: '#06B6D4', gradientTo: '#14B8A6', permission: 'contract:read' },
    ],
  },
  {
    id: 'collab',
    title: '协作',
    icon: Share2,
    iconTone: 'cyan',
    items: [
      { to: '/wiki',    label: '在线文档', icon: BookOpen, gradientFrom: '#6366F1', gradientTo: '#3B82F6', permission: 'wiki:read' },
      { to: '/shared',  label: '我的分享', icon: Share2,   gradientFrom: '#6366F1', gradientTo: '#8B5CF6', permission: 'share:read' },
    ],
  },
  {
    id: 'system',
    title: '系统管理',
    icon: Settings,
    iconTone: 'gray',
    items: [
      { to: '/console',  label: '管理总览', icon: BarChart3, gradientFrom: '#F97316', gradientTo: '#FBBF24', permission: 'management:console', adminOnly: true },
      { to: '/users',    label: '用户管理', icon: Shield,    gradientFrom: '#EF4444', gradientTo: '#F87171', permission: 'user:read',          adminOnly: true },
      { to: '/monitor',  label: '运维监控', icon: Activity,  gradientFrom: '#10B981', gradientTo: '#14B8A6', permission: 'monitor:read',       adminOnly: true },
      { to: '/data',     label: '数据管理', icon: Database,  gradientFrom: '#6366F1', gradientTo: '#8B5CF6', permission: 'data:export',        adminOnly: true },
      { to: '/settings', label: '系统设置', icon: Settings,  gradientFrom: '#6B7280', gradientTo: '#9CA3AF' },
    ],
  },
]
