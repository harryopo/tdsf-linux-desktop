/**
 * EvidenceList — 高危命令拦截清单
 *
 * 设计稿：decision-detail.html 区域5.5
 * - 左侧统计摘要（已拦截 10 条 + 高危 7 条 + 中危 3 条 + RULE ENGINE R-001~R-010）
 * - 右侧分组命令卡片列表（10 条：7 高 + 3 中，cmd-block 5 色高亮）
 * - checkbox + label 纯展开/收起控制
 * - 底部规则说明 + 清空按钮（mock）
 *
 * cmd-block 5 色高亮：
 *   .cmd-name  → --trae-code-text（命令名）
 *   .cmd-flag  → --trae-text-brand（参数 -rf/-R/-9 等）
 *   .cmd-path  → --trae-accent-cyan（路径 /var/log/*）
 *   .cmd-val   → --trae-code-number（数值 777/root/now）
 *   .cmd-sym   → --trae-code-doc（符号 | & $ ()）
 */
import { useState } from 'react'
import {
  AlertTriangle, ChevronDown, Shield, Trash2, Check, X,
} from 'lucide-react'

/** 危险等级 */
type DangerLevel = 'high' | 'mid'

/** 单条拦截命令 */
export interface DangerCommand {
  /** 规则 ID */
  ruleId: string
  /** 命令分段（用于 5 色高亮渲染） */
  segments: CmdSegment[]
  /** 等级 */
  level: DangerLevel
  /** 威胁描述 */
  threat: string
}

/** 命令分段类型 */
type CmdSegmentType = 'name' | 'flag' | 'path' | 'val' | 'sym' | 'text'

/** 命令分段 */
interface CmdSegment {
  type: CmdSegmentType
  text: string
}

interface EvidenceListProps {
  /** 拦截命令列表 */
  commands: DangerCommand[]
  /** 是否默认展开 */
  defaultExpanded?: boolean
}

/** 等级色映射 */
const LEVEL_STYLES: Record<DangerLevel, {
  borderColor: string
  tagClass: string
  tagText: string
  dotColor: string
  barColor: string
  groupTitle: string
}> = {
  high: {
    borderColor: 'border-l-[2px] border-l-[var(--trae-status-error-default)]',
    tagClass: 'border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-[var(--trae-status-error-default)]',
    tagText: '高',
    dotColor: 'bg-[var(--trae-status-error-default)]',
    barColor: 'bg-[var(--trae-status-error-default)]',
    groupTitle: '高危命令',
  },
  mid: {
    borderColor: 'border-l-[2px] border-l-[var(--trae-status-alert-default)]',
    tagClass: 'border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] text-[var(--trae-status-alert-default)]',
    tagText: '中',
    dotColor: 'bg-[var(--trae-status-alert-default)]',
    barColor: 'bg-[var(--trae-status-alert-default)]',
    groupTitle: '中危命令',
  },
}

/** 分段色映射 */
const SEGMENT_COLORS: Record<CmdSegmentType, string> = {
  name: 'text-[var(--trae-code-text)]',
  flag: 'text-[var(--trae-text-brand)]',
  path: 'text-[var(--trae-accent-cyan)]',
  val: 'text-[var(--trae-code-number)]',
  sym: 'text-[var(--trae-code-doc)]',
  text: 'text-[var(--trae-text-default)]',
}

/**
 * 渲染命令分段（5 色高亮）。
 */
function renderSegments(segments: CmdSegment[]) {
  return segments.map((seg, i) => (
    <span key={i} className={SEGMENT_COLORS[seg.type]}>
      {seg.text}
    </span>
  ))
}

/**
 * EvidenceList 组件
 *
 * 交互入口（spec §B data-dom-id）：
 * - toggle-danger-panel: 展开/收起按钮
 * - close-danger-panel: 关闭整个面板按钮
 * - clear-danger-list: 清空列表按钮
 */
export function EvidenceList({ commands, defaultExpanded = true }: EvidenceListProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [cleared, setCleared] = useState(false)
  const [closed, setClosed] = useState(false)

  const highCmds = commands.filter((c) => c.level === 'high')
  const midCmds = commands.filter((c) => c.level === 'mid')

  if (closed) {
    return null
  }

  return (
    <div className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--trae-status-error-default)]" />
          <span className="text-[16px] font-semibold text-[var(--trae-text-default)]">高危命令拦截清单</span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-error-default)]">
            {commands.length} 条
          </span>
          <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-success-default)]">
            全部已拦截
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-dom-id="toggle-danger-panel"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 rounded-[var(--trae-radius-4)] px-2 py-1 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            aria-label="展开或收起拦截清单"
            aria-expanded={expanded}
          >
            <span>展开/收起</span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[var(--trae-text-secondary)] transition-transform ${expanded ? '' : 'rotate-180'}`}
            />
          </button>
          <button
            type="button"
            data-dom-id="close-danger-panel"
            onClick={() => setClosed(true)}
            className="flex items-center justify-center rounded-[var(--trae-radius-4)] px-1.5 py-1 text-[10px] text-[var(--trae-text-tertiary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
            aria-label="关闭拦截清单面板"
            title="关闭面板"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 主体：统计 + 命令列表 */}
      {expanded && !cleared && (
        <div className="flex gap-6">
          {/* 左侧统计摘要 */}
          <div className="flex w-[172px] shrink-0 flex-col gap-4 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] p-4">
            <div className="text-center">
              <div className="mb-1.5 flex items-center justify-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-[var(--trae-status-error-default)]" />
                <span className="text-[10px] tracking-[0.04em] text-[var(--trae-text-secondary)]">已拦截</span>
              </div>
              <div className="font-mono text-[30px] font-semibold leading-none tabular-nums text-[var(--trae-status-error-default)]">
                {commands.length}
              </div>
              <div className="mt-1 text-[10px] text-[var(--trae-text-tertiary)]">条高危命令</div>
            </div>

            <div className="h-px bg-[var(--trae-border-neutral-l1)]" />

            <div>
              <div className="mb-3 text-[11px] tracking-[0.08em] text-[var(--trae-text-tertiary)]">危险等级</div>

              {/* 高危 */}
              <div className="mb-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] text-[var(--trae-text-secondary)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--trae-status-error-default)]" />
                    高危
                  </span>
                  <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--trae-status-error-default)]">
                    {highCmds.length}
                  </span>
                </div>
                <div className="h-[3px] overflow-hidden rounded bg-[var(--trae-bg-overlay-l1)]">
                  <div
                    className="h-full rounded bg-[var(--trae-status-error-default)]"
                    style={{ width: `${(highCmds.length / commands.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* 中危 */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] text-[var(--trae-text-secondary)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--trae-status-alert-default)]" />
                    中危
                  </span>
                  <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--trae-status-alert-default)]">
                    {midCmds.length}
                  </span>
                </div>
                <div className="h-[3px] overflow-hidden rounded bg-[var(--trae-bg-overlay-l1)]">
                  <div
                    className="h-full rounded bg-[var(--trae-status-alert-default)]"
                    style={{ width: `${(midCmds.length / commands.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="h-px bg-[var(--trae-border-neutral-l1)]" />

            <div className="text-center">
              <div className="font-mono text-[11px] tracking-[0.08em] text-[var(--trae-text-tertiary)]">RULE ENGINE</div>
              <div className="mt-1 font-mono text-[12px] tabular-nums text-[var(--trae-text-secondary)]">
                R-001 ~ R-{String(commands.length).padStart(3, '0')}
              </div>
            </div>
          </div>

          {/* 右侧：分组命令卡片列表 */}
          <div className="flex min-w-0 max-h-[400px] flex-1 flex-col gap-4 overflow-y-auto pr-1 danger-scroll">
            {/* 高危命令组 */}
            {highCmds.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2 pl-1">
                  <span className="h-3.5 w-[3px] rounded-r bg-[var(--trae-status-error-default)]" />
                  <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">高危命令</span>
                  <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-error-default)]">
                    {highCmds.length} 条
                  </span>
                  <span className="h-px flex-1 bg-[var(--trae-border-neutral-l1)]" />
                </div>
                <div className="flex flex-col gap-1.5">
                  {highCmds.map((cmd) => (
                    <DangerCard key={cmd.ruleId} cmd={cmd} />
                  ))}
                </div>
              </div>
            )}

            {/* 中危命令组 */}
            {midCmds.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2 pl-1">
                  <span className="h-3.5 w-[3px] rounded-r bg-[var(--trae-status-alert-default)]" />
                  <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">中危命令</span>
                  <span className="inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] px-2 text-[10px] font-medium text-[var(--trae-status-alert-default)]">
                    {midCmds.length} 条
                  </span>
                  <span className="h-px flex-1 bg-[var(--trae-border-neutral-l1)]" />
                </div>
                <div className="flex flex-col gap-1.5">
                  {midCmds.map((cmd) => (
                    <DangerCard key={cmd.ruleId} cmd={cmd} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 清空后占位 */}
      {cleared && (
        <div className="flex h-[200px] items-center justify-center text-[12px] text-[var(--trae-text-tertiary)]">
          列表已清空
        </div>
      )}

      {/* 底部：规则说明 + 清空按钮 */}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--trae-border-neutral-l1)] pt-4">
        <span className="flex items-center gap-2 text-[10px] text-[var(--trae-text-tertiary)]">
          <Shield className="h-3 w-3 text-[var(--trae-text-tertiary)]" />
          规则引擎 · {commands.length} 条规则 · 对应 L1 预拦截层 · 匹配后阻断执行并记录审计
        </span>
        <button
          type="button"
          data-dom-id="clear-danger-list"
          onClick={() => setCleared(true)}
          className="flex items-center gap-1.5 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-3 py-1.5 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
          aria-label="清空列表"
        >
          <Trash2 className="h-3 w-3 text-[var(--trae-text-secondary)]" />
          清空列表
        </button>
      </div>

      {/* danger-scroll 自定义滚动条样式 */}
      <style>{`
        .danger-scroll::-webkit-scrollbar { width: 6px; }
        .danger-scroll::-webkit-scrollbar-track { background: transparent; }
        .danger-scroll::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--trae-status-error-default) 30%, transparent);
          border-radius: 3px;
        }
        .danger-scroll::-webkit-scrollbar-thumb:hover {
          background: color-mix(in srgb, var(--trae-status-error-default) 50%, transparent);
        }
      `}</style>
    </div>
  )
}

/**
 * 单条命令卡片子组件。
 */
function DangerCard({ cmd }: { cmd: DangerCommand }) {
  const style = LEVEL_STYLES[cmd.level]
  return (
    <div className={`danger-card rounded-r-[var(--trae-radius-4)] bg-[var(--trae-bg-base-tertiary)] p-2 transition-colors hover:bg-[var(--trae-bg-overlay-l2)] ${style.borderColor}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] tracking-[0.04em] tabular-nums text-[var(--trae-text-tertiary)]">
          {cmd.ruleId}
        </span>
        <code className="min-w-0 flex-1 overflow-hidden overflow-ellipsis whitespace-nowrap rounded-[var(--trae-radius-2)] bg-[var(--trae-bg-base-default)] px-2 py-0.5 font-mono text-[10px] leading-[1.4]">
          {renderSegments(cmd.segments)}
        </code>
        <span className={`inline-flex h-5 shrink-0 items-center rounded-[var(--trae-radius-4)] border px-1.5 text-[10px] font-medium ${style.tagClass}`}>
          {style.tagText}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-[var(--trae-text-secondary)]">{cmd.threat}</span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--trae-status-success-default)]">
          <Check className="h-3 w-3 text-[var(--trae-status-success-default)]" />
          已拦截
        </span>
      </div>
    </div>
  )
}
