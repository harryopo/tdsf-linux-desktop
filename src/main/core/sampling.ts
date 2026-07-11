/**
 * 自适应自洽采样模块
 *
 * 策略：
 *   - 置信度 ≥ 0.7：单次推理即可（高置信度，无需重采样）
 *   - 置信度 < 0.7：触发 3 次重采样，取多数票（低置信度，提高可靠性）
 *
 * 多数票机制确保在低置信度场景下通过多次采样降低单次推理的随机性，
 * 提升最终结果的可信度。
 */

/** 置信度阈值，低于此值触发重采样 */
export const CONFIDENCE_THRESHOLD = 0.7

/** 重采样次数 */
export const RESAMPLE_COUNT = 3

/**
 * 判断是否需要重采样
 * @param confidence - 当前置信度
 * @returns true 表示置信度低于阈值，需要重采样
 */
export function shouldResample(confidence: number): boolean {
  return confidence < CONFIDENCE_THRESHOLD
}

/**
 * 对多次采样结果进行多数票投票
 * 返回出现次数最多的结果。若票数相同，返回最先出现的那个。
 * @param results - 采样结果列表
 * @returns 获得最多票的结果，空列表返回空字符串
 */
export function resampleAndVote(results: string[]): string {
  if (results.length === 0) return ''
  if (results.length === 1) return results[0]

  const voteCount = new Map<string, number>()
  for (const result of results) {
    const count = voteCount.get(result) ?? 0
    voteCount.set(result, count + 1)
  }

  let maxVotes = 0
  let winner = results[0]
  for (const [result, votes] of voteCount) {
    if (votes > maxVotes) {
      maxVotes = votes
      winner = result
    }
  }
  return winner
}

/**
 * 自适应采样：根据置信度决定是否重采样
 *
 * - 高置信度（≥ 0.7）：调用 generator 一次
 * - 低置信度（< 0.7）：调用 generator 三次，取多数票
 *
 * @param confidence - 当前置信度
 * @param generator - 结果生成器（异步函数，每次调用返回一个采样结果）
 * @returns 最终结果（单次或多数票）
 */
export async function adaptiveSample(
  confidence: number,
  generator: () => Promise<string>
): Promise<string> {
  // 高置信度：单次推理
  if (!shouldResample(confidence)) {
    return generator()
  }

  // 低置信度：3 次重采样 + 多数票
  const results = await Promise.all([
    generator(),
    generator(),
    generator()
  ])
  return resampleAndVote(results)
}
