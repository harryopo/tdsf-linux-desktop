/**
 * ExecutionResult — 命令决策终端 + 法证审计日志
 *
 * 设计稿：decision-detail.html 区域2 右侧（命令决策终端）+ 区域6（审计日志）
 *
 * 包含两部分：
 * 1. 命令决策终端：三色点 + 决策 ID + 已校验 tag + 命令块 + 影响范围/耗时/回滚 + 3 按钮
 * 2. 决策审计日志：6 行表格（时间戳/操作者/动作/SHA-256 哈希/结果）
 *
 * 交互：
 * - 采纳执行 / 修改 / 拒绝 按钮回调（mock）
 * - 复制命令按钮（mock 切换"已复制"）
 * - 审计行 hover 高亮
 */
import { useState } from 'react'
import {
  Terminal, Check, X, Edit3, Copy, CheckCheck,
} from 'lucide-react'

/** 审计日志行类型 */
export interface AuditRow {
  timestamp: string
  operator: string
  action: string
  hash: string
  result: 'completed' | 'waiting' | 'pending' | 'passed'
}

/** 命令分段（5 色高亮，与 EvidenceList 一致） */
export interface CmdSegment {
  type: 'name' | 'flag' | 'path' | 'val' | 'sym' | 'comment' | 'text'
  text: string
}

interface ExecutionResultProps {
  /** 决策 ID（如 DEC-087） */
  decisionId: string
  /** 命令分段 */
  commandSegments: CmdSegment[]
  /** 命令注释 */
  commandComment?: string
  /** 影响范围 */
  impact: string
  /** 预计耗时 */
  duration: string
  /** 回滚方案 */
  rollback: string
  /** 是否已校验 */
  verified?: boolean
  /** 审计日志行 */
  auditRows: AuditRow[]
  /** 采纳执行回调 */
  onAccept?: () => void
  /** 修改回调 */
  onModify?: () => void
  /** 拒绝回调 */
  onReject?: () => void
}

/** 命令分段色 */
const CMD_COLORS: Record<CmdSegment['type'], string> = {
  name: 'text-[var(--trae-text-brand)]',
  flag: 'text-[var(--trae-text-default)]',
  path: 'text-[var(--trae-text-default)]',
  val: 'text-[var(--trae-text-default)]',
  sym: 'text-[var(--trae-text-tertiary)]',
  comment: 'text-[var(--trae-text-tertiary)]',
  text: 'text-[var(--trae-text-default)]',
}

/** 审计结果 tag 映射 */
const RESULT_TAGS: Record<AuditRow['result'], { text: string; className: string }> = {
  completed: {
    text: '完成',
    className: 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]',
  },
  passed: {
    text: '通过',
    className: 'border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-[var(--trae-status-success-default)]',
  },
  waiting: {
    text: '等待',
    className: 'border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] text-[var(--trae-status-alert-default)]',
  },
  pending: {
    text: '待触发',
    className: 'border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] text-[var(--trae-text-tertiary)]',
  },
}

/**
 * ExecutionResult 组件
 */
export function ExecutionResult({
  decisionId,
  commandSegments,
  commandComment,
  impact,
  duration,
  rollback,
  verified = true,
  auditRows,
  onAccept,
  onModify,
  onReject,
}: ExecutionResultProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ===== 命令决策终端 ===== */}
      <div className="flex flex-1 min-w-[340px] flex-col overflow-hidden rounded-[var(--trae-radius-10)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]">
        {/* 终端头部 */}
        <div className="flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-error-default)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-alert-default)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-success-default)]" />
          </div>
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3 w-3 text-[var(--trae-text-secondary)]" />
            <span className="font-mono text-[10px] text-[var(--trae-text-secondary)]">
              决策命令 · {decisionId}
            </span>
          </div>
          {verified && (
            <span className="ml-auto inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-success-default)]">
              已校验
            </span>
          )}
        </div>

        {/* 终端主体 */}
        <div className="flex flex-1 flex-col gap-3 p-4">
          {/* 命令块 */}
          <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-code-block)] px-4 py-3 font-mono text-[15px] leading-[1.8]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-[var(--trae-text-tertiary)]">$</span>
              <span className="flex-1">
                {commandSegments.map((seg, i) => (
                  <span key={i} className={CMD_COLORS[seg.type]}>
                    {i > 0 && seg.type !== 'comment' ? ' ' : ''}
                    {seg.text}
                  </span>
                ))}
              </span>
              <button
                type="button"
                data-dom-id="copy-cmd"
                onClick={handleCopy}
                className="shrink-0 rounded p-1 text-[var(--trae-text-tertiary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
                aria-label="复制命令"
              >
                {copied ? <CheckCheck className="h-3.5 w-3.5 text-[var(--trae-status-success-default)]" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            {commandComment && (
              <div className="mt-1 pl-4 text-[12px] text-[var(--trae-text-tertiary)]"># {commandComment}</div>
            )}
          </div>

          {/* 影响范围 / 预计耗时 / 回滚方案 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)]">影响范围</span>
              <span className="text-[12px] font-medium text-[var(--trae-text-default)]">{impact}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)]">预计耗时</span>
              <span className="font-mono text-[12px] font-medium tabular-nums text-[var(--trae-text-default)]">{duration}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)]">回滚方案</span>
              <span className="font-mono text-[12px] font-medium text-[var(--trae-text-default)]">{rollback}</span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="mt-auto flex gap-2">
            <button
              type="button"
              data-dom-id="approve-execution"
              onClick={onAccept}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--trae-radius-6)] bg-[var(--trae-bg-brand)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)]"
            >
              <Check className="h-3.5 w-3.5" />
              采纳执行
            </button>
            <button
              type="button"
              data-dom-id="modify-execution"
              onClick={onModify}
              className="inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:bg-[var(--trae-bg-overlay-l3)]"
            >
              <Edit3 className="h-3.5 w-3.5" />
              修改
            </button>
            <button
              type="button"
              data-dom-id="reject-execution"
              onClick={onReject}
              className="inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-3 py-1.5 text-[12px] font-medium text-[var(--trae-text-default)] transition-colors hover:bg-[var(--trae-bg-overlay-l3)]"
            >
              <X className="h-3.5 w-3.5" />
              拒绝
            </button>
          </div>
        </div>
      </div>

      {/* ===== 决策审计日志 ===== */}
      <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
        {/* 标题栏 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">决策审计日志</span>
            <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2 text-[10px] font-medium text-[var(--trae-text-brand)]">
              不可篡改
            </span>
          </div>
          <span className="text-[10px] text-[var(--trae-text-tertiary)]">法证级 · SHA-256 链式哈希</span>
        </div>

        {/* 表格 */}
        <div className="overflow-hidden rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
          {/* 表头 */}
          <div className="flex items-center gap-4 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)] flex-[0_0_160px]">
              时间戳
            </span>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)] flex-[0_0_100px]">
              操作者
            </span>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)] flex-1 min-w-0">
              动作
            </span>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)] flex-[0_0_120px]">
              哈希
            </span>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--trae-text-tertiary)] flex-[0_0_64px] text-right">
              结果
            </span>
          </div>

          {/* 数据行 */}
          {auditRows.map((row, idx) => {
            const tag = RESULT_TAGS[row.result]
            const isLast = idx === auditRows.length - 1
            const isPending = row.result === 'pending'
            return (
              <div
                key={`${row.timestamp}-${idx}`}
                className={`audit-row flex items-center gap-4 px-4 py-2 transition-colors hover:bg-[var(--trae-bg-overlay-l1)] ${
                  !isLast ? 'border-b border-[var(--trae-border-neutral-l1)]' : ''
                }`}
              >
                <span
                  className={`font-mono text-[10px] tabular-nums flex-[0_0_160px] ${
                    isPending ? 'text-[var(--trae-text-tertiary)]' : 'text-[var(--trae-text-secondary)]'
                  }`}
                >
                  {row.timestamp}
                </span>
                <span
                  className={`text-[10px] flex-[0_0_100px] ${
                    isPending ? 'text-[var(--trae-text-tertiary)]' : 'text-[var(--trae-text-secondary)]'
                  }`}
                >
                  {row.operator}
                </span>
                <span
                  className={`text-[10px] flex-1 min-w-0 ${
                    isPending ? 'text-[var(--trae-text-tertiary)]' : 'text-[var(--trae-text-default)]'
                  }`}
                >
                  {row.action}
                </span>
                <span className="font-mono text-[11px] flex-[0_0_120px] overflow-hidden overflow-ellipsis whitespace-nowrap text-[var(--trae-text-tertiary)]">
                  {row.hash}
                </span>
                <span className="flex flex-[0_0_64px] justify-end">
                  <span className={`inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border px-1.5 text-[10px] font-medium ${tag.className}`}>
                    {tag.text}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
