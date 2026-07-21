/**
 * CurrentChapterCard — 当前章节卡（TutorialDetailPage 子组件）
 *
 * 设计稿参考：tutorial-detail.html 当前章节 article
 * 结构：
 *   1. 标题行：第 N 章 标题 + "当前学习" tag
 *   2. 学习目标列表（3 条，绿色 check-circle 图标）
 *   3. 内容正文段落（2 段）
 *   4. 命令示例代码块（带语法着色：comment 灰 / text 白 / constant 蓝）
 *   5. 注意事项 alert（左 3px warning 边框 + info-circle 图标）
 *   6. 按钮组：上一章 / 标记完成（品牌蓝填充）/ 下一章
 *
 * 数据接入（v0.7.0 Sprint 4.4）：
 *   - contentParagraphs?: string[]    正文段落（默认 = mock CHAPTER_PARAGRAGRAPHS）
 *   - codeLines?: CodeLine[]          代码示例（默认 = mock CODE_EXAMPLE）
 *   - objectives?: string[]           学习目标（默认 = mock LEARNING_OBJECTIVES）
 *   - alertText?: string              注意事项（默认 = mock ALERT_TEXT）
 *   - codeCaption?: string            代码块底部说明（默认 = mock CODE_CAPTION）
 *   - sourceBadge?: string            来源标识（如 "FROM arch-wiki"）
 *
 * JS 交互：3 个按钮 data-dom-id（btn-prev-chapter / btn-complete-chapter / btn-next-chapter）
 */
import { CheckCircle, Info, ArrowLeft, Check, ArrowRight } from 'lucide-react'
import { Button } from '@/components/trae/Button'
import { Badge } from '@/components/trae/Badge'
import {
  type CodeLine,
  LEARNING_OBJECTIVES,
  CHAPTER_PARAGRAPHS,
  CODE_EXAMPLE,
  CODE_CAPTION,
  ALERT_TEXT,
} from './detail-data'

/** 当前章节卡 */
export function CurrentChapterCard({
  chapterIndex,
  chapterTitle,
  onPrev,
  onComplete,
  onNext,
  contentParagraphs,
  codeLines,
  objectives,
  alertText,
  codeCaption,
  sourceBadge,
}: {
  chapterIndex: number
  chapterTitle: string
  onPrev: () => void
  onComplete: () => void
  onNext: () => void
  contentParagraphs?: string[]
  codeLines?: CodeLine[]
  objectives?: string[]
  alertText?: string
  codeCaption?: string
  sourceBadge?: string
}) {
  const paragraphs = contentParagraphs ?? CHAPTER_PARAGRAPHS
  const code = codeLines ?? CODE_EXAMPLE
  const objs = objectives ?? LEARNING_OBJECTIVES.map((o) => o.text)
  const alert = alertText ?? ALERT_TEXT
  const caption = codeCaption ?? CODE_CAPTION
  return (
    <article
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{ padding: 16, animation: 'tutorialFadeIn 0.4s cubic-bezier(0.3,0,0,1)' }}
    >
      {/* 标题行 */}
      <div className="flex items-center justify-between gap-2">
        <h2
          className="m-0 font-semibold"
          style={{
            fontSize: 'var(--trae-heading-xs-font-size)',
            lineHeight: 'var(--trae-heading-xs-line-height)',
            color: 'var(--trae-text-default)',
          }}
        >
          第{chapterIndex}章：{chapterTitle}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {sourceBadge && (
            <span
              className="inline-flex items-center gap-1 rounded-[var(--trae-radius-4)] border px-2"
              style={{
                borderColor: 'var(--trae-status-success-default)',
                background: 'rgba(51,193,146,0.12)',
                color: 'var(--trae-status-success-default)',
                fontSize: '10px',
                fontWeight: 500
              }}
            >
              {sourceBadge}
            </span>
          )}
          <Badge variant="primary">当前学习</Badge>
        </div>
      </div>

      {/* 学习目标 */}
      <div style={{ marginTop: 12 }}>
        <div
          className="mb-1.5 font-medium text-[var(--trae-text-tertiary)]"
          style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
        >
          学习目标
        </div>
        <ul className="m-0 flex flex-col gap-1.5 p-0" style={{ listStyle: 'none' }}>
          {objs.map((text, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle
                size={14}
                className="mt-px shrink-0"
                style={{ color: 'var(--trae-status-success-default)' }}
              />
              <span
                className="text-[var(--trae-text-default)]"
                style={{
                  fontSize: 'var(--trae-body-sm-font-size)',
                  lineHeight: 'var(--trae-body-sm-line-height)',
                }}
              >
                {text}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 正文段落 */}
      <div className="mt-3 flex flex-col gap-2">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="m-0 text-[var(--trae-text-default)]"
            style={{
              fontSize: 'var(--trae-body-sm-font-size)',
              lineHeight: 'var(--trae-body-sm-line-height)',
            }}
          >
            {p}
          </p>
        ))}
      </div>

      {/* 代码示例 */}
      {code.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <pre
            className="m-0 overflow-x-auto rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]"
            style={{
              background: '#0F1011',
              padding: 12,
              fontFamily: 'var(--trae-font-family-mono)',
              fontSize: 'var(--trae-body-sm-font-size)',
              lineHeight: 1.7,
            }}
          >
            {code.map((line, i) => (
              <CodeLineRender key={i} line={line} />
            ))}
          </pre>
          {caption && (
            <div
              className="mt-1.5"
              style={{
                fontSize: 'var(--trae-body-xs-font-size)',
                color: 'var(--trae-code-constant)',
                fontFamily: 'var(--trae-font-family-mono)',
              }}
            >
              {caption}
            </div>
          )}
        </div>
      )}

      {/* 注意事项 alert */}
      {alert && (
        <div
          className="mt-3 flex items-start gap-2"
          style={{
            padding: '8px 12px',
            background: 'var(--trae-status-warning-surface-l1)',
            borderLeft: '3px solid var(--trae-status-warning-default)',
            borderRadius: '0 var(--trae-radius-4) var(--trae-radius-4) 0',
          }}
        >
          <Info
            size={14}
            className="mt-px shrink-0"
            style={{ color: 'var(--trae-status-warning-default)' }}
          />
          <span
            className="text-[var(--trae-text-default)]"
            style={{
              fontSize: 'var(--trae-body-sm-font-size)',
              lineHeight: 'var(--trae-body-sm-line-height)',
            }}
          >
            {alert}
          </span>
        </div>
      )}

      {/* 按钮组 */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="default"
          data-dom-id="btn-prev-chapter"
          onClick={onPrev}
        >
          <ArrowLeft size={13} />
          上一章
        </Button>
        <Button
          variant="brand"
          size="default"
          data-dom-id="btn-complete-chapter"
          onClick={onComplete}
        >
          <Check size={13} />
          标记完成
        </Button>
        <Button
          variant="outline"
          size="default"
          data-dom-id="btn-next-chapter"
          onClick={onNext}
          className="border-[var(--trae-bg-brand)] text-[var(--trae-text-brand)]"
        >
          下一章
          <ArrowRight size={13} />
        </Button>
      </div>
    </article>
  )
}

/** 渲染单行代码（带语法着色） */
function CodeLineRender({ line }: { line: CodeLine }) {
  const color =
    line.type === 'comment'
      ? 'var(--trae-code-doc)'
      : line.type === 'constant'
        ? 'var(--trae-code-constant)'
        : 'var(--trae-code-text)'
  return (
    <div style={{ color }}>
      {line.content}
    </div>
  )
}
