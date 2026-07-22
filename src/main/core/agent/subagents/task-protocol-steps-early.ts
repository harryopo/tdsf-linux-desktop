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
// v0.9.3 §11 遗留项 2 P2-H 新增：Task Protocol step 2 check-permission 审批 IPC
import {
  waitForTaskPermissionApproval,
  type TaskPermissionApprovalRequest,
} from '../../../ipc/task-permission-approval'

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
 * v0.9.3 §11 遗留项 2 P2-H 升级：从"默认允许"升级为"三态权限审批"
 *
 * 三态权限审批（R12，参考 AgentScope Permission）：
 * - ctx.defaultPermission = 'auto' → 自动允许（适用于可信 subagent，如 builtin）
 * - ctx.defaultPermission = 'never' → 自动拒绝（适用于黑名单 subagent）
 * - ctx.defaultPermission = 'always'（默认）：
 *   · ctx.mainWindow 存在 → 推送审批请求到 UI，等待用户响应（30 秒超时自动拒绝）
 *   · ctx.mainWindow 不存在 → 降级为默认允许（保持向后兼容，单测场景不受影响）
 *
 * 审批请求载荷（TaskPermissionApprovalRequest）包含：
 * - taskId / subagentName / inputSummary（可选）/ parentSessionId（可选）/ correlationId（可选）
 * - 用户响应（TaskPermissionDecision）：approved + rejectReason（可选）+ remember（可选）
 *
 * remember=true 时，主进程记录日志（持久化规则表留待 v1.6 实现）
 */
export async function stepCheckPermission(ctx: TaskProtocolContext): Promise<StepResult> {
  const start = Date.now()
  try {
    // 1. 检查 cancelled 状态
    if (ctx.cancelled) {
      return {
        step: 'check-permission',
        success: false,
        error: '协议已取消（cancelled=true）',
        durationMs: Date.now() - start,
      }
    }

    // 2. 读取默认权限模式（默认 'always'）
    const mode = ctx.defaultPermission ?? 'always'

    // 3. 'auto' 模式：自动允许（不推送审批请求）
    if (mode === 'auto') {
      log.debug('step 2/14 check-permission 通过（mode=auto，自动允许）', {
        taskId: ctx.taskId,
        subagentName: ctx.subagentName,
      })
      return {
        step: 'check-permission',
        success: true,
        output: { approved: true, source: 'mode-auto', mode },
        durationMs: Date.now() - start,
      }
    }

    // 4. 'never' 模式：自动拒绝（不推送审批请求）
    if (mode === 'never') {
      log.warn('step 2/14 check-permission 拒绝（mode=never，自动拒绝）', {
        taskId: ctx.taskId,
        subagentName: ctx.subagentName,
      })
      return {
        step: 'check-permission',
        success: false,
        error: `Subagent "${ctx.subagentName}" 被权限规则拒绝（mode=never）`,
        durationMs: Date.now() - start,
      }
    }

    // 5. 'always' 模式：需要用户审批
    // 5.1 mainWindow 不存在 → 降级为默认允许（向后兼容）
    if (!ctx.mainWindow) {
      log.warn('step 2/14 check-permission 降级为默认允许（mainWindow 不存在，单测/CLI 场景）', {
        taskId: ctx.taskId,
        subagentName: ctx.subagentName,
        mode,
      })
      return {
        step: 'check-permission',
        success: true,
        output: { approved: true, source: 'default-allow-no-mainwindow', mode },
        durationMs: Date.now() - start,
      }
    }

    // 5.2 mainWindow 已销毁 → 降级为默认允许
    if (ctx.mainWindow.isDestroyed()) {
      log.warn('step 2/14 check-permission 降级为默认允许（mainWindow 已销毁）', {
        taskId: ctx.taskId,
        subagentName: ctx.subagentName,
        mode,
      })
      return {
        step: 'check-permission',
        success: true,
        output: { approved: true, source: 'default-allow-destroyed', mode },
        durationMs: Date.now() - start,
      }
    }

    // 5.3 构建审批请求载荷
    // inputSummary：从 ctx.input 提取前 200 字符作为摘要（避免过长）
    const inputSummary =
      typeof ctx.input === 'string'
        ? ctx.input.slice(0, 200)
        : ctx.input !== undefined
          ? JSON.stringify(ctx.input).slice(0, 200)
          : undefined

    const callId = `taskperm-${ctx.taskId}-${Date.now().toString(36)}`
    const request: TaskPermissionApprovalRequest = {
      callId,
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
      inputSummary,
      parentSessionId: ctx.parentSessionId,
      correlationId: ctx.correlationId,
      timestamp: Date.now(),
      mode,
    }

    // 5.4 推送审批请求并等待响应（30 秒超时自动拒绝）
    log.info('step 2/14 check-permission 推送审批请求到 UI', {
      callId,
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
      mode,
    })

    const decision = await waitForTaskPermissionApproval(ctx.mainWindow, request)

    // 5.5 处理用户决策
    if (decision.approved) {
      log.info('step 2/14 check-permission 通过（用户批准）', {
        callId,
        taskId: ctx.taskId,
        subagentName: ctx.subagentName,
        remember: decision.remember ?? false,
      })
      return {
        step: 'check-permission',
        success: true,
        output: {
          approved: true,
          source: 'user-approved',
          mode,
          remember: decision.remember ?? false,
        },
        durationMs: Date.now() - start,
      }
    }

    // 用户拒绝
    log.warn('step 2/14 check-permission 拒绝（用户拒绝）', {
      callId,
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
      rejectReason: decision.rejectReason,
      remember: decision.remember ?? false,
    })
    return {
      step: 'check-permission',
      success: false,
      error: `用户拒绝 Subagent "${ctx.subagentName}" 调度${decision.rejectReason ? `：${decision.rejectReason}` : ''}`,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    // 超时或其他异常 → 失败
    const errMsg = err instanceof Error ? err.message : String(err)
    log.error('step 2/14 check-permission 异常', {
      taskId: ctx.taskId,
      subagentName: ctx.subagentName,
      error: errMsg,
    })
    return {
      step: 'check-permission',
      success: false,
      error: errMsg,
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
