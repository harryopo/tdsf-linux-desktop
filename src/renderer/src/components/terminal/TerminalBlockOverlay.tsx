/**
 * 终端命令块工具条（2026-11-01）
 *
 * 块模型早就在跑（喂 AI 上下文与状态栏），但终端里看不见"块"：exit code / 耗时 / cwd
 * 要自己在滚动区里找，复制输出要手动抹选。这里在 xterm 视口上叠一层与 buffer 行对齐的
 * 分隔线 + 工具条（借 B 的交互）：块尾一条工具栏，带 exit、耗时、复制命令、复制输出、重跑。
 *
 * 位置换算：y = (row - baseY) * cellHeight。baseY/rows 在每次渲染帧、滚动与尺寸变化时重取；
 * cellHeight 从 .xterm-rows 的第一行量（xterm 没有公开的 cell 尺寸 API）。
 *
 * 不接管终端：所有 handler 仍然 return false，这里只是"画在上面"。
 */
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { CommandBlock } from '../../terminal/block-model'
import './TerminalBlockOverlay.css'

/** 同时最多画这么多条工具栏：一次会话几百条命令，DOM 不能跟着长 */
export const BLOCK_TOOLBAR_MAX = 40

export interface BlockLayout {
  id: number
  /** 工具栏顶边（px，相对终端容器）；用 translateY(-100%) 贴在块尾那一行上方 */
  y: number
  /** 分隔线顶边（命令提示符那一行） */
  separatorY: number
  command: string
  exitCode: number | null
  durationMs: number | null
  ok: boolean
}

/** 纯函数：把"块 + 视口"算成"该画在哪"。视口外的不画，顺序按行从上到下 */
export function layoutBlockToolbars(
  blocks: readonly CommandBlock[],
  view: { baseY: number; rows: number },
  cellHeight: number
): BlockLayout[] {
  if (!Number.isFinite(cellHeight) || cellHeight <= 0 || view.rows <= 0) return []
  const out: BlockLayout[] = []
  for (let i = blocks.length - 1; i >= 0 && out.length < BLOCK_TOOLBAR_MAX; i--) {
    const b = blocks[i]
    if (!b.command || b.promptRow === null) continue
    const anchorRow = b.endRow ?? b.promptRow
    const rel = anchorRow - view.baseY
    const promptRel = b.promptRow - view.baseY
    if (rel < 0 || rel >= view.rows) continue
    out.push({
      id: b.id,
      y: rel * cellHeight,
      separatorY: promptRel >= 0 && promptRel < view.rows ? promptRel * cellHeight : -1,
      command: b.command,
      exitCode: b.exitCode,
      durationMs:
        b.startedAt !== null && b.startedAt !== undefined && b.endedAt !== null && b.endedAt !== undefined
          ? Math.max(0, b.endedAt - b.startedAt)
          : null,
      ok: b.exitCode === 0,
    })
  }
  return out.reverse()
}

/** 0ms / 850ms / 2.4s / 1m5s：排障时看的是量级，不是毫秒精度 */
export function formatBlockDuration(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  const s = Math.round(ms / 1_000)
  return `${Math.floor(s / 60)}m${s % 60}s`
}

function measureCellHeight(terminal: Terminal): number | null {
  const rows = terminal.element?.querySelector('.xterm-rows')
  const first = rows?.firstElementChild as HTMLElement | null | undefined
  const h = first?.getBoundingClientRect().height
  return h && h > 0 ? h : null
}

interface TerminalBlockOverlayProps {
  terminal: Terminal | null
  blocks: CommandBlock[]
  visible: boolean
  /** 重跑：把命令写回同一个 shell（与用户手敲走同一条通道） */
  onRerun: (command: string) => void
  /**
   * 只在"量不到 DOM 行高"时兜底（xterm 还没渲染出 .xterm-rows 的那一帧、或测试替身）。
   * 正常路径永远以真 DOM 量出来的高度为准。
   */
  cellHeightPx?: number
}

export const TerminalBlockOverlay: FC<TerminalBlockOverlayProps> = ({
  terminal,
  blocks,
  visible,
  onRerun,
  cellHeightPx,
}) => {
  const [layouts, setLayouts] = useState<BlockLayout[]>([])
  const [copied, setCopied] = useState<Record<number, 'command' | 'output'>>({})
  const frameRef = useRef<number | null>(null)
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

  const recompute = useCallback(() => {
    if (!terminal || !visible) {
      setLayouts([])
      return
    }
    const buffer = terminal.buffer.active
    const cell = cellHeightPx ?? measureCellHeight(terminal) ?? 16
    setLayouts(layoutBlockToolbars(blocksRef.current, { baseY: buffer.baseY, rows: terminal.rows }, cell))
  }, [terminal, visible, cellHeightPx])

  // 块变了立即重算（onIteration → onChange → props.blocks）
  useEffect(() => {
    recompute()
  }, [recompute, blocks])

  // 滚动/重绘/窗口尺寸变化都要重算：xterm 的行像素位置会整体位移
  useEffect(() => {
    if (!terminal || !visible) return
    const schedule = (): void => {
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        recompute()
      })
    }
    const renderSub = terminal.onRender?.(() => schedule())
    const scrollSub = terminal.onScroll?.(() => schedule())
    window.addEventListener('resize', schedule)
    return () => {
      renderSub?.dispose()
      scrollSub?.dispose()
      window.removeEventListener('resize', schedule)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [terminal, visible, recompute])

  const copy = async (text: string, id: number, kind: 'command' | 'output'): Promise<void> => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied((s) => ({ ...s, [id]: kind }))
      window.setTimeout(() => {
        setCopied((s) => {
          const next = { ...s }
          delete next[id]
          return next
        })
      }, 1_500)
    } catch {
      // 剪贴板不可用就不报"已复制"——宁可没反应，也不给假的成功回执
    }
  }

  if (!visible || layouts.length === 0) return null

  return (
    <div className="terminal-block-overlay" data-dom-id="terminal-block-overlay">
      {layouts.map((l) => {
        const output = byId.get(l.id)?.outputText ?? ''
        return (
          <div key={l.id} className="terminal-block-layer" style={{ transform: `translateY(${l.y}px)` }}>
            {l.separatorY >= 0 && (
              <span
                aria-hidden
                className={`terminal-block-separator ${l.ok ? 'is-ok' : 'is-bad'}`}
                style={{ position: 'absolute', top: l.separatorY - l.y, left: 0, right: 0 }}
              />
            )}
            <div
              className="terminal-block-toolbar"
              data-dom-id={`terminal-block-${l.id}`}
              data-exit={l.exitCode ?? 'running'}
            >
              <span className={`terminal-block-exit ${l.ok ? 'is-ok' : 'is-bad'}`}>
                {l.exitCode === null ? '…' : `exit ${l.exitCode}`}
              </span>
              <code className="terminal-block-cmd" title={l.command}>
                {l.command}
              </code>
              {l.durationMs !== null && (
                <span className="terminal-block-duration">{formatBlockDuration(l.durationMs)}</span>
              )}
              <button
                type="button"
                aria-label={`复制命令：${l.command}`}
                onClick={() => void copy(l.command, l.id, 'command')}
              >
                {copied[l.id] === 'command' ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                aria-label={`复制输出：${l.command}`}
                disabled={!output}
                onClick={() => void copy(output, l.id, 'output')}
              >
                {copied[l.id] === 'output' ? '已复制' : '输出'}
              </button>
              <button type="button" aria-label={`重跑：${l.command}`} onClick={() => onRerun(l.command)}>
                重跑
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
