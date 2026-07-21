/**
 * AtCommandPicker - @命令选择器
 *
 * 职责：
 * - 在 ChatPanel 输入框输入 `@` 时触发显示
 * - 显示 8 类 @命令列表（从 window.electronAPI.atList() 加载）
 * - 每项显示：图标 + 标签 + 描述
 * - 键盘导航：ArrowUp/Down 选中，Enter 确认，Esc 关闭
 * - 鼠标 hover 高亮
 * - 选中后触发 onSelect(type) 回调
 *
 * 位置：紧贴输入框上方（absolute + transform），z-index 高
 * 宽度：280px，最大高度：320px 可滚动
 *
 * 方案书依据：v0.9 §4.3（@命令接口契约）
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
import type { AtCommandType } from '@shared/at-command-types'
import { isElectronAPIAvailable } from '../../../utils/electron-api'
import './AtCommandPicker.css'

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

/** 命令元信息（与 preload AtCommandInfo 一致） */
interface CommandInfo {
  type: AtCommandType
  label: string
  icon: string
  description: string
}

/** AtCommandPicker Props */
export interface AtCommandPickerProps {
  /** 是否可见 */
  visible: boolean
  /** 选中命令类型回调 */
  onSelect: (type: AtCommandType) => void
  /** 关闭回调（Esc 或外部点击） */
  onClose: () => void
}

/** AtCommandPicker 组件 */
const AtCommandPicker: React.FC<AtCommandPickerProps> = ({ visible, onSelect, onClose }) => {
  /** 命令列表 */
  const [commands, setCommands] = useState<CommandInfo[]>([])
  /** 当前高亮索引 */
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  /** 加载中 */
  const [loading, setLoading] = useState(false)
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null)
  /** 容器引用（用于外部点击检测） */
  const containerRef = useRef<HTMLDivElement>(null)

  /** 加载命令列表 */
  const loadCommands = useCallback(async () => {
    if (!isElectronAPIAvailable()) {
      setError('electronAPI 不可用')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await window.electronAPI.atList()
      setCommands(list)
      setHighlightedIndex(0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`加载 @命令列表失败: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [])

  /** visible 变为 true 时加载 */
  useEffect(() => {
    if (visible) {
      void loadCommands()
    }
  }, [visible, loadCommands])

  /** 键盘导航 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || commands.length === 0) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((prev) => (prev + 1) % commands.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((prev) => (prev - 1 + commands.length) % commands.length)
          break
        case 'Enter':
          e.preventDefault()
          if (commands[highlightedIndex]) {
            onSelect(commands[highlightedIndex].type)
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [visible, commands, highlightedIndex, onSelect, onClose]
  )

  /** 注册全局键盘监听（visible 时生效） */
  useEffect(() => {
    if (!visible) return
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [visible, handleKeyDown])

  /** 外部点击关闭 */
  useEffect(() => {
    if (!visible) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // 延迟绑定，避免触发显示的点击事件立刻关闭
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visible, onClose])

  /** 命令列表（稳定顺序，便于键盘导航） */
  const orderedCommands = useMemo(() => {
    // 保持 atList 返回的顺序（与 AT_COMMAND_LIST 一致）
    return commands
  }, [commands])

  if (!visible) return null

  return (
    <div className="at-command-picker" ref={containerRef} role="listbox" aria-label="@命令选择">
      <div className="at-command-picker-header">
        <span className="at-command-picker-title">注入 @命令</span>
        <span className="at-command-picker-hint">↑↓ 选择 · Enter 确认 · Esc 关闭</span>
      </div>
      <div className="at-command-picker-body">
        {loading && <div className="at-command-picker-empty">加载中...</div>}
        {error && <div className="at-command-picker-error">{error}</div>}
        {!loading && !error && orderedCommands.length === 0 && (
          <div className="at-command-picker-empty">暂无可用命令</div>
        )}
        {!loading && !error &&
          orderedCommands.map((cmd, index) => {
            const IconComp = ICON_MAP[cmd.type] || FileOutlined
            return (
              <button
                key={cmd.type}
                type="button"
                role="option"
                aria-selected={index === highlightedIndex}
                className={`at-command-picker-item ${
                  index === highlightedIndex ? 'highlighted' : ''
                }`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => onSelect(cmd.type)}
              >
                <IconComp className="at-command-picker-item-icon" />
                <div className="at-command-picker-item-content">
                  <span className="at-command-picker-item-label">{cmd.label}</span>
                  <span className="at-command-picker-item-desc">{cmd.description}</span>
                </div>
              </button>
            )
          })}
      </div>
    </div>
  )
}

export default AtCommandPicker
