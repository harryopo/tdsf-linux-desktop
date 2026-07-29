/**
 * paor-graph.test.ts — PAOR 状态图编排引擎单测（v2.11）
 *
 * 价值：路由决策从 supervisor 的 for 循环里抽出后，可穷举所有分支而无需 mock SSH/LLM。
 */
import { describe, it, expect } from 'vitest'
import {
  initPaorState,
  shouldContinueLoop,
  routePaorNext,
  routeRiskRejected,
  type PaorLoopState,
  type PaorRouteLimits,
} from '../../src/main/core/agent/paor-graph'

const st = (partial: Partial<PaorLoopState> = {}): PaorLoopState => ({
  stepIndex: 0,
  retryCount: 0,
  replanCount: 0,
  totalSteps: 3,
  ...partial,
})

/** 旧默认行为：禁用 replan */
const LEGACY: PaorRouteLimits = { maxRetriesPerStep: 1, maxReplans: 0 }
/** 启用 replan 回退 */
const WITH_REPLAN: PaorRouteLimits = { maxRetriesPerStep: 1, maxReplans: 2 }

describe('initPaorState / shouldContinueLoop', () => {
  it('初始状态归零，totalSteps 非负', () => {
    expect(initPaorState(3)).toEqual({ stepIndex: 0, retryCount: 0, replanCount: 0, totalSteps: 3 })
    expect(initPaorState(-1).totalSteps).toBe(0)
  })

  it('迭代未超上限且步骤未走完 → 继续', () => {
    expect(shouldContinueLoop(st({ stepIndex: 1 }), 2, 5)).toBe(true)
  })
  it('达到迭代上限 → 停止', () => {
    expect(shouldContinueLoop(st(), 5, 5)).toBe(false)
  })
  it('步骤走完 → 停止', () => {
    expect(shouldContinueLoop(st({ stepIndex: 3, totalSteps: 3 }), 1, 5)).toBe(false)
  })
})

describe('routePaorNext — 决策路由（默认行为与旧 switch 等价）', () => {
  it('done → complete，stepIndex 推到末尾', () => {
    const r = routePaorNext('done', st({ stepIndex: 1 }), LEGACY)
    expect(r.action).toBe('complete')
    expect(r.terminal).toBe('done')
    expect(r.state.stepIndex).toBe(3)
  })

  it('abort → abort 终态', () => {
    const r = routePaorNext('abort', st(), LEGACY)
    expect(r.action).toBe('abort')
    expect(r.terminal).toBe('abort')
  })

  it('continue → next-step，retry 归零', () => {
    const r = routePaorNext('continue', st({ stepIndex: 0, retryCount: 1 }), LEGACY)
    expect(r.action).toBe('next-step')
    expect(r.state.stepIndex).toBe(1)
    expect(r.state.retryCount).toBe(0)
  })

  it('retry 未达上限 → 原地重试，retryCount+1', () => {
    const r = routePaorNext('retry', st({ retryCount: 0 }), LEGACY)
    expect(r.action).toBe('retry-same')
    expect(r.state.stepIndex).toBe(0)
    expect(r.state.retryCount).toBe(1)
  })

  it('retry 耗尽 + maxReplans=0 → 跳下一步（旧默认行为，不回退）', () => {
    const r = routePaorNext('retry', st({ retryCount: 1 }), LEGACY)
    expect(r.action).toBe('next-step')
    expect(r.state.stepIndex).toBe(1)
    expect(r.state.retryCount).toBe(0)
  })
})

describe('routePaorNext — replan 回退边（v2.11 新增能力）', () => {
  it('retry 耗尽 + 启用 replan → 回退重规划，stepIndex 归零，replanCount+1', () => {
    const r = routePaorNext('retry', st({ stepIndex: 2, retryCount: 1 }), WITH_REPLAN)
    expect(r.action).toBe('replan')
    expect(r.state.stepIndex).toBe(0)
    expect(r.state.retryCount).toBe(0)
    expect(r.state.replanCount).toBe(1)
  })

  it('显式 replan 决策 → 回退重规划', () => {
    const r = routePaorNext('replan', st(), WITH_REPLAN)
    expect(r.action).toBe('replan')
    expect(r.state.replanCount).toBe(1)
  })

  it('replan 上限耗尽 → blocked 终态（abort，区别于正常 abort）', () => {
    const r = routePaorNext('retry', st({ retryCount: 1, replanCount: 2 }), WITH_REPLAN)
    expect(r.action).toBe('abort')
    expect(r.terminal).toBe('blocked')
  })

  it('replan 决策上限耗尽同样 → blocked', () => {
    const r = routePaorNext('replan', st({ replanCount: 2 }), WITH_REPLAN)
    expect(r.terminal).toBe('blocked')
  })
})

describe('routeRiskRejected — 高危被拒路由（保持旧语义：跳下一步）', () => {
  it('跳到下一步，retry 归零', () => {
    const r = routeRiskRejected(st({ stepIndex: 1, retryCount: 1 }))
    expect(r.action).toBe('next-step')
    expect(r.state.stepIndex).toBe(2)
    expect(r.state.retryCount).toBe(0)
  })
})

describe('纯函数不可变性', () => {
  it('routePaorNext 不修改入参 state', () => {
    const input = st({ stepIndex: 1, retryCount: 0 })
    const snapshot = { ...input }
    routePaorNext('retry', input, LEGACY)
    expect(input).toEqual(snapshot)
  })
})
