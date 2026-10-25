/**
 * Subagent 聚合导出
 *
 * 提供 8+1 个 Subagent 类（含 ExploreSubagent），由 Supervisor 实例化并按 name 调度。
 *
 * v0.9.4 批次 4 新增：
 * - ExploreSubagent（任务 2）：代码库探索 Subagent，基于 fs 扫描
 *
 * 任务 3 那个 `.tdsf/agent/*.md` 加载器也已于 2026-10-25 整删（#216）：它唯一的读者是
 * subagent:list / subagent:reload 这两把键，而渲染层对这两把零调用、界面上从来没有 Agent 列表。
 * 原 8 步 dispatcher（任务 1）已于 2026-10-24 整删：它只被本文件转出、生产零调用，
 * 编排实际由 supervisor 自己做（PAOR）。详见 docs/功能实景清单.md C 组。
 */
export { BaseSubagent, createSubagentTask } from './base'
export type {
  Subagent,
  SubagentTask,
  SubagentResult,
  SubagentRegistry,
  SubagentName,
} from './base'

export { CodingSubagent } from './coding-subagent'
export { ThinkingSubagent } from './thinking-subagent'
export { RunningSubagent } from './running-subagent'
export { SearchSubagent } from './search-subagent'
export { SkillSubagent } from './skill-subagent'
export { MethodologySubagent } from './methodology-subagent'
export { HistorySubagent } from './history-subagent'
export { KnowledgeSubagent } from './knowledge-subagent'

// v0.9.4 批次 4 - 任务 2：Explore Subagent
export { ExploreSubagent } from './explore-subagent'
export type { ExploreTaskInput, ExploreResultOutput } from './explore-subagent'


import { CodingSubagent } from './coding-subagent'
import { ThinkingSubagent } from './thinking-subagent'
import { RunningSubagent } from './running-subagent'
import { SearchSubagent } from './search-subagent'
import { SkillSubagent } from './skill-subagent'
import { MethodologySubagent } from './methodology-subagent'
import { HistorySubagent } from './history-subagent'
import { KnowledgeSubagent } from './knowledge-subagent'
import { ExploreSubagent } from './explore-subagent'
import type { Subagent, SubagentName } from './base'

/**
 * 创建所有内置 Subagent 实例（由 Supervisor 调用注册）
 *
 * v0.9.4 批次 4 - 任务 2：
 * - 新增 explore Subagent（代码库探索，基于 fs 扫描）
 * - explore 不在 SubagentName 联合类型中（避免修改现有接口），
 *   返回类型扩展为 Record<SubagentName, Subagent> & { explore: Subagent }
 */
export function createAllSubagents(): Record<SubagentName, Subagent> & {
  explore: Subagent
} {
  return {
    coding: new CodingSubagent(),
    thinking: new ThinkingSubagent(),
    running: new RunningSubagent(),
    search: new SearchSubagent(),
    skill: new SkillSubagent(),
    methodology: new MethodologySubagent(),
    history: new HistorySubagent(),
    knowledge: new KnowledgeSubagent(),
    explore: new ExploreSubagent(),
  }
}
