/**
 * AttentionBubble — Agent 注意力关注点气泡（v0.9.4 §11 改进点 24 渲染层接入）
 *
 * 数据来源：
 * - 主进程 AttentionTracker 单例（src/main/core/agent/attention-tracker.ts）
 * - IPC 通道：window.electronAPI.attentionCurrent() → AttentionFocus
 *
 * 展示策略：
 * - 4 类关注点（files / commands / errors / keywords），每类最多展示 3 条，超出折叠
 * - 空AttentionFocus（4 类全空）时不渲染
 * - 30 秒轮询刷新（与主进程 AttentionTracker 同步频率对齐）
 * - 非 Electron 环境降级为不渲染
 *
 * 设计依据：v0.9.3 §11 改进点 24 + Kilo Code attention 字段机制
 * 论文支撑：无（纯 UI 增强，借鉴 Kilo Code §6.1）
 */
import { useEffect, useState, useMemo } from 'react'
import { Tooltip, Tag } from 'antd'
import {
  FileTextOutlined,
  CodeOutlined,
  WarningOutlined,
  TagOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import type { AttentionFocus } from '@shared/agent-types'
import { isElectronAPIAvailable } from '../../utils/electron-api'

/** 单类关注点最多展示的条目数（超出折叠到 Tooltip） */
const MAX_VISIBLE_ITEMS = 3

/** 轮询间隔（ms），与主进程 AttentionTracker debug 日志频率对齐 */
const POLL_INTERVAL_MS = 30_000

interface AttentionBubbleProps {
  /** 自定义 className（可选） */
  className?: string
}

/**
 * 渲染单类关注点的 Tag 列表
 *
 * @param icon 该类的图标
 * @param label 该类中文名（如"文件"/"命令"）
 * @param items 该类的关注点列表
 * @param color Tag 颜色主题
 */
function renderAttentionGroup(
  icon: React.ReactNode,
  label: string,
  items: string[] | undefined,
  color: string,
): React.ReactNode {
  if (!items || items.length === 0) return null
  const visible = items.slice(0, MAX_VISIBLE_ITEMS)
  const overflow = items.length - visible.length
  return (
    <div className="attention-bubble-group">
      <span className="attention-bubble-group-label">
        {icon}
        <span className="attention-bubble-group-name">{label}</span>
        <span className="attention-bubble-group-count">{items.length}</span>
      </span>
      <div className="attention-bubble-group-items">
        {visible.map((item, idx) => (
          <Tag key={`${label}-${idx}`} color={color} className="attention-bubble-tag">
            {item.length > 40 ? `${item.slice(0, 37)}...` : item}
          </Tag>
        ))}
        {overflow > 0 && (
          <Tooltip
            title={
              <div className="attention-bubble-overflow">
                {items.slice(MAX_VISIBLE_ITEMS).map((item, idx) => (
                  <div key={`overflow-${idx}`} className="attention-bubble-overflow-item">
                    {item}
                  </div>
                ))}
              </div>
            }
            overlayClassName="attention-bubble-overflow-tooltip"
          >
            <Tag className="attention-bubble-tag attention-bubble-tag-overflow">
              +{overflow}
            </Tag>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

/**
 * AttentionBubble 主组件
 *
 * 订阅主进程 AttentionTracker，展示当前会话 Agent 的关注点。
 * 当 4 类关注点全部为空时不渲染（避免占用 UI 空间）。
 */
const AttentionBubble: React.FC<AttentionBubbleProps> = ({ className }) => {
  const [attention, setAttention] = useState<AttentionFocus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isElectronAPIAvailable()) return
    const api = window.electronAPI
    if (!api?.attentionCurrent) return

    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    /** 拉取当前 attention */
    const fetchAttention = async () => {
      try {
        const current = await api.attentionCurrent()
        if (!cancelled) {
          setAttention(current)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          const reason = err instanceof Error ? err.message : String(err)
          setError(reason)
        }
      }
    }

    // 首次立即拉取
    void fetchAttention()
    // 定时轮询
    timer = setInterval(() => {
      void fetchAttention()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (timer !== null) clearInterval(timer)
    }
  }, [])

  /** 4 类是否全部为空（决定是否渲染） */
  const hasAny = useMemo(() => {
    if (!attention) return false
    return (
      (attention.files?.length ?? 0) > 0 ||
      (attention.commands?.length ?? 0) > 0 ||
      (attention.errors?.length ?? 0) > 0 ||
      (attention.keywords?.length ?? 0) > 0
    )
  }, [attention])

  // 非 Electron / IPC 不可用 / 无关注点 / 出错：均不渲染
  if (!isElectronAPIAvailable() || !hasAny || error) return null

  const sinceStr = attention?.since
    ? new Date(attention.since).toLocaleTimeString('zh-CN', { hour12: false })
    : ''

  return (
    <div className={`attention-bubble ${className ?? ''}`}>
      <div className="attention-bubble-header">
        <EyeOutlined className="attention-bubble-icon" />
        <span className="attention-bubble-title">Agent 关注点</span>
        {sinceStr && <span className="attention-bubble-since">自 {sinceStr}</span>}
      </div>
      <div className="attention-bubble-body">
        {renderAttentionGroup(
          <FileTextOutlined />,
          '文件',
          attention?.files,
          'blue',
        )}
        {renderAttentionGroup(
          <CodeOutlined />,
          '命令',
          attention?.commands,
          'geekblue',
        )}
        {renderAttentionGroup(
          <WarningOutlined />,
          '错误',
          attention?.errors,
          'red',
        )}
        {renderAttentionGroup(
          <TagOutlined />,
          '关键词',
          attention?.keywords,
          'purple',
        )}
      </div>
    </div>
  )
}

export default AttentionBubble
