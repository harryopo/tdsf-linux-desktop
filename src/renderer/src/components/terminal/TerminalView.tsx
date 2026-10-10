/**
 * xterm.js 终端视图组件 - TerminalView
 *
 * 职责：
 * - 初始化 xterm.js Terminal 实例
 * - 加载 Addon：FitAddon / WebLinksAddon / SearchAddon / WebglAddon（降级）
 * - 通过 terminal-bus 订阅本终端（shellId）的 SSH 输出（IPC 总订阅在 App 启动时装好）
 * - 通过 window.electronAPI.sshShellWrite 发送用户输入
 * - 支持复制粘贴、字体缩放（Ctrl + / -）
 * - 黑色背景终端（与苹果极简 UI 形成对比）
 * - v0.8.0 集成翻译选词（SelectionManager + 浮层）
 *
 * 生命周期：
 * - useEffect 中初始化（DOM 就绪后）
 * - 组件卸载时 dispose 终端实例
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useTerminalStore } from '../../stores/terminal-store'
import { createBlockModel, lastBlock, toAiContext, finishedBlocks } from '../../terminal/block-model'
import { attachBlockCollector } from '../../terminal/block-collector'
import { subscribeShellData } from '../../terminal/terminal-bus'
import type { ShellKind } from '../../stores/terminal-store'
import { CODE_THEMES } from '@shared/code-themes'
import { SelectionManager } from './selection-manager'
import { formatTerminalClipboard } from './clipboard-format'
import TerminalSearchBar from './TerminalSearchBar'
import TerminalCompletionAddon from './TerminalCompletionAddon'
import './TerminalView.css'
import './Terminal.css'

/** TerminalView 组件 Props */
interface TerminalViewProps {
  /** 终端通道 ID（主进程按它分发输出；一条 SSH 连接可以有多个终端） */
  shellId: string
  /** 这条终端跑在本机还是 SSH 远端：键入与 resize 要走各自的通道 */
  kind: ShellKind
  /** 终端是否可见（非活跃 Tab 时设为 false 可节省渲染资源） */
  visible: boolean
}

/** 终端默认字体大小（v2.5：11px 在 1080p+ 下过小显破碎，调大到 13px） */
const DEFAULT_FONT_SIZE = 13
/** 终端最小/最大字体大小 */
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32

/** TerminalView 终端视图 */
const TerminalView: React.FC<TerminalViewProps> = ({ shellId, kind, visible }) => {
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
  /** 复制相关开关（终端设置页 terminal.autoCopy / stripNewline / stripControlChars，异步读回来后给选区监听用） */
  const copyPrefsRef = useRef({
    autoCopy: false,
    stripNewline: false,
    stripControlChars: true,
  })
  /** 视觉响铃开关（terminal.bellEnabled，异步读回来后给 onBell 用） */
  const bellRef = useRef(false)
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

  /**
   * 重算终端行列，并把新尺寸回报主进程。
   *
   * 字号或字体一变，格子的像素尺寸就变：不重算行列，xterm 会把容器一路撑高
   * （实测 Ctrl+ 四次后容器 712→920px，底边落到视口外 184px，状态栏整个被顶没）；
   * 而 PTY 侧仍按旧尺寸换行，远端输出的行会对不齐。所以 fit 之后必须报一次尺寸。
   */
  const refit = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    try {
      fitRef.current?.fit()
    } catch {
      return // 容器可能已卸载
    }
    if (!isElectronAPIAvailable()) return
    const api = window.electronAPI
    const report =
      kind === 'local'
        ? api.localTtyResize?.(shellId, terminal.cols, terminal.rows)
        : api.sshShellResize(shellId, terminal.cols, terminal.rows)
    report?.catch(() => {
      // 终端正在关闭时尺寸回报会失败，不影响界面
    })
  }, [shellId, kind])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    const palette = CODE_THEMES[appearanceCodeTheme]?.terminal
    if (palette) {
      terminal.options.theme = { ...terminal.options.theme, ...palette }
    }
    const stack = CODE_FONT_STACKS[appearanceCodeFont]
    if (stack) terminal.options.fontFamily = stack
    refit()
  }, [appearanceCodeTheme, appearanceCodeFont, refit])

  useEffect(() => {
    if (!containerRef.current) return

    // ===== 1. 创建 Terminal 实例 =====
    const terminal = new Terminal({
      // 配色来自 src/shared/code-themes.ts（与外观设置页同一份表），
      // 初值取用户当前主题，避免"先画默认色、下一帧再改"的闪色
      theme: { ...CODE_THEMES[useAppearanceStore.getState().codeTheme].terminal },
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
        const themePalette = CODE_THEMES[app.codeTheme]?.terminal
        if (themePalette) {
          terminal.options.theme = { ...terminal.options.theme, ...themePalette }
        }
        // 代码字体（外观设置）
        const codeStack = CODE_FONT_STACKS[app.codeFont]
        if (codeStack) terminal.options.fontFamily = codeStack
        // 终端专属设置（TerminalSettings 页 terminal.* key）
        if (api?.configGet) {
          const [fs, lh, cs, cb, sb, bell, autoCopy, stripNl, stripCc] = await Promise.all([
            api.configGet<number>('terminal.fontSize'),
            api.configGet<number>('terminal.lineHeight'),
            api.configGet<string>('terminal.cursorStyle'),
            api.configGet<boolean>('terminal.cursorBlink'),
            api.configGet<number>('terminal.scrollback'),
            api.configGet<boolean>('terminal.bellEnabled'),
            api.configGet<boolean>('terminal.autoCopy'),
            api.configGet<boolean>('terminal.stripNewline'),
            api.configGet<boolean>('terminal.stripControlChars'),
          ])
          if (typeof fs === 'number' && fs >= MIN_FONT_SIZE && fs <= MAX_FONT_SIZE) {
            fontSizeRef.current = fs
            terminal.options.fontSize = fs
          }
          if (typeof lh === 'number' && lh >= 1 && lh <= 2) terminal.options.lineHeight = lh
          if (cs === 'block' || cs === 'underline' || cs === 'bar') terminal.options.cursorStyle = cs
          if (typeof cb === 'boolean') terminal.options.cursorBlink = cb
          if (typeof sb === 'number' && sb > 0) terminal.options.scrollback = sb
          // 响铃：xterm 5 没有 bellStyle 选项，只能自己听 onBell 闪一下容器
          if (typeof bell === 'boolean') bellRef.current = bell
          copyPrefsRef.current = {
            autoCopy: autoCopy === true,
            stripNewline: stripNl === true,
            stripControlChars: stripCc !== false,
          }
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

    // 命令块收集器：旁听 OSC 133/633，把字符流切成【命令 → 输出 → 退出码】。
    // handler 一律 return false（规矩见 terminal/block-collector.ts 文件头
    // 与 tests/unit/xterm-osc-return-false.test.ts）——返回 true 会掐断 OSC 链。
    const blockModel = createBlockModel()
    const setCommandBlocks = useTerminalStore.getState().setCommandBlocks
    const blockCollector = attachBlockCollector(terminal, blockModel, (m) => {
      const last = lastBlock(m)
      setCommandBlocks({
        count: finishedBlocks(m).length,
        lastCommand: last?.command ?? null,
        lastExitCode: last?.exitCode ?? null,
        context: toAiContext(m),
      })
    })

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

    // ===== 4. 用户输入 → 发送到这条通道对应的 Shell（本机 / 远端各自的通道）=====
    const inputDisposable = terminal.onData((data: string) => {
      if (!isElectronAPIAvailable()) return
      const api = window.electronAPI
      const write = kind === 'local' ? api.localTtyWrite?.(shellId, data) : api.sshShellWrite(shellId, data)
      write?.catch((error: unknown) => {
        console.error('[TerminalView] 发送输入失败:', error)
      })
    })

    // ===== 5. 监听 Shell 输出 → 本终端（走 terminal-bus，不在这里直接订 IPC）=====
    // 按 shellId 过滤，不是 sessionId：同一条连接开两个终端时，
    // 按会话过滤会让两个终端都收到对方的输出（串字）。
    // 为什么不在这里 onTerminalData：那几帧空窗（本 effect 还没跑）里的输出会丢，
    // bus 在 App 启动时就装好总订阅并暂存无人订阅的输出，这里一挂上就补齐。
    const offShellData = subscribeShellData(shellId, (data: string) => {
      const term = terminalRef.current
      if (!term) return
      try {
        term.write(data)
      } catch {
        // 终端可能已销毁
      }
    })

    // ===== 6. 尺寸变化 → fit + 通知主进程（防抖 150ms，避免高频触发） =====
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) return
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null
        refit()
      }, 150)
    })
    resizeObserver.observe(containerRef.current)

    // ===== 7. 字体缩放快捷键（Ctrl + / - / 0） =====
    // 改完字号必须等 xterm 量出新格子尺寸再 refit（下一帧），否则行列数不变、
    // 终端按旧行数继续把容器撑高，底部行与状态栏一起掉到视口外。
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + +/- 缩放字体
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        fontSizeRef.current = Math.min(fontSizeRef.current + 1, MAX_FONT_SIZE)
        terminal.options.fontSize = fontSizeRef.current
        requestAnimationFrame(refit)
      } else if (e.ctrlKey && e.key === '-') {
        e.preventDefault()
        fontSizeRef.current = Math.max(fontSizeRef.current - 1, MIN_FONT_SIZE)
        terminal.options.fontSize = fontSizeRef.current
        requestAnimationFrame(refit)
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        fontSizeRef.current = DEFAULT_FONT_SIZE
        terminal.options.fontSize = DEFAULT_FONT_SIZE
        requestAnimationFrame(refit)
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
          // 选中即复制（terminal.autoCopy）：Linux 终端的老习惯，默认关
          if (copyPrefsRef.current.autoCopy) {
            const clipText = formatTerminalClipboard(text, copyPrefsRef.current)
            void navigator.clipboard?.writeText(clipText).catch(() => {
              // 剪贴板权限被拒时保持"只选中不复制"，不打断输入
            })
          }
        } else {
          // 选中清空时也清除 store（避免浮层残留）
          setSelection(null)
        }
      }, 50)
    })

    // ===== 7.7 视觉响铃（terminal.bellEnabled）=====
    // xterm 5 的 ITerminalOptions 没有 bellStyle，只能自己听 onBell 给容器加一闪
    const bellDisposable = terminal.onBell(() => {
      if (!bellRef.current) return
      const el = containerRef.current
      if (!el) return
      el.classList.add('term-bell-flash')
      setTimeout(() => el.classList.remove('term-bell-flash'), 220)
    })

    // ===== 8. 清理 =====
    return () => {
      // 撤掉命令块收集器并清空摘要（不撤的话状态栏会留着上一个会话的命令）
      blockCollector.dispose()
      bellDisposable.dispose()
      setCommandBlocks(null)
      // 取消输出订阅（缓存与别的终端的订阅不受影响）
      offShellData()
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
  }, [shellId, kind, refit])

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
          shellId={shellId}
          kind={kind}
        />
      )}
    </div>
  )
}

export default TerminalView
