/**
 * 终端选词管理器 - SelectionManager
 *
 * 教学术语：
 * - Selection（选区）：用户在终端中用鼠标拖动选中的文本范围
 * - xterm.js Selection API：xterm.js 内置的选区管理（mousedown 拖动即可）
 *
 * 职责：
 * 1. 监听 xterm.js 内置的 selectionchange 事件
 * 2. 当有选区时计算浮层显示位置（屏幕坐标）
 * 3. 提取选区文本并通知外部回调
 * 4. 选中状态变化时清理
 *
 * 设计说明：
 * - 不重写 xterm.js 的选区行为（用户已习惯默认拖动选择）
 * - 浮层位置基于鼠标释放位置（更可靠，避免 selectionchange 不带坐标问题）
 * - 通过 mousedown/mousemove/mouseup 追踪最后位置
 * - 移除 xterm.js 5.5 未公开的私有 API 使用
 *
 * @module terminal/selection-manager
 */

import type { Terminal } from '@xterm/xterm'

/** 选词结果 */
export interface SelectionInfo {
  /** 选中的文本（去除首尾空白） */
  text: string
  /** 屏幕坐标（用于浮层定位） */
  screenX: number
  screenY: number
}

/** 回调 */
type SelectionCallback = (info: SelectionInfo | null) => void

export class SelectionManager {
  private readonly terminal: Terminal
  private readonly onSelectionChange: SelectionCallback
  private readonly element: HTMLElement

  /** 鼠标最后一次位置（用于浮层定位） */
  private lastMousePos: { x: number; y: number } | null = null

  /** 上次已通知的选区文本（用于去重） */
  private lastNotifiedText: string | null = null

  /** dispose 列表 */
  private readonly cleanups: Array<() => void> = []

  constructor(terminal: Terminal, onSelectionChange: SelectionCallback) {
    this.terminal = terminal
    this.onSelectionChange = onSelectionChange
    const el = terminal.element
    if (!el) {
      throw new Error('[SelectionManager] terminal.element 不存在')
    }
    this.element = el
    this.bind()
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  private bind(): void {
    // 1. 鼠标按下：记录起点（让 mousemove 仅在按下时更新位置）
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return  // 只处理左键
      this.lastMousePos = { x: e.clientX, y: e.clientY }
    }
    this.element.addEventListener('mousedown', onMouseDown)
    this.cleanups.push(() => this.element.removeEventListener('mousedown', onMouseDown))

    // 2. 鼠标移动：仅在按下时追踪（性能优化）
    const onMouseMove = (e: MouseEvent) => {
      // 使用 buttons 位掩码：1 表示左键按下
      if (e.buttons & 1) {
        this.lastMousePos = { x: e.clientX, y: e.clientY }
      }
    }
    this.element.addEventListener('mousemove', onMouseMove)
    this.cleanups.push(() => this.element.removeEventListener('mousemove', onMouseMove))

    // 3. 鼠标释放：触发选词回调
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return
      this.lastMousePos = { x: e.clientX, y: e.clientY }
      // 等待一帧让 xterm.js 完成选区更新
      requestAnimationFrame(() => this.checkAndNotify())
    }
    this.element.addEventListener('mouseup', onMouseUp)
    this.cleanups.push(() => this.element.removeEventListener('mouseup', onMouseUp))

    // 4. 鼠标离开终端：清理
    const onMouseLeave = () => {
      this.lastMousePos = null
    }
    this.element.addEventListener('mouseleave', onMouseLeave)
    this.cleanups.push(() => this.element.removeEventListener('mouseleave', onMouseLeave))

    // 5. 监听 xterm.js 内置 selection 变化（兜底，处理键盘选择等）
    //    与 mouseup 是互补关系，二者都会触发 checkAndNotify
    //    内部通过 lastNotifiedText 去重
    const sub = this.terminal.onSelectionChange(() => {
      this.checkAndNotify()
    })
    this.cleanups.push(() => sub.dispose())
  }

  // ============================================================
  // 核心逻辑
  // ============================================================

  /**
   * 检查当前选区并通知外部（含去重）
   */
  private checkAndNotify(): void {
    const sel = this.terminal.getSelection()
    const text = sel?.trim() || ''

    if (!text) {
      // 无选区：清空浮层（仅在之前有内容时通知，避免重复）
      if (this.lastNotifiedText !== null) {
        this.lastNotifiedText = null
        this.onSelectionChange(null)
      }
      return
    }

    if (!this.lastMousePos) {
      // 没有位置信息，无法定位浮层（通常发生在 mouseleave 后）
      return
    }

    // 去重：与上次通知的文本相同则跳过
    if (text === this.lastNotifiedText) {
      return
    }
    this.lastNotifiedText = text
    this.onSelectionChange({
      text,
      screenX: this.lastMousePos.x,
      screenY: this.lastMousePos.y,
    })
  }

  // ============================================================
  // 公共方法
  // ============================================================

  /**
   * 主动清除选区与浮层
   */
  clear(): void {
    this.terminal.clearSelection()
    this.lastMousePos = null
    this.lastNotifiedText = null
    this.onSelectionChange(null)
  }

  /**
   * 销毁监听器
   */
  dispose(): void {
    for (const fn of this.cleanups) {
      try {
        fn()
      } catch {
        // 忽略清理错误
      }
    }
    this.cleanups.length = 0
  }
}
