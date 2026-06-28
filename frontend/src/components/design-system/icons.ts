/**
 * 图标语义注册表
 *
 * 用法：把业务概念映射到具体的 Lucide 图标 + tone，避免每个页面各自选
 * 替换所有 17+ 处内联 emoji 的工作从这里开始
 */
import {
  // 业务概念
  MessageSquare, Sparkles, ListChecks, BarChart3, Cpu, Briefcase,
  Calendar, BookOpen, FileText, Users, Shield, Database,
  LayoutDashboard, Share2, Activity, Settings, Clock, Brain, Eye, Mic,
  // 操作
  Plus, X, Save, Trash2, Loader2, Edit3, RotateCcw, Search, Filter, RefreshCw,
  ChevronDown, ChevronRight, ChevronUp, ArrowRight, ArrowUp, ArrowDown,
  Send, Check, Copy, Download, Upload, Key, EyeOff, LogOut, Sliders,
  // 状态
  AlertTriangle, AlertCircle, CheckCircle2, CheckCircle, Info, XCircle, Circle,
  // 装饰
  Layers, Hash, Tag, Link2, ExternalLink, Pin, Cloud, Server, HardDrive,
  TrendingUp, TrendingDown, Target, Zap, Pencil, Mail, Phone, MapPin,
  Globe, Image, ImageIcon, FileAudio, FileCheck, FileJson, ScrollText,
  User, UserCheck, UserX, UserPlus, UserCog, UserCircle2, Crown, Lock,
  Building2, FolderTree, ShieldAlert, ShieldCheck, KeyRound, Move, Ban,
  PanelLeftClose, PanelLeft, Home, Headphones, Sun, Moon, Menu, Monitor,
  // 媒体/数据
  Compass, Maximize2, Minimize2, Square, Play, Pause, MicOff, CreditCard,
  // AI 能力
  Wand2, Code2, Lightbulb, Terminal, Palette, Package,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Tone } from '../../theme/tokens'

/**
 * 业务域图标（用于导航/分类）
 */
export const APP_ICONS = {
  // 工作台
  dashboard: { icon: LayoutDashboard, tone: 'blue' as Tone },
  reports:   { icon: BookOpen,        tone: 'green' as Tone },
  meetings:  { icon: Calendar,        tone: 'cyan' as Tone },
  tasks:     { icon: Clock,           tone: 'purple' as Tone },
  // 业务管理
  projects:  { icon: Briefcase,       tone: 'orange' as Tone },
  customers: { icon: Users,           tone: 'pink' as Tone },
  contracts: { icon: FileText,        tone: 'cyan' as Tone },
  // 协作
  wiki:      { icon: BookOpen,        tone: 'blue' as Tone },
  shared:    { icon: Share2,          tone: 'purple' as Tone },
  // 智能
  ai:        { icon: Sparkles,        tone: 'purple' as Tone },
  // 系统
  console:   { icon: BarChart3,       tone: 'orange' as Tone },
  users:     { icon: Shield,          tone: 'red' as Tone },
  monitor:   { icon: Activity,        tone: 'green' as Tone },
  data:      { icon: Database,        tone: 'blue' as Tone },
  settings:  { icon: Settings,        tone: 'gray' as Tone },
  logs:      { icon: ScrollText,      tone: 'gray' as Tone },
} as const

/**
 * SettingsPage 任务组图标（取代 5 处内联 emoji）
 */
export const TASK_GROUP_ICONS = {
  chat:      { icon: MessageSquare,   tone: 'blue' as Tone },
  summary:   { icon: ListChecks,     tone: 'green' as Tone },
  extract:   { icon: FileText,       tone: 'purple' as Tone },
  insight:   { icon: BarChart3,      tone: 'orange' as Tone },
  multimodal:{ icon: Cpu,            tone: 'pink' as Tone },
} as const

/**
 * 多模态组子任务图标
 */
export const SUBTASK_ICONS = {
  speech_to_text: { icon: Mic,    tone: 'cyan' as Tone },
  vision:         { icon: Eye,    tone: 'purple' as Tone },
  embedding:      { icon: Brain,  tone: 'blue' as Tone },
} as const

/**
 * AI 能力 chips 图标（用于任务级「需要的能力」）
 */
export const AI_CAPABILITY_ICONS = {
  function_calling: { icon: Wand2,         tone: 'pink' as Tone },
  vision:           { icon: Eye,           tone: 'purple' as Tone },
  json_mode:        { icon: Code2,         tone: 'green' as Tone },
  thinking:         { icon: Lightbulb,     tone: 'purple' as Tone },
  streaming:        { icon: Zap,           tone: 'cyan' as Tone },
  system_prompt:    { icon: MessageSquare, tone: 'orange' as Tone },
} as const

/**
 * 菜单分类图标
 */
export const MENU_CATEGORY_ICONS = {
  workbench:  { icon: Home,         tone: 'blue' as Tone },
  business:   { icon: Briefcase,    tone: 'orange' as Tone },
  collab:     { icon: Share2,       tone: 'cyan' as Tone },
  ai:         { icon: Sparkles,     tone: 'purple' as Tone },
  system:     { icon: Settings,     tone: 'gray' as Tone },
} as const

/**
 * 通用图标（纯操作/装饰，按需取用）
 */
export const COMMON_ICONS = {
  // 操作
  plus: Plus, x: X, save: Save, trash: Trash2, edit: Edit3,
  refresh: RefreshCw, search: Search, filter: Filter,
  rotate: RotateCcw, copy: Copy, download: Download, upload: Upload,
  key: Key, eye: Eye, eyeOff: EyeOff, logout: LogOut,
  chevronDown: ChevronDown, chevronRight: ChevronRight, chevronUp: ChevronUp,
  arrowRight: ArrowRight, arrowUp: ArrowUp, arrowDown: ArrowDown,
  send: Send, check: Check, sliders: Sliders,
  // 状态
  alert: AlertTriangle, alertCircle: AlertCircle,
  checkCircle: CheckCircle2, info: Info, xCircle: XCircle, circle: Circle,
  // 装饰
  layers: Layers, hash: Hash, tag: Tag, link: Link2, externalLink: ExternalLink,
  pin: Pin, cloud: Cloud, server: Server, hardDrive: HardDrive, cpu: Cpu,
  trendingUp: TrendingUp, trendingDown: TrendingDown,
  target: Target, zap: Zap, pencil: Pencil, mail: Mail, phone: Phone,
  mapPin: MapPin, globe: Globe, image: Image, imageIcon: ImageIcon,
  fileAudio: FileAudio, fileCheck: FileCheck, fileJson: FileJson,
  scrollText: ScrollText, terminal: Terminal, palette: Palette, package: Package,
  monitor: Monitor,
  // 人员/权限
  user: User, userCheck: UserCheck, userX: UserX, userPlus: UserPlus,
  userCog: UserCog, userCircle: UserCircle2, crown: Crown, lock: Lock,
  building: Building2, folderTree: FolderTree, shield: Shield,
  shieldAlert: ShieldAlert, shieldCheck: ShieldCheck, keyRound: KeyRound,
  move: Move, ban: Ban,
  // 布局
  panelLeftClose: PanelLeftClose, panelLeft: PanelLeft,
  home: Home, headphones: Headphones, sun: Sun, moon: Moon, menu: Menu,
  // 媒体/数据
  compass: Compass, maximize: Maximize2, minimize: Minimize2,
  square: Square, play: Play, pause: Pause, micOff: MicOff,
  creditCard: CreditCard, mic: Mic, fileText: FileText, eye2: Eye, brain: Brain,
  briefcase: Briefcase, calendar: Calendar, bookOpen: BookOpen,
  users: Users, clock: Clock, activity: Activity,
  database: Database, barChart3: BarChart3, listChecks: ListChecks,
  sparkles: Sparkles, settings: Settings, messageSquare: MessageSquare,
  loader: Loader2,
} as const

/**
 * Emoji → 图标映射（用于批量替换 + 字符串清洗工具）
 */
export const EMOJI_REPLACEMENTS: Record<string, { icon: LucideIcon; tone: Tone }> = {
  '💬':  { icon: MessageSquare, tone: 'blue' },
  '📋':  { icon: ListChecks,    tone: 'green' },
  '📝':  { icon: FileText,      tone: 'purple' },
  '📊':  { icon: BarChart3,     tone: 'orange' },
  '🖼️':  { icon: Image,         tone: 'pink' },
  '🔍':  { icon: Search,        tone: 'blue' },
  '📅':  { icon: Calendar,      tone: 'cyan' },
  '📞':  { icon: Phone,         tone: 'green' },
  '🎙️':  { icon: Mic,           tone: 'red' },
  '🎨':  { icon: Palette,       tone: 'pink' },
  '📁':  { icon: FolderTree,    tone: 'orange' },
  '⚙️':  { icon: Settings,      tone: 'gray' },
  '👤':  { icon: User,          tone: 'blue' },
  '🏠':  { icon: Home,          tone: 'blue' },
  '🔔':  { icon: AlertCircle,   tone: 'orange' },
  '🌐':  { icon: Globe,         tone: 'cyan' },
  '💡':  { icon: Lightbulb,     tone: 'orange' },
  '🚀':  { icon: Zap,           tone: 'purple' },
  '🎯':  { icon: Target,        tone: 'red' },
  '📈':  { icon: TrendingUp,    tone: 'green' },
  '📉':  { icon: TrendingDown,  tone: 'red' },
  '💼':  { icon: Briefcase,     tone: 'orange' },
  '📃':  { icon: FileText,      tone: 'blue' },
  '📄':  { icon: FileText,      tone: 'blue' },
  '🔗':  { icon: Link2,         tone: 'blue' },
  '🔒':  { icon: Lock,          tone: 'gray' },
  '🔓':  { icon: Lock,          tone: 'green' },
  '✅':  { icon: CheckCircle,   tone: 'green' },
  '❌':  { icon: XCircle,       tone: 'red' },
  '⚠️':  { icon: AlertTriangle, tone: 'orange' },
  '🔴':  { icon: Circle,        tone: 'red' },
  '🟢':  { icon: Circle,        tone: 'green' },
  '🟡':  { icon: Circle,        tone: 'orange' },
  '🔵':  { icon: Circle,        tone: 'blue' },
  '🖥️':  { icon: Monitor,       tone: 'gray' },
} as const

/**
 * 工具：剥离字符串开头的 emoji，返回纯文本
 * 用法：stripEmoji('📋 内容总结') => '内容总结'
 */
const EMOJI_REGEX = new RegExp(
  '^[' + Object.keys(EMOJI_REPLACEMENTS).map((e) => '\\u' + e.codePointAt(0)!.toString(16).padStart(4, '0')).join('') + ']\\s*',
  'u',
)
export function stripEmoji(s: string): string {
  return s.replace(EMOJI_REGEX, '').trim()
}
