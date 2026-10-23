/**
 * 外部 MCP 工具 → 主对话工具集（任务 #173 第三步）
 *
 * 这里只做"把第三方工具翻译成模型能看见、能调用的形状"，不碰 Electron：
 * 列表、审批、真调用都由调用方把三个回调递进来（supervisor 侧接 agent-runtime，
 * agent-runtime 侧接 McpGateway + requestApproval）。因此本文件可以单测，
 * 而判据见 tests/unit/mcp-external-chat-tools.test.ts。
 *
 * 三条不能让步的规矩：
 * 1. **工具名带服务器来源**。两台第三方服务器都提供 `search` 时，不加前缀就是
 *    后一个静默覆盖前一个——模型调的是哪个程序，界面上永远读不出来。
 * 2. **每次调用都要有人点头**，且判不了就先问人。审批回调抛异常按"未批准"处理，
 *    而不是按"没这套流程所以放行"。理由与 `core/agent/mcp-approval.ts` 同一条：
 *    第三方程序内部会做什么，主进程看不见。
 * 3. **挂了多少就报多少**。超出上限时把跳过的条数如实带回装配卡片，
 *    不许静默丢工具——卡片写着"挂了 7 个工具"而模型只能看见 4 个，就是界面在骗人。
 */
import { jsonSchema, tool } from 'ai'
import { buildExternalCallApproval } from '../mcp-approval'
import { limitToolTextOnly, TOOL_STDOUT_CHAR_LIMIT } from './output-limit'
import type { PaorApprovalRequest } from '@shared/approval-types'

/** 外部工具在对话里的名字前缀（与内置工具隔开，也让人一眼看出来源） */
export const EXTERNAL_CHAT_TOOL_PREFIX = 'mcp__'

/** 各家 chat API 对函数名的通用形状（超出去整条请求被拒，不是只拒那一个工具） */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const UNSAFE_SEG = /[^A-Za-z0-9_-]/g

/**
 * 一轮对话最多挂多少个外部工具。
 * 每个工具定义都要随请求发给模型，第三方服务器一多就会顶穿上下文；
 * 上限不是保护性的猜测，而是"必须有界"这条硬要求的最小落地——超出部分明确报数。
 */
export const EXTERNAL_TOOL_MOUNT_LIMIT = 24

/** 一台已连上的外部服务器报上来的一个工具（schema 由那个程序自己决定） */
export interface ExternalToolDescriptor {
  serverId: string
  /** 用户在设置页起的名字（审批卡与工具描述都用它，不用内部 id） */
  serverName: string
  name: string
  description: string
  /** 服务器自报的 JSON Schema；没给就退回"只收一个对象" */
  inputSchema?: unknown
}

/** 外部工具的一次调用结果（与 McpGateway.callExternalTool 的信封同形） */
export interface ExternalCallResult {
  success: boolean
  content: Array<{ type: 'text'; text: string }>
  error?: string
}

export interface ExternalChatToolDeps {
  /** 此刻已连上的外部工具（不触发连接：连不连得上是设置页那三张卡决定的事） */
  tools: () => ExternalToolDescriptor[]
  /** 逐次人工审批；只有实现方判定为真才算批准 */
  approve: (input: Omit<PaorApprovalRequest, 'expiresAt'>) => Promise<boolean>
  /** 真正调用外部工具（只会在放行之后走到这里） */
  call: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<ExternalCallResult>
  /** 被拒也要留痕：拦下来了却没有任何地方记得，等于没拦 */
  onDenied: (info: { serverId: string; serverName: string; toolName: string }) => void
}

export interface ExternalChatToolMount {
  /** 可直接并进 candidateTools 的工具表（键是 externalChatToolName(...)） */
  tools: Record<string, unknown>
  /** 挂上来的工具名（供历史剪枝按名字清旧输出） */
  names: string[]
  /** 因超出上限没挂上来的条数（0 才是"全都给了"） */
  skipped: number
  /** 挂上来的服务器名（装配卡片按服务器说，一长串工具名没人看得下去） */
  servers: string[]
  /** 拼进 system prompt 的一句说明（没挂工具时为空串） */
  promptHint: string
}

/** 把一段不可控的名字洗成 API 收得下的字符（真去调用时仍用原名） */
function safeSegment(raw: string, max: number): string {
  const cleaned = raw
    .replace(UNSAFE_SEG, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return (cleaned || 'tool').slice(0, Math.max(1, max))
}

/**
 * 外部工具在对话里的唯一名字。
 *
 * 工具名是第三方程序自己起的，中文、空格、点号都可能出现；服务器 id 是我们生成的、
 * 天然安全。原样拼进键名，一个不守规矩的服务器就能让整条对话请求被 provider 拒掉
 * （不是只拒那一个工具）。所以键名要洗，而真去调那次用的还是原名。
 */
export function externalChatToolName(serverId: string, toolName: string): string {
  const head = `${EXTERNAL_CHAT_TOOL_PREFIX}${safeSegment(serverId, 24)}__`
  const key = head + safeSegment(toolName, 64 - head.length)
  return TOOL_NAME_PATTERN.test(key) ? key : `${EXTERNAL_CHAT_TOOL_PREFIX}tool`
}

/** 服务器没自报 schema 时的兜底：能收一个对象，其余由那个程序自己判 */
function fallbackSchema(): object {
  return { type: 'object', properties: {}, additionalProperties: true }
}

export function buildExternalChatTools(deps: ExternalChatToolDeps): ExternalChatToolMount {
  // 顺序要稳定：两台服务器的工具数量一变，挂载集合就变，模型的行为跟着变。
  // 按「服务器名 → 工具名」排，跳过的那几条才是可解释的。
  const sorted = [...deps.tools()].sort(
    (a, b) => a.serverName.localeCompare(b.serverName) || a.name.localeCompare(b.name)
  )
  const picked = sorted.slice(0, EXTERNAL_TOOL_MOUNT_LIMIT)
  const tools: Record<string, unknown> = {}

  for (const d of picked) {
    const key = externalChatToolName(d.serverId, d.name)
    // 洗完名可能撞车（`a.b` 与 `a_b` 都是 API 合法形状）。撞了就不覆盖先挂的那个，
    // 并把这一条算进未挂载数——静默覆盖等于卡片上的数字在骗人。
    if (tools[key]) continue
    tools[key] = tool({
      description:
        `外部 MCP 工具：${d.serverName} 的 ${d.name}。这是第三方程序自己的实现，` +
        `主进程看不见它内部会做什么，所以每次调用都会先请你审批。` +
        (d.description ? `它自己的说明：${d.description}` : ''),
      inputSchema: jsonSchema((d.inputSchema ?? fallbackSchema()) as object),
      execute: async (input: unknown) => {
        const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
        const approvalInput = buildExternalCallApproval(d.serverId, d.name, args, d.serverName)

        let approved = false
        try {
          approved = (await deps.approve(approvalInput)) === true
        } catch {
          // 审批通道自己出问题：按未批准处理。宁可模型这一步空手而归，
          // 也不在"判不了"的时候替用户放行一个不透明的第三方程序。
          approved = false
        }
        if (!approved) {
          deps.onDenied({ serverId: d.serverId, serverName: d.serverName, toolName: d.name })
          return {
            ok: false,
            // "不要重复"不是客套：一条 12 步的工具链里，模型完全可以拿同一个参数再试一次，
            // 于是用户被同一张卡反复追问到 60 秒超时（ssh_write 那条 denial 早就这么写了）。
            error:
              '这次外部 MCP 调用没有被批准（用户拒绝或超时未答复），工具没有执行。' +
              '不要重复发起同一个调用，把"未获批准"如实告诉用户并就此收尾。',
          }
        }

        try {
          const r = await deps.call(d.serverId, d.name, args)
          const text = limitToolTextOnly(
            (r.content ?? []).map((c) => c.text).join('\n'),
            TOOL_STDOUT_CHAR_LIMIT,
            '外部工具输出'
          )
          if (!r.success) {
            return { ok: false, error: r.error ?? text ?? '外部工具调用失败' }
          }
          // summary 是界面卡片唯一认得的可读文本字段之一（core/agent/tool-result-view.ts）；
          // 自造一个键名，卡片会退化成把整个返回体 JSON 贴给用户。
          return { ok: true, summary: text }
        } catch (err) {
          return {
            ok: false,
            error: `外部 MCP 工具调用异常：${err instanceof Error ? err.message : String(err)}`,
          }
        }
      },
    })
  }

  const names = Object.keys(tools)
  // 只报"真挂上来的"那些服务器：撞名或超上限被丢的那条，它所属的服务器可能一个工具都没剩
  const mounted = sorted.filter((d) => names.includes(externalChatToolName(d.serverId, d.name)))
  const mountedServers = [...new Set(mounted.map((d) => d.serverName))].sort()
  const skipped = sorted.length - names.length
  const promptHint = names.length
    ? `你有 ${names.length} 个外部 MCP 工具（来自 ${mountedServers.join('、')}），` +
      `它们由第三方程序实现，你能看见的只有名字与参数表；` +
      `每一次调用都会先弹审批卡等用户点头，未批准不会执行。需要这类数据时才调用，` +
      `调用失败或没批准就把原因如实告诉用户，不要凭空补结果、也不要拿同一个调用再试一次。` +
      (skipped > 0 ? `另有 ${skipped} 个外部工具本轮未挂载（数量上限或名字撞车）。` : '')
    : ''

  return { tools, names, skipped, servers: mountedServers, promptHint }
}
