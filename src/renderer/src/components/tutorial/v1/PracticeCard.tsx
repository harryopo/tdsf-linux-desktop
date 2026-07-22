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
import '../../../pages/TutorialPage.css'
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
    <article className="tut-card tut-fade-in tut-fade-in--delay-1">
      <div className="tut-card-title-row">
        <Terminal size={15} className="tut-card-icon--brand" />
        <h2 className="tut-card-title">{title ?? '动手实践'}</h2>
        {sourceLabel && (
          <span className="tut-source-badge">{sourceLabel}</span>
        )}
      </div>
      <p className="tut-practice-desc">{desc}</p>
      {/* 终端模拟块 */}
      {lines.length > 0 && (
        <pre className="tut-code-block" style={{ marginTop: 10 }}>
          {lines.map((line, i) => (
            <TerminalLine key={i} line={line} />
          ))}
        </pre>
      )}
      <div className="tut-practice-btn-row">
        <button
          type="button"
          data-dom-id="btn-open-sandbox"
          className="tut-practice-btn tut-btn-press"
          onClick={onOpenSandbox}
        >
          <Terminal size={13} />
          打开沙箱练习
        </button>
      </div>
    </article>
  )
}

/** 渲染终端单行（同行内可能有 constant + text 混排） */
function TerminalLine({ line }: { line: CodeLine }) {
  const lineClass =
    line.type === 'comment'
      ? 'tut-code-line--comment'
      : line.type === 'constant'
        ? 'tut-code-line--constant'
        : 'tut-code-line--text'
  return <div className={lineClass}>{line.content}</div>
}
