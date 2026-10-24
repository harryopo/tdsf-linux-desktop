/**
 * 「把失败当数据返回」这条出方向的收口（#95 收尾）
 *
 * 背景：P1-2 给 `ipcMain.handle` 装了错误边界，但脱敏只装在 **reject** 路径上。
 * 实测 `src/main/ipc/*.ts` 有 39 处 `success: false` 与 32 处 `ok: false` 是**正常 resolve** 的
 * 返回体（渲染层按 `code` 分支、审批被拒不算故障），其中 sandbox / llm-tools / tutorial /
 * scheduler / subagent / diagnostics 直接把 `toErrorString(err)`、`(err as Error).message`
 * 拼进 `error` 字段 —— 于是同一句话，抛出来会被脱敏，作为数据返回就一个字不涂地越过进程边界。
 *
 * 本文件钉住四件事，缺一条这道闸就是假的：
 *   1. 阳性对照：带凭据形状的返回体，跨边界读不到那个值；
 *   2. 反向对照：没有凭据形状的诊断文本**一字不改**（这道闸不是把报错砸平）；
 *   3. 范围对照：`success: true` 的业务数据（文件正文、命令输出）不动，那是用户点名要看的字节；
 *   4. 不就地改写：失败信封里常常直接装着服务内部的数组，涂别人的状态是另一种事故。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { ipcMain } from 'electron'

/** 假凭据按相邻字面量拆开再 join：源码里不能出现完整形状的密钥串 */
const FAKE_KEY = ['sk-ant-', 'TESTONLYabcdefghij0123456789'].join('')
const FAKE_PASSWORD = ['hunter', '2NotReal'].join('')
const RAW_INTERNAL = `LLM 调用失败：401 invalid api_key=${FAKE_KEY} 配置读自 /srv/app/.env`

type Listener = (event: unknown, ...args: unknown[]) => unknown
const mainHandlers: Record<string, Listener> = {}
const logged: Array<{ level: string; category: string; message: string; meta: unknown }> = []

vi.mock('electron', () => ({
  IpcRendererEvent: class {},
  ipcMain: {
    handle: (channel: string, listener: Listener) => {
      mainHandlers[channel] = listener
    }
  },
  ipcRenderer: { invoke: async () => undefined }
}))

vi.mock('../../src/main/services/log/logger', () => ({
  logger: {
    error: (category: string, message: string, meta?: unknown) =>
      logged.push({ level: 'error', category, message, meta }),
    warn: (category: string, message: string, meta?: unknown) =>
      logged.push({ level: 'warn', category, message, meta }),
    info: (category: string, message: string, meta?: unknown) =>
      logged.push({ level: 'info', category, message, meta })
  }
}))

import { installIpcErrorBoundary, guardDataError } from '../../src/main/ipc/error-boundary'

beforeAll(() => {
  installIpcErrorBoundary({ exposeDetail: true })
})

/**
 * 通过**装过边界的注册函数**注册，拿到的是包装后的调用口。
 * 同时返回原始 listener —— 用它做"不兜就会漏"的对照，证明这条泄露是真的存在过，
 * 而不是我编出来一个假想敌。
 */
function viaBoundary(channel: string, listener: Listener) {
  ;(ipcMain.handle as unknown as (c: string, l: Listener) => void)(channel, listener)
  return {
    /** 渲染层实际收到的值 */
    crossed: (event: unknown = {}, ...args: unknown[]) => mainHandlers[channel](event, ...args),
    /** handler 自己构造的值（未经边界） */
    raw: listener,
  }
}

describe('阳性对照：不兜就会把原文送过边界', () => {
  it('success:false 的 error 字段里的凭据形状被涂掉，人话那半句还在', async () => {
    const { crossed, raw } = viaBoundary('sandbox:list', async () => ({
      success: false,
      error: RAW_INTERNAL,
      code: 'E_CONNECTION',
    }))

    // 先证明这条路径本身确实会泄露原文（否则下一条断言是空的）
    const untouched = (await raw({})) as { error: string }
    expect(untouched.error).toContain('TESTONLYabcdefghij0123456789')

    const out = (await crossed()) as { error: string; code: string }
    expect(out.error).not.toContain('TESTONLYabcdefghij0123456789')
    expect(out.error).not.toContain('/srv/app/.env')
    expect(out.error).toContain('LLM 调用失败')
    // 分支用的码不能被顺手改掉
    expect(out.code).toBe('E_CONNECTION')
  })

  it('ok:false 这一族（sidecar / llm:test）同样兜住', async () => {
    const { crossed } = viaBoundary('sidecar:health', async () => ({
      ok: false,
      error: `读取配置失败 password=${FAKE_PASSWORD}\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnZzaXAy\n`,
    }))
    const out = (await crossed()) as { error: string }
    expect(out.error).not.toContain(FAKE_PASSWORD)
    expect(out.error).not.toContain('b3BlbnZzaXAy')
    expect(out.error).toContain('读取配置失败')
  })

  it('嵌套在 failed[] 里的每条 error 都兜住（subagent:reload 的真实形状）', async () => {
    const { crossed } = viaBoundary('subagent:reload', async () => ({
      success: false,
      reloaded: ['/a/b.md'],
      failed: [
        { filePath: '/home/u/.tdsf/agent/x.md', error: `解析失败 token=${FAKE_KEY}` },
        { filePath: '/home/u/.tdsf/agent/y.md', error: '文件不存在' },
      ],
    }))
    const out = (await crossed()) as { failed: Array<{ filePath: string; error: string }> }
    expect(out.failed[0].error).not.toContain('TESTONLYabcdefghij0123456789')
    // 兄弟条目没有凭据形状，就该原样留着
    expect(out.failed[1].error).toBe('文件不存在')
    expect(out.failed[0].filePath).toBe('/home/u/.tdsf/agent/x.md')
  })

  it('未登记为诊断字段的键，只要带出密钥形状也照样涂，并在日志里点名', async () => {
    logged.length = 0
    const { crossed } = viaBoundary('tutorial:crawlStart', async () => ({
      success: false,
      detail: `上游回了 api_key=${FAKE_KEY}`,
      error: '抓取失败',
    }))
    const out = (await crossed()) as { detail: string; error: string }
    expect(out.detail).not.toContain('TESTONLYabcdefghij0123456789')
    expect(out.error).toBe('抓取失败')
    const warn = logged.find((l) => l.level === 'warn' && l.category === 'IPC')
    expect(warn?.message).toContain('已在边界兜掉 1 处')
    expect(JSON.stringify(warn?.meta)).toContain('.detail(未登记为诊断字段)')
  })

  it('异步 resolve 才拿到的信封也覆盖（真 handler 全是 async）', async () => {
    const { crossed } = viaBoundary('llm:test', () =>
      Promise.resolve({ ok: false, latency: 12, error: RAW_INTERNAL })
    )
    const out = (await crossed()) as { error: string; latency: number }
    expect(out.error).not.toContain('TESTONLYabcdefghij0123456789')
    expect(out.latency).toBe(12)
  })

  it('reject 路径不受影响：仍然折进信封并带 [E_INTERNAL]', async () => {
    const { crossed } = viaBoundary('llm:chat', async () => {
      throw new Error(RAW_INTERNAL)
    })
    await expect(crossed()).rejects.toThrow(/\[E_INTERNAL\]$/)
  })
})

describe('反向对照与范围：这道闸不是把返回体乱改一通', () => {
  it('没有凭据形状的诊断文本一字不改，且返回同一个引用（零复制）', async () => {
    const payload = {
      success: false,
      error: 'session_api_key 未找到：沙箱可能已过期或主进程已重启，请重新调用 sandbox:create',
      code: 'SESSION_KEY_MISSING',
      sessionId: 'sess_1',
    }
    const { crossed } = viaBoundary('sandbox:execute', async () => payload)
    const out = await crossed()
    expect(out).toBe(payload)
  })

  it('success:true 的业务数据不涂：文件正文里的 password 是用户自己要看的内容', async () => {
    const { crossed } = viaBoundary('fs:readFile', async () => ({
      success: true,
      content: `db_password=${FAKE_PASSWORD}\n`,
    }))
    const out = (await crossed()) as { content: string }
    expect(out.content).toBe(`db_password=${FAKE_PASSWORD}\n`)
  })

  it('非失败信封（数组 / null / 字符串 / undefined）原样返回', async () => {
    for (const value of [['a'], null, 'plain', undefined, 0]) {
      const { crossed } = viaBoundary(`sys:${typeof value}:${String(value)}`, async () => value)
      expect(await crossed()).toBe(value)
    }
  })

  it('信封里的 Date 等非普通对象保持原引用（不用 Object.entries 复制它们）', () => {
    const at = new Date(0)
    const out = guardDataError({ success: false, error: `失败 api_key=${FAKE_KEY}`, at }, 'x:y') as {
      at: Date
      error: string
    }
    expect(out.at).toBe(at)
    expect(out.error).not.toContain('TESTONLYabcdefghij0123456789')
  })

  it('写时复制：原对象（服务内部状态）不被就地涂改', async () => {
    // 模拟"信封直接引用服务内部数组"那种返回（抓取一族已随 #211 整删，形状照旧判）
    const history = [{ id: 't1', error: `抓取失败 api_key=${FAKE_KEY}` }]
    const before = JSON.parse(JSON.stringify(history))
    const { crossed } = viaBoundary('tutorial:list', async () => ({
      success: false,
      error: RAW_INTERNAL,
      results: history,
    }))
    const out = (await crossed()) as { results: typeof history }
    expect(out.results[0].error).not.toContain('TESTONLYabcdefghij0123456789')
    // 服务内部那份一个字都没动
    expect(JSON.parse(JSON.stringify(history))).toEqual(before)
  })
})
