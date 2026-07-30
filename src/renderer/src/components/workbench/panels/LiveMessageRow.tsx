import { memo, useMemo, useState, type FC } from 'react'
import {
  Activity, BookOpen, Check, ChevronRight, Clock, Layers, Loader2, Pause, Play,
  Search, Sparkles, Terminal as TerminalIcon, Wrench, X,
} from 'lucide-react'
import type { AgentMessage } from '@/stores/agent-store'
import type { AgentStep } from '@shared/models'
import MarkdownMessage from './MarkdownMessage'
import ChatCredibility from './ChatCredibility'
import './MarkdownMessage.css'

/** 工具名 → 中文展示名（v2.4：真实工具执行可视化） */
function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    ssh_readonly: '只读诊断命令',
    ssh_write: '写操作命令',
    ssh_journal_follow: '实时日志追踪',
    sftp_read: '读远程文件',
    kb_search: '检索知识库',
    tutorial_search: '检索教程',
    memory_recall: '回忆长期记忆',
    skill_match: '匹配技能',
    monitor_get: '采集监控',
    tool_route: '工具装配',
    thinking_route: '思考强度',
  }
  return map[name] ?? name
}

/** 命令类工具（渲染终端命令卡）；其余一律按检索类折叠行渲染（v2.5；v2.9 抩写命令/日志追踪） */
const COMMAND_TOOLS = new Set(['ssh_readonly', 'ssh_write', 'ssh_journal_follow'])

/** 检索类工具图标（设计稿 Panel B/C/D：brand 色小图标） */
function searchToolIcon(name: string): JSX.Element {
  const cls = 'size-3 text-[var(--trae-bg-brand)]'
  switch (name) {
    case 'kb_search':
      return <Layers className={cls} />
    case 'tutorial_search':
      return <BookOpen className={cls} />
    case 'skill_match':
      return <Wrench className={cls} />
    case 'tool_route':
      return <Wrench className={cls} />
    case 'thinking_route':
      return <Sparkles className={cls} />
    case 'monitor_get':
      return <Activity className={cls} />
    case 'sftp_read':
      return <BookOpen className={cls} />
    default:
      return <Search className={cls} />
  }
}

/** 从检索输出中估算结果条数（summary 为 "1. [..] ..." 每行一条） */
function countSearchResults(output: string | undefined): number {
  if (!output) return 0
  return output.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length
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
}

/**
 * 实时 Agent 消息行（useAgentStore / Supervisor 主路径）
 *
 * v3.2 命令检测：自动解析 agent 回复中的 bash 代码块，添加"执行"/"沙箱预演"按钮。
 */
const LiveMessageRow: FC<LiveMessageRowProps> = ({ message, onNavigate, onToolAction, activeSessionId }) => {
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
          <Sparkles className="size-3 text-[var(--trae-bg-brand)]" />
          <span className="font-medium text-[var(--trae-text-default)]">深度思考</span>
          <span className={`text-[10px] ${thinkingLive ? 'ai-shimmer-text' : 'text-[var(--trae-text-tertiary)]'}`}>
            {thinkingLive ? '思考中…' : '已完成'}
          </span>
          <ChevronRight
            className={`ml-auto size-2.5 text-[var(--trae-text-tertiary)] transition-transform duration-150 ${reasoningExpanded ? 'rotate-90' : ''}`}
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
      <div className="mt-1.5 flex gap-1 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-base-tertiary)] px-2 py-1.5 text-[11px]">
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
                  ? 'border-transparent bg-[var(--trae-bg-brand)] font-medium text-[var(--trae-text-onbrand)]'
                  : isCurrent
                    ? 'border-transparent bg-[var(--trae-status-primary-surface-l2)] font-medium text-[var(--trae-text-brand)]'
                    : 'border-transparent bg-transparent text-[var(--trae-text-tertiary)]',
                isWaiting ? 'border-[var(--trae-status-alert-default)]' : '',
              ].join(' ')}
            >
              {STEP_LABELS[step]}
              {isWaiting && <Pause className="size-2.5" />}
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
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--trae-text-secondary)]">
          <Play className="size-3 text-[var(--trae-text-brand)]" />
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
              className="flex-1 truncate rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2.5 py-1.5 font-mono text-[12px] leading-[1.5] text-[var(--trae-text-default)]"
            >
              {display}
            </code>
            <button
              type="button"
              onClick={() => onToolAction('execute', cmd)}
              title="发送到终端执行（回显可见）"
              className="btn-press inline-flex shrink-0 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--trae-text-brand)] transition-opacity hover:opacity-90"
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
    // 命令类 → 终端命令卡
    if (COMMAND_TOOLS.has(evt.toolName)) {
      return (
        <div key={evt.toolCallId} className="ai-tool-exec">
          <div className="ai-tool-exec-head">
            {evt.done ? (
              evt.ok ? (
                <Check className="size-3.5 text-[var(--trae-status-success-default)]" />
              ) : (
                <X className="size-3.5 text-[var(--trae-status-error-default)]" />
              )
            ) : (
              <Loader2 className="size-3.5 animate-spin text-[var(--trae-text-brand)]" />
            )}
            <TerminalIcon className="size-3.5 text-[var(--trae-text-brand)]" />
            <span className="ai-tool-exec-name">{toolDisplayName(evt.toolName)}</span>
            {!evt.done && <span className="ai-tool-exec-status">执行中…</span>}
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
        </div>
      )
    }

    // 检索类 → 设计稿 Panel C 式折叠行（执行中展开，完成后默认收起）
    const expanded = toolOpenMap[evt.toolCallId] ?? !evt.done
    const resultCount = evt.done && evt.ok ? countSearchResults(evt.output) : 0
    const badge = !evt.done
      ? '检索中…'
      : !evt.ok
        ? '失败'
        : resultCount > 0
          ? `${resultCount} 条匹配`
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
          {searchToolIcon(evt.toolName)}
          <span className="text-[var(--trae-text-default)]">{toolDisplayName(evt.toolName)}</span>
          <span
            className={`ai-tool-badge ${
              !evt.done
                ? 'ai-tool-badge-brand'
                : !evt.ok
                  ? 'ai-tool-badge-error'
                  : resultCount > 0
                    ? 'ai-tool-badge-brand'
                    : ''
            }`}
          >
            {!evt.done && <Loader2 className="size-2.5 animate-spin" />}
            {badge}
          </span>
          <ChevronRight
            className={`ml-auto size-2.5 text-[var(--trae-text-tertiary)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        {expanded && (
          <div className="ai-tool-search-body">
            {evt.input && (
              <div className="ai-tool-search-query">查询: “{evt.input}”</div>
            )}
            {evt.done && evt.output && (
              <div className={`ai-tool-search-output ${evt.ok ? '' : 'is-error'}`}>
                {evt.output}
              </div>
            )}
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
  const renderActionButtons = () => {
    if (message.isStreaming || message.isError) return null
    if (!onNavigate) return null
    return (
      <div className="mt-2 flex gap-2 border-t border-[var(--trae-border-neutral-l1)] pt-2">
        <button
          type="button"
          onClick={() => onNavigate('/monitor')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--trae-text-secondary)] transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]"
        >
          查看监控
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/history')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--trae-text-secondary)] transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]"
        >
          记录决策
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/knowledge')}
          className="btn-press rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--trae-text-secondary)] transition-colors duration-150 hover:border-[var(--trae-border-neutral-l2)] hover:bg-[var(--trae-bg-overlay-l1)] hover:text-[var(--trae-text-default)]"
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
          {message.isError ? (
            <div className="ai-card border-[var(--trae-status-error-surface-l2)] bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)] whitespace-pre-wrap">
              {message.content}
            </div>
          ) : segments.segs.length > 0 ? (
            /* v2.8 穿插渲染：正文分片与工具卡按真实发生顺序交错（命令在流式输出里，
               不再全部堆在消息尾部） */
            <div className="flex flex-col gap-1.5">
              {segments.segs.map((seg, i) =>
                seg.kind === 'text' ? (
                  <div key={`seg-${i}`} className="ai-card">
                    <MarkdownMessage content={seg.text} />
                    {message.isStreaming && i === segments.segs.length - 1 && (
                      <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--trae-bg-brand)] align-middle" />
                    )}
                  </div>
                ) : (
                  <div key={`tool-${seg.evt.toolCallId}`}>{renderToolCard(seg.evt)}</div>
                ),
              )}
              {/* 流式中且最后一片是工具卡 → 光标单独补一行（命令后续文本即将到来） */}
              {message.isStreaming && segments.segs[segments.segs.length - 1]?.kind === 'tool' && (
                <div className="ai-card">
                  <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--trae-bg-brand)] align-middle" />
                </div>
              )}
            </div>
          ) : (
            <div className="ai-card">
              {/* 有思考链时不重复显示占位（下方“深度思考”块已有“思考中…”） */}
              {message.isStreaming && !message.reasoning ? '思考中…' : ''}
              {message.isStreaming && (
                <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--trae-bg-brand)] align-middle" />
              )}
            </div>
          )}
        </div>
      </div>
      {renderStepProgress()}
      {renderToolEvents()}
      {/* v2.5：完成态且有真实工具轨迹时，展示 6 源 D-S/PCR5 可信度分析折叠块 */}
      {!message.isStreaming && !message.isError && (
        <ChatCredibility message={message} />
      )}
      {renderCommandButtons()}
      {(message.usage || message.model) && !message.isStreaming && (
        <div className="ai-token-row ai-token-pop pl-8">
          <Clock className="size-3" />
          <span>
            {message.model ? `${message.model} · ` : ''}
            {message.usage
              ? `${message.usage.totalTokens.toLocaleString()} tokens`
              : ''}
          </span>
        </div>
      )}
      {renderActionButtons()}
    </div>
  )
}

export default memo(LiveMessageRow)
