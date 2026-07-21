/**
 * MCP 生命周期状态条（v0.9.5 P0）
 *
 * 借鉴 instructkr/claw-code §3.3 McpLifecycleHardened
 *
 * 5 个状态的可视化：
 * - connected   绿色，所有功能可用
 * - degraded    黄色，部分功能受损
 * - recovering  蓝色，正在重试
 * - failed      红色，调用被拒绝
 * - backoff     橙色，冷却倒计时
 *
 * 使用：
 * ```tsx
 * <McpStatusBar />
 * ```
 */
import { useEffect, useState } from 'react'
import { Tag, Tooltip, Button, Space } from 'antd'
import {
  CheckCircleOutlined,
  WarningOutlined,
  SyncOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import type { McpStateContext, McpLifecycleState } from '@shared/models'
import './McpStatusBar.css'

/** 状态配置（颜色 + 图标 + 标签） */
const STATE_CONFIG: Record<
  McpLifecycleState,
  { color: string; bg: string; icon: React.ReactNode; label: string; description: string }
> = {
  connected: {
    color: 'var(--color-success)',
    bg: 'var(--color-success-alpha-10)',
    icon: <CheckCircleOutlined />,
    label: 'MCP 已连接',
    description: '所有工具可用',
  },
  degraded: {
    color: 'var(--color-warning)',
    bg: 'var(--color-warning-alpha-10)',
    icon: <WarningOutlined />,
    label: 'MCP 降级运行',
    description: '部分工具不可用，自动降级',
  },
  recovering: {
    color: 'var(--color-link)',
    bg: 'var(--color-link-alpha-10)',
    icon: <SyncOutlined spin />,
    label: 'MCP 正在恢复',
    description: '正在重试连接',
  },
  failed: {
    color: 'var(--color-error)',
    bg: 'var(--color-error-alpha-08)',
    icon: <CloseCircleOutlined />,
    label: 'MCP 连接失败',
    description: '调用被拒绝，需手动重置',
  },
  backoff: {
    color: 'var(--color-warning)',
    bg: 'var(--color-warning-alpha-12)',
    icon: <ClockCircleOutlined />,
    label: 'MCP 冷却中',
    description: '倒计时结束后自动重试',
  },
}

export const McpStatusBar: React.FC = () => {
  const [state, setState] = useState<McpStateContext | null>(null)

  useEffect(() => {
    // 初始拉取
    if (window.electronAPI?.mcpGetState) {
      window.electronAPI.mcpGetState().then(setState)
    }
    // 订阅变更
    if (window.electronAPI?.onMcpStateChanged) {
      const unsub = window.electronAPI.onMcpStateChanged(setState)
      return unsub
    }
    return undefined
  }, [])

  if (!state) return null

  const config = STATE_CONFIG[state.state]
  const isHealthy = state.state === 'connected'
  const isFailed = state.state === 'failed'
  const isBackoff = state.state === 'backoff'

  // connected 状态可折叠（不打扰用户）
  if (isHealthy) {
    return (
      <Tooltip title={config.description}>
        <Tag
          icon={config.icon}
          color="default"
          className="mcp-status-tag mcp-status-tag--connected"
        >
          MCP 健康
        </Tag>
      </Tooltip>
    )
  }

  // 异常状态展开显示
  return (
    <div
      className="mcp-status-bar"
      style={{ background: config.bg, borderColor: config.color }}
    >
      <Space size="small" className="mcp-status-bar-main">
        <span className="mcp-status-bar-icon" style={{ color: config.color }}>
          {config.icon}
        </span>
        <span className="mcp-status-bar-label" style={{ color: config.color }}>
          {config.label}
        </span>
        {isBackoff && state.backoffRemainingSec > 0 && (
          <Tag color="orange" className="mcp-status-bar-backoff">
            剩余 {state.backoffRemainingSec}s
          </Tag>
        )}
        {state.consecutiveFailures > 0 && (
          <Tag color="default" className="mcp-status-bar-meta">
            连续失败 {state.consecutiveFailures} 次
          </Tag>
        )}
        {state.retryAttempts > 0 && state.state === 'recovering' && (
          <Tag color="default" className="mcp-status-bar-meta">
            重试 {state.retryAttempts}/3
          </Tag>
        )}
      </Space>
      <Space size="small" className="mcp-status-bar-actions">
        {state.lastFailureReason && (
          <Tooltip title={state.lastFailureReason}>
            <Tag color="default" className="mcp-status-bar-reason">
              {state.lastFailureReason.length > 30
                ? state.lastFailureReason.slice(0, 30) + '...'
                : state.lastFailureReason}
            </Tag>
          </Tooltip>
        )}
        {isFailed && (
          <Button
            size="small"
            type="primary"
            icon={<ReloadOutlined />}
            onClick={async () => {
              await window.electronAPI?.mcpReset?.()
            }}
          >
            重置 MCP
          </Button>
        )}
      </Space>
    </div>
  )
}

export default McpStatusBar
