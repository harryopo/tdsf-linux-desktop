/**
 * React 错误边界组件
 *
 * 捕获子组件树中的 JavaScript 错误，防止整个应用白屏崩溃。
 * 显示友好的错误提示页面，提供重新加载按钮。
 */
import React from 'react'
import { Result, Button } from 'antd'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面加载出错"
          subTitle={this.state.error?.message || '未知错误'}
          extra={<Button type="primary" onClick={() => window.location.reload()}>重新加载</Button>}
        />
      )
    }
    return this.props.children
  }
}
