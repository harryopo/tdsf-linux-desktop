/**
 * QuizCard — 知识检查卡（TutorialDetailPage 子组件）
 *
 * 设计稿参考：tutorial-detail.html 知识检查 article
 * 结构：check-circle 图标 + 标题 → 3 道单选题（每题 4 选项） → 提交答案按钮
 * 选项交互：点击切换选中态，正确答案预选中状态用 success 色边框 + 软背景 + ✓ 标记
 *
 * JS 交互：useState 管理每题选中答案；提交按钮 data-dom-id="btn-submit-quiz"
 *
 * 数据接入（v0.7.0 Sprint 4.4）：
 *   - questions?: QuizQuestion[]   题目列表（默认 = mock QUIZ_QUESTIONS）
 *   - title?: string                卡片标题（默认 = "知识检查"）
 *   - sourceLabel?: string          来源标签
 */
import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import '../../../pages/TutorialPage.css'
import { type QuizQuestion, QUIZ_QUESTIONS } from './detail-data'

/** 知识检查卡 */
export function QuizCard({
  onSubmit,
  questions,
  title,
  sourceLabel,
}: {
  onSubmit: (answers: Record<string, string>) => void
  questions?: QuizQuestion[]
  title?: string
  sourceLabel?: string
}) {
  // 每题选中答案：questionId -> optionKey
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const list = questions ?? QUIZ_QUESTIONS
  const cardTitle = title ?? '知识检查'

  /** 选择某题的某个选项 */
  const selectOption = (qId: string, optKey: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: optKey }))
  }

  return (
    <article className="tut-card tut-fade-in tut-fade-in--delay-2">
      <div className="tut-card-title-row">
        <CheckCircle size={15} className="tut-card-icon--brand" />
        <h2 className="tut-card-title">{cardTitle}</h2>
        {sourceLabel && (
          <span className="tut-source-badge">{sourceLabel}</span>
        )}
      </div>

      {list.length === 0 ? (
        <p
          style={{
            margin: '12px 0 0 0',
            fontSize: 'var(--trae-body-sm-font-size)',
            lineHeight: 'var(--trae-body-sm-line-height)',
            color: 'var(--trae-text-tertiary)'
          }}
        >
          本章节暂无知识检查题
        </p>
      ) : (
        <>
          {/* 题目列表 */}
          {list.map((q) => (
            <div key={q.id} className="tut-quiz-question">
              <div className="tut-quiz-question-text">
                <span className="tut-quiz-question-num">{q.id}.</span>{' '}
                {q.question}
              </div>
              <div className="tut-quiz-options">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt.key
                  const showCorrect = selected && opt.correct
                  return (
                    <label
                      key={opt.key}
                      className={`tut-quiz-option${showCorrect ? ' tut-quiz-option--correct' : ''}`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={selected}
                        onChange={() => selectOption(q.id, opt.key)}
                        style={{ accentColor: 'var(--trae-bg-brand)' }}
                      />
                      {opt.key}. {opt.text}
                      {showCorrect && <span> ✓</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}

          {/* 提交按钮 */}
          <div className="tut-quiz-submit-row">
            <button
              type="button"
              data-dom-id="btn-submit-quiz"
              className="tut-quiz-submit-btn tut-btn-press"
              onClick={() => onSubmit(answers)}
            >
              提交答案
            </button>
          </div>
        </>
      )}
    </article>
  )
}
