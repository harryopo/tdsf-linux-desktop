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
 *   - contentParagraphs?: string[]    正文段落（默认 = mock CHAPTER_PARAGRAPHS）
 *   - codeLines?: CodeLine[]          代码示例（默认 = mock CODE_EXAMPLE）
 *   - objectives?: string[]           学习目标（默认 = mock LEARNING_OBJECTIVES）
 *   - alertText?: string              注意事项（默认 = mock ALERT_TEXT）
 *   - codeCaption?: string            代码块底部说明（默认 = mock CODE_CAPTION）
 *   - sourceBadge?: string            来源标识（如 "FROM arch-wiki"）
 *
 * JS 交互：3 个按钮 data-dom-id（btn-prev-chapter / btn-complete-chapter / btn-next-chapter）
 */
import { CheckCircle, Info, ArrowLeft, Check, ArrowRight } from 'lucide-react'
import '../../../pages/TutorialPage.css'
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
    <article className="tut-card tut-fade-in">
      {/* 标题行 */}
      <div className="tut-card-title-row" style={{ justifyContent: 'space-between' }}>
        <h2 className="tut-card-title">
          第{chapterIndex}章：{chapterTitle}
        </h2>
        <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 6 }}>
          {sourceBadge && (
            <span className="tut-source-badge">{sourceBadge}</span>
          )}
          <span className="tut-detail-badge tut-detail-badge--brand">当前学习</span>
        </div>
      </div>

      {/* 学习目标 */}
      <div style={{ marginTop: 12 }}>
        <div className="tut-objective-label">学习目标</div>
        <ul className="tut-objective-list">
          {objs.map((text, i) => (
            <li key={i} className="tut-objective-item">
              <CheckCircle size={14} className="tut-objective-icon" />
              <span className="tut-objective-text">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 正文段落 */}
      <div className="tut-paragraphs">
        {paragraphs.map((p, i) => (
          <p key={i} className="tut-paragraph">{p}</p>
        ))}
      </div>

      {/* 代码示例 */}
      {code.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <pre className="tut-code-block">
            {code.map((line, i) => (
              <CodeLineRender key={i} line={line} />
            ))}
          </pre>
          {caption && (
            <div className="tut-code-caption">{caption}</div>
          )}
        </div>
      )}

      {/* 注意事项 alert */}
      {alert && (
        <div className="tut-alert">
          <Info size={14} className="tut-alert-icon" />
          <span className="tut-alert-text">{alert}</span>
        </div>
      )}

      {/* 按钮组 */}
      <div className="tut-btn-group">
        <button
          type="button"
          data-dom-id="btn-prev-chapter"
          className="tut-chapter-btn tut-chapter-btn--prev tut-btn-press"
          onClick={onPrev}
        >
          <ArrowLeft size={13} />
          上一章
        </button>
        <button
          type="button"
          data-dom-id="btn-complete-chapter"
          className="tut-chapter-btn tut-chapter-btn--complete tut-btn-press"
          onClick={onComplete}
        >
          <Check size={13} />
          标记完成
        </button>
        <button
          type="button"
          data-dom-id="btn-next-chapter"
          className="tut-chapter-btn tut-chapter-btn--next tut-btn-press"
          onClick={onNext}
        >
          下一章
          <ArrowRight size={13} />
        </button>
      </div>
    </article>
  )
}

/** 渲染单行代码（带语法着色） */
function CodeLineRender({ line }: { line: CodeLine }) {
  const lineClass =
    line.type === 'comment'
      ? 'tut-code-line--comment'
      : line.type === 'constant'
        ? 'tut-code-line--constant'
        : 'tut-code-line--text'
  return <div className={lineClass}>{line.content}</div>
}
