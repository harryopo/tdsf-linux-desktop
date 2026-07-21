/**
 * AtCommandChip - @命令 Chip 组件
 *
 * 职责：
 * - 渲染单个 @命令为可删除的 Chip（紧凑 Tag 样式）
 * - 显示：图标 + 类型 label + 参数预览
 * - 点击 Chip 触发 onEdit（编辑参数）
 * - 点击 X 触发 onRemove
 * - hover 显示 Popover 完整 displayText
 *
 * 暗系风格（深渊暗系）：
 * - 背景 var(--color-bg-inset)
 * - hover 时阴影 + 1px 位移
 * - 柔和白文字
 *
 * 方案书依据：v0.9 §4.3（@命令接口契约）
 */
import { useMemo } from 'react'
import { Popover, Tooltip } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import {
  FileTextOutlined,
  CodeOutlined,
  FileOutlined,
  LineChartOutlined,
  HistoryOutlined,
  BookOutlined,
  ToolOutlined,
  CloudServerOutlined,
} from '@ant-design/icons'
import type { AtCommand, AtCommandType } from '@shared/at-command-types'
import { AT_COMMAND_LABELS } from '@shared/at-command-types'
import './AtCommandChip.css'

/** 图标映射：AtCommandType → Ant Design 图标组件 */
const ICON_MAP: Record<AtCommandType, React.ComponentType<{ className?: string }>> = {
  log: FileTextOutlined,
  cmd: CodeOutlined,
  file: FileOutlined,
  metric: LineChartOutlined,
  decision: HistoryOutlined,
  kb: BookOutlined,
  skill: ToolOutlined,
  server: CloudServerOutlined,
}

/** Chip 命令数据（带 id 用于 React key 和移除） */
export interface AtCommandChipData extends AtCommand {
  /** 客户端生成的唯一 ID（用于 React key / removeCommand） */
  id: string
}

/** AtCommandChip Props */
export interface AtCommandChipProps {
  /** 命令数据 */
  command: AtCommandChipData
  /** 点击 Chip 主体触发（编辑参数） */
  onEdit?: (command: AtCommandChipData) => void
  /** 点击 X 触发（移除） */
  onRemove?: (command: AtCommandChipData) => void
}

/**
 * 从 displayText 提取参数预览（去掉前缀的 @type 标识）
 * 例：'@file /etc/hosts' → '/etc/hosts'
 */
function extractPreview(displayText: string): string {
  // 去除开头的 @type 标识（@log / @cmd / @file / @metric / @decision / @kb / @skill / @server）
  const match = displayText.match(/^@\w+\s+(.+)$/)
  return match ? match[1] : displayText
}

/** AtCommandChip 组件 */
const AtCommandChip: React.FC<AtCommandChipProps> = ({ command, onEdit, onRemove }) => {
  const IconComp = ICON_MAP[command.type] || FileOutlined
  const label = AT_COMMAND_LABELS[command.type] || command.type
  const preview = useMemo(() => extractPreview(command.displayText), [command.displayText])

  /** Popover 内容：完整 displayText + injectedText 摘要 */
  const popoverContent = useMemo(() => {
    return (
      <div className="at-chip-popover">
        <div className="at-chip-popover-row">
          <span className="at-chip-popover-label">显示</span>
          <code className="at-chip-popover-code">{command.displayText}</code>
        </div>
        <div className="at-chip-popover-row">
          <span className="at-chip-popover-label">注入</span>
          <pre className="at-chip-popover-pre">{command.injectedText}</pre>
        </div>
      </div>
    )
  }, [command.displayText, command.injectedText])

  return (
    <Popover
      content={popoverContent}
      trigger="hover"
      placement="top"
      mouseEnterDelay={0.3}
      mouseLeaveDelay={0.1}
      overlayClassName="at-chip-popover-overlay"
    >
      <div className="at-command-chip" onClick={() => onEdit?.(command)}>
        <IconComp className="at-command-chip-icon" />
        <span className="at-command-chip-label">{label}</span>
        {preview && <span className="at-command-chip-preview">{preview}</span>}
        {onRemove && (
          <Tooltip title="移除" mouseEnterDelay={0.5}>
            <button
              type="button"
              className="at-command-chip-close"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(command)
              }}
              aria-label="移除命令"
            >
              <CloseOutlined />
            </button>
          </Tooltip>
        )}
      </div>
    </Popover>
  )
}

export default AtCommandChip
