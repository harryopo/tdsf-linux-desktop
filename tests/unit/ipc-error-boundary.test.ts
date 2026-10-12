/**
 * IPC 错误边界与信封（P1-2）
 *
 * 审的那件事：`ipcMain.handle` 没有错误边界，handler 抛什么，渲染层就原样收到
 * `Error invoking remote method 'x': <内部 message>` —— 里面常有 API Key、
 * 绝对路径、底层 `.message`。修法是两个收口点：主进程编码（只送安全的那一句 + 末尾码），
 * preload 解码（还原成 `{message: 人话, ipcCode}`）。
 *
 * 本文件同时钉住两类东西：
 *   1. 行为：装了边界之后，参数仍然原样转发、正常返回值不被改写、异步 reject 也被覆盖；
 *   2. 泄露：把一条带凭据形状的原文喂进去，断言那个值没有出现在跨边界的字符串里。
 *      这条是"防线已造 ≠ 防线生效"的正面回答 —— 只测 encode/parse 的往返，
 *      等于测了一个没被任何人调用的函数。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { ipcMain, ipcRenderer } from 'electron'
import { readSourceFile } from '../helpers/source-scan'
import {
  encodeIpcError,
  parseIpcError,
  IpcError,
  ipcErrorUserText,
  GENERIC_INTERNAL_TEXT
} from '@shared/ipc-errors'

/**
 * 假凭据按相邻字面量拆开再 join：源码里不存在完整形状的密钥串，
 * 否则 GitHub 密钥扫描会把它当真值并给仓库所有者发信（删掉也不会自动关警报）。
 */
const FAKE_KEY = ['sk-ant-', 'TESTONLYabcdefghij0123456789'].join('')
const RAW_INTERNAL = `LLM 调用失败：401 invalid api_key=${FAKE_KEY} 配置读自 /srv/app/.env`

const mainHandlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}
const logged: string[] = []
/** 每个用例换一条 invoke 行为：vi.mock 工厂只跑一次，所以这里放一个可换的指针 */
const invokeImpl: { current: (channel: string, ...args: unknown[]) => Promise<unknown> } = {
  current: async () => undefined
}

vi.mock('electron', () => ({
  IpcRendererEvent: class {},
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      mainHandlers[channel] = listener
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => invokeImpl.current(channel, ...args)
  }
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: {
    error: (category: string, message: string, meta?: unknown) =>
      logged.push(`${category} ${message} ${JSON.stringify(meta ?? null)}`),
    warn: (category: string, message: string) => logged.push(`${category} ${message}`),
    info: (category: string, message: string) => logged.push(`${category} ${message}`)
  }
}))

import { installIpcErrorBoundary, finalize, safeUserText } from '../../src/main/ipc/error-boundary'
import { installIpcErrorUnwrap, type RendererIpcError } from '../../src/preload/ipc-util'

/** 走"已装边界"的注册路径，而不是直接调 handler —— 边界没装上的话这里就是 undefined */
function registerThroughBoundary(
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => unknown
): (event?: unknown, ...args: unknown[]) => unknown {
  ;(ipcMain.handle as unknown as (c: string, l: never) => void)(channel, listener as never)
  return (event = {}, ...args) => mainHandlers[channel](event, ...args)
}

beforeAll(() => {
  // 开发态：exposeDetail=true。生产态在下面的纯函数用例里单独断言。
  installIpcErrorBoundary({ exposeDetail: true })
  installIpcErrorUnwrap()
})

describe('信封本身（共享层纯函数）', () => {
  it('编解码往返：码在末尾，读起来仍是一句正常的话', () => {
    const wire = encodeIpcError(new IpcError('E_CONNECTION', 'SSH 连接失败'), false)
    expect(wire).toBe('SSH 连接失败 [E_CONNECTION]')
    expect(parseIpcError(wire)).toEqual({ code: 'E_CONNECTION', text: 'SSH 连接失败' })
  })

  it('开发态把内部原文放进详情，生产态整段丢掉', () => {
    const dev = parseIpcError(
      encodeIpcError(new IpcError('E_TIMEOUT', '命令超时', 'ssh-keygen 60s 未返回'), true)
    )
    expect(dev?.text).toBe('命令超时')
    expect(dev?.detail).toBe('ssh-keygen 60s 未返回')
    const prod = encodeIpcError(new IpcError('E_TIMEOUT', '命令超时', 'ssh-keygen 60s 未返回'), false)
    expect(prod).toBe('命令超时 [E_TIMEOUT]')
    expect(prod).not.toContain('ssh-keygen')
  })

  it('不是信封的字符串（老代码直接抛的）原样返回，不被吞掉', () => {
    expect(parseIpcError('connect ECONNREFUSED 10.0.0.1:22')).toBeNull()
    expect(ipcErrorUserText('connect ECONNREFUSED 10.0.0.1:22')).toBe(
      'connect ECONNREFUSED 10.0.0.1:22'
    )
    expect(ipcErrorUserText('SSH 连接失败 [E_CONNECTION]')).toBe('SSH 连接失败')
    expect(ipcErrorUserText(undefined)).toBe('')
  })
})

describe('主进程收口：finalize', () => {
  it('跨边界不外送凭据与敏感路径，但保留用户能看懂的那半句（生产态）', () => {
    const wire = finalize(new Error(RAW_INTERNAL), 'llm:chat', false).message
    expect(wire).not.toContain('TESTONLYabcdefghij0123456789')
    expect(wire).not.toContain('/srv/app/.env')
    // 具体句子还在：把 152 处报错全砸成"操作未完成"是可用性回退，不是安全收益
    expect(wire).toContain('LLM 调用失败')
    expect(wire.endsWith('[E_INTERNAL]')).toBe(true)
  })

  it('开发态的详情也过脱敏 —— exposeDetail 不是密钥外送的许可证', () => {
    // 故意写成多行：单行时详情会和原话相同而被收口处丢掉（那是另一条用例）
    const multiLine = `LLM 调用失败\n  request api_key=${FAKE_KEY}\n  配置文件读自 /srv/app/.env`
    const wire = finalize(new Error(multiLine), 'llm:chat', true).message
    expect(wire).toContain('（详情：')
    expect(wire).not.toContain('TESTONLYabcdefghij0123456789')
    expect(wire).not.toContain('/srv/app/.env')
  })

  it('显式 IpcError 的 detail 同样被脱敏（收口只有一处，不靠作者自觉）', () => {
    const wire = finalize(new IpcError('E_CONNECTION', '连接失败', `key=${FAKE_KEY}`), 'llm:x', true)
      .message
    expect(wire).not.toContain('TESTONLYabcdefghij0123456789')
    expect(wire).toContain('连接失败')
  })

  it('内部原文交给主进程日志（跨边界丢掉的东西本地找得回，且带上是哪个通道）', () => {
    logged.length = 0
    finalize(new Error('数据库打开失败：/var/lib/tdsf/app.db locked'), 'db:open', false)
    expect(logged.some((l) => l.includes('数据库打开失败：/var/lib/tdsf/app.db locked'))).toBe(true)
    expect(logged[0]).toContain('"channel":"db:open"')
  })

  it('显式 IpcError 的码与话术不被 E_INTERNAL 覆盖', () => {
    const wire = finalize(new IpcError('E_BLOCKED', '高危命令已被拦截'), 'ssh:exec', false).message
    expect(wire).toBe('高危命令已被拦截 [E_BLOCKED]')
  })

  it('safeUserText：纯空白退回通用话术，超长压到 300 字符内', () => {
    expect(safeUserText('   \n\t ')).toBe(GENERIC_INTERNAL_TEXT)
    expect(safeUserText('多行\n原文\r\n混排')).toBe('多行 原文 混排')
    expect(safeUserText('x'.repeat(5000)).length).toBeLessThanOrEqual(300)
  })
})

/** 边界对同步抛错的 handler 是"往外抛一个已编码的 Error"（Electron 再把它变成 reject） */
function thrown(fn: () => unknown): Error {
  try {
    fn()
  } catch (e) {
    return e as Error
  }
  throw new Error('用例写错了：本该抛错却没抛')
}

describe('边界真的装在注册入口上（不是只写了个函数）', () => {
  it('handler 同步抛错 → 出信封', () => {
    const call = registerThroughBoundary('t:sync-throw', () => {
      throw new Error(RAW_INTERNAL)
    })
    const wire = thrown(() => call()).message
    expect(wire).not.toContain('TESTONLYabcdefghij0123456789')
    expect(wire).not.toContain('/srv/app/.env')
    expect(wire.endsWith('[E_INTERNAL]')).toBe(true)
  })

  it('handler 返回被 reject 的 Promise → 同样出信封（异步才是多数路径）', async () => {
    const call = registerThroughBoundary('t:async-reject', async () => {
      throw new IpcError('E_NOT_FOUND', '会话不存在')
    })
    await expect(call() as Promise<unknown>).rejects.toThrow('会话不存在 [E_NOT_FOUND]')
  })

  it('参数原样展开转发：写成数组会让 239 个注册点的第二个形参全部收到长度为 1 的数组', () => {
    const call = registerThroughBoundary('t:args', (_event, a, b) => [a, b])
    expect(call({}, 'shell-1', 2)).toEqual(['shell-1', 2])
  })

  it('正常返回值原样透传（同步返回不被包成 Promise，也不被改写）', () => {
    const call = registerThroughBoundary('t:ok', (_event, n) => ({ ok: true, n }))
    expect(call({}, 7)).toEqual({ ok: true, n: 7 })
  })

  it('只装一次：重复 install 不套第二层边界（套两层会把码与详情各多出一份）', () => {
    installIpcErrorBoundary({ exposeDetail: false })
    const call = registerThroughBoundary('t:double', () => {
      // 两行原文：详情与压平后的原话不同，所以开发态那份详情一定还在，能用来数层数
      throw new Error('底层原文\n第二行')
    })
    const wire = thrown(() => call()).message
    expect(wire.split('[E_INTERNAL]').length - 1).toBe(1)
    expect(wire.split('（详情：').length - 1).toBe(1)
  })

  it('开发态详情与原话相同就别重说一遍（真机弹出过两句一样的）', () => {
    const wire = finalize(new Error('预览句柄不存在或已过期'), 'preview:readText', true).message
    expect(wire).toBe('预览句柄不存在或已过期 [E_INTERNAL]')
  })

  it('开发态详情比原话多信息（换行、堆栈行）时才保留', () => {
    const wire = finalize(new Error('启动失败\n  at Shell.spawn (pty.ts:88)'), 'shell:start', true)
      .message
    expect(wire).toContain('（详情：启动失败')
    expect(wire).toContain('pty.ts:88')
  })
})

describe('preload 收口：装在 ipcRenderer.invoke 上（覆盖实测的 214 处直接调用）', () => {
  async function invokeRejects(message: string): Promise<RendererIpcError> {
    invokeImpl.current = () => Promise.reject(new Error(message))
    try {
      await (ipcRenderer.invoke as unknown as (c: string) => Promise<unknown>)('t:x')
      throw new Error('用例写错了：invoke 本该 reject')
    } catch (err) {
      return err as RendererIpcError
    }
  }

  it('Electron 的包装前缀不会漏进用户可见的那句话，码挂到 ipcCode', async () => {
    const out = await invokeRejects(
      "Error invoking remote method 'ssh:connect': Error: 远程端口没开 [E_CONNECTION]"
    )
    expect(out.message).toBe('远程端口没开')
    expect(out.ipcCode).toBe('E_CONNECTION')
  })

  it('开发态详情换行附在那句话后面（界面直接渲染 message 也不会露码）', async () => {
    const wire = finalize(new IpcError('E_CONNECTION', 'SSH 连接失败', 'ECONNREFUSED 10.0.0.1:22'), 'ssh:connect', true)
      .message
    const out = await invokeRejects(
      `Error invoking remote method 'ssh:connect': Error: ${wire}`
    )
    expect(out.message.split('\n')[0]).toBe('SSH 连接失败')
    expect(out.message).toContain('ECONNREFUSED 10.0.0.1:22')
    expect(out.message).not.toContain('[E_CONNECTION]')
    expect(out.ipcCode).toBe('E_CONNECTION')
  })

  it('没有信封码的 reject（如 No handler registered）原样透传', async () => {
    const out = await invokeRejects("No handler registered for 'unknown:channel'")
    expect(out.message).toBe("No handler registered for 'unknown:channel'")
    expect(out.ipcCode).toBeUndefined()
  })
})

/**
 * 接线核对（审查纪律 §7.2：防线已造 ≠ 防线生效）。
 *
 * 上面那些用例都是"手工把边界装上"再测的 —— 光它们全绿，不能证明生产入口真的调了
 * install。所以这里按源码文本钉住顺序：主进程必须在第一个 handler 注册之前装，
 * preload 必须在 exposeInMainWorld 之前装。谁把这两句挪到后面，这里就红。
 */
describe('接线核对：两个收口点都装在该装的位置', () => {
  it('主进程：installIpcErrorBoundary 早于第一个 register*Handlers 调用', () => {
    const src = readSourceFile('src/main/ipc/index.ts')
    // 只取函数体：签名里那句 `export function registerAllIpcHandlers(` 自己就会命中
    // register*Handlers( 的形状，不剥掉的话比较的是"函数名 vs 函数名"。
    const head = src.indexOf('export function registerAllIpcHandlers')
    expect(head).toBeGreaterThanOrEqual(0)
    const body = src.slice(src.indexOf('{', head))
    const install = body.indexOf('installIpcErrorBoundary(')
    const firstRegister = body.search(/\bregister[A-Za-z]*Handlers\(/)
    expect(install).toBeGreaterThanOrEqual(0)
    expect(firstRegister).toBeGreaterThanOrEqual(0)
    expect(install).toBeLessThan(firstRegister)
  })

  it('preload：installIpcErrorUnwrap 早于 contextBridge.exposeInMainWorld', () => {
    const src = readSourceFile('src/preload/index.ts')
    const install = src.indexOf('installIpcErrorUnwrap()')
    const expose = src.indexOf('contextBridge.exposeInMainWorld')
    expect(install).toBeGreaterThanOrEqual(0)
    expect(expose).toBeGreaterThanOrEqual(0)
    expect(install).toBeLessThan(expose)
  })
})
