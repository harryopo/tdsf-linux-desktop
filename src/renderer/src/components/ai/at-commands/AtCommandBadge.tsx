/**
 * AtCommandBadge - AI 消息气泡中的 @命令徽章
 *
 * 职责：
 * - 在 AI 消息气泡中渲染已注入的 @命令为小徽章（点击展开详情）
 * - 鼠标 hover 显示 Popover 完整 displayText + injectedText
 *
 * 与 AtCommandChip 的区别：
 * - Badge 用于消息气泡内（只读展示，无删除按钮）
 * - Chip 用于输入框下方（可编辑/删除）
 *
 * 方案书依据：v0.9 §4.3（@命令接口契约）
 */
import { useMemo } from 'react'
import { Popover } from 'antd'
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
import './AtCommandBadge.css'

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

/** AtCommandBadge Props */
export interface AtCommandBadgeProps {
  /** 命令数据 */
  command: AtCommand
  /** 点击 Badge 触发（可选，用于展开详情） */
  onClick?: (command: AtCommand) => void
}

/** AtCommandBadge 组件 */
const AtCommandBadge: React.FC<AtCommandBadgeProps> = ({ command, onClick }) => {
  const IconComp = ICON_MAP[command.type] || FileOutlined
  const label = AT_COMMAND_LABELS[command.type] || command.type

  /** Popover 内容：完整 displayText + injectedText 摘要 */
  const popoverContent = useMemo(() => {
    return (
      <div className="at-badge-popover">
        <div className="at-badge-popover-row">
          <span className="at-badge-popover-label">显示</span>
          <code className="at-badge-popover-code">{command.displayText}</code>
        </div>
        <div className="at-badge-popover-row">
          <span className="at-badge-popover-label">注入</span>
          <pre className="at-badge-popover-pre">{command.injectedText}</pre>
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
      overlayClassName="at-badge-popover-overlay"
    >
      <button
        type="button"
        className="at-command-badge"
        onClick={() => onClick?.(command)}
        aria-label={`@${label} 命令`}
      >
        <IconComp className="at-command-badge-icon" />
        <span className="at-command-badge-label">{label}</span>
      </button>
    </Popover>
  )
}

export default AtCommandBadge
