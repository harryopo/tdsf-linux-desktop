/**
 * xterm.js 终端视图组件 - TerminalView
 *
 * 职责：
 * - 初始化 xterm.js Terminal 实例
 * - 加载 Addon：FitAddon / WebLinksAddon / SearchAddon / WebglAddon（降级）
 * - 通过 window.electronAPI 监听 terminal:data 事件接收 SSH 输出
 * - 通过 window.electronAPI.sshShellWrite 发送用户输入
 * - 支持复制粘贴、字体缩放（Ctrl + / -）
 * - 黑色背景终端（与苹果极简 UI 形成对比）
 *
 * 生命周期：
 * - useEffect 中初始化（DOM 就绪后）
 * - 组件卸载时 dispose 终端实例
 */
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import './TerminalView.css'

/** TerminalView 组件 Props */
interface TerminalViewProps {
  /** SSH 会话 ID */
  sessionId: string
  /** 终端是否可见（非活跃 Tab 时设为 false 可节省渲染资源） */
  visible: boolean
}

/** 终端默认字体大小 */
const DEFAULT_FONT_SIZE = 14
/** 终端最小/最大字体大小 */
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32

/** TerminalView 终端视图 */
const TerminalView: React.FC<TerminalViewProps> = ({ sessionId, visible }) => {
  /** 终端容器 DOM 引用 */
  const containerRef = useRef<HTMLDivElement>(null)
  /** xterm.js Terminal 实例引用 */
  const terminalRef = useRef<Terminal | null>(null)
  /** FitAddon 实例引用 */
  const fitRef = useRef<FitAddon | null>(null)
  /** 当前字体大小 */
  const fontSizeRef = useRef<number>(DEFAULT_FONT_SIZE)

  useEffect(() => {
    if (!containerRef.current) return

    // ===== 1. 创建 Terminal 实例 =====
    const terminal = new Terminal({
      // 黑色背景，与苹果极简 UI 形成对比
      theme: {
        background: '#1a1a1a',
        foreground: '#e8e8e8',
        cursor: '#e8e8e8',
        cursorAccent: '#1a1a1a',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
        black: '#1a1a1a',
        red: '#ff3b30',
        green: '#34c759',
        yellow: '#ff9500',
        blue: '#0071e3',
        magenta: '#af52de',
        cyan: '#30b0c7',
        white: '#e8e8e8',
        brightBlack: '#86868b',
        brightRed: '#ff6b35',
        brightGreen: '#30d158',
        brightYellow: '#ffd60a',
        brightBlue: '#4a9eff',
        brightMagenta: '#c779ff',
        brightCyan: '#5ac8fa',
        brightWhite: '#ffffff',
      },
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
    })
    terminalRef.current = terminal

    // ===== 2. 加载 Addon =====
    const fitAddon = new FitAddon()
    fitRef.current = fitAddon
    terminal.loadAddon(fitAddon)

    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(webLinksAddon)

    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)

    // 尝试加载 WebglAddon（失败则降级到默认 Canvas 渲染）
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      terminal.loadAddon(webglAddon)
    } catch {
      // WebglAddon 加载失败，降级到默认渲染器
      console.warn('[TerminalView] WebglAddon 加载失败，使用默认渲染器')
    }

    // ===== 3. 打开终端到容器 =====
    terminal.open(containerRef.current)

    // 延迟一帧再 fit，确保容器尺寸已计算
    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch {
        // 容器可能尚未就绪
      }
    })

    // ===== 4. 用户输入 → 发送到 SSH Shell =====
    const inputDisposable = terminal.onData((data: string) => {
      if (!isElectronAPIAvailable()) return
      window.electronAPI.sshShellWrite(sessionId, data).catch((error: unknown) => {
        console.error('[TerminalView] 发送输入失败:', error)
      })
    })

    // ===== 5. 监听 terminal:data 事件（SSH 输出 → 终端） =====
    if (isElectronAPIAvailable()) {
      window.electronAPI.onTerminalData((recvSessionId: string, data: string) => {
        if (recvSessionId === sessionId) {
          terminal.write(data)
        }
      })
    }

    // ===== 6. 尺寸变化 → fit + 通知主进程 =====
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        // 通知主进程终端尺寸变化
        if (isElectronAPIAvailable()) {
          window.electronAPI
            .sshShellResize(sessionId, terminal.cols, terminal.rows)
            .catch(() => {
              // 忽略 resize 错误
            })
        }
      } catch {
        // 容器可能已卸载
      }
    })
    resizeObserver.observe(containerRef.current)

    // ===== 7. 字体缩放快捷键（Ctrl + / - / 0） =====
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + +/- 缩放字体
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        fontSizeRef.current = Math.min(fontSizeRef.current + 1, MAX_FONT_SIZE)
        terminal.options.fontSize = fontSizeRef.current
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault()
        fontSizeRef.current = Math.max(fontSizeRef.current - 1, MIN_FONT_SIZE)
        terminal.options.fontSize = fontSizeRef.current
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        fontSizeRef.current = DEFAULT_FONT_SIZE
        terminal.options.fontSize = DEFAULT_FONT_SIZE
      }
    }
    terminal.textarea?.addEventListener('keydown', handleKeyDown)

    // ===== 8. 清理 =====
    return () => {
      inputDisposable.dispose()
      resizeObserver.disconnect()
      terminal.textarea?.removeEventListener('keydown', handleKeyDown)
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  // 非活跃 Tab 时隐藏容器（保持终端实例存活）
  return (
    <div
      ref={containerRef}
      className={`terminal-view ${visible ? 'visible' : 'hidden'}`}
    />
  )
}

export default TerminalView
