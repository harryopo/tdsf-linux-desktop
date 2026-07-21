/**
 * 预期回显监控（v0.9.4 批次 4 - 任务 5）
 *
 * 借鉴 Kilo Code 的"预期回显"机制：
 *   d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §6.2
 *
 * 执行命令前先记录"预期输出特征"，执行后对比实际输出，发现异常时告警：
 * - mustContain：必须出现的关键词（任一匹配即视为符合预期）
 * - mustNotContain：禁止出现的关键词（任一匹配即视为违反预期，如 "Permission denied"）
 * - expectedExitCode：预期退出码（默认 0）
 * - timeoutMs：超时阈值（ms，默认 30000）
 *
 * 典型使用场景：
 * - running-subagent 执行高危命令前，先声明预期输出
 * - 命令执行后对比实际输出，发现异常时告警 + 触发审批
 * - 历史会话回放时验证输出一致性
 *
 * 方案书依据：v0.9.4 §11 第 7 类（其他 3 项 - 任务 5）
 */

/**
 * 命令预期配置
 *
 * 由调用方（running-subagent / supervisor）在执行命令前构造，
 * 传入 checkExpectation 进行对比。
 */
export interface CommandExpectation {
  /** 命令文本 */
  command: string
  /**
   * 预期必须出现的关键词（任一匹配即视为符合预期）
   *
   * 空数组或 undefined 表示不检查 mustContain 规则。
   */
  mustContain?: string[]
  /**
   * 预期不能出现的关键词（任一匹配即视为违反预期）
   *
   * 例如：['Permission denied', 'command not found', 'No such file or directory']
   */
  mustNotContain?: string[]
  /**
   * 预期退出码（默认 0）
   *
   * 设为 null 表示不检查退出码。
   */
  expectedExitCode?: number | null
  /**
   * 超时阈值（ms，默认 30000）
   *
   * 注意：超时检查不由本模块执行（由调用方控制超时），
   * 此字段仅作为元数据记录，便于审计。
   */
  timeoutMs?: number
}

/**
 * 预期违反类型
 */
export type ExpectationViolationType =
  | 'missing-required' // 缺少必须出现的关键词
  | 'forbidden-found' // 出现了禁止的关键词
  | 'exit-code-mismatch' // 退出码不匹配
  | 'timeout' // 超时（由调用方标记）

/**
 * 预期违反详情
 *
 * checkExpectation 返回的违规列表元素。
 */
export interface ExpectationViolation {
  /** 违反类型 */
  type: ExpectationViolationType
  /** 实际退出码（exit-code-mismatch / timeout 时填充） */
  actualExitCode?: number
  /** 实际输出片段（截断 500 字符，避免长输出导致日志膨胀） */
  actualOutputSnippet: string
  /** 违反原因（人类可读） */
  reason: string
  /** 触发违反的关键词（missing-required / forbidden-found 时填充） */
  triggeredKeyword?: string
}

/**
 * 实际输出片段的最大长度（字符数）
 *
 * 超出时截断并追加 '...[truncated]' 后缀。
 */
const MAX_OUTPUT_SNIPPET_LENGTH = 500

/**
 * 默认预期退出码
 */
const DEFAULT_EXPECTED_EXIT_CODE = 0

/**
 * 默认超时阈值（ms）
 */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 截断输出片段
 *
 * 超过 MAX_OUTPUT_SNIPPET_LENGTH 时截断并追加后缀。
 *
 * @param output 原始输出
 * @returns 截断后的片段
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_SNIPPET_LENGTH) {
    return output
  }
  return output.slice(0, MAX_OUTPUT_SNIPPET_LENGTH) + '...[truncated]'
}

/**
 * 对比预期与实际输出
 *
 * 检查规则（按顺序）：
 * 1. forbidden-found：实际输出包含 mustNotContain 中的任一关键词 → 违反
 * 2. missing-required：实际输出未包含 mustContain 中的任一关键词 → 违反
 *    注意：mustContain 是"任一匹配即符合"，所以只有全部都不匹配才违反
 * 3. exit-code-mismatch：实际退出码 != expectedExitCode → 违反
 *
 * 超时检查（timeout）由调用方标记：
 * - 调用方在超时时直接构造 ExpectationViolation({ type: 'timeout' }) 加入违规列表
 * - 或在调用 checkExpectation 前自行检查 elapsed > timeoutMs
 *
 * @param expectation 预期配置
 * @param actualOutput 实际输出
 * @param actualExitCode 实际退出码
 * @returns 违规列表（空数组表示符合预期）
 *
 * @example
 * ```ts
 * const expectation: CommandExpectation = {
 *   command: 'ls /etc/nginx',
 *   mustContain: ['nginx.conf'],
 *   mustNotContain: ['Permission denied', 'No such file or directory'],
 *   expectedExitCode: 0,
 * }
 * const violations = checkExpectation(expectation, 'nginx.conf\nsites-enabled', 0)
 * // violations: []  // 符合预期
 * ```
 */
export function checkExpectation(
  expectation: CommandExpectation,
  actualOutput: string,
  actualExitCode: number
): ExpectationViolation[] {
  const violations: ExpectationViolation[] = []
  const outputSnippet = truncateOutput(actualOutput)
  const lowerOutput = actualOutput.toLowerCase()

  // 1. forbidden-found：检查禁止关键词
  if (expectation.mustNotContain && expectation.mustNotContain.length > 0) {
    for (const keyword of expectation.mustNotContain) {
      if (!keyword) continue
      if (lowerOutput.includes(keyword.toLowerCase())) {
        violations.push({
          type: 'forbidden-found',
          actualOutputSnippet: outputSnippet,
          reason: `输出包含禁止关键词："${keyword}"`,
          triggeredKeyword: keyword,
        })
      }
    }
  }

  // 2. missing-required：检查必须关键词
  // mustContain 是"任一匹配即符合"，所以只有全部都不匹配才违反
  if (expectation.mustContain && expectation.mustContain.length > 0) {
    const matchedAny = expectation.mustContain.some((keyword) =>
      keyword ? lowerOutput.includes(keyword.toLowerCase()) : false
    )
    if (!matchedAny) {
      violations.push({
        type: 'missing-required',
        actualOutputSnippet: outputSnippet,
        reason: `输出未包含任一必须关键词：[${expectation.mustContain.join(', ')}]`,
      })
    }
  }

  // 3. exit-code-mismatch：检查退出码
  // expectedExitCode = null 表示不检查退出码
  const expectedCode =
    expectation.expectedExitCode === null
      ? null
      : (expectation.expectedExitCode ?? DEFAULT_EXPECTED_EXIT_CODE)
  if (expectedCode !== null && actualExitCode !== expectedCode) {
    violations.push({
      type: 'exit-code-mismatch',
      actualExitCode,
      actualOutputSnippet: outputSnippet,
      reason: `退出码不匹配：预期 ${expectedCode}，实际 ${actualExitCode}`,
    })
  }

  return violations
}

/**
 * 构造超时违规
 *
 * 由调用方在命令超时时调用，构造一个 timeout 类型的违规对象。
 *
 * @param expectation 预期配置
 * @param elapsedMs 实际耗时（ms）
 * @returns 超时违规对象
 */
export function createTimeoutViolation(
  expectation: CommandExpectation,
  elapsedMs: number
): ExpectationViolation {
  const timeoutMs = expectation.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    type: 'timeout',
    actualOutputSnippet: '',
    reason: `命令超时：耗时 ${elapsedMs}ms，超过阈值 ${timeoutMs}ms`,
  }
}

/**
 * 判断预期配置是否被满足
 *
 * 等价于 checkExpectation(...).length === 0，但语义更清晰。
 *
 * @param expectation 预期配置
 * @param actualOutput 实际输出
 * @param actualExitCode 实际退出码
 * @returns true 表示符合预期（无违规）
 */
export function isExpectationMet(
  expectation: CommandExpectation,
  actualOutput: string,
  actualExitCode: number
): boolean {
  return checkExpectation(expectation, actualOutput, actualExitCode).length === 0
}

/**
 * 格式化违规列表为人类可读字符串
 *
 * 用于日志输出 / UI 展示。
 *
 * @param violations 违规列表
 * @returns 格式化后的字符串
 */
export function formatViolations(violations: ExpectationViolation[]): string {
  if (violations.length === 0) {
    return '符合预期（无违规）'
  }
  const lines = violations.map((v, i) => {
    const parts = [`[${i + 1}] ${v.type}: ${v.reason}`]
    if (v.triggeredKeyword) {
      parts.push(`    触发关键词: ${v.triggeredKeyword}`)
    }
    if (v.actualExitCode !== undefined) {
      parts.push(`    实际退出码: ${v.actualExitCode}`)
    }
    if (v.actualOutputSnippet) {
      parts.push(`    输出片段: ${v.actualOutputSnippet}`)
    }
    return parts.join('\n')
  })
  return `发现 ${violations.length} 项违规：\n${lines.join('\n')}`
}
