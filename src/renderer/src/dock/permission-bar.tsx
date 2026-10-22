/**
 * 审批条（底部固定，不遮挡消息流）
 *
 * 布局照 cc-gui 的 PermissionDialog v3：贴底滑入、只上圆角、命令框可折叠、
 * 按钮右排带数字键片。但**默认安全姿态与它相反**，三条是刻意的差异：
 *
 * 1. 默认选中"拒绝"，不是"批准"。cc-gui 的 selectedIndex 初值是 0=Allow，
 *    用户没注意直接敲回车就放行了。
 * 2. 鼠标悬停不改选中项。cc-gui 在 hover 时改写 selectedIndex，
 *    指针扫过按钮再敲回车 = 执行扫到的那一项。
 * 3. Esc 明确等于拒绝。cc-gui 的 v3 根本没处理 Esc。
 *
 * 队列里同时有多个请求时只暴露队首——批准等待期间不允许有第二条通道。
 * 真正的 fail-closed 判定在主进程（只有字面 true 算批准），这里只保证 UI 不替用户做主。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'
import type { ApprovalEntry } from '@/stores/approval-store'
import { cn } from '@/components/trae/utils'
import { Button, Chip } from '@/ui'

type Choice = 'allow' | 'deny'

/**
 * 只有"批准这一次"和"拒绝"。没有"始终批准"：
 * 主进程 paorApprove(callId, approved) 只有布尔一档，做出这个按钮等于给用户一个
 * 不起作用的授权范围——审批面上的空承诺比少一个按钮危险得多。
 */
const CHOICES: { key: Choice; label: string; hint: string }[] = [
  { key: 'allow', label: '批准这一次', hint: '1' },
  { key: 'deny', label: '拒绝', hint: '2' },
]

export interface PermissionBarProps {
  /**
   * 全局审批队列（stores/approval-store）。
   * 每条带着 expired 标记：主进程 60 秒到点会自动拒绝，而那张卡不能装作还能答。
   */
  entries: ApprovalEntry[]
  onRespond: (callId: string, approved: boolean) => void
  /** 已经作废的那条，用户看完把它关掉（不是"撤销批准"，只是收起这条话） */
  onDismiss: (callId: string) => void
}

export const PermissionBar: FC<PermissionBarProps> = ({ entries, onRespond, onDismiss }) => {
  const [index, setIndex] = useState(0)
  const [showCommand, setShowCommand] = useState(true)
  const [submitted, setSubmitted] = useState<string | null>(null)
  const denyRef = useRef<HTMLButtonElement>(null)

  const head = entries[0] ?? null
  const current = head?.request ?? null
  const expired = head?.expired ?? false
  const selectedIndex = useMemo(() => {
    // 越界兜底回"拒绝"，不回"批准"
    return index >= 0 && index < CHOICES.length ? index : CHOICES.findIndex((c) => c.key === 'deny')
  }, [index])

  // 换一条请求：重置到默认的"拒绝"，并让焦点落在它上面
  useEffect(() => {
    setIndex(CHOICES.findIndex((c) => c.key === 'deny'))
    setShowCommand(true)
    setSubmitted(null)
    denyRef.current?.focus()
  }, [current?.callId])

  const respond = useCallback(
    (choice: Choice) => {
      // expired 之后这条在主进程已经作废（60 秒到点自动拒绝），按钮不许再发回答——
      // 发出去也只会得到 paor:approve 的 false，用户却以为是自己批了。
      if (!current || submitted || expired) return
      setSubmitted(current.callId)
      onRespond(current.callId, choice === 'allow')
    },
    [current, submitted, expired, onRespond]
  )

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // 输入框里打字不该被当成审批快捷键
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return

      // 已作废的那条只剩一个动作：关掉它。快捷键不许再走批准/拒绝。
      if (expired) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault()
          onDismiss(current.callId)
        }
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        respond('deny')
        return
      }
      const byHint = CHOICES.findIndex((c) => c.hint === e.key)
      if (byHint >= 0) {
        e.preventDefault()
        setIndex(byHint)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setIndex((i) => (i + step + CHOICES.length) % CHOICES.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        respond(CHOICES[selectedIndex].key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, expired, onDismiss, respond, selectedIndex])

  if (!current) return null

  const critical = current.riskLevel === 'CRITICAL'

  return (
    <section
      role="region"
      aria-label="命令审批"
      className={cn(
        'absolute inset-x-0 bottom-0 z-(--ui-z-permission)',
        'rounded-t-(--ui-radius-bubble) border-t border-line-strong bg-raised/95 backdrop-blur-sm',
        'shadow-(--shadow-lg)',
        'animate-[ui-slide-from-bottom_var(--ui-dur-base)_var(--ui-ease-out)]'
      )}
    >
      {/* 顶部把手：纯视觉，提示这块可以从底部拉起 */}
      <span aria-hidden className="mx-auto block h-1 w-8 rounded-full bg-line-strong" />

      <div className="px-4 pb-3">
        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldAlert className={cn('size-4 shrink-0', critical ? 'text-error' : 'text-warning')} />
            <h2 className="truncate text-title font-semibold text-ink-strong">
              {/* 对话里的写命令也走这条通道，标题不能一口咬定是 PAOR；
                  stepIndex 只有 PAOR 那一路给得出真值，没有就不该显示"第 1 步" */}
              {expired ? '这次审批已过期' : current.origin === 'chat' ? 'AI 请求执行写操作' : 'PAOR 请求批准'}
              {!expired && current.stepIndex !== undefined ? ` — 第 ${current.stepIndex + 1} 步` : ''}
            </h2>
            <Chip tone={critical ? 'error' : 'warning'}>{current.riskLevel}</Chip>
          </div>
          {entries.length > 1 ? (
            <span className="shrink-0 text-caption text-ink-mute">
              队列中还有 {entries.length - 1} 条待处理
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-sm text-ink-dim">
          {expired
            ? // 主进程那侧不再认这个回答了；留着卡片是为了说清"AI 那一步为什么停住"，
              // 而不是给用户一个点了没动静的按钮。
              `这条在 ${new Date(current.expiresAt).toLocaleTimeString()} 到点，主进程已自动拒绝。AI 那一步按"未批准"继续。`
            : current.riskDescription || '主进程风险闸判定为高危，需人工确认。'}
        </p>

        <div className="mt-3 overflow-hidden rounded-(--ui-radius-panel) border border-line bg-sunken">
          <button
            type="button"
            onClick={() => setShowCommand((v) => !v)}
            aria-expanded={showCommand}
            className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left hover:bg-hover"
          >
            <code className="truncate font-mono text-caption text-ink-dim">
              {new Date(current.timestamp).toLocaleTimeString()} · 待执行命令
            </code>
            {showCommand ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
          </button>
          {showCommand ? (
            <pre className="max-h-(--ui-collapse-max-command) overflow-auto px-3 py-2.5 font-mono text-md leading-normal break-all whitespace-pre-wrap text-ink">
              {current.command}
            </pre>
          ) : null}
        </div>

        {expired ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => onDismiss(current.callId)}
              data-dom-id="approval-dismiss"
            >
              知道了
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-end gap-2">
            {CHOICES.map((choice, i) => {
              const selected = i === selectedIndex
              return (
                <Button
                  key={choice.key}
                  variant={selected ? 'selected' : 'outline'}
                  size="md"
                  aria-pressed={selected}
                  disabled={submitted !== null}
                  onClick={() => {
                    setIndex(i)
                    respond(choice.key)
                  }}
                  className={cn(
                    'gap-2',
                    choice.key === 'deny' && selected && 'text-error-text'
                  )}
                >
                  {choice.label}
                  <kbd className="rounded-(--ui-radius-control) bg-sunken px-2 py-0.5 text-caption font-normal text-ink-mute">
                    {choice.hint}
                  </kbd>
                </Button>
              )
            })}
          </div>
        )}

        <p className="mt-2 text-right text-caption text-ink-mute">
          {expired
            ? 'Esc 或 Enter 关掉这条'
            : `↑ ↓ 切换 · Enter 执行选中 · Esc 拒绝 · ${new Date(current.expiresAt).toLocaleTimeString()} 前未答复将自动拒绝`}
        </p>
      </div>
    </section>
  )
}
