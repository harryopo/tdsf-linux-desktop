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
// v2.7：外观设置（代码主题/代码字体）的终端侧消费者
import { useAppearanceStore, CODE_FONT_STACKS } from '../../stores/appearance-store'
import { SelectionManager } from './selection-manager'
import TerminalSearchBar from './TerminalSearchBar'
import TerminalCompletionAddon from './TerminalCompletionAddon'
import './TerminalView.css'
import './Terminal.css'

/** TerminalView 组件 Props */
interface TerminalViewProps {
  /** SSH 会话 ID */
  sessionId: string
  /** 终端是否可见（非活跃 Tab 时设为 false 可节省渲染资源） */
  visible: boolean
}

/** 终端默认字体大小（v2.5：11px 在 1080p+ 下过小显破碎，调大到 13px） */
const DEFAULT_FONT_SIZE = 13
/** 终端最小/最大字体大小 */
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32

/**
 * v2.7：代码高亮主题 → xterm 色板（外观设置 syntax.theme 真实消费者）
 * 背景色保持与容器 --trae-terminal-block-bg 对齐，ansi 色按主题调整
 */
const XTERM_THEMES: Record<string, Partial<import('@xterm/xterm').ITheme>> = {
  'one-dark': {
    background: '#0f1011', foreground: '#e8e8e8', cursor: '#4a9eff',
    red: '#E06C75', green: '#98C379', yellow: '#E5C07B', blue: '#61AFEF',
    magenta: '#C678DD', cyan: '#56B6C2',
  },
  monokai: {
    background: '#1e1f1c', foreground: '#F8F8F2', cursor: '#F8F8F0',
    red: '#F92672', green: '#A6E22E', yellow: '#E6DB74', blue: '#66D9EF',
    magenta: '#AE81FF', cyan: '#A1EFE4',
  },
  'solarized-dark': {
    background: '#002B36', foreground: '#93A1A1', cursor: '#93A1A1',
    red: '#DC322F', green: '#859900', yellow: '#B58900', blue: '#268BD2',
    magenta: '#D33682', cyan: '#2AA198',
  },
  'github-dark': {
    background: '#0D1117', foreground: '#C9D1D9', cursor: '#58A6FF',
    red: '#FF7B72', green: '#3FB950', yellow: '#D29922', blue: '#58A6FF',
    magenta: '#BC8CFF', cyan: '#39C5CF',
  },
}

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
  /** v0.9.7 终端实例已打开到 DOM，可挂载补全覆盖层 */
  const [terminalReady, setTerminalReady] = useState(false)
  /** v0.8.0 翻译开关状态（订阅 store 变化以动态挂载/卸载 SelectionManager） */
  const translateEnabled = useTranslateStore((s) => s.enabled)
  /** v2.8：订阅外观设置 —— 代码主题/字体切换对已打开的终端即时生效
   *（此前只在终端创建时读一次，设置页切了颜色看不到变化） */
  const appearanceCodeTheme = useAppearanceStore((s) => s.codeTheme)
  const appearanceCodeFont = useAppearanceStore((s) => s.codeFont)

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    const palette = XTERM_THEMES[appearanceCodeTheme]
    if (palette) {
      terminal.options.theme = { ...terminal.options.theme, ...palette }
    }
    const stack = CODE_FONT_STACKS[appearanceCodeFont]
    if (stack) terminal.options.fontFamily = stack
    fitRef.current?.fit()
  }, [appearanceCodeTheme, appearanceCodeFont])

  useEffect(() => {
    if (!containerRef.current) return

    // ===== 1. 创建 Terminal 实例 =====
    const terminal = new Terminal({
      // v2.5 视觉修复：背景与容器变量 --trae-terminal-block-bg(#0f1011) 对齐，
      // 消除之前 #1a1a1a vs #0f1011 的“双色套娃框”；光标/选区用品牌蓝
      theme: {
        background: '#0f1011',
        foreground: '#e8e8e8',
        cursor: '#4a9eff',
        cursorAccent: '#0f1011',
        selectionBackground: 'rgba(74, 158, 255, 0.28)',
        black: '#0f1011',
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
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.45,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
    })
    terminalRef.current = terminal

    // ===== v2.7 设置真实落地：异步应用终端设置 + 外观代码主题/字体 =====
    // 此前 TerminalSettings 页的 terminal.* 保存后被这里的硬编码无视（假设置）；
    // 现在创建后立即读取并覆盖 xterm options（xterm 支持运行时改 options）
    void (async () => {
      try {
        const api = window.electronAPI
        const app = useAppearanceStore.getState()
        // 代码高亮主题色板（外观设置）
        const themePalette = XTERM_THEMES[app.codeTheme]
        if (themePalette) {
          terminal.options.theme = { ...terminal.options.theme, ...themePalette }
        }
        // 代码字体（外观设置）
        const codeStack = CODE_FONT_STACKS[app.codeFont]
        if (codeStack) terminal.options.fontFamily = codeStack
        // 终端专属设置（TerminalSettings 页 terminal.* key）
        if (api?.configGet) {
          const [fs, lh, cs, cb, sb] = await Promise.all([
            api.configGet<number>('terminal.fontSize'),
            api.configGet<number>('terminal.lineHeight'),
            api.configGet<string>('terminal.cursorStyle'),
            api.configGet<boolean>('terminal.cursorBlink'),
            api.configGet<number>('terminal.scrollback'),
          ])
          if (typeof fs === 'number' && fs >= MIN_FONT_SIZE && fs <= MAX_FONT_SIZE) {
            fontSizeRef.current = fs
            terminal.options.fontSize = fs
          }
          if (typeof lh === 'number' && lh >= 1 && lh <= 2) terminal.options.lineHeight = lh
          if (cs === 'block' || cs === 'underline' || cs === 'bar') terminal.options.cursorStyle = cs
          if (typeof cb === 'boolean') terminal.options.cursorBlink = cb
          if (typeof sb === 'number' && sb > 0) terminal.options.scrollback = sb
        }
        fitRef.current?.fit()
      } catch (err) {
        console.warn('[TerminalView] 应用终端设置失败（使用默认值）', err)
      }
    })()

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
    setTerminalReady(true)

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
    // v2.6 修复：已拆到独立 useEffect（见下方）。原来在这里挂载并把
    // translateEnabled 放进本 effect 依赖，导致每次切换翻译开关都
    // dispose 重建整个终端（屏幕内容全部丢失）。

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
      // v2.0 清理 xterm 选中监听
      selectionDisposable.dispose()
      if (selectionDebounce) {
        clearTimeout(selectionDebounce)
      }
      // v2.0 清理 SearchAddon 引用
      searchAddonRef.current = null
      setTerminalReady(false)
      try {
        terminal.dispose()
      } catch {
        // 终端可能已销毁
      }
      terminalRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  // ===== v0.8.0 翻译选词监听（v2.6 拆为独立 effect） =====
  // 切换翻译开关只挂载/卸载 SelectionManager，不再重建终端实例
  useEffect(() => {
    if (!translateEnabled || !terminalReady || !terminalRef.current) return
    const selectionManager = new SelectionManager(terminalRef.current, (info) => {
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
    return () => {
      selectionManager.dispose()
      // 关闭开关时清掉残留选区浮层
      useTranslateStore.getState().clear()
    }
  }, [translateEnabled, terminalReady])

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
      {terminalReady && terminalRef.current && (
        <TerminalCompletionAddon
          terminal={terminalRef.current}
          sessionId={sessionId}
        />
      )}
    </div>
  )
}

export default TerminalView
