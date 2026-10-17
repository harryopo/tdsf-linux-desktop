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
import {
  AGENT,
  BOOT,
  LOCAL_TTY,
  PREVIEW,
  PROVIDER,
  SHELL_INTEGRATION,
  SSH,
  WINDOW,
} from './ipc-channels'

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

/** 预览目标（W5）：两种目标各自校验，端口必须落在 1..65535 */
const previewTarget = z.union([
  z.object({ kind: z.literal('file'), sessionId: str, path: z.string().startsWith('/') }),
  z.object({ kind: z.literal('port'), sessionId: str, port: z.number().int().min(1).max(65535) }),
])

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
    doc: '向指定终端写入键入数据（主进程行缓冲到回车时过风险闸，block 时返回 false）',
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
    kind: 'invoke',
    api: 'windowOpenSecondary',
    channel: WINDOW.OPEN_SECONDARY,
    doc: '再开一个应用窗口，返回当前窗口数',
    args: [],
    resultTs: 'number',
    result: z.number(),
  },
  // 预览（W5）。子资源一律由 tdsf-preview: 协议按句柄取，不经这里——
  // 所以这张表上没有"给我一个任意路径的字节"那种通道。
  {
    kind: 'invoke',
    api: 'previewOpen',
    channel: PREVIEW.OPEN,
    doc: '为一个远端目标铸预览句柄，返回 token 与 iframe 用的 URL',
    args: [{ name: 'target', ts: 'PreviewTarget', schema: previewTarget }],
    resultTs: 'PreviewHandleInfo',
    result: z.object({
      token: str,
      url: str,
      kind: z.enum(['file', 'port']),
      entryPath: z.nullable(str),
    }),
  },
  {
    kind: 'invoke',
    api: 'previewClose',
    channel: PREVIEW.CLOSE,
    doc: '作废一个预览句柄（关掉预览标签时调）',
    args: [{ name: 'token', ts: 'string', schema: str }],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'previewReadText',
    channel: PREVIEW.READ_TEXT,
    doc: '读句柄入口文件的文本（Markdown 在渲染层安全渲染，不进 iframe）',
    args: [{ name: 'token', ts: 'string', schema: str }],
    resultTs: 'string',
    result: str,
  },
  // 远端 Shell 集成（#61）。入参一律只有 sessionId：
  // 写哪个文件、写什么内容由主进程定死，状态里带回来的原文就是界面要展示的那份。
  {
    kind: 'invoke',
    api: 'sshShellIntegrationStatus',
    channel: SHELL_INTEGRATION.STATUS,
    doc: '问这台服务器的 shell 集成状态，并带回将要写入的两处原文',
    args: [{ name: 'sessionId', ts: 'string', schema: str }],
    resultTs: 'ShellIntegrationStatus',
    result: z.object({
      shellPath: str,
      kind: z.enum(['bash', 'zsh', 'other']),
      rcFile: z.nullable(str),
      snippetFile: str,
      installed: z.boolean(),
      snippetMissing: z.boolean(),
      snippetText: str,
      rcBlockText: str,
      message: str,
    }),
  },
  {
    kind: 'invoke',
    api: 'sshShellIntegrationInstall',
    channel: SHELL_INTEGRATION.INSTALL,
    doc: '用户逐台确认之后才调：写入集成脚本并在 rc 里加标记块',
    args: [{ name: 'sessionId', ts: 'string', schema: str }],
    resultTs: 'ShellIntegrationResult',
    result: z.object({ ok: z.boolean(), message: str }),
  },
  {
    kind: 'invoke',
    api: 'sshShellIntegrationUninstall',
    channel: SHELL_INTEGRATION.UNINSTALL,
    doc: '从 rc 里剥掉标记块并删掉集成脚本',
    args: [{ name: 'sessionId', ts: 'string', schema: str }],
    resultTs: 'ShellIntegrationResult',
    result: z.object({ ok: z.boolean(), message: str }),
  },
  // 本机终端（W3）。输出仍走 terminal:data（不在此处，理由见上面那段注释）；
  // local-tty:exit 的载荷是一个裸 shellId，不是对象，所以它和 terminal:data 一样
  // 留在契约外——契约的 event 支要求对象载荷，硬套会让生成出来的类型撒谎。
  {
    kind: 'invoke',
    api: 'localTtyStatus',
    channel: LOCAL_TTY.STATUS,
    doc: '本机终端是否可用（node-pty 装没装上、用的是哪个 Shell）',
    args: [],
    resultTs: '{ available: boolean; reason: string | null; shellPath: string | null }',
    result: z.object({
      available: z.boolean(),
      reason: z.nullable(z.string()),
      shellPath: z.nullable(z.string()),
    }),
  },
  {
    kind: 'invoke',
    api: 'localTtyStart',
    channel: LOCAL_TTY.START,
    doc: '开一条本机终端，返回 shellId；不可用时抛错并带原因',
    args: [
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
    api: 'localTtyList',
    channel: LOCAL_TTY.LIST,
    doc: '列出当前开着的本机终端 shellId（标签对账用）',
    args: [],
    resultTs: 'string[]',
    result: arr(str),
  },
  {
    kind: 'invoke',
    api: 'localTtyWrite',
    channel: LOCAL_TTY.WRITE,
    doc: '向本机终端写入键入数据（主进程行缓冲到回车时过风险闸，block 时返回 false）',
    args: [
      { name: 'shellId', ts: 'string', schema: str },
      { name: 'data', ts: 'string', schema: str },
    ],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'localTtyResize',
    channel: LOCAL_TTY.RESIZE,
    doc: '调整本机终端窗口尺寸',
    args: [
      { name: 'shellId', ts: 'string', schema: str },
      { name: 'cols', ts: 'number', schema: z.number() },
      { name: 'rows', ts: 'number', schema: z.number() },
    ],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'localTtyClose',
    channel: LOCAL_TTY.CLOSE,
    doc: '关闭一条本机终端（连带杀掉它的子进程树）',
    args: [{ name: 'shellId', ts: 'string', schema: str }],
    resultTs: 'boolean',
    result: bool,
  },
  {
    kind: 'invoke',
    api: 'localTtyRunAuthored',
    channel: LOCAL_TTY.RUN_AUTHORED,
    doc: '在本机终端执行整条代写命令；主进程先过风险闸，block 级抛错',
    args: [
      { name: 'shellId', ts: 'string', schema: str },
      { name: 'command', ts: 'string', schema: str },
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
  // 启动加载页。两条一起登记：推送 + 补拉，缺一条就会有"界面永久停在加载页"那种竞态。
  {
    kind: 'event',
    api: 'onBootLoadingStage',
    channel: BOOT.LOADING_STAGE,
    doc: '主进程走到某个启动阶段（渲染层据此显示一句人话，stage=done 即就绪）',
    payloadName: 'BootLoadingStage',
    payload: z.object({ stage: opt(str), message: opt(str) }).passthrough(),
  },
  {
    kind: 'invoke',
    api: 'bootGetState',
    channel: BOOT.GET_STATE,
    doc: '拉取最近一次启动阶段；主进程还没推过时为 null',
    args: [],
    resultTs: 'BootLoadingStage | null',
    result: z.nullable(z.object({ stage: str, message: str })),
  },
]

/** 生成文件要 import 的类型来自哪儿 */
export const CONTRACT_TYPE_IMPORTS: Record<string, string> = {
  ChatMessage: '@shared/models',
  PreviewTarget: '@shared/models',
  PreviewHandleInfo: '@shared/models',
  ShellIntegrationStatus: '@shared/models',
  ShellIntegrationResult: '@shared/models',
  ThinkingStrength: '@shared/agent-types',
  PersistedProviderConfig: '@shared/agent-types',
  ProviderConfig: '@shared/agent-types',
  PaorLoopResult: '@shared/paor-types',
  AgentChunkPayload: '@shared/agent-types',
  AgentDonePayload: '@shared/agent-types',
  AgentErrorPayload: '@shared/agent-types',
  BootLoadingStage: '@shared/boot-types',
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
