import { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  sectionName?: string
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: any) {
    console.error(`[ErrorBoundary${this.props.sectionName ? `/${this.props.sectionName}` : ''}]`, error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">
              {this.props.sectionName ? `${this.props.sectionName}渲染异常` : '组件渲染异常'}
            </p>
            <p className="text-xs text-red-600 dark:text-red-300 mt-0.5 break-all">
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={this.handleReset}
              className="mt-2 px-2.5 py-1 rounded text-[11px] font-semibold bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/25 transition-colors inline-flex items-center gap-1"
            >
              <RefreshCw size={10} /> 重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
