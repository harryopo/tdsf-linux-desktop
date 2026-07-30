/**
 * paor-plan-status 单测（v2.11 任务拆解可视化）
 *
 * 锁死步骤状态推导：待执行/进行中/完成/失败/已拦截 + 进度计算。
 */
import { describe, it, expect } from 'vitest'
import {
  derivePlanStepStatuses,
  computePlanProgress,
} from '@/components/workbench/panels/paor-plan-status'
import type { PaorIteration } from '@shared/paor-types'

/** 构造一条迭代轨迹 */
function iter(
  iteration: number,
  stepIndex: number,
  status: 'success' | 'partial' | 'failed',
  opts?: { riskBlocked?: boolean },
): PaorIteration {
  return {
    iteration,
    stepIndex,
    act: { stepIndex, command: `cmd-${stepIndex}`, output: '', success: status === 'success' },
    observe: { status, observations: [], needsRetry: status !== 'success' },
    reflect: { decision: status === 'success' ? 'continue' : 'retry', reasoning: '' },
    riskBlocked: opts?.riskBlocked,
  }
}

describe('derivePlanStepStatuses', () => {
  const steps = ['step0', 'step1', 'step2']

  it('无迭代 + 运行中 → 第一步 running，其余 pending', () => {
    expect(derivePlanStepStatuses(steps, [], true)).toEqual(['running', 'pending', 'pending'])
  })

  it('无迭代 + 未运行 → 全 pending', () => {
    expect(derivePlanStepStatuses(steps, [], false)).toEqual(['pending', 'pending', 'pending'])
  })

  it('第一步成功、正在执行第二步 → done / running / pending', () => {
    const its = [iter(1, 0, 'success'), iter(2, 1, 'partial')]
    expect(derivePlanStepStatuses(steps, its, true)).toEqual(['done', 'running', 'pending'])
  })

  it('全部成功 → 全 done', () => {
    const its = [iter(1, 0, 'success'), iter(2, 1, 'success'), iter(3, 2, 'success')]
    expect(derivePlanStepStatuses(steps, its, false)).toEqual(['done', 'done', 'done'])
  })

  it('高危命令被拦截 → blocked', () => {
    const its = [iter(1, 0, 'success'), iter(2, 1, 'failed', { riskBlocked: true })]
    expect(derivePlanStepStatuses(steps, its, false)).toEqual(['done', 'blocked', 'pending'])
  })

  it('某步失败且已停止（非当前步）→ failed', () => {
    // 第 0 步失败，循环已推进到第 1 步（成功），停止
    const its = [iter(1, 0, 'failed'), iter(2, 1, 'success')]
    const out = derivePlanStepStatuses(steps, its, false)
    expect(out[0]).toBe('failed')
    expect(out[1]).toBe('done')
  })

  it('运行中当前步失败（重试中）→ running', () => {
    const its = [iter(1, 0, 'success'), iter(2, 1, 'failed')]
    expect(derivePlanStepStatuses(steps, its, true)[1]).toBe('running')
  })
})

describe('computePlanProgress', () => {
  it('计算已完成/总数/百分比', () => {
    expect(computePlanProgress(['done', 'done', 'pending', 'running'])).toEqual({
      done: 2,
      total: 4,
      percent: 50,
    })
  })

  it('空步骤 → 0%', () => {
    expect(computePlanProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it('全完成 → 100%', () => {
    expect(computePlanProgress(['done', 'done'])).toEqual({ done: 2, total: 2, percent: 100 })
  })
})
