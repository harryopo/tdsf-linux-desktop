/**
 * 上下文窗口覆盖（#91）的判定与合成
 *
 * 为什么单独成文件：这两条判断决定"存进 provider 的能力声明长什么样"，
 * 而 provider:list 现在恒带解析后的 capabilities（#89），所以这里必须守住两条：
 *   1. 只有用户真填了值才写覆盖，填 0（未知）表示不覆盖；
 *   2. 目标 provider 没有能力声明时不凭空造一份 —— 宁可不覆盖，
 *      也不要送出一半是猜的 streaming/toolCall/vision/logprobs。
 * 主进程写入口（provider-registry.stripDerivedFields）是第二道防线，
 * 这里先不产生垃圾比事后剥掉更省事。
 */
import type { PersistedProviderConfig } from '@shared/agent-types'

/** 低于这个窗口连一轮真实请求都装不下，视为填错 */
export const MIN_CONTEXT_WINDOW = 1024

/**
 * 校验用户填的窗口：0 表示"未知/不覆盖"，合法放行。
 * @returns 错误提示文案；null 表示合法
 */
export function validateContextWindow(value: number): string | null {
  if (value === 0) return null
  if (!Number.isFinite(value)) return '上下文窗口要填数字'
  if (!Number.isInteger(value)) return '上下文窗口要填整数'
  if (value < MIN_CONTEXT_WINDOW) {
    return `上下文窗口要不小于 ${MIN_CONTEXT_WINDOW}（填 0 表示未知、不覆盖）`
  }
  return null
}

/**
 * 把窗口覆盖合成进 provider 的能力声明。
 *
 * @param target 当前默认 provider（provider:list 带出来的已含解析后 capabilities）
 * @param value 用户填的窗口；0 = 不覆盖
 * @returns 要写进 payload 的 capabilities；不该覆盖时原样返回
 */
export function withContextWindow(
  target: Pick<PersistedProviderConfig, 'capabilities'>,
  value: number
): PersistedProviderConfig['capabilities'] {
  const base = target.capabilities
  if (!base || value === 0) return base
  return { ...base, contextWindow: value }
}
