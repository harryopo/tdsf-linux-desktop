/**
 * ipc-contract.ts —— 跨进程通道的单一契约源（阶段 D1）
 *
 * 治的病：加一个参数要改四处。今天给对话加 terminalContext 就同时动了
 * preload/index.ts、preload 的类型声明、渲染层 electron.d.ts、主进程 handler——
 * 三处手写签名 + 一处实现，谁漏一处就是运行时 undefined。
 * 这里把「通道 → 方法名 → 入参 → 返回」写成一份 zod 契约，渲染层用的类型由它生成，
 * 主进程与 preload 之间运行时按它校验，未纳入契约的通道数量由 pnpm test 里的刻度闸管着。
 *
 * ChannelContract 按 kind 判别（invoke / event 两支）：
 * - invoke：请求-响应通道，校验【入参】（渲染层用错了就在 preload 里当场抛，不拖到主进程深处）；
 *   返回值只声明类型不强校验——主进程已经在跑的真实返回若被一条过紧的 schema 拦死，
 *   那是拿契约去砸功能，不叫加防护。
 * - event：主进程推送的负载，只作为类型源，不校验（推送丢了没法重试）。
 *
 * 生成物：src/renderer/src/types/generated/ipc-contract.ts，由 scripts/ipc/gen-contract.mjs 产出；
 * 测试会在内存里重算一遍并与盘上文件比对，漂了就红（同 design-contract 的路子）。
 */
import { z } from 'zod'
import { AGENT, PROVIDER, SSH } from './ipc-channels'

/** 一条入参：名字用来生成签名，schema 用来运行时校验，ts 用来生成签名里的类型 */
export interface ContractArg {
  name: string
  ts: string
  schema: z.ZodTypeAny
}

interface ContractBase {
  /** electronAPI 上的方法名 */
  api: string
  /** 通道名（用 ipc-channels 常量拼，别写字面量） */
  channel: string
  /** 写进生成文件的一行说明 */
  doc: string
}

export interface InvokeContract extends ContractBase {
  kind: 'invoke'
  args: readonly ContractArg[]
  /** 返回值类型（Promise 里那一层） */
  resultTs: string
  result: z.ZodTypeAny
}

export interface EventContract extends ContractBase {
  kind: 'event'
  /** 负载类型名（形状仍以 shared 里的接口为准，这里负责把通道和它钉在一起） */
  payloadName: string
  payload: z.ZodTypeAny
}

/** 判别联合：kind 决定这一条是请求-响应还是推送 */
export type ChannelContract = InvokeContract | EventContract

const str = z.string()
const bool = z.boolean()
const opt = (schema: z.ZodTypeAny) => schema.optional()
const arr = (schema: z.ZodTypeAny) => z.array(schema)

const chatMessage = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: opt(z.string()),
  toolCallId: opt(z.string()),
})

const thinkingStrength = z.enum(['fast', 'standard', 'deep', 'auto'])

/** Provider 配置：形状由 shared 里的接口负责，这里只挡明显用错类型的调用 */
const providerConfig = z
  .object({ id: str, name: str, type: str, model: str })
  .passthrough()

export const IPC_CONTRACT: readonly ChannelContract[] = [
  {
    kind: 'invoke',
    api: 'agentChat',
    channel: AGENT.CHAT,
    doc: '发起一轮 Supervisor 对话，返回 correlationId',
    args: [
      { name: 'messages', ts: 'ChatMessage[]', schema: arr(chatMessage) },
      { name: 'providerId', ts: 'string | undefined', schema: opt(str) },
      { name: 'strength', ts: 'ThinkingStrength | "auto" | undefined', schema: opt(thinkingStrength) },
      { name: 'sshSessionId', ts: 'string | undefined', schema: opt(str) },
      { name: 'terminalContext', ts: 'string | undefined', schema: opt(str) },
    ],
    resultTs: 'string',
    result: str,
  },
  {
    kind: 'invoke',
    api: 'agentChatCancel',
    channel: AGENT.CHAT_CANCEL,
    doc: '按 correlationId 或 sessionId 取消进行中的对话',
    args: [{ name: 'sessionIdOrCorrelationId', ts: 'string', schema: str }],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'agentPaor',
    channel: AGENT.PAOR,
    doc: '跑一轮 PAOR 自主循环',
    args: [
      { name: 'task', ts: 'string', schema: str },
      { name: 'sshSessionId', ts: 'string', schema: str },
      { name: 'maxIterations', ts: 'number | undefined', schema: opt(z.number()) },
    ],
    resultTs: 'PaorLoopResult',
    result: z.unknown(),
  },
  // ===== 交互式 Shell（2026-10-10 起身份是 shellId，不再是 sessionId）=====
  // 六条都进契约、preload 全走 invokeChecked：这样"未纳入契约的 invoke 位点"刻度
  // 不会因为新增通道往上走（该刻度只许降）。
  // terminal:data 这条推送**故意不进契约**：它是位置参数 (shellId, data)，
  // 而 event 支的 payload 是对象类型源，硬套会让生成的类型撒谎。
  {
    kind: 'invoke',
    api: 'sshShellStart',
    channel: SSH.SHELL_START,
    doc: '新开一条交互式 Shell，返回 shellId（一条连接可开多个终端）',
    args: [
      { name: 'sessionId', ts: 'string', schema: str },
      {
        name: 'size',
        ts: '{ cols: number; rows: number } | undefined',
        schema: opt(z.object({ cols: z.number(), rows: z.number() })),
      },
    ],
    resultTs: 'string',
    result: str,
  },
  {
    kind: 'invoke',
    api: 'sshShellClose',
    channel: SSH.SHELL_CLOSE,
    doc: '关掉一条终端通道（不断整条 SSH 连接）',
    args: [{ name: 'shellId', ts: 'string', schema: str }],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'sshShellList',
    channel: SSH.SHELL_LIST,
    doc: '列出某条会话当前开着的 shellId（渲染层恢复标签用）',
    args: [{ name: 'sessionId', ts: 'string', schema: str }],
    resultTs: 'string[]',
    result: arr(str),
  },
  {
    kind: 'invoke',
    api: 'sshShellWrite',
    channel: SSH.SHELL_WRITE,
    doc: '向指定终端写入键入数据（主进程不逐键判定，见通道注释）',
    args: [
      { name: 'shellId', ts: 'string', schema: str },
      { name: 'data', ts: 'string', schema: str },
    ],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'sshRunAuthored',
    channel: SSH.SHELL_RUN_AUTHORED,
    doc: '执行整条代写命令；主进程先过风险闸，block 级抛错',
    args: [
      { name: 'shellId', ts: 'string', schema: str },
      { name: 'command', ts: 'string', schema: str },
    ],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'sshShellResize',
    channel: SSH.SHELL_RESIZE,
    doc: '调整指定终端窗口尺寸',
    args: [
      { name: 'shellId', ts: 'string', schema: str },
      { name: 'cols', ts: 'number', schema: z.number() },
      { name: 'rows', ts: 'number', schema: z.number() },
    ],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'event',
    api: 'onAgentChunk',
    channel: AGENT.CHUNK,
    doc: '流式增量（前端按 messageSync 的事件分类表合并，不逐 token setState）',
    payloadName: 'AgentChunkPayload',
    payload: z.object({ delta: opt(str) }).passthrough(),
  },
  {
    kind: 'event',
    api: 'onAgentDone',
    channel: AGENT.DONE,
    doc: '本轮结束',
    payloadName: 'AgentDonePayload',
    payload: z.object({ correlationId: opt(str) }).passthrough(),
  },
  {
    kind: 'event',
    api: 'onAgentError',
    channel: AGENT.ERROR,
    doc: '本轮失败',
    payloadName: 'AgentErrorPayload',
    payload: z.object({ message: opt(str) }).passthrough(),
  },
  {
    kind: 'invoke',
    api: 'providerList',
    channel: PROVIDER.LIST,
    doc: '列出 Provider（不含 apiKey，附 hasApiKey）',
    args: [{ name: 'onlyEnabled', ts: 'boolean | undefined', schema: opt(bool) }],
    resultTs: 'PersistedProviderConfig[]',
    result: arr(z.unknown()),
  },
  {
    kind: 'invoke',
    api: 'providerGet',
    channel: PROVIDER.GET,
    doc: '取单个 Provider',
    args: [{ name: 'id', ts: 'string', schema: str }],
    resultTs: 'PersistedProviderConfig | null',
    result: z.union([z.unknown(), z.null()]),
  },
  {
    kind: 'invoke',
    api: 'providerSave',
    channel: PROVIDER.SAVE,
    doc: '保存 Provider（apiKey 由主进程走 SecureStore）',
    args: [{ name: 'config', ts: 'ProviderConfig', schema: providerConfig }],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'providerSetDefault',
    channel: PROVIDER.SET_DEFAULT,
    doc: '设默认 Provider',
    args: [{ name: 'id', ts: 'string', schema: str }],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'providerGetDefault',
    channel: PROVIDER.GET_DEFAULT,
    doc: '读默认 Provider ID',
    args: [],
    resultTs: 'string',
    result: str,
  },
]

/** 生成文件要 import 的类型来自哪儿 */
export const CONTRACT_TYPE_IMPORTS: Record<string, string> = {
  ChatMessage: '@shared/models',
  ThinkingStrength: '@shared/agent-types',
  PersistedProviderConfig: '@shared/agent-types',
  ProviderConfig: '@shared/agent-types',
  PaorLoopResult: '@shared/paor-types',
  AgentChunkPayload: '@shared/agent-types',
  AgentDonePayload: '@shared/agent-types',
  AgentErrorPayload: '@shared/agent-types',
}

export function contractFor(api: string): ChannelContract | undefined {
  return IPC_CONTRACT.find((c) => c.api === api)
}

export function contractByChannel(channel: string): ChannelContract | undefined {
  return IPC_CONTRACT.find((c) => c.channel === channel)
}

function describeIssues(where: string, issues: z.ZodIssue[]): string {
  return `${where}: ${issues.map((i) => `${i.path.join('.') || '(根)'} ${i.message}`).join('；')}`
}

/**
 * 渲染层调用前校验入参。不匹配就抛——错误留在最近的一层，
 * 而不是等主进程 handler 里某个 undefined 崩掉再回头猜是谁传歪了。
 * 返回值不做同等强校验，理由见文件头。
 */
export function assertContractArgs(api: string, args: readonly unknown[]): void {
  const c = contractFor(api)
  if (!c || c.kind !== 'invoke') return
  if (args.length > c.args.length) {
    throw new Error(`[ipc-contract] ${api} 传了 ${args.length} 个参数，契约只声明 ${c.args.length} 个`)
  }
  for (let i = 0; i < c.args.length; i++) {
    const parsed = c.args[i].schema.safeParse(args[i])
    if (!parsed.success) {
      throw new Error(
        describeIssues(`[ipc-contract] ${api} 第 ${i + 1} 个参数 ${c.args[i].name} 不合契约`, parsed.error.issues)
      )
    }
  }
}
