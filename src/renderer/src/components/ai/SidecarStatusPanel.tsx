/**
 * SidecarStatusPanel - 多 Sidecar 状态面板（v1.5）
 *
 * 用途：
 * - 统一展示 Sidecar A（SRE）、B（Analytics）、C（Agent）的运行状态
 * - 提供单 sidecar 启动/停止/健康检查操作入口
 * - Sidecar-B/C 懒启动：首次点击时启动（避免资源浪费）
 *
 * 设计参考：
 * - McpStatusBar.tsx：5 阶段状态机的可视化范式
 * - v1.0 SrePipelinePanel：3 步骤输入 → 处理 → 结果的简单 UI 范式
 *
 * 5 个状态映射（与 SidecarManager 一致）：
 * - ready     绿色
 * - starting  蓝色（spin 图标）
 * - degraded  黄色
 * - crashed   红色
 * - stopped   灰色
 *
 * 使用：
 * ```tsx
 * <SidecarStatusPanel open onClose={() => setOpen(false)} />
 * ```
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Modal,
  Card,
  Tag,
  Space,
  Button,
  Tooltip,
  message,
  Spin,
  Empty,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  SyncOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  PoweroffOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ApiOutlined,
  ExperimentOutlined,
  BarChartOutlined,
  RobotOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import './SidecarStatusPanel.css'

const { Text, Paragraph } = Typography

/** 状态类型（与 main/core/sidecar/sidecar-manager.ts SidecarStatus 对齐） */
type SidecarStatus = 'stopped' | 'starting' | 'ready' | 'degraded' | 'crashed'

/** 单个 Sidecar 状态项（与 main/ipc/sidecar.ts sidecar:list-status 返回对齐） */
interface SidecarItem {
  id: 'sre' | 'analytics' | 'agent'
  name: string
  port: number
  status: SidecarStatus
  lastError: string | null
}

/** 状态配置（颜色 + 图标 + 标签） */
const STATUS_CONFIG: Record<
  SidecarStatus,
  { color: string; bg: string; icon: React.ReactNode; label: string; antTag: string }
> = {
  ready: {
    color: 'var(--color-success)',
    bg: 'var(--color-success-alpha-10)',
    icon: <CheckCircleOutlined />,
    label: '运行中',
    antTag: 'success',
  },
  starting: {
    color: 'var(--color-link)',
    bg: 'var(--color-link-alpha-10)',
    icon: <SyncOutlined spin />,
    label: '启动中',
    antTag: 'processing',
  },
  degraded: {
    color: 'var(--color-warning)',
    bg: 'var(--color-warning-alpha-10)',
    icon: <WarningOutlined />,
    label: '降级',
    antTag: 'warning',
  },
  crashed: {
    color: 'var(--color-error)',
    bg: 'var(--color-error-alpha-08)',
    icon: <CloseCircleOutlined />,
    label: '崩溃',
    antTag: 'error',
  },
  stopped: {
    color: 'var(--color-text-tertiary)',
    bg: 'var(--color-bg-elevated)',
    icon: <PoweroffOutlined />,
    label: '已停止',
    antTag: 'default',
  },
}

/** Sidecar 类型图标映射 */
const SIDECAR_ICON: Record<string, React.ReactNode> = {
  sre: <ExperimentOutlined />,
  analytics: <BarChartOutlined />,
  agent: <RobotOutlined />,
}

/** Sidecar 类型标签映射 */
const SIDECAR_TAG: Record<string, { tag: string; color: string; note: string }> = {
  sre: {
    tag: 'SRE',
    color: 'purple',
    note: 'Drain3 + OpenDerisk + 可选 LLM 增强',
  },
  analytics: {
    tag: 'Analytics',
    color: 'blue',
    note: 'DoWhy + Phoenix（v1.5 占位，v1.6 真实集成）',
  },
  agent: {
    tag: 'Agent',
    color: 'cyan',
    note: 'smolagents + AgentScope（v1.5 占位，v1.6 真实集成）',
  },
}

interface SidecarStatusPanelProps {
  open: boolean
  onClose: () => void
}

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 3000

const SidecarStatusPanel: React.FC<SidecarStatusPanelProps> = ({ open, onClose }) => {
  const [items, setItems] = useState<Record<string, SidecarItem>>({})
  const [loading, setLoading] = useState(false)
  /** 记录每个 sidecar 正在进行的操作（用于按钮 loading） */
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [lastRefresh, setLastRefresh] = useState<number>(0)
  /** 占位端点测试响应（用于弹窗展示，替代 console.log） */
  const [toolCallResult, setToolCallResult] = useState<{
    sidecarId: string
    endpoint: string
    data: unknown
  } | null>(null)
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null)

  // ============================================================
  // 数据获取
  // ============================================================
  const refresh = useCallback(async (silent = false) => {
    if (!window.electronAPI?.sidecarListStatus) {
      message.error('sidecarListStatus 不可用（IPC 未注册）')
      return
    }
    if (!silent) setLoading(true)
    try {
      const resp = await window.electronAPI.sidecarListStatus()
      if (resp.ok && resp.data) {
        setItems(resp.data)
        setLastRefresh(Date.now())
      } else {
        message.error(`拉取状态失败：${resp.error ?? 'unknown'}`)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      message.error(`拉取状态异常：${errMsg}`)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // ============================================================
  // 启动/停止
  // ============================================================
  const handleStart = useCallback(async (sidecarId: SidecarItem['id']) => {
    if (!window.electronAPI?.sidecarStartOne) return
    setBusy((prev) => ({ ...prev, [sidecarId]: true }))
    try {
      const resp = await window.electronAPI.sidecarStartOne(sidecarId)
      if (resp.ok) {
        message.success(`${SIDECAR_TAG[sidecarId]?.tag ?? sidecarId} 启动成功`)
      } else {
        message.error(`启动失败：${resp.error ?? 'unknown'}`)
      }
      // 立即刷新一次状态
      await refresh(true)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      message.error(`启动异常：${errMsg}`)
    } finally {
      setBusy((prev) => ({ ...prev, [sidecarId]: false }))
    }
  }, [refresh])

  const handleStop = useCallback(async (sidecarId: SidecarItem['id']) => {
    if (!window.electronAPI?.sidecarStopOne) return
    setBusy((prev) => ({ ...prev, [sidecarId]: true }))
    try {
      const resp = await window.electronAPI.sidecarStopOne(sidecarId)
      if (resp.ok) {
        message.success(`${SIDECAR_TAG[sidecarId]?.tag ?? sidecarId} 已停止`)
      } else {
        message.error(`停止失败`)
      }
      await refresh(true)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      message.error(`停止异常：${errMsg}`)
    } finally {
      setBusy((prev) => ({ ...prev, [sidecarId]: false }))
    }
  }, [refresh])

  // ============================================================
  // 测试占位端点（仅 Sidecar-B/C）
  // ============================================================
  const handleTestToolCall = useCallback(async (sidecarId: SidecarItem['id']) => {
    if (!window.electronAPI?.sidecarToolCall) return
    setBusy((prev) => ({ ...prev, [sidecarId]: true }))
    try {
      // Sidecar-B 测 /analytics/dowhy，Sidecar-C 测 /agent/code-task
      const endpoint = sidecarId === 'analytics' ? '/analytics/dowhy' : '/agent/code-task'
      const payload =
        sidecarId === 'analytics'
          ? { treatment: 'latency', outcome: 'errors', confounders: ['load', 'cpu'] }
          : { task: '写一个 hello world 函数' }
      const resp = await window.electronAPI.sidecarToolCall(sidecarId, endpoint, payload)
      if (resp.ok) {
        message.success(`占位端点调用成功（${endpoint}）`)
        // 将占位响应存入状态，由结果弹窗展示（替代 console.log 占位）
        setToolCallResult({ sidecarId, endpoint, data: resp.data })
      } else {
        message.error(`占位调用失败：${resp.error ?? 'unknown'}`)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      message.error(`占位调用异常：${errMsg}`)
    } finally {
      setBusy((prev) => ({ ...prev, [sidecarId]: false }))
    }
  }, [])

  // ============================================================
  // 生命周期：open 时启动轮询，关闭时清理
  // ============================================================
  useEffect(() => {
    if (!open) return

    // 立即拉一次
    refresh(true)

    // 启动轮询
    pollTimerRef.current = setInterval(() => {
      refresh(true)
    }, POLL_INTERVAL_MS)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [open, refresh])

  // ============================================================
  // 渲染
  // ============================================================
  const itemList: SidecarItem[] = Object.values(items)
  const lastRefreshText = lastRefresh
    ? new Date(lastRefresh).toLocaleTimeString('zh-CN')
    : '—'

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={920}
      title={
        <Space>
          <ApiOutlined style={{ color: 'var(--color-primary)' }} />
          <span>多 Sidecar 状态面板（v1.5）</span>
          <Tag color="default" style={{ marginLeft: 8 }}>
            A / B / C 三进程隔离
          </Tag>
        </Space>
      }
      destroyOnClose
    >
      <Spin spinning={loading}>
        <div className="sidecar-status-panel">
          {/* 顶部信息条 */}
          <div className="sidecar-status-panel__toolbar">
            <Space size="middle">
              <Text type="secondary">
                <BulbOutlined /> Sidecar-A 为生产就绪；B/C 为 v1.5 占位（v1.6 真实集成）
              </Text>
            </Space>
            <Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                上次刷新：{lastRefreshText}
              </Text>
              <Tooltip title="手动刷新">
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => refresh(false)}
                  loading={loading}
                >
                  刷新
                </Button>
              </Tooltip>
            </Space>
          </div>

          {/* 卡片列表 */}
          {itemList.length === 0 ? (
            <Empty description="暂无 Sidecar 状态数据" style={{ marginTop: 40 }} />
          ) : (
            <div className="sidecar-status-panel__grid">
              {itemList.map((item) => {
                const cfg = STATUS_CONFIG[item.status]
                const tag = SIDECAR_TAG[item.id]
                const isRunning = item.status === 'ready' || item.status === 'starting'
                return (
                  <Card
                    key={item.id}
                    size="small"
                    className="sidecar-card"
                    style={{
                      borderColor: cfg.color,
                      background: cfg.bg,
                    }}
                  >
                    {/* 卡片头：图标 + 名称 + 状态 */}
                    <div className="sidecar-card__header">
                      <span className="sidecar-card__icon" style={{ color: cfg.color }}>
                        {SIDECAR_ICON[item.id]}
                      </span>
                      <div className="sidecar-card__title">
                        <Text strong style={{ fontSize: 15 }}>
                          {tag?.tag ?? item.id}
                        </Text>
                        <Tag color={tag?.color ?? 'default'} style={{ marginLeft: 8, marginRight: 0 }}>
                          :{item.port}
                        </Tag>
                      </div>
                      <Tag
                        icon={cfg.icon}
                        color={cfg.antTag}
                        className="sidecar-card__status-tag"
                      >
                        {cfg.label}
                      </Tag>
                    </div>

                    {/* 描述 */}
                    {tag?.note && (
                      <Paragraph
                        type="secondary"
                        style={{ fontSize: 12, marginBottom: 8, marginTop: 4 }}
                      >
                        {tag.note}
                      </Paragraph>
                    )}

                    {/* 错误信息 */}
                    {item.status === 'crashed' && item.lastError && (
                      <Tooltip title={item.lastError}>
                        <div className="sidecar-card__error">
                          <CloseCircleOutlined /> {item.lastError.slice(0, 60)}
                          {item.lastError.length > 60 ? '...' : ''}
                        </div>
                      </Tooltip>
                    )}

                    {/* 操作按钮 */}
                    <div className="sidecar-card__actions">
                      {isRunning ? (
                        <Button
                          size="small"
                          danger
                          icon={<PoweroffOutlined />}
                          loading={busy[item.id]}
                          onClick={() => handleStop(item.id)}
                          disabled={item.status === 'starting'}
                        >
                          停止
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          loading={busy[item.id]}
                          onClick={() => handleStart(item.id)}
                          disabled={item.status === 'starting'}
                        >
                          启动
                        </Button>
                      )}
                      {/* 占位端点测试（仅 B/C） */}
                      {item.id !== 'sre' && (
                        <Tooltip title={`测试 ${item.id === 'analytics' ? '/analytics/dowhy' : '/agent/code-task'} 占位端点`}>
                          <Button
                            size="small"
                            icon={<ExperimentOutlined />}
                            loading={busy[item.id]}
                            onClick={() => handleTestToolCall(item.id)}
                            disabled={!isRunning}
                          >
                            测试占位
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {/* 底部说明 */}
          <div className="sidecar-status-panel__footer">
            <Space size="small" wrap>
              <Tag icon={<CheckCircleOutlined />} color="success">
                ready - 运行中
              </Tag>
              <Tag icon={<SyncOutlined spin />} color="processing">
                starting - 启动中
              </Tag>
              <Tag icon={<WarningOutlined />} color="warning">
                degraded - 降级
              </Tag>
              <Tag icon={<CloseCircleOutlined />} color="error">
                crashed - 崩溃
              </Tag>
              <Tag icon={<PoweroffOutlined />} color="default">
                stopped - 已停止
              </Tag>
            </Space>
          </div>
        </div>
      </Spin>

      {/* 占位端点测试响应弹窗（替代 console.log，便于直观查看返回数据） */}
      <Modal
        open={toolCallResult !== null}
        onCancel={() => setToolCallResult(null)}
        onOk={() => setToolCallResult(null)}
        footer={null}
        width={640}
        title={
          <Space>
            <ExperimentOutlined style={{ color: 'var(--color-primary)' }} />
            <span>占位端点响应</span>
            {toolCallResult && (
              <Tag color={SIDECAR_TAG[toolCallResult.sidecarId]?.color ?? 'default'}>
                {SIDECAR_TAG[toolCallResult.sidecarId]?.tag ?? toolCallResult.sidecarId}
              </Tag>
            )}
          </Space>
        }
        destroyOnClose
      >
        {toolCallResult && (
          <div>
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              端点：<Text code>{toolCallResult.endpoint}</Text>
            </Paragraph>
            <pre
              style={{
                maxHeight: 360,
                overflow: 'auto',
                padding: 12,
                borderRadius: 6,
                background: 'var(--color-bg-elevated)',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {JSON.stringify(toolCallResult.data, null, 2)}
            </pre>
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <Button type="primary" onClick={() => setToolCallResult(null)}>
                关闭
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Modal>
  )
}

export default SidecarStatusPanel
