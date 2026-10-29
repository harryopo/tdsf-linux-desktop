/**
 * 外部 MCP 工具调用的审批载荷（纯函数，无 Electron，可直接单测）
 *
 * 为什么这里不按工具名查形状表放行：外部服务器自称的工具名我们无从登记，查不到就得逐条问人
 * （`core/command-gate.ts` 的 TOOL_CALL_SHAPES 那张表）。内部工具能列全，
 * 外部 MCP 服务器的工具名是第三方自己定的、不可枚举——接上去等于把所有外部工具拒死。
 * 参数里那串字符串到底是不是 shell 命令，也取决于对面那个服务器干什么，主进程判不了。
 * 对不透明的第三方程序，唯一诚实的控制是**每次调用都要有人点头**。
 */
import { randomUUID } from 'node:crypto'
import type { PaorApprovalRequest } from '@shared/approval-types'

/** 参数预览最多贴这么多字符（审批卡不是调试面板，整坨 JSON 会把"要不要批"挤没了） */
export const MCP_CALL_PREVIEW_LIMIT = 400

/**
 * 把参数序列化成一行预览。
 * 循环引用不能让审批流程自己崩（那等于"想拦却先把调用方弄死"）。
 */
function argsPreview(args: Record<string, unknown>): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(args, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[循环引用]'
        seen.add(value)
      }
      return value
    }) ?? String(args)
  } catch {
    return '{' + Object.keys(args).join(', ') + ' …}'
  }
}

/**
 * 构造一条审批请求（不含 `expiresAt`——死线由等待器统一给，两处各写一把 60 秒迟早漂）
 *
 * `serverName` 是用户在设置页自己起的那个名字。审批卡是要人当场点头的东西，
 * 上面只写 `mcp-mvkcr1xt-aoeb6s` 等于让人对着一串乱码授权；
 * 名字认不出来（配置里没这台）才退回 id——空白比乱码更糟。
 */
export function buildExternalCallApproval(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  serverName?: string
): Omit<PaorApprovalRequest, 'expiresAt'> {
  const label = serverName?.trim() || serverId
  const head = `外部 MCP「${label}」 · 工具 ${toolName} · 参数 `
  const json = argsPreview(args)
  const clipped = json.length > MCP_CALL_PREVIEW_LIMIT
  const command = clipped
    ? head + json.slice(0, MCP_CALL_PREVIEW_LIMIT) + '…（已截断）'
    : head + json

  return {
    // 每次调用一个新 callId：审批表按它挂等待器与定时器。
    // 只带时间戳不够——同一步里并行两个同类调用会撞同一毫秒，
    // 撞了就是第一条永远不结算（界面上只有一张卡，第二次调用挂在半路）。
    // 随机段刻意放在名字之前：整串按 96 截断，被切掉的只可能是尾部的服务器名，
    // 而前面的毫秒 + 随机段已经把两次调用分开了，截断不会把它们并成一个。
    callId: `mcp_${Date.now()}_${randomUUID().slice(0, 8)}_${serverId}_${toolName}`.slice(0, 96),
    command,
    riskLevel: 'HIGH',
    // 卡上只贴得下前 400 字，而那程序收下的是整份参数——
    // 审批是同意的凭证，不写清这一层，用户会以为自己把参数整个看过并点头了。
    riskDescription:
      '这是第三方 MCP 服务器自己的程序在执行，主进程看不到它内部会做什么，只能由人确认后放行。' +
      (clipped ? '参数超出展示上限：卡上看不到的那部分仍会原样交给它执行。' : ''),
    origin: 'mcp',
    // 外部调用不属于任何计划，没有"第几步"——不填就不填，不许用 0 冒充第 1 步
    timestamp: Date.now(),
  }
}
