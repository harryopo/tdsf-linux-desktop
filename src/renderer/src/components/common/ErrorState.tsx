/**
 * ErrorState 错误状态组件（v0.7.0 UI 规范）
 *
 * 设计原则：
 * - 错误用语义化图标（CloseCircleFilled / WarningFilled）
 * - 区分错误类型（network/auth/timeout/generic）
 * - 提供重试/返回操作
 *
 * @example
 *   <ErrorState
 *     type="network"
 *     title="网络连接失败"
 *     description="无法连接到服务器，请检查网络后重试"
 *     onRetry={handleRetry}
 *   />
 */
import React from 'react'
import { Button, Result } from 'antd'
import {
  CloseCircleFilled,
  WifiOutlined,
  LockOutlined,
  ClockCircleOutlined,
  WarningFilled,
} from '@ant-design/icons'

export type ErrorStateType = 'network' | 'auth' | 'timeout' | 'forbidden' | 'notfound' | 'generic'

export interface ErrorStateProps {
  /** 错误类型（决定图标和文案） */
  type?: ErrorStateType
  /** 自定义标题 */
  title: string
  /** 详细描述 */
  description?: string
  /** 错误码或消息 */
  errorMessage?: string
  /** 重试回调 */
  onRetry?: () => void
  /** 返回回调 */
  onBack?: () => void
  /** 重试按钮文本 */
  retryText?: string
}

const TYPE_CONFIG: Record<ErrorStateType, { icon: React.ReactNode; defaultTitle: string }> = {
  network: { icon: <WifiOutlined />, defaultTitle: '网络连接失败' },
  auth: { icon: <LockOutlined />, defaultTitle: '身份验证失败' },
  timeout: { icon: <ClockCircleOutlined />, defaultTitle: '请求超时' },
  forbidden: { icon: <LockOutlined />, defaultTitle: '无权访问' },
  notfound: { icon: <CloseCircleFilled />, defaultTitle: '资源不存在' },
  generic: { icon: <WarningFilled />, defaultTitle: '出现错误' },
}

const ErrorState: React.FC<ErrorStateProps> = ({
  type = 'generic',
  title,
  description,
  errorMessage,
  onRetry,
  onBack,
  retryText = '重试',
}) => {
  const config = TYPE_CONFIG[type]
  return (
    <Result
      icon={
        <span style={{ color: 'var(--trae-status-error-default, #ff4d4f)', fontSize: 64, lineHeight: 1 }}>
          {config.icon}
        </span>
      }
      title={title || config.defaultTitle}
      subTitle={
        <>
          {description && <div style={{ marginBottom: 6 }}>{description}</div>}
          {errorMessage && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-tertiary, #c7c7cc)',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                padding: '6px 10px',
                background: 'var(--color-bg-card, #fafafa)',
                borderRadius: 4,
                display: 'inline-block',
                maxWidth: 480,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={errorMessage}
            >
              {errorMessage}
            </div>
          )}
        </>
      }
      extra={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {onBack && <Button onClick={onBack}>返回</Button>}
          {onRetry && (
            <Button type="primary" onClick={onRetry}>
              {retryText}
            </Button>
          )}
        </div>
      }
      style={{ padding: '48px 16px' }}
    />
  )
}

export default ErrorState
