import { memo, useMemo, useState, type FC } from 'react'
import { AlertTriangle, Check, ChevronRight, Clock, Loader2, Pause, Play, Sparkles, X } from 'lucide-react'
import type { AgentMessage } from '@/stores/agent-store'
import type { AgentStep } from '@shared/models'
import { MarkdownMessage } from './MarkdownMessage'
import ChatCredibility from './ChatCredibility'
import {
  TOOL_KIND_INPUT_LABELS,
  TOOL_KIND_LABELS,
  TOOL_KIND_RUNNING_LABELS,
  identifyTool,
  isCommandKind,
  isStructuredInput,
  showsKindBadge,
} from './tool-identity'
import { resolveErrorNextStep, type ErrorAction } from '../error-next-step'
import './MarkdownMessage.css'

/**
 * 工具名 → 身份（图标 / 中文名 / 类别）的唯一入口在 ./tool-identity.ts。
 * 这里以前自己抄了一份名字表、一个"命令类"集合和一个 switch 图标分支，
 * 主进程每加一个工具就要在三处跟着改，漏一处界面上就是英文原名
 * （`monitor_get` 那一条连名字都是错的，真名 monitor_get_data，从没命中过）。
 */

/**
 * 复制到剪贴板的小按钮（命令输出 / 工具结果都用得上）。
 *
 * 环境拿不到剪贴板时（navigator.clipboard 不存在或被拒）干脆不画——
 * 画一个点了没反应的按钮，比没有按钮更让人觉得软件坏了。
 */
const CopyChip: FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false)
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText)
  if (!canCopy) return null
  return (
    <button
      type="button"
      className="ai-tool-copy"
      aria-label="复制到剪贴板"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          // 写失败就不动：不谎报"已复制"
          .catch(() => setCopied(false))
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

/** Agent 工作流 7 步骤有序列表 */
const ALL_STEPS: AgentStep[] = ['collect', 'analyze', 'reason', 'check', 'confirm', 'execute', 'verify']

/** 步骤中文标签 */
const STEP_LABELS: Record<AgentStep, string> = {
  collect: '采集',
  analyze: '分析',
  reason: '推理',
  check: '检查',
  confirm: '确认',
  execute: '执行',
  verify: '验证',
}

/** 只提取【明确标注 shell 语系】代码块里的命令（bash/sh/shell/zsh/console） */
const SHELL_LANG_RE = /^(bash|sh|shell|zsh|console|shell-session)$/i

/** 剔除行尾注释（仅当 # 在引号外、且前面是空白时，避免误伤 url#anchor / $# 等） */
function stripInlineComment(cmd: string): string {
  let inSingle = false
  let inDouble = false
  for (let j = 0; j < cmd.length; j++) {
    const ch = cmd[j]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble && (j === 0 || /\s/.test(cmd[j - 1]))) {
      return cmd.slice(0, j)
    }
  }
  return cmd
}

/** 判断一行是否“像命令”（过滤流程图箭头/框线字符、HTML 标签、中文开头的说明文） */
function looksLikeCommand(line: string): boolean {
  if (!line) return false
  // v2.11：必须含至少一个字母/数字 → 过滤纯符号行（如单个 > / $ / | / —），
  // 防止 AI 用 > 作提示符时漏出“空命令”条目
  if (!/[a-zA-Z0-9]/.test(line)) return false
  // 流程图/示意图的箭头与框线字符 → 非命令
  if (/[\u25b6\u25bc\u25c0\u25b2\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c\u2192\u2190\u2191\u2193]/.test(line)) return false
  // HTML/XML 标签行 → 非命令（heredoc 已整体处理，此处兜底）
  if (/^<\/?[a-zA-Z!]/.test(line)) return false
  // 以中文开头 → 说明文，非命令
  if (/^[\u4e00-\u9fa5]/.test(line)) return false
  return true
}

/**
 * 解析一个 shell 代码块，返回【逻辑命令】列表。
 *
 * v2.4 修复（命令提取失控）：
 * - heredoc（<< EOF）body 整体归为一条命令，不再把 HTML 等内容拆成一堆假命令
 * - 续行（\\ 结尾）合并为一条
 * - 剔除行尾中文注释、跳过纯注释/空行、过滤流程图文字
 */
function parseShellBlock(block: string): string[] {
  const out: string[] = []
  const lines = block.split('\n')
  let i = 0
  let pending = ''
  while (i < lines.length) {
    const rawTrim = lines[i].replace(/^\s*[$>]\s+/, '').trim() // 去掉行首 $ 或 > 提示符
    i++
    // v2.11：跳过空行/注释/单独提示符行（> 或 $ 自成一行，非真命令）
    if (!rawTrim || rawTrim === '>' || rawTrim === '$' || rawTrim.startsWith('#')) continue

    // heredoc：<< EOF / <<-'EOF' → body 直到终止符全部并入当前命令（作为一条多行命令）
    const heredoc = rawTrim.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/)
    if (heredoc) {
      const term = heredoc[1]
      const body: string[] = []
      while (i < lines.length && lines[i].trim() !== term) {
        body.push(lines[i])
        i++
      }
      const termLine = i < lines.length ? lines[i] : term
      if (i < lines.length) i++
      out.push([rawTrim, ...body, termLine.trim()].join('\n'))
      continue
    }

    // 续行：\\ 结尾 → 累积
    if (rawTrim.endsWith('\\')) {
      pending += rawTrim.slice(0, -1) + ' '
      continue
    }
    const cleaned = stripInlineComment(pending + rawTrim).trim()
    pending = ''
    if (cleaned && looksLikeCommand(cleaned)) out.push(cleaned)
  }
  return out
}

/**
 * 从消息文本中提取 shell 命令。
 *
 * 只处理【明确标注 shell 语系】的围栏代码块（```bash / ```sh …）；
 * 无语言标记、```html / ```text / ```yaml 等一律不当命令（避免把流程图/HTML 误列）。
 */
export function extractCommands(content: string): string[] {
  const commands: string[] = []
  const fenceRe = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g
  let match = fenceRe.exec(content)
  while (match) {
    const lang = (match[1] || '').trim()
    if (SHELL_LANG_RE.test(lang)) {
      commands.push(...parseShellBlock(match[2]))
    }
    match = fenceRe.exec(content)
  }
  return commands
}

interface LiveMessageRowProps {
  message: AgentMessage
  onNavigate?: (path: string) => void
  /** 工具操作回调（执行/沙箱预演等） */
  onToolAction?: (action: string, payload?: string) => void
  /** 活跃 SSH 会话 ID（执行命令需要） */
  activeSessionId?: string | null
  /** 错误后的"重试"：重发本轮提问 */
  onRetry?: () => void
  /** 错误后的"压缩上下文" */
  onCompress?: () => void
}

/**
 * 实时 Agent 消息行（useAgentStore / Supervisor 主路径）
 *
 * v3.2 命令检测：自动解析 agent 回复中的 bash 代码块，添加"执行"/"沙箱预演"按钮。
 */
const LiveMessageRow: FC<LiveMessageRowProps> = ({ message, onNavigate, onToolAction, activeSessionId, onRetry, onCompress }) => {
  // v2.5 深度思考折叠态：null=跟随默认（流式中展开、完成后收起），用户点击后固定
  const [reasoningOpen, setReasoningOpen] = useState<boolean | null>(null)
  const reasoningExpanded = reasoningOpen ?? message.isStreaming === true

  // v2.5 检索类工具卡折叠态（按 toolCallId）：未点击时跟随默认（执行中展开、完成收起）
  const [toolOpenMap, setToolOpenMap] = useState<Record<string, boolean>>({})

  // v2.4：命令提取用 useMemo 缓存，避免流式期间每 token 重复跑正则（滚动卡顿主因之一）；
  // 流式/错误态直接返回空，不跑解析。
  const commands = useMemo(
    () => (message.isStreaming || message.isError ? [] : extractCommands(message.content)),
    [message.content, message.isStreaming, message.isError],
  )

  /** 渲染深度思考折叠块（v2.5：设计稿 Panel A — ai-tool-row + 左缘竖线正文） */
  const renderReasoning = () => {
    if (!message.reasoning) return null
    const thinkingLive = message.isStreaming && !message.content
    return (
      <div className="ai-reasoning">
        <button
          type="button"
          className="ai-tool-row w-full text-left"
          onClick={() => setReasoningOpen(!reasoningExpanded)}
        >
          <Sparkles className="size-3 text-(--accent-text)" />
          <span className="font-medium text-ink">深度思考</span>
          <span className={`text-micro ${thinkingLive ? 'ai-shimmer-text' : 'text-ink-mute'}`}>
            {thinkingLive ? '思考中…' : '已完成'}
          </span>
          <ChevronRight
            className={`ml-auto size-3 text-ink-mute transition-transform duration-150 ${reasoningExpanded ? 'rotate-90' : ''}`}
          />
        </button>
        {reasoningExpanded && (
          <div className="ai-reasoning-body">
            {message.reasoning}
          </div>
        )}
      </div>
    )
  }

  /** 渲染 Agent 工作流步骤进度条（如果 message.stepState 存在） */
  const renderStepProgress = () => {
    if (!message.stepState) return null
    const { currentStep, completedSteps, waitingForConfirmation } = message.stepState
    return (
      <div className="mt-1.5 flex gap-1 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-base-tertiary)] px-2 py-1.5 text-caption">
        {ALL_STEPS.map((step) => {
          const isCompleted = completedSteps.includes(step)
          const isCurrent = currentStep === step
          const isWaiting = isCurrent && waitingForConfirmation
          return (
            <span
              key={step}
              className={[
                'inline-flex items-center gap-0.5 rounded-[2px] border px-1.5 py-0.5 transition-colors duration-150',
                isCompleted
                  ? 'border-transparent bg-accent-solid font-medium text-[var(--trae-text-onbrand)]'
                  : isCurrent
                    ? 'border-transparent bg-[var(--trae-status-primary-surface-l2)] font-medium text-(--accent-text)'
                    : 'border-transparent bg-transparent text-ink-mute',
                isWaiting ? 'border-[var(--trae-status-alert-default)]' : '',
              ].join(' ')}
            >
              {STEP_LABELS[step]}
              {isWaiting && <Pause className="size-3" />}
            </span>
          )
        })}
      </div>
    )
  }

  /** 从消息中提取命令，渲染“在终端执行”按钮（v2.5：沙箱功能已全量移除） */
  const renderCommandButtons = () => {
    if (message.isStreaming || message.isError) return null
    if (!onToolAction || !activeSessionId) return null
    if (commands.length === 0) return null
    return (
      <div className="mt-2.5 flex flex-col gap-2 border-t border-[var(--trae-border-neutral-l1)] pt-2.5">
        <div className="flex items-center gap-1.5 text-caption font-medium text-ink-dim">
          <Play className="size-3 text-(--accent-text)" />
          检测到 {commands.length} 条命令
        </div>
        {commands.map((cmd, i) => {
          // 多行命令（如 heredoc）只展示首行 + 行数，避免擑爆列表；执行时仍用完整 cmd
          const multiline = cmd.includes('\n')
          const display = multiline
            ? `${cmd.split('\n')[0]} …(${cmd.split('\n').length} 行)`
            : cmd
          return (
          <div key={i} className="flex items-center gap-2">
            <code
              title={cmd}
              className="flex-1 truncate rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2.5 py-1.5 font-mono text-sm leading-[1.5] text-ink"
            >
              {display}
            </code>
            <button
              type="button"
              onClick={() => onToolAction('execute', cmd)}
              title="发送到终端执行（回显可见）"
              className="btn-press inline-flex shrink-0 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2.5 py-1.5 text-caption font-medium text-(--accent-text) transition-opacity hover:opacity-90"
            >
              <Play className="size-3" />
              在终端执行
            </button>
          </div>
          )
        })}
      </div>
    )
  }

  /** 渲染单张工具卡（v2.8 抽取：供穿插渲染与尾部兑底共用）
   *
   * - 命令类（ssh_readonly）：终端命令卡（$ 提示符 + 黑底输出块）
   * - 检索类（kb_search / tutorial_search 等）：设计稿 Panel C 式折叠行
   */
  const renderToolCard = (evt: NonNullable<AgentMessage['toolEvents']>[number]) => {
    const identity = identifyTool(evt.toolName)
    const KindIcon = identity.icon

    // 命令类 → 终端命令卡
    if (isCommandKind(identity.kind)) {
      return (
        <div key={evt.toolCallId} className="ai-tool-exec">
          <div className="ai-tool-exec-head">
            {evt.done ? (
              evt.ok ? (
                <Check className="size-3.5 text-(--status-success-text)" />
              ) : (
                <X className="size-3.5 text-(--status-error-text)" />
              )
            ) : (
              <Loader2 className="size-3.5 animate-spin text-(--accent-text)" />
            )}
            <KindIcon className="size-3.5 text-(--accent-text)" />
            <span className="ai-tool-exec-name">{identity.label}</span>
            {showsKindBadge(identity.kind) && (
              <span className="ai-tool-kind">{TOOL_KIND_LABELS[identity.kind]}</span>
            )}
            {!evt.done && <span className="ai-tool-exec-status">{TOOL_KIND_RUNNING_LABELS[identity.kind]}</span>}
            {evt.done && (
              <span className={`ai-tool-exec-pill ${evt.ok ? 'is-ok' : 'is-fail'}`}>
                {evt.ok ? '执行成功' : '执行失败'}
              </span>
            )}
          </div>
          {evt.input && (
            <div className="ai-tool-exec-cmd">
              <span className="ai-tool-exec-prompt">$</span> {evt.input}
            </div>
          )}
          {/* v2.6：执行中即流式展示输出（phase='output' 增量累积），不再等 result */}
          {evt.output && (
            <pre className={`ai-tool-exec-output ${evt.done && !evt.ok ? 'is-error' : ''}`}>{evt.output}</pre>
          )}
          {evt.output && <CopyChip text={evt.output} />}
        </div>
      )
    }

    // 其余类别 → 设计稿 Panel C 式折叠行（执行中展开，完成后默认收起）
    const expanded = toolOpenMap[evt.toolCallId] ?? !evt.done
    // 条数只认工具自己报的那个（result.count）；没有就不显示数字。
    // 以前在这里用正则数摘要文本的 "1. 2. 3." 行，于是技能匹配、工具装配
    // 这些输出不是编号列表的卡片全被判成"无结果"——界面在说没发生过的事。
    const knownCount = evt.done && evt.ok && typeof evt.count === 'number' ? evt.count : null
    const badge = !evt.done
      ? TOOL_KIND_RUNNING_LABELS[identity.kind]
      : !evt.ok
        ? '失败'
        : knownCount === null
          ? '完成'
          : knownCount > 0
            ? `${knownCount} 条结果`
            : '无结果'
    return (
      <div key={evt.toolCallId} className="ai-tool-search">
        <button
          type="button"
          className="ai-tool-row w-full text-left"
          onClick={() =>
            setToolOpenMap((m) => ({ ...m, [evt.toolCallId]: !expanded }))
          }
        >
          <KindIcon className="size-3 text-(--accent-text)" />
          <span className="ai-tool-name text-ink">{identity.label}</span>
          {showsKindBadge(identity.kind) && (
            <span className="ai-tool-kind">{TOOL_KIND_LABELS[identity.kind]}</span>
          )}
          <span
            className={`ai-tool-badge ${
              !evt.done
                ? 'ai-tool-badge-brand'
                : !evt.ok
                  ? 'ai-tool-badge-error'
                  : knownCount !== null && knownCount > 0
                    ? 'ai-tool-badge-brand'
                    : ''
            }`}
          >
            {!evt.done && <Loader2 className="size-3 animate-spin" />}
            {badge}
          </span>
          <ChevronRight
            className={`ml-auto size-3 text-ink-mute transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        {expanded && (
          <div className="ai-tool-search-body">
            {evt.input && (
              <div className="ai-tool-search-query">
                <span className="ai-tool-io-label">{TOOL_KIND_INPUT_LABELS[identity.kind]}：</span>
                {isStructuredInput(evt.input) ? (
                  <code className="ai-tool-io-code">{evt.input}</code>
                ) : (
                  <span className="ai-tool-io-text">{evt.input}</span>
                )}
              </div>
            )}
            {evt.done && evt.output && (
              <div className={`ai-tool-search-output ${evt.ok ? '' : 'is-error'}`}>
                {evt.output}
              </div>
            )}
            {evt.done && evt.output && <CopyChip text={evt.output} />}
          </div>
        )}
      </div>
    )
  }

  /**
   * v2.8 穿插分片：按 anchorOffset 把正文切成段，工具卡插在它真实发生的位置
   *
   * - 锚点吸附到最近的换行边界，避免把句子拦腰切断
   * - 无锚点的旧数据事件保留在尾部（兼容历史消息）
   */
  const segments = useMemo(() => {
    const events = message.toolEvents ?? []
    const content = message.content || ''
    const inline = events
      .filter((e) => typeof e.anchorOffset === 'number')
      .sort((a, b) => (a.anchorOffset ?? 0) - (b.anchorOffset ?? 0))
    const tail = events.filter((e) => typeof e.anchorOffset !== 'number')
    const segs: Array<
      | { kind: 'text'; text: string }
      | { kind: 'tool'; evt: NonNullable<AgentMessage['toolEvents']>[number] }
    > = []
    let pos = 0
    for (const evt of inline) {
      let off = Math.min(Math.max(evt.anchorOffset ?? 0, pos), content.length)
      // 吸附到锚点前最近的换行，避免句内拦腰
      const nl = content.lastIndexOf('\n', off)
      if (nl > pos) off = nl + 1
      if (off > pos) segs.push({ kind: 'text', text: content.slice(pos, off) })
      segs.push({ kind: 'tool', evt })
      pos = off
    }
    if (pos < content.length) segs.push({ kind: 'text', text: content.slice(pos) })
    return { segs, tail }
  }, [message.content, message.toolEvents])

  /** 尾部兑底：无锚点事件（历史数据）仍按旧方式堆在消息后 */
  const renderToolEvents = () => {
    if (segments.tail.length === 0) return null
    return (
      <div className="mt-2 flex flex-col gap-1">
        {segments.tail.map((evt) => renderToolCard(evt))}
      </div>
    )
  }

  /** 渲染底部 3 动作按钮（消息完成且非错误时显示） */
  /**
   * 报错之后给一条真能走的路（分类码在渲染层不再只当装饰）
   *
   * 只渲染"父组件真的传了对应回调"的动作：按钮点了没反应，比没有按钮更让人怀疑软件坏了。
   */
  const renderErrorCard = () => {
    if (!message.isError) return null
    const step = resolveErrorNextStep(message.errorCode)
    const handlers: Record<ErrorAction, (() => void) | undefined> = {
      settings: onNavigate ? () => onNavigate('/settings/model') : undefined,
      retry: onRetry,
      compress: onCompress,
    }
    const labels: Record<ErrorAction, string> = {
      settings: '去设置 · 模型',
      retry: '重试',
      compress: '压缩上下文',
    }
    const actions = step ? step.actions.filter((a) => handlers[a]) : []
    const raw = message.errorMessage ?? ''
    return (
      <div className="ai-error-card">
        <AlertTriangle className="ai-error-card__icon" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="ai-error-card__title">{step?.hint ?? '这次回答没完成'}</div>
          {raw !== '' && <div className="ai-error-card__raw">{raw}</div>}
          {actions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {actions.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => handlers[a]?.()}
                  className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-transparent px-2 py-0.5 text-caption text-(--accent-text) transition-colors duration-150 hover:bg-[var(--trae-bg-overlay-l1)]"
                >
                  {labels[a]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderActionButtons = () => {
    if (message.isStreaming || message.isError) return null
    if (!onNavigate) return null
    return (
      <div className="mt-2 flex gap-2 border-t border-[var(--trae-border-neutral-l1)] pt-2">
        <button
          type="button"
          onClick={() => onNavigate('/monitor')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-caption text-ink-dim transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-ink"
        >
          查看监控
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/history')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-caption text-ink-dim transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-ink"
        >
          记录决策
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/knowledge')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-caption text-ink-dim transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-ink"
        >
          更新知识库
        </button>
      </div>
    )
  }

  if (message.role === 'user') {
    const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return (
      <div className="ai-msg ai-msg-user">
        <div className="ai-msg-user-inner">
          <div className="ai-msg-user-bubble whitespace-pre-wrap">
            {message.content}
          </div>
          <span className="ai-msg-time">{time}</span>
        </div>
      </div>
    )
  }

  // assistant / system
  return (
    <div className="ai-msg ai-msg-multi">
      <div className="ai-msg-with-avatar">
        <div className="ai-avatar">
          {message.isStreaming ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles />
          )}
        </div>
        <div className="ai-card-wrap">
          {/* v2.11：深度思考块置于最终回答上方（对齐 Trae：先思考过程、后答案） */}
          {renderReasoning()}
          {/* 正文只装真说过的话；错误单独一张卡（见 renderErrorCard）。
              上一版把 `[错误] …` 拼进 content 并整块按错误样式渲染，
              已经流出来的半截答案会跟着一起变红。 */}
          {segments.segs.length > 0 ? (
            /* v2.8 穿插渲染：正文分片与工具卡按真实发生顺序交错（命令在流式输出里，
               不再全部堆在消息尾部） */
            <div className="flex flex-col gap-1.5">
              {segments.segs.map((seg, i) =>
                seg.kind === 'text' ? (
                  <div key={`seg-${i}`} className="ai-card">
                    <MarkdownMessage content={seg.text} />
                    {message.isStreaming && i === segments.segs.length - 1 && (
                      <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-accent-solid align-middle" />
                    )}
                  </div>
                ) : (
                  <div key={`tool-${seg.evt.toolCallId}`}>{renderToolCard(seg.evt)}</div>
                ),
              )}
              {/* 流式中且最后一片是工具卡 → 光标单独补一行（命令后续文本即将到来） */}
              {message.isStreaming && segments.segs[segments.segs.length - 1]?.kind === 'tool' && (
                <div className="ai-card">
                  <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-accent-solid align-middle" />
                </div>
              )}
            </div>
          ) : message.isStreaming || message.content ? (
            <div className="ai-card">
              {/* 有思考链时不重复显示占位（下方“深度思考”块已有“思考中…”） */}
              {message.isStreaming && !message.reasoning ? '思考中…' : ''}
              {message.isStreaming && (
                <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-accent-solid align-middle" />
              )}
            </div>
          ) : null}
          {/* 失败态：一条错误只在这里说一次（流底部那条红色横幅由 MessageList 让位给这里） */}
          {renderErrorCard()}
        </div>
      </div>
      {renderStepProgress()}
      {renderToolEvents()}
      {/* v2.5：完成态且有真实工具轨迹时，展示 D-S/PCR5 可信度分析折叠块 */}
      {!message.isStreaming && !message.isError && (
        <ChatCredibility message={message} />
      )}
      {renderCommandButtons()}
      {/*
       * 被用户"停止"的回答要说在半截处停住了（调研 P0-2）。
       * 以前这里什么都没有：内容停在半句、流动态关掉，与"模型说完了"长得一模一样。
       */}
      {message.cancelled && !message.isStreaming && (
        <div className="ai-token-row pl-8 text-caption text-ink-mute" data-dom-id="message-cancelled">
          已停止 · 上面是中断处的半截回答，模型没有说到完
        </div>
      )}
      {(message.usage || message.model) && !message.isStreaming && (
        <div
          className="ai-token-row ai-token-pop pl-8"
          data-dom-id="message-usage-row"
        >
          <Clock className="size-3" />
          <span>
            {[
              message.model,
              // 拿不到实测用量就说没拿到（被停止的那一轮多数落在这一条），
              // 既不写 0 也不留一个后头空着的分隔符。
              message.usage
                ? `${message.usage.totalTokens.toLocaleString()} tokens`
                : '没拿到实测用量',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}
      {message.contextNote && !message.isStreaming && (
        <div className="ai-token-row pl-8 text-caption text-ink-mute">{message.contextNote}</div>
      )}
      {renderActionButtons()}
    </div>
  )
}

export default memo(LiveMessageRow)
