/**
 * React 错误边界组件
 *
 * 捕获子组件树中的 JavaScript 错误，防止整个应用白屏崩溃。
 * 显示友好的错误提示页面，提供重新加载按钮。
 * 同时将完整错误栈输出到控制台，便于调试。
 */
import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/ui'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: React.ErrorInfo
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // 输出完整错误信息到控制台
    console.error('[ErrorBoundary] 捕获到渲染错误:')
    console.error('[ErrorBoundary] Error:', error.message)
    console.error('[ErrorBoundary] Stack:', error.stack)
    console.error('[ErrorBoundary] ComponentStack:', errorInfo.componentStack)
    // 保存到全局变量，方便用户复制上报
    try {
      ;(window as unknown as { __lastRenderError?: { error: Error; errorInfo: React.ErrorInfo } }).__lastRenderError = { error, errorInfo }
    } catch {
      // 忽略
    }
    this.setState({ errorInfo })
  }

  render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || '未知错误'
      const errorStack = this.state.error?.stack || ''
      // 取组件栈的前3行（最有用的部分）
      const componentStack = this.state.errorInfo?.componentStack || ''
      const stackLines = componentStack.split('\n').filter(Boolean).slice(0, 5).join('\n')

      return (
        <div className="flex min-h-full w-full items-start justify-center overflow-y-auto bg-canvas p-8">
          <div className="w-full max-w-[720px]">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-(--ui-radius-control) bg-error/10 text-(--status-error-text)">
                <AlertTriangle className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-body font-semibold text-ink">页面加载出错</h2>
                <p className="mt-1 break-all text-md text-ink-dim">{errorMsg}</p>
                <div className="mt-4 flex gap-2">
                  <Button variant="solid" size="lg" onClick={() => window.location.reload()}>
                    重新加载
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => this.setState({ hasError: false, error: undefined, errorInfo: undefined })}
                  >
                    忽略并继续
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-(--ui-radius-card) border border-line bg-panel p-4">
              <p className="text-md font-medium text-ink">错误信息</p>
              <pre className="mt-1 max-h-[200px] overflow-auto break-all whitespace-pre-wrap font-mono text-caption text-ink-dim">
                {errorMsg}
              </pre>
              {stackLines ? (
                <>
                  <p className="mt-3 text-md font-medium text-ink">组件调用栈</p>
                  <pre className="mt-1 max-h-[150px] overflow-auto whitespace-pre-wrap font-mono text-caption text-ink-dim">
                    {stackLines}
                  </pre>
                </>
              ) : null}
              {errorStack ? (
                <>
                  <p className="mt-3 text-md font-medium text-ink">JS 调用栈</p>
                  <pre className="mt-1 max-h-[150px] overflow-auto whitespace-pre-wrap font-mono text-caption text-ink-dim">
                    {errorStack.split('\n').slice(0, 8).join('\n')}
                  </pre>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
