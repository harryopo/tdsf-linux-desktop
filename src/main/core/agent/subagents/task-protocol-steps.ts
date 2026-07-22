/**
 * Subagent 调度 14 步协议 - 步骤函数注册表
 *
 * v2.0 Phase D.1-D.4：把 14 步骨架桩实现补齐为真实逻辑。
 *
 * 【拆分说明】
 * 原文件 1142 行超过 500 行硬约束，按职责拆分为 4 个文件：
 * - task-protocol-helpers.ts：共享辅助函数（readInputField / extractStringField / createBuiltinRegistry）
 * - task-protocol-steps-early.ts：step 1-5（validate-input / check-permission / load-subagent-config / derive-permissions / prepare-context）
 * - task-protocol-steps-mid.ts：step 6-10（select-provider / select-mode / build-prompt / invoke-subagent / stream-output）
 * - task-protocol-steps-late.ts：step 11-14（collect-usage / validate-output / cleanup / return-result）
 *
 * 本文件仅保留 STEP_FUNCTIONS 注册表（按 14 步顺序映射）+ re-export，
 * 保持外部 import 路径兼容（task-protocol.ts 从此 re-export）。
 *
 * 借鉴 Kilo Code task 工具的 14 步流程
 * （参考 d:\ai\linux教学一体\idea-to-dev-output\29-源码分析-KiloCode-多模式Subagent.md §4.3）
 *
 * 步骤间数据通过 TaskProtocolContext 的可选字段传递（向后兼容）。
 * 每个步骤函数都是纯函数（不抛异常，异常 → success=false 的 StepResult）。
 */
import type { TaskProtocolStep, StepFunction } from './task-protocol-types'

// Re-export 所有步骤函数（保持外部 import 路径兼容）
export {
  stepValidateInput,
  stepCheckPermission,
  stepLoadSubagentConfig,
  stepDerivePermissions,
  stepPrepareContext,
} from './task-protocol-steps-early'

export {
  stepSelectProvider,
  stepSelectMode,
  stepBuildPrompt,
  stepInvokeSubagent,
  stepStreamOutput,
} from './task-protocol-steps-mid'

export {
  stepCollectUsage,
  stepValidateOutput,
  stepCleanup,
  stepReturnResult,
} from './task-protocol-steps-late'

// 导入步骤函数以构建注册表
import { stepValidateInput, stepCheckPermission, stepLoadSubagentConfig, stepDerivePermissions, stepPrepareContext } from './task-protocol-steps-early'
import { stepSelectProvider, stepSelectMode, stepBuildPrompt, stepInvokeSubagent, stepStreamOutput } from './task-protocol-steps-mid'
import { stepCollectUsage, stepValidateOutput, stepCleanup, stepReturnResult } from './task-protocol-steps-late'

/**
 * 14 个步骤函数的有序映射表
 *
 * 用于 executeTaskProtocol 串行执行，以及测试单独调用某步骤。
 * 顺序与 TASK_PROTOCOL_STEPS 常量数组保持一致（不要改动顺序/名称，有测试断言）。
 */
export const STEP_FUNCTIONS: Record<TaskProtocolStep, StepFunction> = {
  'validate-input': stepValidateInput,
  'check-permission': stepCheckPermission,
  'load-subagent-config': stepLoadSubagentConfig,
  'derive-permissions': stepDerivePermissions,
  'prepare-context': stepPrepareContext,
  'select-provider': stepSelectProvider,
  'select-mode': stepSelectMode,
  'build-prompt': stepBuildPrompt,
  'invoke-subagent': stepInvokeSubagent,
  'stream-output': stepStreamOutput,
  'collect-usage': stepCollectUsage,
  'validate-output': stepValidateOutput,
  'cleanup': stepCleanup,
  'return-result': stepReturnResult,
}
