/**
 * 终端智能补全 UI 组件（Phase 1）
 *
 * 零 Token 本地补全的渲染层：
 * - 监听 xterm.js 用户输入，提取当前行作为前缀
 * - 调用主进程 TerminalCompletionEngine 获取补全建议
 * - 在光标右侧显示灰色尾随建议（ghost text）
 * - 按右箭头或 Tab 接受建议，将剩余文本写入 shell
 *
 * 设计约束：
 * - 不访问任何在线 API，完全本地
 * - 防抖 80ms，避免每次按键都请求
 * - 输入变化/失去焦点/接受建议时清空建议
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './TerminalCompletionAddon.css'

/** 组件 Props */
interface TerminalCompletionAddonProps {
  /** xterm.js Terminal 实例 */
  terminal: Terminal
  /** SSH 会话 ID */
  sessionId: string
}

/** 补全建议项（与 preload 暴露类型一致） */
interface CompletionSuggestion {
  /** 完整命令 */
  command: string
  /** 需要追加的文本 */
  completion: string
  /** 分数 */
  score: number
  /** 来源 */
  source: 'history' | 'static'
}

const TerminalCompletionAddon: React.FC<TerminalCompletionAddonProps> = ({
  terminal,
  sessionId,
}) => {
  const [suggestion, setSuggestion] = useState<CompletionSuggestion | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const overlayRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  /** 当前输入缓冲区（仅当前行） */
  const inputRef = useRef('')

  /** 计算建议浮层位置（基于光标坐标） */
  const updateOverlayPosition = useCallback(() => {
    if (!terminal || !containerRef.current) return
    try {
      const buffer = terminal.buffer.active
      const cursorX = buffer.cursorX
      const cursorY = buffer.cursorY
      const cellWidth = terminal.cols > 0 ? containerRef.current.clientWidth / terminal.cols : 8
      const cellHeight = terminal.rows > 0 ? containerRef.current.clientHeight / terminal.rows : 15
      const left = cursorX * cellWidth
      const top = cursorY * cellHeight
      setPosition({ left, top })
    } catch {
      // 忽略 xterm 未就绪时的计算异常
    }
  }, [terminal])

  /** 清空建议 */
  const clearSuggestion = useCallback(() => {
    setSuggestion(null)
  }, [])

  /** 请求补全建议 */
  const requestCompletion = useCallback(
    async (prefix: string) => {
      if (!prefix || !isElectronAPIAvailable()) {
        clearSuggestion()
        return
      }
      try {
        const suggestions = await window.electronAPI.terminalCompletionComplete(prefix)
        if (!mountedRef.current) return
        const best = suggestions.find(
          (s) => s.command !== prefix && s.command.startsWith(prefix)
        )
        if (best) {
          setSuggestion(best)
          updateOverlayPosition()
        } else {
          clearSuggestion()
        }
      } catch (err) {
        console.error('[TerminalCompletionAddon] complete 失败:', err)
        clearSuggestion()
      }
    },
    [clearSuggestion, updateOverlayPosition]
  )

  /** 接受建议 */
  const acceptSuggestion = useCallback(async () => {
    if (!suggestion || !terminal || !isElectronAPIAvailable()) return
    const completion = suggestion.completion
    if (!completion) return
    try {
      await window.electronAPI.sshShellWrite(sessionId, completion)
      await window.electronAPI.terminalCompletionAccept(suggestion.command)
      inputRef.current += completion
      clearSuggestion()
    } catch (err) {
      console.error('[TerminalCompletionAddon] 接受建议失败:', err)
    }
  }, [suggestion, terminal, sessionId, clearSuggestion])

  useEffect(() => {
    mountedRef.current = true
    if (!terminal?.element) return
    containerRef.current = terminal.element

    /** 从终端当前行提取输入前缀 */
    const extractPrefix = () => {
      try {
        const line = terminal.buffer.active.getLine(terminal.buffer.active.cursorY)
        const text = line?.translateToString(true) ?? ''
        return text.trimStart()
      } catch {
        return ''
      }
    }

    /** 输入事件处理 */
    const onDataDisposable = terminal.onData((data: string) => {
      // 只处理可打印字符，忽略控制字符
      if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) !== 127) {
        inputRef.current += data
      } else if (data === '\r' || data === '\n') {
        // 回车：记录当前命令后清空
        if (inputRef.current.trim()) {
          // 记录到历史索引由主进程端通过 accept/import 完成
        }
        inputRef.current = ''
        clearSuggestion()
        return
      } else if (data === '\x7f' || data === '\b') {
        // Backspace
        inputRef.current = inputRef.current.slice(0, -1)
      } else if (data === '\x03') {
        // Ctrl+C
        inputRef.current = ''
        clearSuggestion()
        return
      } else {
        // 其他控制字符，尝试重新从终端行提取
        inputRef.current = extractPrefix()
      }

      const prefix = inputRef.current.trimStart()
      if (!prefix) {
        clearSuggestion()
        return
      }

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        requestCompletion(prefix)
      }, 80)
    })

    /** 按键事件：右箭头 / Tab 接受建议 */
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!suggestion) return
      if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault()
        acceptSuggestion()
      } else if (e.key === 'Escape') {
        clearSuggestion()
      }
    }
    terminal.textarea?.addEventListener('keydown', handleKeyDown)

    /** 光标移动/滚动时更新位置 */
    const cursorDisposable = terminal.onCursorMove(() => {
      if (suggestion) updateOverlayPosition()
    })

    return () => {
      mountedRef.current = false
      onDataDisposable.dispose()
      cursorDisposable.dispose()
      terminal.textarea?.removeEventListener('keydown', handleKeyDown)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [terminal, sessionId, suggestion, acceptSuggestion, clearSuggestion, requestCompletion, updateOverlayPosition])

  if (!suggestion) return null

  return (
    <div
      ref={overlayRef}
      className="terminal-completion-overlay"
      style={{
        left: position.left,
        top: position.top,
      }}
      aria-label={`补全建议: ${suggestion.command}`}
    >
      {suggestion.completion}
    </div>
  )
}

export default TerminalCompletionAddon
