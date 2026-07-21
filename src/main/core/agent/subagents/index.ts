/**
 * Subagent 聚合导出
 *
 * 提供 8+1 个 Subagent 类（含 ExploreSubagent），由 Supervisor 实例化并按 name 调度。
 *
 * v0.9.4 批次 4 新增：
 * - ExploreSubagent（任务 2）：代码库探索 Subagent，基于 fs 扫描
 * - dispatchSubagents（任务 1）：8 步简化版调度器
 * - loadCustomAgents / loadCustomAgent（任务 3）：.tdsf/agent/*.md 加载器
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

// v0.9.4 批次 4 - 任务 1：8 步简化版调度器
export { dispatchSubagents } from './dispatcher'
export type {
  DispatchStep,
  DispatchContext,
  DispatchResult,
} from './dispatcher'

// v0.9.4 批次 4 - 任务 3：.tdsf/agent/*.md 加载器
export { loadCustomAgent, loadCustomAgents } from './agent-loader'
export type { CustomAgentConfig } from './agent-loader'

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
