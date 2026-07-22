/**
 * Subagent 调度 14 步协议 - 步骤 1-5（D.1 + step 1-2）
 *
 * 从 task-protocol-steps.ts 拆分而来（避免单文件超 500 行硬约束）。
 *
 * 包含：
 * - step 1: validate-input（校验 taskId / subagentName 非空字符串，初始化 startTime）
 * - step 2: check-permission（默认允许，检查 cancelled 状态）
 * - step 3: load-subagent-config（D.1，用 registry 查找 subagent，写入 subagentInstance/subagentMeta）
 * - step 4: derive-permissions（D.1，禁用 question/interactive_terminal，标记 inherited）
 * - step 5: prepare-context（D.1，从 AttentionTracker 获取 attention，构建 attentionContext + toolWhitelist）
 */
import type { TaskProtocolContext, StepResult, SubagentMeta, DerivedPermissions } from './task-protocol-types'
import type { SubagentRegistry } from './base'
import { AttentionTracker } from '../attention-tracker'
import { log, createBuiltinRegistry } from './task-protocol-helpers'

// ============================================================================
// step 1-2：输入校验 + 权限检查（保留并增强）
// ============================================================================

/**
 * 步骤 1：校验输入
 *
 * 检查 ctx.taskId / ctx.subagentName / ctx.input 是否合法。
 * - taskId 必须为非空字符串
 * - subagentName 必须为非空字符串
 * - input 允许任意值（包括 undefined / null）
 *
 * 增强：尝试从 ctx.registry 查找 subagent（如果存在），但不强制要求存在
 * （存在性校验在 step 3 load-subagent-config 中完成）。
 */
export async function stepValidateInput(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    if (!ctx.taskId || typeof ctx.taskId !== 'string') {
      return {
        step: 'validate-input',
        success: false,
        error: 'taskId 必须为非空字符串',
        durationMs: Date.now() - start,
      }
    }
    if (!ctx.subagentName || typeof ctx.subagentName !== 'string') {
      return {
        step: 'validate-input',
        success: false,
        error: 'subagentName 必须为非空字符串',
        durationMs: Date.now() - start,
      }
    }
    // 初始化 startTime（step 14 用于计算总耗时）
    if (ctx.startTime === undefined) {
      ctx.startTime = start
    }
    log.debug('step 1/14 validate-input 通过', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
    })
    return {
      step: 'validate-input',
      success: true,
      output: { taskId: ctx.taskId, subagentName: ctx.subagentName },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'validate-input',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 2：检查权限
 *
 * 借鉴 Kilo Code：ctx.ask({ permission: "task", patterns: [subagent_type] })
 * - 用户审批 subagent 调度（可保存永久规则，下次同类自动通过）
 *
 * 当前版本：默认允许（骨架），但检查 ctx.cancelled 状态。
 * 后续增强：通过 IPC 推送审批请求到 UI，等待用户响应。
 */
export async function stepCheckPermission(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    if (ctx.cancelled) {
      return {
        step: 'check-permission',
        success: false,
        error: '协议已取消（cancelled=true）',
        durationMs: Date.now() - start,
      }
    }
    log.debug('step 2/14 check-permission 通过（默认允许，IPC 审批待集成）', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
    })
    return {
      step: 'check-permission',
      success: true,
      output: { approved: true, source: 'default-allow' },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'check-permission',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

// ============================================================================
// D.1：step 3-5（load-subagent-config / derive-permissions / prepare-context）
// ============================================================================

/**
 * 步骤 3：加载 Subagent 配置
 *
 * 真实逻辑：
 * 1. 优先用 ctx.registry（如果调用方注入）查找 subagent
 * 2. 否则用 createAllSubagents() 创建内置 subagent 集合
 * 3. 校验 subagentName 在集合中
 * 4. 提取 subagent metadata（name / displayName / description）
 * 5. 写入 ctx.subagentInstance / ctx.subagentMeta
 */
export async function stepLoadSubagentConfig(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 选择 registry：优先用 ctx.registry，否则创建内置 registry
    const registry: SubagentRegistry = ctx.registry ?? createBuiltinRegistry()

    // 查找 subagent（兼容 explore 等不在 SubagentName 联合类型中的名称）
    const subagent = registry.get(ctx.subagentName as never)
    if (!subagent) {
      return {
        step: 'load-subagent-config',
        success: false,
        error: `Subagent "${ctx.subagentName}" 未在注册表中找到（可用：${registry.list().map((s) => s.name).join(', ')}）`,
        durationMs: Date.now() - start,
      }
    }

    // 提取 metadata
    const meta: SubagentMeta = {
      name: subagent.name,
      displayName: subagent.displayName,
      description: subagent.description,
      source: ctx.registry ? 'builtin' : 'builtin',
    }

    // 写入 ctx
    ctx.subagentInstance = subagent
    ctx.subagentMeta = meta

    log.info('step 3/14 load-subagent-config 通过', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
      displayName: meta.displayName,
      source: meta.source,
    })
    return {
      step: 'load-subagent-config',
      success: true,
      output: {
        subagentName: meta.name,
        displayName: meta.displayName,
        source: meta.source,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'load-subagent-config',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 4：派生权限
 *
 * 借鉴 Kilo Code：deriveSubagentSessionPermission({ parentSessionPermission, subagent })
 * - 继承父 session 的 deny 规则和 external_directory 规则
 * - subagent 默认禁止 question / interactive_terminal 工具（不能与用户交互）
 *
 * 真实逻辑：
 * 1. 初始化 denyRules：默认禁用 question / interactive_terminal
 * 2. 标记 externalDirectory：subagent 默认不能访问外部目录
 * 3. 标记 inherited：如果有 parentSessionId 则为 true
 */
export async function stepDerivePermissions(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // subagent 默认禁用交互工具（借鉴 Kilo Code：不能 question、不能 interactive_terminal）
    const denyRules: string[] = ['question', 'interactive_terminal']

    // external_directory 限制：subagent 默认只能访问当前项目根目录
    // 父会话权限继承：如有 parentSessionId，标记 inherited=true
    const externalDirectory: string[] = []
    const inherited = ctx.parentSessionId !== undefined && ctx.parentSessionId !== null

    const permissions: DerivedPermissions = {
      denyRules,
      externalDirectory,
      inherited,
      parentSessionId: ctx.parentSessionId,
    }

    ctx.derivedPermissions = permissions

    log.debug('step 4/14 derive-permissions 通过', {
      taskId: ctx.taskId,
      parentSessionId: ctx.parentSessionId ?? null,
      inherited,
      denyRulesCount: denyRules.length,
    })
    return {
      step: 'derive-permissions',
      success: true,
      output: {
        parentSessionId: ctx.parentSessionId ?? null,
        inherited,
        denyRules,
        externalDirectory,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'derive-permissions',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * 步骤 5：准备上下文
 *
 * 借鉴 Kilo Code：KiloTask.inherited + KiloTask.merge
 * - 继承父 agent 的 edit/bash/MCP 限制，合并所有 permission ruleset
 * - 注入 attention context（如果 AttentionTracker 有数据）
 *
 * 真实逻辑：
 * 1. 从 AttentionTracker.getInstance().getCurrent() 获取当前 attention
 * 2. 构建 attentionContext 文本（如果有 attention 数据）
 * 3. 工具白名单：默认 ['search', 'kb', 'log', 'metric', 'history']，subagent 可扩展
 * 4. 写入 ctx.attentionContext / ctx.toolWhitelist / ctx.attention
 */
export async function stepPrepareContext(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 获取当前 attention（从 AttentionTracker 单例）
    const tracker = AttentionTracker.getInstance()
    const attention = tracker.getCurrent()

    // 2. 构建 attentionContext 文本（如果有数据）
    let attentionContext = ''
    if (!tracker.isEmpty()) {
      const parts: string[] = []
      if (attention.files && attention.files.length > 0) {
        parts.push(`关注文件：${attention.files.join(', ')}`)
      }
      if (attention.commands && attention.commands.length > 0) {
        parts.push(`关注命令：${attention.commands.join(', ')}`)
      }
      if (attention.errors && attention.errors.length > 0) {
        parts.push(`关注错误：${attention.errors.join(', ')}`)
      }
      if (attention.keywords && attention.keywords.length > 0) {
        parts.push(`关注关键词：${attention.keywords.join(', ')}`)
      }
      attentionContext = parts.join('\n')
    }

    // 3. 工具白名单：默认只读工具集（subagent 不应该有写权限）
    const toolWhitelist = ['search', 'kb', 'log', 'metric', 'history', 'tutorial']

    // 4. 写入 ctx
    ctx.attention = attention
    ctx.attentionContext = attentionContext
    ctx.toolWhitelist = toolWhitelist

    log.debug('step 5/14 prepare-context 通过', {
      taskId: ctx.taskId,
      attentionEmpty: tracker.isEmpty(),
      attentionContextLength: attentionContext.length,
      toolWhitelistCount: toolWhitelist.length,
    })
    return {
      step: 'prepare-context',
      success: true,
      output: {
        prepared: true,
        attentionEmpty: tracker.isEmpty(),
        attentionContextLength: attentionContext.length,
        toolWhitelist,
      },
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      step: 'prepare-context',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}
