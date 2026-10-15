/**
 * 错误分类码 → 用户下一步（2026-10-15 全维度审查 D5）
 *
 * 主进程早就把错误分成了 18 类，`code` 也一路随 IPC 送到渲染进程，但渲染层**零消费**：
 * 于是"未配置 API Key"和"内容被安全策略拒绝"在界面上是同一句灰字，
 * 用户唯一能做的就是再按一次发送。分类白做了。
 *
 * 这里把码翻成"一句人话 + 真的能点的按钮"。硬规矩：
 * 只允许给出界面上确实存在的动作（去设置 / 重试 / 压缩上下文），
 * 没有一个动作可给时就只说话、不放按钮——按钮点了没反应比没有按钮更糟。
 */
import type { LlmErrorCode } from '@shared/agent-types'

/** 界面上真实存在的动作（LiveMessageRow 的 props 一一对应） */
export type ErrorAction = 'settings' | 'retry' | 'compress'

export interface ErrorNextStep {
  /** 一句话：说清下一步做什么，不复述错误原文 */
  hint: string
  /** 可执行动作，按推荐顺序；空数组 = 只说明，不给按钮 */
  actions: ErrorAction[]
}

const NEXT_STEP: Record<LlmErrorCode, ErrorNextStep> = {
  NO_API_KEY: { hint: '补上 API Key 就能继续。', actions: ['settings'] },
  CONFIG: { hint: '这个模型的配置还缺东西，补齐就能继续。', actions: ['settings'] },
  AUTH: { hint: 'Key 被判无效：确认没多空格、没过期，再保存一次。', actions: ['settings'] },
  PAYMENT_REQUIRED: { hint: '账户欠费，充值后重试。', actions: [] },
  PERMISSION: { hint: '这个模型没开通或没权限，换一个试试。', actions: ['settings'] },
  MODEL_NOT_FOUND: { hint: '模型名或地址不对，去设置里核对。', actions: ['settings'] },
  CONTEXT_OVERFLOW: { hint: '这段对话已经超出模型窗口，先剪掉较早的历史。', actions: ['compress', 'settings'] },
  RATE_LIMIT: { hint: '对方限流了，等几秒再发。', actions: ['retry'] },
  QUOTA_EXHAUSTED: { hint: '额度已用尽，重试不会恢复，去看配额或换模型。', actions: ['settings'] },
  TIMEOUT: { hint: '这一步太久没回音。可以重试，或把问题拆细一点、换更快的思考强度。', actions: ['retry'] },
  NETWORK: { hint: '连不上模型服务，检查网络或地址后重试。', actions: ['retry', 'settings'] },
  SERVER: { hint: '对面上次没答好，稍后重试。', actions: ['retry'] },
  PARSE: { hint: '返回的内容没解析成功，重试通常就好。', actions: ['retry'] },
  BAD_REQUEST: { hint: '这次请求对方不接受，换个说法重试。', actions: ['retry'] },
  VALIDATION: { hint: '参数没通过校验，重试或换个模型。', actions: ['retry'] },
  CONTENT_POLICY: { hint: '这段内容被对方的安全策略拒绝，改一下问法。', actions: [] },
  CANCELLED: { hint: '已按你的停止。', actions: [] },
  UNKNOWN: { hint: '原因没被认出来，可以重试一次；连续出现请查看日志。', actions: ['retry'] },
}

/** 全部取值都必须在表里（新增码漏配这里会直接编译不过，运行期再兜一次底） */
export function resolveErrorNextStep(code: LlmErrorCode | undefined): ErrorNextStep | null {
  if (!code) return null
  return NEXT_STEP[code] ?? null
}

/** 表里出现过的动作集合（判据用它反查界面是否都实现了） */
export function errorActionTypes(): ErrorAction[] {
  const set = new Set<ErrorAction>()
  for (const v of Object.values(NEXT_STEP)) for (const a of v.actions) set.add(a)
  return [...set]
}
