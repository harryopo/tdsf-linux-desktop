/**
 * PCR5（Proportional Conflict Redistribution Rule No.5）冲突融合
 *
 * 论文依据：
 * - Smarandache, F. & Dezert, J. (2004). "Four Versions of the Proportional
 *   Conflict Redistribution Rules of Combination in Information Fusion".
 *   arXiv:cs.AI/0408064. https://arxiv.org/pdf/cs.AI/0408064v1
 * - Smarandache, F. & Dezert, J. (2006). "Proportional Conflict Redistribution
 *   Rules for Information Fusion". arXiv:cs.AI/0603005（DSmT 卷 2）.
 * - Smarandache, F. & Dezert, J. (2021). "Improvement of Proportional Conflict
 *   Redistribution Rules of Combination of Basic Belief Assignments".
 *   J. Advances in Information Fusion, Vol 16, No 2.
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §3
 *
 * PCR5 与 Dempster 规则的核心差异：
 * - Dempster：将冲突质量 k 归一化丢弃（除以 1-k），高冲突时失效（Zadeh 悖论）
 * - PCR5：将冲突质量按贡献比例**回填**到参与冲突的命题，保留冲突信息
 *
 * 适用场景：冲突系数 k ≥ 0.3 的高冲突场景
 */

import {
  type MassFunction,
  focalKey,
  parseFocalKey,
  setsIntersect,
  setIntersection,
} from './ds-theory'

/**
 * PCR5 组合规则（Proportional Conflict Redistribution Rule No.5）
 *
 * 公式（Smarandache & Dezert 2004）：
 *
 *   m_PCR5(X) = m_Conj(X)
 *             + Σ_{Y: X∩Y=∅} [ m1(X)²·m2(Y)/(m1(X)+m2(Y))
 *                              + m2(X)²·m1(Y)/(m2(X)+m1(Y)) ]
 *
 * 其中：
 *   m_Conj(X) = Σ_{A∩B=X} m1(A)·m2(B)    （合取规则 / Conjunctive Rule 结果）
 *
 * 回填逻辑详解：
 *   冲突 m1(X)·m2(Y) 中（X∩Y=∅），回填给 X 的比例 = m1(X)/(m1(X)+m2(Y))，
 *   即 X 在冲突双方的"贡献占比"。
 *   因此 X 获得的回填量 = m1(X)·m2(Y)·m1(X)/(m1(X)+m2(Y))
 *                        = m1(X)²·m2(Y)/(m1(X)+m2(Y))
 *
 *   对称项 m2(X)²·m1(Y)/(m2(X)+m1(Y)) 处理 m2 视角下 X 与 m1 中 Y 的冲突。
 *
 * 分母为零处理：当 m1(X)+m2(Y)=0 时，该项视为 0（避免除零）。
 *
 * 优势：
 * 1. 保留冲突信息（不丢弃，按比例回填），避免 Zadeh 悖论
 * 2. 数学严谨：仅将部分冲突回填给真正参与冲突的集合
 * 3. 保留 VBF（Vacuous Belief Function）的中性影响
 * 4. 高冲突鲁棒：即使 k 很大也能合理分配
 *
 * 注：PCR5 不完全满足结合律（quasi-associative），多源融合时按顺序两两组合。
 *
 * @param m1 - 第一个 Mass 函数
 * @param m2 - 第二个 Mass 函数
 * @returns PCR5 组合后的 Mass 函数
 */
export function pcr5Combine(m1: MassFunction, m2: MassFunction): MassFunction {
  // ------------------------------------------------------------------
  // 步骤 1：计算合取规则结果 m_Conj
  // m_Conj(X) = Σ_{A∩B=X} m1(A)·m2(B)
  // ------------------------------------------------------------------
  const conj = new Map<string, number>()

  for (const [keyA, massA] of m1.focalElements) {
    const setA = parseFocalKey(keyA)
    for (const [keyB, massB] of m2.focalElements) {
      const setB = parseFocalKey(keyB)
      const intersection = setIntersection(setA, setB)
      if (intersection.size === 0) continue // 冲突项，不计入合取结果

      const keyC = focalKey(intersection)
      conj.set(keyC, (conj.get(keyC) ?? 0) + massA * massB)
    }
  }

  // ------------------------------------------------------------------
  // 步骤 2：计算冲突回填
  // 对每个焦元 X，找到所有与之冲突的 Y（X∩Y=∅），按 PCR5 公式回填
  // ------------------------------------------------------------------
  const result = new Map<string, number>(conj)

  // 收集所有可能的焦元 X（来自 m1 和 m2 的焦元并集）
  const allFocalKeys = new Set<string>([
    ...m1.focalElements.keys(),
    ...m2.focalElements.keys(),
  ])

  for (const keyX of allFocalKeys) {
    const setX = parseFocalKey(keyX)
    if (setX.size === 0) continue // 跳过空集

    // 获取 X 在两个 Mass 函数中的质量值
    const m1_X = m1.focalElements.get(keyX) ?? 0
    const m2_X = m2.focalElements.get(keyX) ?? 0

    let backfill = 0

    // 遍历 m2 中所有与 X 冲突的 Y，计算第一项：m1(X)²·m2(Y)/(m1(X)+m2(Y))
    for (const [keyY, m2_Y] of m2.focalElements) {
      const setY = parseFocalKey(keyY)
      if (setY.size === 0) continue
      // 仅处理冲突项（X∩Y=∅）
      if (setsIntersect(setX, setY)) continue

      const denom = m1_X + m2_Y
      const term = denom > 1e-12 ? (m1_X * m1_X * m2_Y) / denom : 0
      backfill += term
    }

    // 遍历 m1 中所有与 X 冲突的 Y，计算第二项：m2(X)²·m1(Y)/(m2(X)+m1(Y))
    for (const [keyY, m1_Y] of m1.focalElements) {
      const setY = parseFocalKey(keyY)
      if (setY.size === 0) continue
      if (setsIntersect(setX, setY)) continue

      const denom = m2_X + m1_Y
      const term = denom > 1e-12 ? (m2_X * m2_X * m1_Y) / denom : 0
      backfill += term
    }

    // 将回填量累加到 X 的合取结果上
    if (backfill > 0) {
      result.set(keyX, (result.get(keyX) ?? 0) + backfill)
    }
  }

  return {
    sourceId: `${m1.sourceId}+${m2.sourceId}`,
    sourceName: `${m1.sourceName}⊕${m2.sourceName}`,
    focalElements: result,
    confidence: (m1.confidence + m2.confidence) / 2,
  }
}
