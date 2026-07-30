import type { FC } from 'react'
import { Check, Loader2, Circle, X, ShieldAlert, ListChecks } from 'lucide-react'
import type { PaorIteration, PaorPlanObject } from '@shared/paor-types'
import {
  derivePlanStepStatuses,
  computePlanProgress,
  type PaorStepStatus,
} from './paor-plan-status'

/**
 * PaorPlanCard — PAOR 任务拆解可视化卡片（v2.11）
 *
 * 把 Plan 阶段生成的结构化计划渲染成带实时状态的步骤清单：
 * - 顶部：任务目标 + 进度条（已完成/总步数）
 * - 步骤：每步一行，左侧状态图标（待执行/进行中/完成/失败/已拦截），右侧步骤文本
 * - 底部：风险点 + 验证方法（若有）
 *
 * 状态由 derivePlanStepStatuses 纯函数从 iterations 推导，随迭代实时更新。
 */
const STEP_ICON: Record<PaorStepStatus, JSX.Element> = {
  done: <Check className="size-3.5 text-[var(--trae-status-success-default)]" />,
  running: <Loader2 className="size-3.5 animate-spin text-[var(--trae-text-brand)]" />,
  failed: <X className="size-3.5 text-[var(--trae-status-error-default)]" />,
  blocked: <ShieldAlert className="size-3.5 text-[var(--trae-status-alert-default)]" />,
  pending: <Circle className="size-3.5 text-[var(--trae-text-tertiary)]" />,
}

const STEP_LABEL: Record<PaorStepStatus, string> = {
  done: '完成',
  running: '进行中',
  failed: '失败',
  blocked: '已拦截',
  pending: '待执行',
}

const PaorPlanCard: FC<{
  plan: PaorPlanObject
  iterations: PaorIteration[]
  isRunning: boolean
}> = ({ plan, iterations, isRunning }) => {
  const statuses = derivePlanStepStatuses(plan.steps, iterations, isRunning)
  const progress = computePlanProgress(statuses)

  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-base-secondary)] p-3">
      {/* 标题 + 进度 */}
      <div className="flex items-center gap-2">
        <ListChecks className="size-4 shrink-0 text-[var(--trae-text-brand)]" />
        <span className="flex-1 truncate text-[13px] font-semibold text-[var(--trae-text-default)]" title={plan.goal}>
          {plan.goal || '任务计划'}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--trae-text-tertiary)]">
          {progress.done}/{progress.total}
        </span>
      </div>
      {/* 进度条 */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l2)]">
        <div
          className="h-full rounded-full bg-[var(--trae-bg-brand)] transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {/* 步骤清单 */}
      <ol className="flex flex-col gap-1">
        {plan.steps.map((step, i) => {
          const st = statuses[i]
          return (
            <li key={i} className="flex items-start gap-2 py-0.5">
              <span className="mt-0.5 shrink-0">{STEP_ICON[st]}</span>
              <span
                className={`flex-1 text-[12px] leading-[1.5] ${
                  st === 'done'
                    ? 'text-[var(--trae-text-tertiary)] line-through'
                    : st === 'running'
                      ? 'text-[var(--trae-text-default)] font-medium'
                      : 'text-[var(--trae-text-secondary)]'
                }`}
              >
                {step}
              </span>
              <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-[var(--trae-text-tertiary)]">
                {STEP_LABEL[st]}
              </span>
            </li>
          )
        })}
      </ol>
      {/* 验证方法（若有） */}
      {plan.verification && (
        <div className="border-t border-[var(--trae-border-neutral-l1)] pt-2 text-[11px] leading-[1.5] text-[var(--trae-text-tertiary)]">
          <span className="font-medium text-[var(--trae-text-secondary)]">验证：</span>
          {plan.verification}
        </div>
      )}
    </div>
  )
}

export default PaorPlanCard
