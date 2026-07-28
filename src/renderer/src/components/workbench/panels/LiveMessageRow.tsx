import { memo, useMemo, type FC } from 'react'
import { Check, Clock, Loader2, Pause, Play, Shield, Sparkles, Terminal as TerminalIcon, X } from 'lucide-react'
import type { AgentMessage } from '@/stores/agent-store'
import type { AgentStep } from '@shared/models'
import MarkdownMessage from './MarkdownMessage'
import './MarkdownMessage.css'

/** 工具名 → 中文展示名（v2.4：真实工具执行可视化） */
function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    ssh_readonly: '只读诊断命令',
    kb_search: '知识库检索',
    tutorial_search: '教程检索',
    skill_match: '技能匹配',
    monitor_get: '监控采集',
  }
  return map[name] ?? name
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
    const rawTrim = lines[i].replace(/^\s*\$\s+/, '').trim() // 去掉行首 $ 提示符
    i++
    if (!rawTrim || rawTrim.startsWith('#')) continue

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
function extractCommands(content: string): string[] {
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
  // v2.4：命令提取用 useMemo 缓存，避免流式期间每 token 重复跑正则（滚动卡顿主因之一）；
  // 流式/错误态直接返回空，不跑解析。
  const commands = useMemo(
    () => (message.isStreaming || message.isError ? [] : extractCommands(message.content)),
    [message.content, message.isStreaming, message.isError],
  )

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

  /** 从消息中提取命令，渲染执行/沙箱预演按钮 */
  const renderCommandButtons = () => {
    if (message.isStreaming || message.isError) return null
    if (!onToolAction || !activeSessionId) return null
    if (commands.length === 0) return null
    return (
      <div className="mt-2 flex flex-col gap-1.5 border-t border-[var(--trae-border-neutral-l1)] pt-2">
        <div className="text-[10px] text-[var(--trae-text-tertiary)]">检测到 {commands.length} 条命令：</div>
        {commands.map((cmd, i) => {
          // 多行命令（如 heredoc）只展示首行 + 行数，避免擑爆列表；执行时仍用完整 cmd
          const multiline = cmd.includes('\n')
          const display = multiline
            ? `${cmd.split('\n')[0]} …(${cmd.split('\n').length} 行)`
            : cmd
          return (
          <div key={i} className="flex items-center gap-1.5">
            <code
              title={cmd}
              className="flex-1 truncate rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] px-2 py-1 font-mono text-[11px] text-[var(--trae-text-default)]"
            >
              {display}
            </code>
            <button
              type="button"
              onClick={() => onToolAction('execute', cmd)}
              title="在终端执行"
              className="btn-press inline-flex shrink-0 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-bg-brand)] bg-[var(--trae-bg-brand)] px-2 py-1 text-[10px] font-medium text-[var(--trae-text-onbrand)] transition-opacity hover:opacity-90"
            >
              <Play className="size-3" />
              执行
            </button>
            <button
              type="button"
              onClick={() => onToolAction('sandbox', cmd)}
              title="沙箱预演"
              className="btn-press inline-flex shrink-0 items-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-transparent px-2 py-1 text-[10px] text-[var(--trae-text-secondary)] transition-colors hover:border-[var(--trae-border-brand)] hover:text-[var(--trae-text-brand)]"
            >
              <Shield className="size-3" />
              沙箱
            </button>
          </div>
          )
        })}
      </div>
    )
  }

  /** 渲染 Agent 【真实执行】的工具调用卡片（v2.4：由 agent:tool-event 驱动） */
  const renderToolEvents = () => {
    const events = message.toolEvents
    if (!events || events.length === 0) return null
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        {events.map((evt) => (
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
            </div>
            {evt.input && (
              <div className="ai-tool-exec-cmd">
                <span className="ai-tool-exec-prompt">$</span> {evt.input}
              </div>
            )}
            {evt.done && evt.output && (
              <pre className={`ai-tool-exec-output ${evt.ok ? '' : 'is-error'}`}>{evt.output}</pre>
            )}
          </div>
        ))}
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
          <div
            className={[
              'ai-card',
              // 流式中用纯文本（whitespace-pre-wrap）保证逐 token 顺滑；
              // 完成后用 MarkdownMessage 渲染为真实预览（标题/加粗/列表/代码块）
              message.isStreaming ? 'whitespace-pre-wrap' : '',
              message.isError
                ? 'border-[var(--trae-status-error-surface-l2)] bg-[var(--trae-status-error-surface-l1)] text-[var(--trae-status-error-default)] whitespace-pre-wrap'
                : '',
            ].join(' ')}
          >
            {message.isStreaming || message.isError ? (
              <>
                {message.content || (message.isStreaming ? '思考中…' : '')}
                {message.isStreaming && (
                  <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--trae-bg-brand)] align-middle" />
                )}
              </>
            ) : (
              <MarkdownMessage content={message.content} />
            )}
          </div>
        </div>
      </div>
      {renderStepProgress()}
      {renderToolEvents()}
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