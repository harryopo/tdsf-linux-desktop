/**
 * paor-graph — PAOR 状态图编排引擎（v2.11）
 *
 * 背景：PAOR 原为线性 while 循环，"下一步去哪"的决策与副作用（SSH/LLM 执行）
 * 硬编码耦合在一个 switch 里，无法单测、abort 分支不可达、无"失败回退重规划"能力。
 *
 * 本模块把「路由决策」抽成纯函数（reduce 形式）：给定当前状态 + reflect 决策 + 上限，
 * 返回下一步动作与新状态。supervisor 负责执行副作用，引擎只负责决策路由。
 *
 * 设计约束：
 * - 纯函数、无副作用、可穷举单测（不依赖 SSH/LLM/网络）
 * - 默认行为与旧 switch 100% 等价（maxReplans=0 时，retry 耗尽 → 跳下一步），
 *   保证现有 runPaorLoop 测试不回退
 * - 新增能力（opt-in，maxReplans>0 才生效）：
 *   · replan 回退边：失败可回退到 Plan 重新规划（replanCount 上限防震荡）
 *   · blocked 终态：重规划上限耗尽仍失败 → blocked（区别于正常 abort）
 *   · abort 可达：显式 abort 或 replan 耗尽
 */

/** reflect 阶段的循环决策（v2.11 新增 replan） */
export type PaorDecision = 'continue' | 'retry' | 'abort' | 'done' | 'replan'

/** 路由动作：引擎告诉执行器下一步做什么 */
export type PaorRouteAction =
  | 'retry-same' // 原地重试当前步骤（stepIndex 不变）
  | 'next-step' // 前进到下一步
  | 'replan' // 回退到 Plan 重新规划（stepIndex 归零）
  | 'complete' // 计划正常完成
  | 'abort' // 中止（含 blocked）

/** 循环可变状态（引擎读写的最小状态，不含副作用产物） */
export interface PaorLoopState {
  /** 当前步骤索引 */
  stepIndex: number
  /** 当前步骤已重试次数 */
  retryCount: number
  /** 已重新规划次数（防震荡） */
  replanCount: number
  /** 计划步骤总数 */
  totalSteps: number
}

/** 路由上限配置 */
export interface PaorRouteLimits {
  /** 每步最大重试次数 */
  maxRetriesPerStep: number
  /** 最大重新规划次数（0 = 禁用 replan，保持旧行为：retry 耗尽跳下一步） */
  maxReplans: number
}

/** 路由结果 */
export interface PaorRouteResult {
  /** 下一步动作 */
  action: PaorRouteAction
  /** 更新后的状态 */
  state: PaorLoopState
  /** 若进入终态，给出最终状态标签 */
  terminal?: 'done' | 'abort' | 'blocked'
}

/** 创建初始循环状态 */
export function initPaorState(totalSteps: number): PaorLoopState {
  return { stepIndex: 0, retryCount: 0, replanCount: 0, totalSteps: Math.max(0, totalSteps) }
}

/**
 * 循环是否应继续（替代 while 条件的一部分）
 *
 * @param state 当前状态
 * @param iterationNum 已执行迭代数
 * @param maxIterations 迭代上限
 */
export function shouldContinueLoop(
  state: PaorLoopState,
  iterationNum: number,
  maxIterations: number,
): boolean {
  return iterationNum < maxIterations && state.stepIndex < state.totalSteps
}

/**
 * 核心路由：根据 reflect 决策与当前状态，计算下一步动作与新状态（纯函数）
 *
 * 决策语义（与旧 switch 对齐 + 扩展）：
 * - done      → complete（stepIndex 推到末尾以退出循环）
 * - abort     → abort（显式中止）
 * - continue  → next-step（stepIndex+1，retry 归零）
 * - retry     → 未达重试上限：retry-same（retryCount+1）
 *               达上限 + maxReplans>0 且未达重规划上限：replan（回退重规划）
 *               达上限 + maxReplans>0 且已达重规划上限：abort（terminal=blocked）
 *               达上限 + maxReplans=0：next-step（旧默认行为，跳过失败步骤）
 * - replan    → 未达重规划上限：replan；已达：abort（terminal=blocked）
 */
export function routePaorNext(
  decision: PaorDecision,
  state: PaorLoopState,
  limits: PaorRouteLimits,
): PaorRouteResult {
  switch (decision) {
    case 'done':
      return { action: 'complete', state: { ...state, stepIndex: state.totalSteps }, terminal: 'done' }

    case 'abort':
      return { action: 'abort', state, terminal: 'abort' }

    case 'continue':
      return { action: 'next-step', state: { ...state, stepIndex: state.stepIndex + 1, retryCount: 0 } }

    case 'replan':
      return routeReplan(state, limits)

    case 'retry': {
      if (state.retryCount < limits.maxRetriesPerStep) {
        // 未达重试上限 → 原地重试
        return { action: 'retry-same', state: { ...state, retryCount: state.retryCount + 1 } }
      }
      // 重试耗尽
      if (limits.maxReplans > 0) {
        return routeReplan(state, limits)
      }
      // 旧默认行为：跳到下一步（避免死循环）
      return { action: 'next-step', state: { ...state, stepIndex: state.stepIndex + 1, retryCount: 0 } }
    }

    default:
      // 未知决策按 continue 处理（防御）
      return { action: 'next-step', state: { ...state, stepIndex: state.stepIndex + 1, retryCount: 0 } }
  }
}

/** replan 分支：未达上限 → 回退重规划；已达 → blocked 中止 */
function routeReplan(state: PaorLoopState, limits: PaorRouteLimits): PaorRouteResult {
  if (state.replanCount < limits.maxReplans) {
    return {
      action: 'replan',
      state: { ...state, replanCount: state.replanCount + 1, stepIndex: 0, retryCount: 0 },
    }
  }
  // 重规划上限耗尽仍无法推进 → blocked（区别于正常 abort）
  return { action: 'abort', state, terminal: 'blocked' }
}

/**
 * 风险命令被拒后的路由（与旧行为一致：跳过该步继续后续）
 *
 * 注：保持旧的"高危被拒→跳下一步"语义不变，独立成函数便于将来配置化
 * （如"高危被拒→中止"或"→回退重规划"）。
 */
export function routeRiskRejected(state: PaorLoopState): PaorRouteResult {
  return { action: 'next-step', state: { ...state, stepIndex: state.stepIndex + 1, retryCount: 0 } }
}
