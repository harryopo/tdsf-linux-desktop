/**
 * 外部 MCP 子进程的环境变量：默认继承表 + 用户点名的键，仅此两样
 *
 * 见判据 tests/unit/mcp-child-env.test.ts。旧写法 `{ ...process.env, ...config.env }`
 * 会把主进程的全部环境交给第三方程序（本机随便一把 API Key 都在里面）。
 */
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'

/** 合法的 shell 环境变量名（首字符不能是数字，也不许有 . / 空格 / $ / -） */
export const MCP_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * @param pick 用户点名要从本机继承的环境变量名；非法名与本机没有的键直接跳过
 * @param source 默认 process.env，测试可注入以证明"点名才给"
 */
export function buildExternalChildEnv(
  pick: readonly string[] | undefined,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  // 基表跟着 SDK 走，不自己抄一份白名单：SDK 改了这里不会悄悄留着旧的
  const env: Record<string, string> = { ...getDefaultEnvironment() }
  for (const key of pick ?? []) {
    if (!MCP_ENV_NAME.test(key)) continue
    const value = source[key]
    if (typeof value === 'string') env[key] = value
  }
  return env
}
