/**
 * LoopWorkflowPanel — 循环工程工作流可视化面板
 *
 * // @ai-session: ai-glm-20260721-loop-eng
 * // @ai-task: loop-engineering-ui
 *
 * 用户原话：
 *   "我要从「假设计 → 可演示真 IDE」做完一整轮"
 *
 * 渲染循环工程的完整执行流程：
 *   1. LLM 推理阶段（假设计）— 显示 hypothesis + fixCommand + confidence
 *   2. 7 步 HITL 进度条 — collect→analyze→reason→check→confirm→execute→verify
 *   3. 决策卡片（confirm 步骤触发）— 显示风险/证据/命令，批准/拒绝按钮
 *   4. 完成状态 — verified / rejected / failed
 *
 * 设计原则：
 *   - 严格使用 var(--color-*) / var(--trae-*) CSS 变量（Hard Constraint）
 *   - 卡片 hover 仅允许阴影变化（Hard Constraint）
 *   - 不使用 emoji，使用 lucide-react 图标
 *   - 设计风格与 AIPanel.tsx MessageRow 一致
 */

import { FC, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  Sparkles,
  Play,
  X,
  ChevronRight,
  PlugZap,
} from 'lucide-react'
import { cn } from '@/components/trae/utils'
import type {
  UseLoopEngineeringResult,
  AgentStep,
} from './useLoopEngineering'

// ============================================================================
// 常量
// ============================================================================

/** 7 步 HITL 步骤定义 */
const STEPS: { key: AgentStep; label: string; description: string }[] = [
  { key: 'collect', label: '采集', description: '采集环境信息（hostname/uname/free/df/ps）' },
  { key: 'analyze', label: '分析', description: '分析日志 + 用户问题' },
  { key: 'reason', label: '推理', description: '采集证据 + LLM 推理' },
  { key: 'check', label: '检查', description: '安全风险评估 + 决策卡片生成' },
  { key: 'confirm', label: '确认', description: '人工确认（HITL 核心）' },
  { key: 'execute', label: '执行', description: 'SSH 执行修复命令' },
  { key: 'verify', label: '验证', description: '采集执行后状态对比' },
]

// ============================================================================
// 子组件
// ============================================================================

/** 步骤图标（根据状态显示） */
const StepIcon: FC<{
  step: AgentStep
  completed: boolean
  current: boolean
  waiting: boolean
}> = ({ completed, current, waiting }) => {
  if (completed) {
    return <CheckCircle2 className="size-3.5 text-[var(--trae-status-success-default)]" />
  }
  if (current && waiting) {
    return <Loader2 className="size-3.5 animate-spin text-[var(--trae-status-alert-default)]" />
  }
  if (current) {
    return <Loader2 className="size-3.5 animate-spin text-[var(--trae-bg-brand)]" />
  }
  return <Circle className="size-3.5 text-[var(--trae-text-tertiary)]" />
}

/** LLM 推理结果卡片 */
const HypothesisCard: FC<{
  hypothesis: UseLoopEngineeringResult['hypothesis']
}> = ({ hypothesis }) => {
  if (!hypothesis) return null
  const confidencePercent = Math.round(hypothesis.confidence * 100)
  const confidenceColor =
    confidencePercent >= 70
      ? 'var(--trae-status-success-default)'
      : confidencePercent >= 40
        ? 'var(--trae-status-alert-default)'
        : 'var(--trae-status-error-default)'

  return (
    <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-[var(--trae-text-brand)]" />
        <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">LLM 假设</span>
        <span
          className="ml-auto text-[11px] font-medium tabular-nums"
          style={{ color: confidenceColor }}
        >
          {confidencePercent}%
        </span>
      </div>
      <div className="mb-2 text-[11px] leading-4 text-[var(--trae-text-secondary)]">
        {hypothesis.hypothesis}
      </div>
      <div className="rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-overlay-l2)] px-2 py-1.5">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] text-[var(--trae-text-tertiary)]">
          <Terminal className="size-2.5" />
          <span>建议命令</span>
        </div>
        <code className="block whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-[var(--trae-text-default)]">
          {hypothesis.fixCommand}
        </code>
      </div>
    </div>
  )
}

/** 7 步进度条 */
const StepProgress: FC<{
  workflowState: UseLoopEngineeringResult['workflowState']
}> = ({ workflowState }) => {
  if (!workflowState) return null
  const completed = new Set(workflowState.completedSteps)
  const current = workflowState.currentStep

  return (
    <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] p-3">
      <div className="mb-2 text-[11px] font-semibold text-[var(--trae-text-default)]">
        7 步 HITL 工作流
      </div>
      <div className="flex flex-col gap-1.5">
        {STEPS.map((step) => {
          const isCompleted = completed.has(step.key)
          const isCurrent = current === step.key
          const isWaiting = isCurrent && workflowState.waitingForConfirmation
          return (
            <div
              key={step.key}
              className={cn(
                'flex items-start gap-2 rounded-[var(--trae-radius-4)] px-2 py-1.5 transition-colors',
                isCurrent && 'bg-[var(--trae-bg-overlay-l2)]'
              )}
            >
              <div className="mt-0.5 flex-shrink-0">
                <StepIcon
                  step={step.key}
                  completed={isCompleted}
                  current={isCurrent}
                  waiting={isWaiting}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span
                    className={cn(
                      'text-[11px] font-medium',
                      isCompleted
                        ? 'text-[var(--trae-text-secondary)] line-through'
                        : isCurrent
                          ? 'text-[var(--trae-text-default)]'
                          : 'text-[var(--trae-text-tertiary)]'
                    )}
                  >
                    {step.label}
                  </span>
                  {isWaiting && (
                    <span className="rounded-full bg-[var(--trae-status-alert-surface-l1)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--trae-status-alert-default)]">
                      等待确认
                    </span>
                  )}
                </div>
                {(isCurrent || isCompleted) && workflowState.stepDetails?.[step.key] && (
                  <div className="mt-0.5 truncate text-[10px] text-[var(--trae-text-tertiary)]">
                    {workflowState.stepDetails[step.key]}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 决策卡片（confirm 步骤触发） */
const DecisionCardView: FC<{
  card: NonNullable<UseLoopEngineeringResult['decisionCard']>
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
}> = ({ card, onApprove, onReject, disabled }) => {
  const riskLevel = (card.risk?.level ?? 'SAFE').toUpperCase()
  const isHighRisk = ['HIGH', 'CRITICAL'].includes(riskLevel)
  const RiskIcon = isHighRisk ? ShieldAlert : ShieldCheck
  const riskColor = isHighRisk
    ? 'var(--trae-status-error-default)'
    : 'var(--trae-status-success-default)'

  return (
    <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-brand)] bg-[var(--trae-bg-brand-popup)] p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5">
        <RiskIcon className="size-3.5" style={{ color: riskColor }} />
        <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">决策卡片</span>
        <span
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            backgroundColor: isHighRisk
              ? 'var(--trae-status-error-surface-l1)'
              : 'var(--trae-status-success-surface-l1)',
            color: riskColor,
          }}
        >
          {riskLevel}
        </span>
      </div>

      {/* 根因假设 */}
      <div className="mb-2 text-[11px] leading-4 text-[var(--trae-text-secondary)]">
        <span className="font-medium text-[var(--trae-text-default)]">根因：</span>
        {card.hypothesis}
      </div>

      {/* 置信度 */}
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[10px] text-[var(--trae-text-tertiary)]">置信度</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--trae-bg-overlay-l3)]">
          <div
            className="h-full bg-[var(--trae-bg-brand)] transition-all"
            style={{ width: `${Math.round(card.confidence * 100)}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-[var(--trae-text-secondary)]">
          {Math.round(card.confidence * 100)}%
        </span>
      </div>

      {/* 修复命令 */}
      <div className="mb-2 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-overlay-l2)] px-2 py-1.5">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] text-[var(--trae-text-tertiary)]">
          <Terminal className="size-2.5" />
          <span>修复命令</span>
        </div>
        <code className="block whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-[var(--trae-text-default)]">
          {card.fixCommand}
        </code>
      </div>

      {/* 修复说明 */}
      {card.fixDescription && (
        <div className="mb-2 text-[11px] leading-4 text-[var(--trae-text-tertiary)]">
          {card.fixDescription}
        </div>
      )}

      {/* 风险描述 */}
      {card.risk?.description && (
        <div className="mb-2 text-[10px] leading-4 text-[var(--trae-text-tertiary)]">
          <span className="font-medium">风险：</span>
          {card.risk.description}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-1.5">
        <button
          type="button"
          data-dom-id="approve-execution"
          onClick={onApprove}
          disabled={disabled}
          className="btn-press inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-brand)] text-[11px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)] disabled:opacity-40"
        >
          <Play className="size-3" />
          批准执行
        </button>
        <button
          type="button"
          data-dom-id="reject-execution"
          onClick={onReject}
          disabled={disabled}
          className="btn-press inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-[var(--trae-radius-4)] border border-[var(--trae-border-neutral-l2)] bg-transparent text-[11px] font-medium text-[var(--trae-text-secondary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] disabled:opacity-40"
        >
          <X className="size-3" />
          拒绝
        </button>
      </div>
    </div>
  )
}

/** 被阻止卡片（SSH 未连接等场景） */
const BlockedCard: FC<{
  reason: string | null
  message: string | null
  onGoToSsh: () => void
}> = ({ reason, message, onGoToSsh }) => {
  const isSshBlocked = reason === 'SSH_NO_CONNECTION'
  return (
    <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-status-warning-surface-l2)] bg-[var(--trae-status-warning-surface-l1)] p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 text-[var(--trae-status-warning-default)]" />
        <span className="text-[12px] font-semibold text-[var(--trae-status-warning-default)]">
          {isSshBlocked ? 'SSH 未连接' : '操作被阻止'}
        </span>
        {reason && (
          <span className="ml-auto rounded-full bg-[var(--trae-status-warning-surface-l2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--trae-status-warning-default)]">
            {reason}
          </span>
        )}
      </div>
      <div className="mb-2 text-[11px] leading-4 text-[var(--trae-text-secondary)]">
        {message ?? '请先完成前置条件后再执行此操作'}
      </div>
      {isSshBlocked && (
        <button
          type="button"
          data-dom-id="goto-ssh-settings"
          onClick={onGoToSsh}
          className="btn-press inline-flex h-7 items-center gap-1 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-brand)] px-3 text-[11px] font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)]"
        >
          <PlugZap className="size-3" />
          去连接 SSH
        </button>
      )}
    </div>
  )
}

/** 完成状态卡片 */
const CompletionCard: FC<{
  finalCard: UseLoopEngineeringResult['finalCard']
  error: string | null
}> = ({ finalCard, error }) => {
  if (error) {
    return (
      <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-status-error-surface-l2)] bg-[var(--trae-status-error-surface-l1)] p-3">
        <div className="mb-1 flex items-center gap-1.5">
          <AlertTriangle className="size-3.5 text-[var(--trae-status-error-default)]" />
          <span className="text-[12px] font-semibold text-[var(--trae-status-error-default)]">
            执行失败
          </span>
        </div>
        <div className="text-[11px] leading-4 text-[var(--trae-text-secondary)]">{error}</div>
      </div>
    )
  }

  if (!finalCard) return null

  const isSuccess = finalCard.status === 'verified'
  const StatusIcon = isSuccess ? CheckCircle2 : AlertTriangle
  const statusColor = isSuccess
    ? 'var(--trae-status-success-default)'
    : 'var(--trae-status-alert-default)'
  const statusText =
    finalCard.status === 'verified'
      ? '验证通过'
      : finalCard.status === 'rejected'
        ? '已拒绝'
        : finalCard.status === 'failed'
          ? '执行失败'
          : finalCard.status === 'executed'
            ? '已执行'
            : '已结束'

  return (
    <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <StatusIcon className="size-3.5" style={{ color: statusColor }} />
        <span className="text-[12px] font-semibold text-[var(--trae-text-default)]">
          {statusText}
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ color: statusColor, backgroundColor: `color-mix(in srgb, ${statusColor} 12%, transparent)` }}
        >
          {finalCard.status.toUpperCase()}
        </span>
      </div>

      {/* 执行的命令 */}
      <div className="mb-2 rounded-[var(--trae-radius-4)] bg-[var(--trae-bg-overlay-l2)] px-2 py-1.5">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] text-[var(--trae-text-tertiary)]">
          <Terminal className="size-2.5" />
          <span>执行的命令</span>
        </div>
        <code className="block whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-[var(--trae-text-default)]">
          {finalCard.fixCommand}
        </code>
      </div>

      {/* 根因 */}
      <div className="text-[11px] leading-4 text-[var(--trae-text-secondary)]">
        <span className="font-medium text-[var(--trae-text-default)]">根因：</span>
        {finalCard.hypothesis}
      </div>
    </div>
  )
}

// ============================================================================
// 主组件
// ============================================================================

export interface LoopWorkflowPanelProps {
  /** useLoopEngineering 返回值 */
  loop: UseLoopEngineeringResult
}

/**
 * LoopWorkflowPanel — 循环工程工作流可视化面板
 *
 * 不显示时返回 null。显示时占据 AIPanel 消息区域。
 */
export const LoopWorkflowPanel: FC<LoopWorkflowPanelProps> = ({ loop }) => {
  const {
    phase,
    hypothesis,
    workflowState,
    decisionCard,
    finalCard,
    error,
    blockedReason,
    blockedMessage,
    confirm,
    cancel,
  } = loop

  const navigate = useNavigate()

  // 空闲时不显示
  if (phase === 'idle') return null

  const handleApprove = useCallback(() => {
    void confirm(true)
  }, [confirm])

  const handleReject = useCallback(() => {
    void confirm(false)
  }, [confirm])

  const handleGoToSsh = useCallback(() => {
    navigate('/settings/ssh')
  }, [navigate])

  return (
    <div className="flex flex-col gap-2">
      {/* 阶段指示器 */}
      <div className="flex items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] px-3 py-1.5">
        <Sparkles className="size-3 text-[var(--trae-text-brand)]" />
        {/* v2.3.7 修复：原硬编码"演示模式"误导用户，实际为真实循环工程（loop:* IPC + 7 步 HITL），改为"AI 编排" */}
        <span className="text-[11px] font-medium text-[var(--trae-text-default)]">AI 编排</span>
        <ChevronRight className="size-3 text-[var(--trae-text-tertiary)]" />
        <span className="text-[11px] text-[var(--trae-text-secondary)]">
          {phase === 'llm-thinking' && 'LLM 推理中…'}
          {phase === 'workflow' && `工作流执行中（${workflowState?.currentStep ?? ''}）`}
          {phase === 'awaiting' && '等待用户确认'}
          {phase === 'done' && '已完成'}
          {phase === 'error' && '执行出错'}
          {phase === 'blocked' && '操作被阻止'}
        </span>
        {(phase === 'workflow' || phase === 'awaiting') && (
          <button
            type="button"
            onClick={() => void cancel()}
            className="btn-press ml-auto inline-flex h-5 items-center gap-0.5 rounded-[var(--trae-radius-4)] px-1.5 text-[10px] text-[var(--trae-text-tertiary)] transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-[var(--trae-text-default)]"
          >
            <X className="size-2.5" />
            取消
          </button>
        )}
      </div>

      {/* LLM 推理结果（假设计阶段） */}
      {hypothesis && <HypothesisCard hypothesis={hypothesis} />}

      {/* 7 步进度条 */}
      {workflowState && <StepProgress workflowState={workflowState} />}

      {/* 决策卡片（等待用户确认） */}
      {decisionCard && phase === 'awaiting' && (
        <DecisionCardView
          card={decisionCard}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}

      {/* 完成状态 */}
      {(phase === 'done' || phase === 'error') && (
        <CompletionCard finalCard={finalCard} error={error} />
      )}

      {/* 被阻止状态（SSH 未连接等） */}
      {phase === 'blocked' && (
        <BlockedCard
          reason={blockedReason}
          message={blockedMessage}
          onGoToSsh={handleGoToSsh}
        />
      )}
    </div>
  )
}
