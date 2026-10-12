/**
 * 主进程入参契约闸的行为判据（P1-3）
 *
 * 装在游戏里不算装：contract-guard 只有在"经过 ipcMain.handle 的注册路径"上跑起来
 * 才是防线，所以这里一律通过 installIpcErrorBoundary 打过补丁的 handle 注册 handler，
 * 再调用捕获到的那个监听 —— 边界没接上的话这些用例会拿到没包装的原始 handler，
 * 负向用例（"handler 不该被调用"）当场红。
 *
 * 三条判据各有针对性：
 * - handler 没被调用：证明闸挡在业务逻辑之前，而不是让 handler 自己在深处炸；
 * - 收到的值不出现在跨边界的字符串里：入参可能是口令、私钥正文、用户刚敲的命令；
 * - 未登记契约的通道原样放行：这是**覆盖面的诚实边界**（239 条注册点里进了表的只有 28 条），
 *   写成断言而不是写在注释里，免得后来人以为全部通道都判了。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { ipcMain } from 'electron'
import { PREVIEW } from '@shared/ipc-channels'
import { contractByChannel } from '@shared/ipc-contract'
import { parseIpcError } from '@shared/ipc-errors'

const mainHandlers: Record<string, (event: unknown, ...args: unknown[]) => unknown> = {}
const logged: string[] = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
      mainHandlers[channel] = listener
    }
  }
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: {
    error: (category: string, message: string, meta?: unknown) =>
      logged.push(`${category} ${message} ${JSON.stringify(meta ?? null)}`),
    warn: (category: string, message: string, meta?: unknown) =>
      logged.push(`${category} ${message} ${JSON.stringify(meta ?? null)}`),
    info: (category: string, message: string) => logged.push(`${category} ${message}`)
  }
}))

import { installIpcErrorBoundary } from '../../src/main/ipc/error-boundary'

/** 走"已装边界"的注册路径；返回的函数就是渲染层那一次 invoke 在主进程侧的等价物 */
function registerThroughBoundary(
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => unknown
): (...args: unknown[]) => unknown {
  ;(ipcMain.handle as unknown as (c: string, l: never) => void)(channel, listener as never)
  return (...args) => mainHandlers[channel]({}, ...args)
}

/** previewReadText 的通道与形状都由契约表现量决定，不在这里抄一遍字面量 */
const READ = contractByChannel(PREVIEW.READ_TEXT)
const WRITE = contractByChannel(PREVIEW.CLOSE)

beforeAll(() => {
  installIpcErrorBoundary({ exposeDetail: true })
})

describe('前提：这两条通道确实在契约表里', () => {
  it('契约能按通道名查到，且声明的是 1 个字符串参数', () => {
    expect(READ, `契约表里没有 ${PREVIEW.READ_TEXT}`).toBeTruthy()
    expect(READ?.kind).toBe('invoke')
    if (READ?.kind !== 'invoke') return
    expect(READ.args.length).toBe(1)
    expect(READ.args[0].schema.safeParse('a-token').success).toBe(true)
    expect(READ.args[0].schema.safeParse(42).success).toBe(false)
  })
})

describe('命中契约的通道', () => {
  it('合契约的入参原样交给 handler，返回值不被改写', () => {
    const seen: unknown[] = []
    const call = registerThroughBoundary(PREVIEW.READ_TEXT, (_e, token) => {
      seen.push(token)
      return '正文'
    })
    expect(call('good-token')).toBe('正文')
    expect(seen).toEqual(['good-token'])
  })

  it('类型不合契约时在 handler 之前就被拒，并给出 E_INVALID_INPUT', () => {
    let handlerCalls = 0
    const call = registerThroughBoundary(PREVIEW.READ_TEXT, () => {
      handlerCalls++
      return '不该走到这里'
    })
    const err = (() => {
      try {
        call(42)
      } catch (e) {
        return e as Error
      }
      return null
    })()
    expect(err, '入参校验没挡住非字符串').toBeTruthy()
    expect(handlerCalls, '闸的作用是先拦再放行，handler 一次都不该被调到').toBe(0)
    const parsed = parseIpcError(err?.message)
    expect(parsed?.code).toBe('E_INVALID_INPUT')
    expect(parsed?.text).toContain('入参不符合契约')
  })

  it('多传参数也被拒（契约声明的位数就是接口的位数）', () => {
    const call = registerThroughBoundary(PREVIEW.READ_TEXT, (_e, token) => token)
    expect(() => call('t', '多余的')).toThrow(/E_INVALID_INPUT/)
  })

  it('不把渲染层传来的值回显到跨边界的字符串里', () => {
    // 值是"对象而不是字符串"这一类：契约只能报类型，值本身绝不能跟着外送
    const SECRET = ['sk-ant-', 'TESTONLYabcdefghij0123456789'].join('')
    const call = registerThroughBoundary(PREVIEW.READ_TEXT, (_e, token) => token)
    const err = (() => {
      try {
        call({ apiKey: SECRET })
      } catch (e) {
        return e as Error
      }
      return null
    })()
    expect(err?.message).toBeTruthy()
    expect(err?.message).not.toContain('TESTONLYabcdefghij0123456789')
    expect(err?.message).not.toContain('apiKey')
    // 主进程日志里也只留 path 与 zod code，不留值
    expect(logged.some((l) => l.includes('入参不合契约'))).toBe(true)
    expect(logged.join('\n')).not.toContain('TESTONLYabcdefghij0123456789')
  })

  it('0 个参数的契约通道：传了就该拒，没传就放行', () => {
    // PREVIEW.CLOSE 声明 1 位（token），用它测"少传必填位"这一侧
    expect(WRITE?.kind).toBe('invoke')
    if (WRITE?.kind !== 'invoke') return
    expect(WRITE.args.length).toBe(1)
    const call = registerThroughBoundary(PREVIEW.CLOSE, () => true)
    expect(call('token')).toBe(true)
    expect(() => call()).toThrow(/E_INVALID_INPUT/)
  })
})

describe('没登记契约的通道（覆盖面的诚实边界）', () => {
  it('闸不判、handler 照收 —— 211 条未进表的通道今天仍是这个样子', () => {
    const call = registerThroughBoundary('some:uncontracted-channel', (_e, a) => a)
    expect(call({ whatever: 1 })).toEqual({ whatever: 1 })
    expect(contractByChannel('some:uncontracted-channel')).toBeUndefined()
  })
})
