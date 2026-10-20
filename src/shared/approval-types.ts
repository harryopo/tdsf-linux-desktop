/**
 * 人工审批载荷的唯一一份跨进程契约（#111）
 *
 * 改之前这四个形状在三个地方各抄一遍：主进程 ipc/*.ts、src/preload/types.ts、
 * src/renderer/src/types/electron.d.ts。三份没有东西强制对齐，实测已经漂了：
 * `SandboxApprovalRequest` 里 sideEffects / rollbackCommand / saferAlternative / sessionId
 * 四个字段主进程算好了、preload 的类型里根本没写——于是界面拿不到，
 * 沙箱审批弹窗上只剩一条光命令，用户看不到"为什么高危"和"出问题怎么回滚"。
 *
 * 现在只在这里声明一次，三个进程都 import；判据
 * tests/unit/approval-contract-single-source.test.ts 会横扫禁止再次出现同名重复声明。
 */

/** 命令危险度评级（沙箱审批与 AI 写命令审批共用） */
export type SandboxCommandRiskLevel = 'low' | 'medium' | 'high'

/**
 * 沙箱命令审批请求（sandbox:approval-request）
 *
 * 渲染进程弹窗显示命令 + 风险 + 副作用 + 回滚方案，
 * 用户通过 sandboxApprove(callId, approved) 响应；30 秒未响应主进程自动拒绝。
 */
export interface SandboxApprovalRequest {
  /** 审批调用 ID（与 sandboxApprove 的 callId 参数对应） */
  callId: string
  /** 沙箱 ID */
  sandboxId: string
  /** 待执行的命令 */
  command: string
  /** 命令危险度评级 */
  risk: SandboxCommandRiskLevel
  /** 风险原因列表（high/medium 时非空，辅助 UI 展示） */
  reasons: string[]
  /** 推送时间戳（ms） */
  timestamp: number
  /**
   * 会话 ID（可选）：UI 用它把审批请求与发起它的那次 sandbox:execute 关联起来，
   * 也支持用户在等待审批期间主动取消。
   */
  sessionId?: string
  /** 可能的副作用：告诉用户"执行后会发生什么"，例如 ['将删除 /var/log 下所有日志'] */
  sideEffects?: string[]
  /** 推荐的回滚命令：执行失败或结果不符预期时用户可用的补救命令 */
  rollbackCommand?: string
  /** 建议的更安全替代方案（存在时给出） */
  saferAlternative?: string
}

/**
 * 审批是从哪条链路发起的——同一个弹窗服务两条完全不同的路：
 * - 'paor'：PAOR 自动循环的某一步（有真实的步骤索引）
 * - 'chat'：对话里 AI 调 ssh_write 工具（没有"第几步"这回事）
 * 以前两者都写死 `stepIndex: 0`，界面于是永远显示"第 1 步"，
 * 并把对话里的写命令也说成"PAOR 请求批准"。
 */
export type PaorApprovalOrigin = 'paor' | 'chat'

/**
 * 高危命令审批请求（paor:approval-request）
 *
 * 60 秒未响应主进程自动拒绝；用户响应走 paorApprove(callId, approved)。
 */
export interface PaorApprovalRequest {
  /** 审批调用 ID（与 paorApprove 的 callId 参数对应） */
  callId: string
  /** 待执行的命令 */
  command: string
  /** 风险等级（HIGH / CRITICAL） */
  riskLevel: string
  /** 风险描述 */
  riskDescription: string
  /** 来源链路：决定标题文案与"第 N 步"该不该出现 */
  origin: PaorApprovalOrigin
  /**
   * PAOR 计划的步骤索引（0 起）。
   * 只有 origin='paor' 且主进程真的知道处在第几步时才有值——
   * 未知就是未知，不许用 0 冒充"第 1 步"。
   */
  stepIndex?: number
  /** 推送时间戳（ms） */
  timestamp: number
}
