/**
 * PracticeCard — 实践练习卡（TutorialDetailPage 子组件）
 *
 * 设计稿参考：tutorial-detail.html 实践练习 article
 * 结构：terminal 图标 + 标题 → 描述 → 终端模拟 pre 块 → 打开沙箱按钮
 * 终端块带语法着色：constant（提示符）/ text（命令）/ comment（输出）/ parameter（高亮指标）
 *
 * 数据接入（v0.7.0 Sprint 4.4）：
 *   - title?: string         标题（默认 = "动手实践"）
 *   - description?: string   描述（默认 = mock PRACTICE_DESCRIPTION）
 *   - commands?: string[]    命令列表（默认 = mock PRACTICE_TERMINAL）
 *   - sourceLabel?: string   顶部来源标签
 */
import { Terminal } from 'lucide-react'
import { Button } from '@/components/trae/Button'
import {
  type CodeLine,
  PRACTICE_TERMINAL,
  PRACTICE_DESCRIPTION,
} from './detail-data'

/** 把命令字符串列表转成 CodeLine[]（text 类型） */
function commandsToLines(commands: string[]): CodeLine[] {
  return commands.map((cmd) => ({ type: 'text' as const, content: cmd }))
}

/** 实践练习卡 */
export function PracticeCard({
  onOpenSandbox,
  title,
  description,
  commands,
  sourceLabel,
}: {
  onOpenSandbox: () => void
  title?: string
  description?: string
  commands?: string[]
  sourceLabel?: string
}) {
  const desc = description ?? PRACTICE_DESCRIPTION
  const lines: CodeLine[] = commands
    ? commandsToLines(commands)
    : PRACTICE_TERMINAL
  return (
    <article
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{
        padding: 16,
        animation: 'tutorialFadeIn 0.4s cubic-bezier(0.3,0,0,1) 0.05s both',
      }}
    >
      <div className="flex items-center gap-2">
        <Terminal
          size={15}
          style={{ color: 'var(--trae-text-brand)' }}
        />
        <h2
          className="m-0 font-semibold"
          style={{
            fontSize: 'var(--trae-heading-xs-font-size)',
            lineHeight: 'var(--trae-heading-xs-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          {title ?? '动手实践'}
        </h2>
        {sourceLabel && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] border px-2"
            style={{
              borderColor: 'var(--trae-status-success-default)',
              background: 'rgba(51,193,146,0.12)',
              color: 'var(--trae-status-success-default)',
              fontSize: '10px',
              fontWeight: 500
            }}
          >
            {sourceLabel}
          </span>
        )}
      </div>
      <p
        className="mt-2 m-0 text-[var(--trae-text-secondary)]"
        style={{
          fontSize: 'var(--trae-body-sm-font-size)',
          lineHeight: 'var(--trae-body-sm-line-height)',
        }}
      >
        {desc}
      </p>
      {/* 终端模拟块 */}
      {lines.length > 0 && (
        <pre
          className="mt-2.5 overflow-x-auto rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]"
          style={{
            background: '#0F1011',
            padding: 12,
            fontFamily: 'var(--trae-font-family-mono)',
            fontSize: 'var(--trae-body-sm-font-size)',
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          {lines.map((line, i) => (
            <TerminalLine key={i} line={line} />
          ))}
        </pre>
      )}
      <div className="mt-3">
        <Button
          variant="outline"
          size="default"
          data-dom-id="btn-open-sandbox"
          onClick={onOpenSandbox}
          className="border-[var(--trae-bg-brand)] text-[var(--trae-text-brand)]"
        >
          <Terminal size={13} />
          打开沙箱练习
        </Button>
      </div>
    </article>
  )
}

/** 渲染终端单行（同行内可能有 constant + text 混排） */
function TerminalLine({ line }: { line: CodeLine }) {
  const color =
    line.type === 'comment'
      ? 'var(--trae-code-doc)'
      : line.type === 'constant'
        ? 'var(--trae-code-constant)'
        : 'var(--trae-code-text)'
  return <div style={{ color }}>{line.content}</div>
}
