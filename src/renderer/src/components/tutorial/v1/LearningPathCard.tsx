/**
 * LearningPathCard — Sprint 9 学习路径推荐卡片
 *
 * 展示 PathRecommender 生成的完整学习路径（TutorialPath）。
 *
 * 结构：
 * 1. 头部：路径名称 + 描述 + 预估总时间 + 推荐理由
 * 2. 前置知识标签
 * 3. 步骤列表（每步显示序号、标题、分类、难度、阅读时间、关键命令、why）
 *
 * UI 风格：遵循 v1.0 设计稿卡片风格（圆角、边框、CSS 变量）
 */

import { Clock, ListChecks, Lightbulb, Tag } from 'lucide-react'
import type { TutorialPath, PathStep } from '@/types/electron'
import { TUTORIAL_CATEGORY_LABELS } from '@shared/tutorial-types'

/** 难度标签颜色映射 */
const DIFFICULTY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  beginner: {
    bg: 'rgba(51,193,146,0.12)',
    text: 'var(--trae-status-success-default)',
    border: 'var(--trae-status-success-default)',
  },
  intermediate: {
    bg: 'rgba(59,130,246,0.12)',
    text: 'var(--trae-text-brand)',
    border: 'var(--trae-text-brand)',
  },
  advanced: {
    bg: 'rgba(245,101,101,0.12)',
    text: 'var(--trae-status-error-default)',
    border: 'var(--trae-status-error-default)',
  },
}

/** 难度中文映射 */
const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '初级',
  intermediate: '中级',
  advanced: '进阶',
}

interface LearningPathCardProps {
  /** 学习路径数据 */
  path: TutorialPath
  /** 点击步骤跳转回调 */
  onStepClick?: (step: PathStep) => void
}

/**
 * 学习路径卡片
 *
 * @param path 学习路径数据
 * @param onStepClick 点击步骤回调（可选，用于跳转到教程详情）
 */
export function LearningPathCard({ path, onStepClick }: LearningPathCardProps) {
  const totalMinutes = path.estimatedMinutes

  /** 格式化分钟数 */
  function formatDuration(minutes: number): string {
    if (!minutes || minutes <= 0) return '5min'
    if (minutes < 60) return `${Math.round(minutes)}min`
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    if (m === 0) return `${h}h`
    return `${h}h${m}min`
  }

  return (
    <div
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]"
      style={{ padding: '20px 24px' }}
    >
      {/* ===== 头部：路径名称 + 描述 + 预估时间 + 推荐理由 ===== */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3
            className="mb-1 font-semibold"
            style={{
              fontSize: 'var(--trae-heading-md-font-size)',
              lineHeight: 'var(--trae-heading-md-line-height)',
              color: 'var(--trae-text-default)',
            }}
          >
            {path.name}
          </h3>
          {path.description && (
            <p
              className="text-[var(--trae-text-secondary)]"
              style={{ fontSize: 'var(--trae-body-sm-font-size)', lineHeight: 'var(--trae-body-sm-line-height)' }}
            >
              {path.description}
            </p>
          )}
        </div>
        <div
          className="flex shrink-0 items-center gap-1.5 rounded-[var(--trae-radius-6)] px-3 py-1.5"
          style={{
            background: 'var(--trae-bg-overlay-l3)',
            border: '1px solid var(--trae-border-neutral-l2)',
          }}
        >
          <Clock size={14} className="text-[var(--trae-text-tertiary)]" />
          <span
            className="font-medium"
            style={{ fontSize: 'var(--trae-body-sm-font-size)', color: 'var(--trae-text-secondary)' }}
          >
            {formatDuration(totalMinutes)}
          </span>
        </div>
      </div>

      {/* ===== 前置知识标签 ===== */}
      {path.prerequisites.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Tag size={14} className="text-[var(--trae-text-tertiary)]" />
          <span
            className="text-[var(--trae-text-tertiary)]"
            style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
          >
            前置知识：
          </span>
          <div className="flex flex-wrap gap-1.5">
            {path.prerequisites.map((prereq) => (
              <span
                key={prereq}
                className="rounded-[var(--trae-radius-4)] px-2 py-0.5"
                style={{
                  background: 'var(--trae-bg-overlay-l3)',
                  border: '1px solid var(--trae-border-neutral-l2)',
                  fontSize: 'var(--trae-body-xs-font-size)',
                  color: 'var(--trae-text-secondary)',
                }}
              >
                {TUTORIAL_CATEGORY_LABELS[prereq as keyof typeof TUTORIAL_CATEGORY_LABELS] || prereq}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ===== 推荐理由 ===== */}
      {path.reason && (
        <div
          className="mb-4 flex items-start gap-2 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l2)]"
          style={{ padding: '10px 14px' }}
        >
          <Lightbulb
            size={14}
            className="mt-0.5 shrink-0 text-[var(--trae-text-brand)]"
            strokeWidth={2}
          />
          <span
            style={{
              fontSize: 'var(--trae-body-sm-font-size)',
              color: 'var(--trae-text-secondary)',
              lineHeight: 'var(--trae-body-sm-line-height)',
            }}
          >
            {path.reason}
          </span>
        </div>
      )}

      {/* ===== 步骤列表 ===== */}
      <div className="flex flex-col gap-2.5">
        {path.steps.map((step, index) => (
          <StepItem key={step.tutorialId} step={step} index={index} onClick={onStepClick} />
        ))}
      </div>
    </div>
  )
}

/**
 * 单个步骤项
 */
function StepItem({ step, index, onClick }: { step: PathStep; index: number; onClick?: (step: PathStep) => void }) {
  const difficultyColor = DIFFICULTY_COLORS[step.difficulty] ?? DIFFICULTY_COLORS['beginner']

  return (
    <div
      className="flex items-start gap-3 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-default)] transition-colors hover:border-[var(--trae-border-neutral-l2)]"
      style={{ padding: '12px 16px' }}
      onClick={() => onClick?.(step)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* 序号 */}
      <div
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: 28,
          height: 28,
          background: 'var(--trae-bg-brand)',
          color: 'var(--trae-text-onbrand)',
          fontSize: 'var(--trae-body-sm-font-size)',
          fontWeight: 'var(--trae-font-weight-medium)',
        }}
      >
        {step.order}
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="font-medium truncate"
            style={{
              fontSize: 'var(--trae-body-sm-font-size)',
              color: 'var(--trae-text-default)',
            }}
          >
            {step.title}
          </span>
          <span
            className="shrink-0 rounded-[var(--trae-radius-4)] px-2 py-0.5"
            style={{
              background: difficultyColor.bg,
              color: difficultyColor.text,
              border: `1px solid ${difficultyColor.border}`,
              fontSize: 'var(--trae-body-xs-font-size)',
              fontWeight: 'var(--trae-font-weight-medium)',
            }}
          >
            {DIFFICULTY_LABELS[step.difficulty] || step.difficulty}
          </span>
          <span
            className="shrink-0 rounded-[var(--trae-radius-4)] px-2 py-0.5"
            style={{
              background: 'var(--trae-bg-overlay-l3)',
              border: '1px solid var(--trae-border-neutral-l2)',
              fontSize: 'var(--trae-body-xs-font-size)',
              color: 'var(--trae-text-tertiary)',
            }}
          >
            {TUTORIAL_CATEGORY_LABELS[step.category as keyof typeof TUTORIAL_CATEGORY_LABELS] || step.category}
          </span>
          <span
            className="shrink-0 flex items-center gap-1 text-[var(--trae-text-tertiary)]"
            style={{ fontSize: 'var(--trae-body-xs-font-size)' }}
          >
            <ListChecks size={12} />
            {Math.round(step.readingTime)}min
          </span>
        </div>

        {/* 摘要 */}
        {step.summary && (
          <p
            className="mb-1.5 text-[var(--trae-text-secondary)]"
            style={{
              fontSize: 'var(--trae-body-xs-font-size)',
              lineHeight: 'var(--trae-body-xs-line-height)',
            }}
          >
            {step.summary}
          </p>
        )}

        {/* 为什么学这个 */}
        {step.why && (
          <div
            className="flex items-start gap-1.5 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-overlay-l2)]"
            style={{ padding: '6px 10px' }}
          >
            <Lightbulb
              size={12}
              className="mt-0.5 shrink-0 text-[var(--trae-text-brand)]"
              strokeWidth={2}
            />
            <span
              style={{
                fontSize: 'var(--trae-body-xs-font-size)',
                color: 'var(--trae-text-tertiary)',
                lineHeight: 'var(--trae-body-xs-line-height)',
              }}
            >
              {step.why}
            </span>
          </div>
        )}

        {/* 关键命令 */}
        {step.commands.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {step.commands.map((cmd) => (
              <code
                key={cmd}
                className="rounded-[var(--trae-radius-4)] px-2 py-0.5"
                style={{
                  background: 'rgba(0,0,0,0.04)',
                  border: '1px solid var(--trae-border-neutral-l2)',
                  fontSize: 'var(--trae-body-xs-font-size)',
                  fontFamily: 'var(--trae-font-family-mono)',
                  color: 'var(--trae-text-secondary)',
                }}
              >
                {cmd}
              </code>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
