/**
 * React 错误边界组件
 *
 * 捕获子组件树中的 JavaScript 错误，防止整个应用白屏崩溃。
 * 显示友好的错误提示页面，提供重新加载按钮。
 * 同时将完整错误栈输出到控制台，便于调试。
 */
import React from 'react'
import { Result, Button, Typography } from 'antd'

const { Paragraph, Text } = Typography

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
        <div style={{ padding: 40, maxWidth: 700, margin: '0 auto' }}>
          <Result
            status="error"
            title="页面加载出错"
            subTitle={errorMsg}
            extra={[
              <Button
                key="reload"
                type="primary"
                onClick={() => window.location.reload()}
              >
                重新加载
              </Button>,
              <Button
                key="dismiss"
                onClick={() => this.setState({ hasError: false, error: undefined, errorInfo: undefined })}
              >
                忽略并继续
              </Button>,
            ]}
          />
          <div style={{ marginTop: 16, background: '#f5f5f5', padding: 12, borderRadius: 8, maxHeight: 200, overflow: 'auto' }}>
            <Paragraph>
              <Text strong>错误信息：</Text>
            </Paragraph>
            <Paragraph>
              <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>{errorMsg}</Text>
            </Paragraph>
            {stackLines && (
              <>
                <Paragraph>
                  <Text strong>组件调用栈：</Text>
                </Paragraph>
                <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>{stackLines}</pre>
              </>
            )}
            {errorStack && (
              <>
                <Paragraph style={{ marginTop: 8 }}>
                  <Text strong>JS 调用栈：</Text>
                </Paragraph>
                <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>{errorStack.split('\n').slice(0, 8).join('\n')}</pre>
              </>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
