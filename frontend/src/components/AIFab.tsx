import { useNavigate } from 'react-router-dom'
import { Wand2 } from 'lucide-react'

/**
 * AI 浮动入口按钮 (FAB)
 *
 * 设计意图：让 AI 智能助手从任意页面"一键直达"，常驻右下角不喧宾夺主
 * - 渐变紫粉背景 + 高斯光斑动效
 * - hover 弹出 tooltip "AI 智能助手"
 * - 在 AI 页面自身隐藏（避免重复）
 * - 移动端隐藏（小屏上已经有侧边栏入口了）
 */
interface AIFabProps {
  visible: boolean  // 路由判断：是否当前在 AI 页面
  canUse: boolean   // 权限判断
}

export default function AIFab({ visible, canUse }: AIFabProps) {
  const navigate = useNavigate()
  if (!canUse || !visible) return null

  return (
    <button
      onClick={() => navigate('/ai')}
      title="AI 智能助手"
      aria-label="AI 智能助手"
      className="group fixed bottom-6 right-6 z-40 hidden md:flex items-center justify-center w-14 h-14 rounded-full text-white transition-all hover:scale-105 active:scale-95"
      style={{
        background: 'linear-gradient(135deg, #7C3AED 0%, #A855F7 50%, #EC4899 100%)',
        boxShadow: '0 8px 24px rgba(124, 58, 237, 0.45), inset 0 1px 2px rgba(255,255,255,0.30)',
      }}
    >
      {/* 动效光斑（hover 增强） */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.45) 0%, transparent 60%)' }}
      />
      {/* 脉冲外圈（吸引注意） */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none animate-ping opacity-20"
        style={{ background: '#A855F7' }}
      />
      <Wand2 size={22} className="relative z-10 drop-shadow" strokeWidth={2.2} />
      {/* 悬停展开的标签 */}
      <span className="absolute right-full mr-3 px-2.5 py-1.5 rounded-lg bg-bg-card border border-border text-xs font-medium text-white whitespace-nowrap opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all pointer-events-none shadow-lg">
        AI 智能助手
      </span>
    </button>
  )
}
