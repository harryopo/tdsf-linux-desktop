/**
 * CommandTerminal — 命令决策终端（活跃态简化版）
 *
 * 抽离自 DecisionPage.tsx（M2 Task 3 review fix），展示当前决策的 fixCommand +
 * 修复说明 + 三按钮（采纳并执行 / 修改 / 拒绝）。
 *
 * 视觉：终端样式（macOS 红黄绿三圆点 + Terminal 图标）+ 命令语法高亮（按
 * name/flag/path/sym/comment 着色）+ 等待确认徽章 + 三按钮组。
 *
 * Token 合规：所有颜色使用 var(--trae-*) 或 var(--bg-brand)，无硬编码。
 */
import { Terminal, Check, X, Edit3 } from 'lucide-react'
import type { DecisionCard } from '@shared/models'
import { parseCommandSegments } from '@/utils/decision-mappers'

interface CommandTerminalProps {
  /** 当前决策卡片 */
  card: DecisionCard
  /** 是否等待用户确认（true 时按钮可用） */
  waiting: boolean
  /** 是否正在提交审批（true 时按钮禁用并显示 loading） */
  confirming: boolean
  /** 采纳并执行回调 */
  onAccept: () => void
  /** 打开修改弹窗回调 */
  onModify: () => void
  /** 拒绝决策回调 */
  onReject: () => void
}

/** 命令决策终端（活跃态简化版：fixCommand + 修复说明 + 三按钮） */
export function CommandTerminal({
  card,
  waiting,
  confirming,
  onAccept,
  onModify,
  onReject,
}: CommandTerminalProps) {
  const segments = parseCommandSegments(card.fixCommand)
  const disabled = confirming || !waiting
  return (
    <div className="flex min-w-[340px] flex-1 flex-col overflow-hidden rounded-[var(--trae-radius-10)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]">
      {/* 终端 header */}
      <div className="flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-error-default)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-alert-default)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-success-default)]" />
        </div>
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3 w-3 text-[var(--trae-text-secondary)]" />
          <span className="font-mono text-[10px] text-[var(--trae-text-secondary)]">
            决策命令 · #{card.id}
          </span>
        </div>
        {waiting && (
          <span className="ml-auto inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
            等待确认
          </span>
        )}
      </div>
      {/* 命令展示 */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)] px-4 py-3 font-mono text-[14px] leading-[1.8]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--trae-text-tertiary)]">$</span>
            <code className="flex-1 break-all">
              {segments.map((seg, i) => (
                <span
                  key={i}
                  className={
                    seg.type === 'name'
                      ? 'text-[var(--trae-text-brand)]'
                      : seg.type === 'flag'
                      ? 'text-[var(--trae-text-default)]'
                      : seg.type === 'path'
                      ? 'text-[var(--trae-text-default)]'
                      : seg.type === 'sym'
                      ? 'text-[var(--trae-text-tertiary)]'
                      : seg.type === 'comment'
                      ? 'text-[var(--trae-text-tertiary)]'
                      : 'text-[var(--trae-text-default)]'
                  }
                >
                  {i > 0 && seg.type !== 'comment' ? ' ' : ''}
                  {seg.text}
                </span>
              ))}
            </code>
          </div>
        </div>
        {card.fixDescription && (
          <p className="text-[11px] leading-[1.6] text-[var(--trae-text-secondary)]">
            {card.fixDescription}
          </p>
        )}
        {/* 三按钮 */}
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={disabled}
            data-dom-id="accept-execute"
            className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--trae-radius-4)] bg-[var(--bg-brand)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--bg-brand-hover)] disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            采纳并执行
          </button>
          <button
            type="button"
            onClick={onModify}
            disabled={disabled}
            data-dom-id="modify-cmd"
            className="btn-press inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)] disabled:opacity-50"
          >
            <Edit3 className="h-3.5 w-3.5" />
            修改
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={confirming}
            data-dom-id="reject-cmd"
            className="btn-press inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.06)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-status-error-default)] transition-colors hover:bg-[rgba(246,90,90,0.12)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            拒绝
          </button>
        </div>
      </div>
    </div>
  )
}
