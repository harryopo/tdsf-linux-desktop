/**
 * Task Protocol step 2 check-permission 审批 IPC（v0.9.3 §11 遗留项 2）
 *
 * 背景：
 * - v2.0 Phase D 实现 task-protocol 14 步真实逻辑时，step 2 check-permission 仍是默认允许
 * - verify-report.md 遗留项 2：「step 2 check-permission IPC 审批：当前默认允许，需后续集成 IPC 推送审批到 UI」
 * - 本文件实现遗留项 2，让 Subagent 调度支持用户审批
 *
 * 设计要点：
 * - 独立于 sandbox-approval.ts（避免审批队列混淆：sandbox 是命令执行审批，task-permission 是 Subagent 调度审批）
 * - 借鉴 Kilo Code ctx.ask({ permission: "task", patterns: [subagent_type] })
 * - 三态权限审批（R12 ALWAYS/AUTO/NEVER，参考 AgentScope Permission）：
 *   · ALWAYS：每次都询问用户（本文件实现的默认模式）
 *   · AUTO：自动允许（ctx.defaultPermission = 'auto' 时跳过 IPC，直接通过）
 *   · NEVER：自动拒绝（ctx.defaultPermission = 'never' 时直接失败）
 * - 30 秒审批超时自动拒绝（与 sandbox-approval 保持一致）
 * - 用户可选择"记住决策"（remember=true），下次同类 subagent 自动应用
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件注册 task:permission-approve
 * 2. ipc/index.ts：导入并调用 registerTaskPermissionHandlers()
 * 3. preload/index.ts：暴露 onTaskPermissionApprovalRequest / taskPermissionApprove
 * 4. electron.d.ts：声明类型
 *
 * 方案书依据：v2.0 verify-report.md 遗留项 2
 */

import { ipcMain, type BrowserWindow } from 'electron'
import { logger } from '../services/log/logger'

// ============================================================================
// 常量与类型定义
// ============================================================================

/** 审批请求推送通道（主 → 渲染，单向） */
export const TASK_PERMISSION_APPROVAL_CHANNEL = 'task:permission-approval-request'
/** 审批响应通道（渲染 → 主，通过 invoke） */
export const TASK_PERMISSION_APPROVE_INVOKE = 'task:permission-approve'
/** 审批超时（30 秒，与 sandbox-approval 保持一致） */
export const TASK_PERMISSION_APPROVAL_TIMEOUT_MS = 30_000

/**
 * 默认权限模式（R12 三态权限审批）
 *
 * - always：每次都询问用户（默认，最安全）
 * - auto：自动允许（适用于可信 subagent，如 builtin）
 * - never：自动拒绝（适用于黑名单 subagent）
 */
export type TaskPermissionMode = 'always' | 'auto' | 'never'

/** 待审批的 Subagent 调用池（callId → Promise resolver） */
export interface PendingTaskPermissionApproval {
  resolve: (decision: TaskPermissionDecision) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

/** 待审批池（callId → PendingTaskPermissionApproval） */
export const pendingTaskPermissionApprovals = new Map<string, PendingTaskPermissionApproval>()

/**
 * 审批请求载荷（推送给渲染进程）
 */
export interface TaskPermissionApprovalRequest {
  /** 审批调用 ID（与 pendingTaskPermissionApprovals Map 中的 key 对应） */
  callId: string
  /** 任务 ID（来自 TaskProtocolContext.taskId） */
  taskId: string
  /** 目标 Subagent 名称（来自 TaskProtocolContext.subagentName） */
  subagentName: string
  /** 任务输入摘要（可选，便于用户理解 subagent 将要做什么） */
  inputSummary?: string
  /** 父会话 ID（可选，用于关联主对话） */
  parentSessionId?: string
  /** 关联 ID（可选，用于日志追踪） */
  correlationId?: string
  /** 时间戳（ms） */
  timestamp: number
  /** 默认权限模式提示（告诉 UI 当前是 always/auto/never 中的哪种触发了询问） */
  mode: TaskPermissionMode
}

/**
 * 审批决策（渲染进程通过 task:permission-approve 返回）
 */
export interface TaskPermissionDecision {
  /** 是否批准 */
  approved: boolean
  /**
   * 拒绝原因（approved=false 时填充，可选）
   *
   * 用于审计日志和 UI 展示。
   */
  rejectReason?: string
  /**
   * 是否记住决策（可选，默认 false）
   *
   * remember=true 时，主进程可将决策缓存到持久化规则表，
   * 下次同类 subagent 调度时自动应用（避免重复询问）。
   * 当前实现仅记录日志，持久化规则表留待 v1.6 实现。
   */
  remember?: boolean
}

// ============================================================================
// 审批等待函数（step 2 调用）
// ============================================================================

/**
 * 等待用户审批 Subagent 调度
 *
 * @param mainWindow 主窗口实例（用于推送审批请求事件）
 * @param request 审批请求载荷
 * @returns 用户审批决策（approved + rejectReason + remember）
 *
 * 流程：
 * 1. 推送 task:permission-approval-request 事件到渲染进程
 * 2. 渲染进程弹窗显示 taskId / subagentName / inputSummary
 * 3. 用户点击批准/拒绝 → 调用 taskPermissionApprove(callId, decision)
 * 4. 主进程通过 Promise resolve 返回决策
 * 5. 30 秒超时自动拒绝（reject）
 */
export function waitForTaskPermissionApproval(
  mainWindow: BrowserWindow,
  request: TaskPermissionApprovalRequest
): Promise<TaskPermissionDecision> {
  return new Promise<TaskPermissionDecision>((resolve, reject) => {
    // 推送审批请求到渲染进程
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(TASK_PERMISSION_APPROVAL_CHANNEL, request)
      logger.info('IPC.TASK_PERMISSION', `推送 Subagent 审批请求`, {
        callId: request.callId,
        taskId: request.taskId,
        subagentName: request.subagentName,
        mode: request.mode,
      })
    }

    // 30 秒超时自动拒绝
    const timeout = setTimeout(() => {
      pendingTaskPermissionApprovals.delete(request.callId)
      reject(new Error('用户审批超时（30秒），自动拒绝'))
    }, TASK_PERMISSION_APPROVAL_TIMEOUT_MS)

    pendingTaskPermissionApprovals.set(request.callId, {
      resolve,
      reject,
      timeout,
    })
  })
}

// ============================================================================
// IPC Handler 注册
// ============================================================================

/**
 * 注册 Task Permission 审批 IPC handlers
 *
 * 注册以下通道：
 * - task:permission-approve — 渲染进程响应审批请求（approve/reject + remember）
 *
 * IPC 4 步同步：
 * 1. main 层 handler：本文件
 * 2. ipc/index.ts：导入并调用 registerTaskPermissionHandlers()
 * 3. preload/index.ts：暴露 taskPermissionApprove() 方法
 * 4. electron.d.ts：声明 taskPermissionApprove 类型
 */
export function registerTaskPermissionHandlers(): void {
  // ------------------------------------------------------------------
  // task:permission-approve — 渲染进程响应审批请求
  // ------------------------------------------------------------------
  // 参数：
  // - callId: string（与推送的 TaskPermissionApprovalRequest.callId 对应）
  // - decision: TaskPermissionDecision（approved + rejectReason + remember）
  //
  // 返回：void（通过 Promise resolve 通知 waitForTaskPermissionApproval）
  //
  // 设计要点：
  // - 不在校验入参类型（IPC 内部调用，信任渲染进程）
  // - callId 不在 pendingTaskPermissionApprovals 中时静默忽略（可能已超时）
  // - remember=true 时记录日志（持久化规则表留待 v1.6）
  ipcMain.handle(
    TASK_PERMISSION_APPROVE_INVOKE,
    async (_event, callId: string, decision: TaskPermissionDecision): Promise<void> => {
      const pending = pendingTaskPermissionApprovals.get(callId)
      if (!pending) {
        logger.warn('IPC.TASK_PERMISSION', `收到未知 callId 的审批响应（可能已超时）`, {
          callId,
          approved: decision.approved,
        })
        return
      }

      clearTimeout(pending.timeout)
      pendingTaskPermissionApprovals.delete(callId)
      pending.resolve(decision)

      logger.info('IPC.TASK_PERMISSION', `收到审批响应`, {
        callId,
        approved: decision.approved,
        remember: decision.remember ?? false,
        rejectReason: decision.rejectReason,
      })

      // remember=true 时记录日志（v1.6 实现持久化规则表）
      if (decision.remember) {
        logger.info('IPC.TASK_PERMISSION', `用户选择记住决策（持久化规则表 v1.6 实现）`, {
          callId,
          approved: decision.approved,
        })
      }
    }
  )

  logger.info('IPC.TASK_PERMISSION', `Task Permission 审批 IPC handlers 已注册`, {
    channels: [TASK_PERMISSION_APPROVE_INVOKE],
  })
}
