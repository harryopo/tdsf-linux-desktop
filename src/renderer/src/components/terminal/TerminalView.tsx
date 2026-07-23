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
 * - v0.8.0 集成翻译选词（SelectionManager + 浮层）
 *
 * 生命周期：
 * - useEffect 中初始化（DOM 就绪后）
 * - 组件卸载时 dispose 终端实例
 */
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
// import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { isElectronAPIAvailable } from '../../utils/electron-api'
import { useTranslateStore } from '../../stores/translate-store'
import { useEditorStore } from '../../stores/editor-store'
import { SelectionManager } from './selection-manager'
import TerminalSearchBar from './TerminalSearchBar'
import './TerminalView.css'
import './Terminal.css'

/** TerminalView 组件 Props */
interface TerminalViewProps {
  /** SSH 会话 ID */
  sessionId: string
  /** 终端是否可见（非活跃 Tab 时设为 false 可节省渲染资源） */
  visible: boolean
}

/** 终端默认字体大小 */
const DEFAULT_FONT_SIZE = 13
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
  /** SearchAddon 实例引用（供 TerminalSearchBar 使用） */
  const searchAddonRef = useRef<SearchAddon | null>(null)
  /** 当前字体大小 */
  const fontSizeRef = useRef<number>(DEFAULT_FONT_SIZE)
  /** 终端搜索栏显隐状态（Ctrl+F 触发） */
  const [searchOpen, setSearchOpen] = useState(false)
  /** v0.8.0 翻译开关状态（订阅 store 变化以动态挂载/卸载 SelectionManager） */
  const translateEnabled = useTranslateStore((s) => s.enabled)

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
    searchAddonRef.current = searchAddon

    // 默认使用 xterm.js 内置 Canvas 渲染器，避免 WebGL 在部分 GPU 驱动下崩溃
    // 如需启用 WebGL 加速，可取消下面注释并安装 @xterm/addon-webgl
    // try {
    //   const { WebglAddon } = await import('@xterm/addon-webgl')
    //   const webglAddon = new WebglAddon()
    //   webglAddon.onContextLoss(() => {
    //     webglAddon.dispose()
    //   })
    //   terminal.loadAddon(webglAddon)
    // } catch {
    //   console.warn('[TerminalView] WebglAddon 加载失败，使用默认渲染器')
    // }

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
    let offTerminalData: (() => void) | null = null
    if (isElectronAPIAvailable()) {
      offTerminalData = window.electronAPI.onTerminalData((recvSessionId: string, data: string) => {
        if (recvSessionId === sessionId && terminalRef.current) {
          try {
            terminalRef.current.write(data)
          } catch {
            // 终端可能已销毁
          }
        }
      })
    }

    // ===== 6. 尺寸变化 → fit + 通知主进程（防抖 150ms，避免高频触发） =====
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) return
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null
        if (!terminalRef.current) return
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
      }, 150)
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
      } else if (e.ctrlKey && e.key === 'f') {
        // Ctrl+F 触发终端搜索栏
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    terminal.textarea?.addEventListener('keydown', handleKeyDown)

    // ===== 7.5 v0.8.0 翻译选词监听 =====
    // 仅当 enabled = true 时挂载，避免无谓开销
    let selectionManager: SelectionManager | null = null
    if (translateEnabled) {
      selectionManager = new SelectionManager(terminal, (info) => {
        const { setSelection } = useTranslateStore.getState()
        if (info) {
          setSelection({
            text: info.text,
            screenX: info.screenX,
            screenY: info.screenY,
          })
        } else {
          setSelection(null)
        }
      })
    }

    // ===== 7.6 v2.0 xterm 选中桥接 → editor-store.selection =====
    // 选中终端文本时，写入 editor-store.selection（type='cmd'），触发 SelectionPopover 浮层
    // 鼠标松开后 50ms 检查选中（避免拖拽过程中频繁触发）
    let selectionDebounce: ReturnType<typeof setTimeout> | null = null
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (selectionDebounce) clearTimeout(selectionDebounce)
      selectionDebounce = setTimeout(() => {
        if (!terminalRef.current) return
        const text = terminalRef.current.getSelection()
        const { setSelection } = useEditorStore.getState()
        if (text && text.trim().length > 0) {
          setSelection({
            text: text.trim(),
            type: 'cmd',
          })
        } else {
          // 选中清空时也清除 store（避免浮层残留）
          setSelection(null)
        }
      }, 50)
    })

    // ===== 8. 清理 =====
    return () => {
      // 取消 IPC 事件监听
      if (offTerminalData) {
        offTerminalData()
      }
      inputDisposable.dispose()
      resizeObserver.disconnect()
      terminal.textarea?.removeEventListener('keydown', handleKeyDown)
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      // v0.8.0 清理选词监听
      if (selectionManager) {
        selectionManager.dispose()
        selectionManager = null
      }
      // v2.0 清理 xterm 选中监听
      selectionDisposable.dispose()
      if (selectionDebounce) {
        clearTimeout(selectionDebounce)
      }
      // v2.0 清理 SearchAddon 引用
      searchAddonRef.current = null
      try {
        terminal.dispose()
      } catch {
        // 终端可能已销毁
      }
      terminalRef.current = null
      fitRef.current = null
    }
  }, [sessionId, translateEnabled])

  // 非活跃 Tab 时隐藏容器（保持终端实例存活）
  // 注意：SelectionPopover 由 TerminalTabs 统一渲染（避免多实例）
  return (
    <div
      ref={containerRef}
      className={`terminal-view ${visible ? 'visible' : 'hidden'}`}
      style={{ position: 'relative' }}
    >
      <TerminalSearchBar
        open={searchOpen}
        searchAddon={searchAddonRef.current}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  )
}

export default TerminalView
