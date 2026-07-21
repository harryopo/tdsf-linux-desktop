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
import { Button } from '@/components/trae/Button'
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
    <article
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{
        padding: 16,
        animation: 'tutorialFadeIn 0.4s cubic-bezier(0.3,0,0,1) 0.1s both',
      }}
    >
      <div className="flex items-center gap-2">
        <CheckCircle
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
          {cardTitle}
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

      {list.length === 0 ? (
        <p
          className="m-0 mt-3 text-[var(--trae-text-tertiary)]"
          style={{
            fontSize: 'var(--trae-body-sm-font-size)',
            lineHeight: 'var(--trae-body-sm-line-height)'
          }}
        >
          本章节暂无知识检查题
        </p>
      ) : (
        <>
          {/* 题目列表 */}
          {list.map((q) => (
            <div key={q.id} style={{ marginTop: 12 }}>
              <div
                className="mb-1.5 text-[var(--trae-text-default)]"
                style={{ fontSize: 'var(--trae-body-sm-font-size)' }}
              >
                <span
                  className="font-medium"
                  style={{ color: 'var(--trae-text-brand)' }}
                >
                  {q.id}.
                </span>{' '}
                {q.question}
              </div>
              <div className="flex flex-col gap-1">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt.key
                  const showCorrect = selected && opt.correct
                  return (
                    <label
                      key={opt.key}
                      className="flex cursor-pointer items-center gap-2 rounded-[var(--trae-radius-4)]"
                      style={{
                        padding: '6px 10px',
                        border: showCorrect
                          ? '1px solid var(--trae-status-success-default)'
                          : '1px solid var(--trae-border-neutral-l1)',
                        background: showCorrect
                          ? 'var(--trae-status-success-surface-l1)'
                          : 'transparent',
                        color: showCorrect
                          ? 'var(--trae-status-success-default)'
                          : 'var(--trae-text-secondary)',
                        fontSize: 'var(--trae-body-sm-font-size)',
                        fontWeight: showCorrect
                          ? 'var(--trae-font-weight-medium)'
                          : 'var(--trae-font-weight-default)',
                      }}
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
          <div className="mt-3.5">
            <Button
              variant="brand"
              size="default"
              data-dom-id="btn-submit-quiz"
              onClick={() => onSubmit(answers)}
            >
              提交答案
            </Button>
          </div>
        </>
      )}
    </article>
  )
}
