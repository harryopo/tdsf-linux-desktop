/**
 * @命令模块统一出口
 *
 * 职责：
 * - 重新导出所有类型与实现（base / parser / 8 个 command handler）
 * - 提供 createDefaultRegistry() 工厂函数，注册全部 8 类 @命令 handler
 *
 * 使用方式（IPC 层 / Agent Runtime 层）：
 * ```ts
 * import { createDefaultRegistry, AtCommandParser } from './at-commands'
 * const registry = createDefaultRegistry()
 * const parser = new AtCommandParser(registry)
 * ```
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令完整实现）+ §4.3（@命令接口契约）
 */

// 类型与基础接口
export * from '@shared/at-command-types'
export * from './base'
export * from './parser'

// 8 类 @命令 handler（每个独立导出，便于按需 import）
export { LogCommandHandler } from './log-command'
export { CmdCommandHandler } from './cmd-command'
export { FileCommandHandler } from './file-command'
export { MetricCommandHandler } from './metric-command'
export { DecisionCommandHandler } from './decision-command'
export { KbCommandHandler } from './kb-command'
export { SkillCommandHandler } from './skill-command'
export { ServerCommandHandler } from './server-command'

import { AtCommandRegistry } from './base'
import { LogCommandHandler } from './log-command'
import { CmdCommandHandler } from './cmd-command'
import { FileCommandHandler } from './file-command'
import { MetricCommandHandler } from './metric-command'
import { DecisionCommandHandler } from './decision-command'
import { KbCommandHandler } from './kb-command'
import { SkillCommandHandler } from './skill-command'
import { ServerCommandHandler } from './server-command'

/**
 * 创建默认 @命令注册器（注册全部 8 类 handler）
 *
 * 注册顺序与方案书 §4.1 表一致：
 *   log → cmd → file → metric → decision → kb → skill → server
 *
 * 该注册器在 v0.9 一次性注册全部 8 类，不再走"@file PoC"分阶段路线。
 *
 * @returns 已注册 8 类 handler 的 AtCommandRegistry 实例
 */
export function createDefaultRegistry(): AtCommandRegistry {
  const registry = new AtCommandRegistry()
  registry.register(new LogCommandHandler())
  registry.register(new CmdCommandHandler())
  registry.register(new FileCommandHandler())
  registry.register(new MetricCommandHandler())
  registry.register(new DecisionCommandHandler())
  registry.register(new KbCommandHandler())
  registry.register(new SkillCommandHandler())
  registry.register(new ServerCommandHandler())
  return registry
}
