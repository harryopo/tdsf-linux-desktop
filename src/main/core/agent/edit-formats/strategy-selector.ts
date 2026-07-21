/**
 * Edit 策略自动选择（v0.9.4 批次 3 - 任务 2）
 *
 * 借鉴 Aider 三层模型分层 + 策略自动选择：
 * - whole-file：小文件全量覆盖（≤ 100 行），简单稳定
 * - editblock：局部改动（≤ 50 行），token 高效
 * - udiff：大改动（> 50 行），diff 格式节省 token
 *
 * 决策树：
 * 1. LLM 倾向优先（如果 llmPreference 提供则直接返回，覆盖以下规则）
 * 2. 文件 ≤ 100 行 → whole-file
 * 3. 改动 ≤ 50 行 → editblock
 * 4. 改动 > 50 行 → udiff
 *
 * 设计要点：
 * - 纯函数，无副作用，便于单元测试
 * - 阈值（100/50）作为常量导出，便于后续调整
 * - 与 editblock.ts 解耦：本模块只做"选择"，不做"应用"
 *
 * 方案书依据：v0.9.4 §11 第 3 类（edit format 多策略）
 * 调研文档：d:\ai\linux教学一体\idea-to-dev-output\31-源码分析-Aider-终端优先与git沙箱回滚.md
 *   - §5.1 wholefile 模式：小文件全量覆盖
 *   - §5.2 editblock 模式：SEARCH/REPLACE 局部改动
 *   - §5.3 udiff 模式：大改动用 unified diff
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Edit 策略枚举
 *
 * - editblock：SEARCH/REPLACE 块（见 editblock.ts），局部改动
 * - whole-file：全量文件覆盖，小文件最稳
 * - udiff：unified diff 格式，大改动节省 token
 *
 * 注意：patch 格式（V4A）暂未实现，留给 v0.9.5。
 */
export type EditStrategy = 'editblock' | 'whole-file' | 'udiff'

/**
 * 自动选择策略参数
 */
export interface StrategySelectionParams {
  /** 文件大小（行数） */
  fileLines: number
  /** 改动范围（估算需修改的行数） */
  estimatedChangeLines: number
  /** LLM 输出风格倾向（如有，覆盖自动选择） */
  llmPreference?: EditStrategy
  /** 是否首次编辑该文件（首次编辑倾向 whole-file 以建立信任） */
  isFirstEdit: boolean
}

// ============================================================================
// 阈值常量
// ============================================================================

/**
 * whole-file 策略的文件大小阈值（行数）
 *
 * 文件 ≤ 此阈值时优先用 whole-file（小文件全量覆盖更稳）。
 */
export const WHOLE_FILE_THRESHOLD = 100

/**
 * editblock 策略的改动行数阈值（行数）
 *
 * 改动 ≤ 此阈值时用 editblock（局部改动用 SEARCH/REPLACE）。
 * 改动 > 此阈值时用 udiff（大改动用 diff 格式节省 token）。
 */
export const EDITBLOCK_THRESHOLD = 50

// ============================================================================
// 主函数
// ============================================================================

/**
 * 自动选择 edit 策略（借鉴 Aider 三层模型分层 + 策略自动选择）
 *
 * 决策规则（按优先级）：
 * 1. LLM 倾向覆盖：如果 llmPreference 提供则直接返回
 * 2. 文件 ≤ 100 行 → whole-file（小文件全量覆盖更稳）
 * 3. 改动 ≤ 50 行 → editblock（局部改动用 SEARCH/REPLACE）
 * 4. 改动 > 50 行 → udiff（大改动用 diff 格式）
 *
 * 边界处理：
 * - fileLines ≤ 0 → 视为空文件，返回 whole-file
 * - estimatedChangeLines ≤ 0 → 视为无改动，返回 editblock（最小开销）
 * - estimatedChangeLines > fileLines → 视为全量重写，返回 whole-file
 *
 * @param params 选择参数
 * @returns 选中的 EditStrategy
 */
export function selectStrategy(params: StrategySelectionParams): EditStrategy {
  // 1. LLM 倾向优先
  if (params.llmPreference) {
    return params.llmPreference
  }

  // 2. 边界处理：空文件
  if (params.fileLines <= 0) {
    return 'whole-file'
  }

  // 3. 边界处理：改动行数超过文件总行数 → 全量重写
  if (params.estimatedChangeLines >= params.fileLines) {
    return 'whole-file'
  }

  // 4. 小文件优先 whole-file
  if (params.fileLines <= WHOLE_FILE_THRESHOLD) {
    return 'whole-file'
  }

  // 5. 改动行数 ≤ 50 → editblock
  if (params.estimatedChangeLines <= EDITBLOCK_THRESHOLD) {
    return 'editblock'
  }

  // 6. 大改动 → udiff
  return 'udiff'
}
