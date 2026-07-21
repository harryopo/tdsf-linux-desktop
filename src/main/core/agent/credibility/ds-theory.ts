/**
 * D-S 证据理论（Dempster-Shafer Evidence Theory）核心实现
 *
 * 论文依据：
 * - Dempster, A.P. (1967). "Upper and Lower Probabilities Induced by a Multivalued Mapping".
 *   Annals of Mathematical Statistics, 38(2): 325-339.
 *   https://www.jstor.org/stable/2284213
 * - Shafer, G. (1976). "A Mathematical Theory of Evidence".
 *   Princeton University Press, ISBN 978-0691081755.
 * - Shafer, G. (2016). "Dempster's rule of combination".
 *   Int. J. Approximate Reasoning 79: 26-40.
 *
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\22-可信度算法论文支撑调研.md §2
 *
 * 核心概念：
 * 1. 识别框架（Frame of Discernment）Θ：互斥且完备的假设集合
 * 2. 基本概率分配（BPA / Mass 函数）m: 2^Θ → [0, 1]
 * 3. 信任函数（Belief Function）Bel(A) = Σ_{B⊆A} m(B)
 * 4. 似真函数（Plausibility Function）Pl(A) = Σ_{B∩A≠∅} m(B) = 1 - Bel(¬A)
 * 5. 信任区间 [Bel(A), Pl(A)]：反映不确定性程度
 *
 * 本实现采用二元识别框架 Θ = {T, ¬T}（可信 / 不可信），
 * 计算复杂度从 2^N 降为 2^2 = 4，适合实时运维场景。
 */

// ============================================================================
// 识别框架常量（二元框架：可信 / 不可信）
// ============================================================================

/** 命题 T：决策可信（Trusted） */
export const TRUSTED = 'T'

/** 命题 ¬T：决策不可信（Untrusted） */
export const UNTRUSTED = '¬T'

/** 完整识别框架 Θ = {T, ¬T}（表示"不知道"的复合命题） */
export const FRAME_OF_DISCERNMENT: ReadonlySet<string> = new Set<string>([TRUSTED, UNTRUSTED])

/** 仅含 T 的集合（用于计算 Bel({T}) / Pl({T})） */
export const TRUSTED_SET: ReadonlySet<string> = new Set<string>([TRUSTED])

/** 仅含 ¬T 的集合（用于计算 Bel({¬T}) / Pl({¬T})） */
export const UNTRUSTED_SET: ReadonlySet<string> = new Set<string>([UNTRUSTED])

// ============================================================================
// Mass 函数接口定义
// ============================================================================

/**
 * 质量函数（Mass Function / Basic Probability Assignment, BPA）
 *
 * 数学定义：m: 2^Θ → [0, 1]，满足：
 *   m(∅) = 0
 *   Σ_{A ⊆ Θ} m(A) = 1
 *
 * m(A) 表示证据直接支持命题 A 的程度。
 * 关键特性：可分配给复合命题（如 m(Θ)），显式建模"不知道"——
 * 这是 D-S 理论超越经典概率论的核心能力。
 *
 * 信任区间 [Bel(A), Pl(A)]：
 * - Bel(A) ≤ Pl(A) 恒成立
 * - 区间宽度 Pl(A) - Bel(A) 反映不确定性程度
 * - 宽度=0 时退化为经典概率
 */
export interface MassFunction {
  /** 证据源 ID（如 'log'、'kb'、'ai-param'、'human'、'history'、'best-practice'） */
  sourceId: string
  /** 证据源显示名称（如 '日志证据'、'知识库匹配'） */
  sourceName: string
  /**
   * 焦元（focal elements）到质量值的映射。
   *
   * key 为焦点元素的规范化字符串：将 Set 中的元素排序后用 '|' 连接。
   * 例如：Set{'T'} → 'T'，Set{'¬T'} → '¬T'，Set{'T','¬T'} → 'T|¬T'
   *
   * 说明：原设计为 Map<Set<string>, number>，但因 JS 中 Set 为引用比较，
   * 无法作为 Map key 正确查找，故采用规范化字符串 key。
   * 使用 focalKey() / parseFocalKey() 进行 Set ↔ string 双向转换。
   *
   * 该设计支持任意识别框架（不限于二元），便于扩展。
   */
  focalElements: Map<string, number>
  /** 原始置信度 [0, 1]（来自证据源的初始评分，用于追溯） */
  confidence: number
}

// ============================================================================
// 辅助函数：Set ↔ 字符串 key 转换
// ============================================================================

/**
 * 将 Set 转换为规范化的焦元 key
 *
 * 规则：将元素排序后用 '|' 连接，确保相同元素的 Set 产生相同的 key。
 * 例如：Set{'T','¬T'} 和 Set{'¬T','T'} 都会产生 'T|¬T'。
 *
 * @param elements - 焦点元素集合
 * @returns 规范化字符串 key（如 'T'、'¬T'、'T|¬T'）；空集返回 ''
 */
export function focalKey(elements: Set<string>): string {
  if (elements.size === 0) return ''
  return Array.from(elements).sort().join('|')
}

/**
 * 将规范化 key 解析回 Set
 *
 * @param key - 规范化字符串 key
 * @returns 焦点元素集合；空 key 返回空 Set
 */
export function parseFocalKey(key: string): Set<string> {
  if (key === '') return new Set<string>()
  return new Set<string>(key.split('|'))
}

/**
 * 判断两个集合是否有交集（用于冲突检测）
 *
 * @param a - 集合 A
 * @param b - 集合 B
 * @returns true 表示 A ∩ B ≠ ∅
 */
export function setsIntersect(a: Set<string>, b: Set<string>): boolean {
  // 优化：遍历较小的集合
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  for (const elem of smaller) {
    if (larger.has(elem)) return true
  }
  return false
}

/**
 * 计算两个集合的交集
 *
 * @param a - 集合 A
 * @param b - 集合 B
 * @returns A ∩ B
 */
export function setIntersection(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>()
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  for (const elem of smaller) {
    if (larger.has(elem)) result.add(elem)
  }
  return result
}

/**
 * 判断 a 是否为 b 的子集（用于 Belief 计算）
 *
 * @param a - 待判断的集合
 * @param b - 目标集合
 * @returns true 表示 a ⊆ b
 */
export function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size > b.size) return false
  for (const elem of a) {
    if (!b.has(elem)) return false
  }
  return true
}

// ============================================================================
// Mass 函数工厂与工具函数
// ============================================================================

/**
 * 焦元赋值项（用于 createMassFunction 工厂函数）
 */
export interface FocalAssignment {
  /** 焦点元素集合 */
  elements: Set<string>
  /** 质量值 [0, 1] */
  mass: number
}

/**
 * 创建 Mass 函数（工厂函数）
 *
 * 自动归一化：如果总质量不等于 1，会按比例缩放。
 * 跳过空集（m(∅) = 0 是 D-S 理论的约束）。
 * 相同焦元的赋值会自动合并累加。
 *
 * @param sourceId - 证据源 ID
 * @param sourceName - 证据源显示名称
 * @param assignments - 焦元赋值列表
 * @param confidence - 原始置信度 [0, 1]
 * @returns 归一化后的 Mass 函数
 */
export function createMassFunction(
  sourceId: string,
  sourceName: string,
  assignments: FocalAssignment[],
  confidence: number
): MassFunction {
  const focalElements = new Map<string, number>()
  let total = 0

  for (const { elements, mass } of assignments) {
    if (elements.size === 0) continue // m(∅) = 0
    if (mass <= 0) continue // 跳过零质量
    const key = focalKey(elements)
    focalElements.set(key, (focalElements.get(key) ?? 0) + mass)
    total += mass
  }

  // 归一化（容差 1e-9，避免浮点误差）
  if (total > 0 && Math.abs(total - 1) > 1e-9) {
    for (const [key, mass] of focalElements) {
      focalElements.set(key, mass / total)
    }
  }

  return {
    sourceId,
    sourceName,
    focalElements,
    confidence: clamp01(confidence),
  }
}

/**
 * 创建无信息 Mass 函数（Vacuous Belief Function, VBF）
 *
 * m(Θ) = 1，表示完全无知（没有任何证据支持任何具体命题）。
 * VBF 与任何 Mass 函数组合都保持中性（不改变对方）。
 *
 * @param sourceId - 证据源 ID
 * @param sourceName - 证据源显示名称
 * @returns 无信息 Mass 函数
 */
export function createVacuousMassFunction(sourceId = 'vacuous', sourceName = '无信息'): MassFunction {
  const focalElements = new Map<string, number>()
  focalElements.set(focalKey(new Set<string>([TRUSTED, UNTRUSTED])), 1.0)
  return { sourceId, sourceName, focalElements, confidence: 0 }
}

/**
 * 获取 Mass 函数中指定焦元的质量值
 *
 * @param mf - Mass 函数
 * @param elements - 焦点元素集合
 * @returns 质量值 m(elements)，不存在则返回 0
 */
export function getMass(mf: MassFunction, elements: Set<string>): number {
  return mf.focalElements.get(focalKey(elements)) ?? 0
}

/**
 * 归一化 Mass 函数（确保质量总和为 1）
 *
 * @param m - 待归一化的 Mass 函数
 * @returns 归一化后的 Mass 函数（新对象，不修改原对象）
 */
export function normalizeMassFunction(m: MassFunction): MassFunction {
  let total = 0
  for (const mass of m.focalElements.values()) {
    total += mass
  }
  if (total <= 0) {
    // 退化情况：所有质量为 0，返回无信息函数
    return createVacuousMassFunction(m.sourceId, m.sourceName)
  }
  const normalized = new Map<string, number>()
  for (const [key, mass] of m.focalElements) {
    normalized.set(key, mass / total)
  }
  return { ...m, focalElements: normalized }
}

// ============================================================================
// 冲突系数计算
// ============================================================================

/**
 * 计算两个 Mass 函数的冲突系数 k（Conflict Coefficient）
 *
 * 公式：k = Σ_{A ∩ B = ∅} m1(A) · m2(B)
 *
 * k ∈ [0, 1]：
 * - k = 0：证据无冲突（完全兼容）
 * - k → 1：证据高度冲突
 *
 * 冲突阈值参考：sift-kernel（数字取证 MCP 服务器）使用 k=0.3 作为
 * Dempster 规则与 PCR5 规则的切换点。
 *
 * @param m1 - 第一个 Mass 函数
 * @param m2 - 第二个 Mass 函数
 * @returns 冲突系数 k ∈ [0, 1]
 */
export function computeConflict(m1: MassFunction, m2: MassFunction): number {
  let conflict = 0
  for (const [keyA, massA] of m1.focalElements) {
    const setA = parseFocalKey(keyA)
    for (const [keyB, massB] of m2.focalElements) {
      const setB = parseFocalKey(keyB)
      // A ∩ B = ∅ 表示冲突
      if (!setsIntersect(setA, setB)) {
        conflict += massA * massB
      }
    }
  }
  return conflict
}

// ============================================================================
// Dempster 组合规则
// ============================================================================

/**
 * Dempster 组合规则（Dempster's Rule of Combination）
 *
 * 公式：
 *   m12(C) = (1/K) · Σ_{A ∩ B = C} m1(A) · m2(B),  C ≠ ∅
 *   m12(∅) = 0
 *
 * 归一化因子：
 *   K = 1 - k = 1 - Σ_{A ∩ B = ∅} m1(A) · m2(B) = Σ_{A ∩ B ≠ ∅} m1(A) · m2(B)
 *
 * 适用条件：冲突 k < 0.3（低冲突场景）
 * 当 k → 1 时失效（Zadeh 悖论，Zadeh 1984），此时应使用 PCR5 规则。
 *
 * 性质：
 * - 满足交换律：m1 ⊕ m2 = m2 ⊕ m1
 * - 满足结合律：(m1 ⊕ m2) ⊕ m3 = m1 ⊕ (m2 ⊕ m3)
 * - VBF 中性：m ⊕ VBF = m
 *
 * 参考：Shafer 1976, "A Mathematical Theory of Evidence"
 *
 * @param m1 - 第一个 Mass 函数
 * @param m2 - 第二个 Mass 函数
 * @returns 组合后的 Mass 函数（sourceId 为 "m1.sourceId+m2.sourceId"）
 * @throws {Error} 当证据完全冲突（k ≈ 1，K ≈ 0）时抛出
 */
export function dempsterCombine(m1: MassFunction, m2: MassFunction): MassFunction {
  const conflict = computeConflict(m1, m2)
  const K = 1 - conflict

  if (K <= 1e-12) {
    throw new Error(
      `证据完全冲突（k=${conflict.toFixed(4)}，K=${K.toFixed(4)}），` +
        `无法用 Dempster 规则组合。建议使用 PCR5 规则处理高冲突场景。`
    )
  }

  const resultFocal = new Map<string, number>()

  // 遍历所有焦元对，计算交集的非空组合
  for (const [keyA, massA] of m1.focalElements) {
    const setA = parseFocalKey(keyA)
    for (const [keyB, massB] of m2.focalElements) {
      const setB = parseFocalKey(keyB)
      const intersection = setIntersection(setA, setB)
      if (intersection.size === 0) continue // 冲突项，跳过（不计入结果）

      const keyC = focalKey(intersection)
      resultFocal.set(keyC, (resultFocal.get(keyC) ?? 0) + massA * massB)
    }
  }

  // 归一化（除以 K，将冲突质量丢弃并重新分配）
  for (const [key, mass] of resultFocal) {
    resultFocal.set(key, mass / K)
  }

  return {
    sourceId: `${m1.sourceId}+${m2.sourceId}`,
    sourceName: `${m1.sourceName}⊕${m2.sourceName}`,
    focalElements: resultFocal,
    confidence: (m1.confidence + m2.confidence) / 2,
  }
}

// ============================================================================
// 信任函数与似真函数
// ============================================================================

/**
 * 信任函数（Belief Function）
 *
 * 公式：Bel(A) = Σ_{B ⊆ A} m(B)
 *
 * 表示对命题 A 的总信任度（所有支持 A 的子命题信度之和）。
 * Bel(A) 是信任区间的下界。
 *
 * 示例（二元框架 Θ = {T, ¬T}）：
 *   Bel({T}) = m({T})                    （只有 {T} 是 {T} 的子集）
 *   Bel({T, ¬T}) = m({T}) + m({¬T}) + m(Θ) = 1
 *
 * @param m - Mass 函数
 * @param targetSet - 目标命题（如 Set{'T'}）
 * @returns 信任度 Bel(targetSet) ∈ [0, 1]
 */
export function computeBelief(m: MassFunction, targetSet: Set<string>): number {
  let belief = 0
  for (const [key, mass] of m.focalElements) {
    const focalSet = parseFocalKey(key)
    if (isSubset(focalSet, targetSet)) {
      belief += mass
    }
  }
  return belief
}

/**
 * 似真函数（Plausibility Function）
 *
 * 公式：Pl(A) = Σ_{B ∩ A ≠ ∅} m(B) = 1 - Bel(¬A)
 *
 * 表示对命题 A 不怀疑的程度（信任区间上界）。
 * Pl(A) - Bel(A) 反映对 A 的不确定性程度。
 *
 * 示例（二元框架 Θ = {T, ¬T}）：
 *   Pl({T}) = m({T}) + m(Θ)             （{T} 和 Θ 都与 {T} 有交集）
 *   Pl({T, ¬T}) = 1
 *
 * @param m - Mass 函数
 * @param targetSet - 目标命题
 * @returns 似真度 Pl(targetSet) ∈ [0, 1]
 */
export function computePlausibility(m: MassFunction, targetSet: Set<string>): number {
  let plausibility = 0
  for (const [key, mass] of m.focalElements) {
    const focalSet = parseFocalKey(key)
    if (setsIntersect(focalSet, targetSet)) {
      plausibility += mass
    }
  }
  return plausibility
}

// ============================================================================
// 内部工具函数
// ============================================================================

/**
 * 将数值限制在 [0, 1] 范围内
 * NaN 视为 0
 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}
