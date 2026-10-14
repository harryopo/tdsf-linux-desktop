/**
 * 主进程崩溃兜底判据（P0-3）
 *
 * 承诺级判据是"用户什么都不丢"那一条：**注入异常之后进程不许被关掉**。
 * 所以这里 spy 的是真 process.exit，而不是模块里的某个函数——
 * 将来谁在兜底里加一句 process.exit(1)，这条就会红。
 *
 * 另外三条是这个兜底自己的规矩：只弹一次、Promise 拒绝不弹窗、卸载要摘干净监听。
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showErrorBox: vi.fn() },
}))
vi.mock('../../src/main/services/log/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { installCrashGuard, type CrashGuardHandle } from '@main/core/crash-guard'

/** 用 emit 触发：Node 只有在"没人监听"时才走默认的打印+退出，装了监听就走我们的处理 */
function emitException(err: Error): void {
  process.emit('uncaughtException', err)
}

function emitRejection(reason: unknown): void {
  // Node 的 process.emit 重载按事件名收窄，unknown 的 reason 对不上任何一条签名。
  // 只在签名上 cast，并且用 .call(process, ...) 保住 this——把方法摘出来直接调，
  // EventEmitter 读不到自己的 _events，这条用例会在伪造事件那一步炸掉（实测踩过）。
  const emit = process.emit as (event: string, ...args: unknown[]) => boolean
  emit.call(process, 'unhandledRejection', reason)
}

describe('主进程崩溃兜底', () => {
  let handle: CrashGuardHandle | null = null
  // 类型跟着真签名走：写成 ReturnType<typeof vi.spyOn> 会退化成 unknown 参数，
  // 七个用例里赋进去的 exit spy 全都对不上。
  let exitSpy: MockInstance<typeof process.exit>

  afterEach(() => {
    handle?.dispose()
    handle = null
    exitSpy.mockRestore()
  })

  it('未捕获异常：记日志 + 弹一次框，且绝不退出进程', () => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => process) as never)
    const log = vi.fn()
    const notify = vi.fn()
    handle = installCrashGuard({ log, notify })

    emitException(new Error('boom'))

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toMatchObject({
      source: 'uncaughtException',
      message: 'boom',
    })
    expect((log.mock.calls[0][1] as { stack: string }).stack).toContain('Error: boom')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('内部错误')
    expect(exitSpy, '兜底不许顺手把主进程关掉（关掉=所有会话与缓冲一起丢）').not.toHaveBeenCalled()
  })

  it('弹窗正文里的凭据形状先被涂掉（第三个出口：弹到用户屏幕上）', () => {
    // connection-manager 的超时文案是 `命令执行超时(...): ${command}`，命令原文可以是
    // `mysql -u root pass=...`；日志与 IPC 信封都装了脱敏，弹到桌面上的这一份以前是漏网的。
    // 这里不用 `as never` 骗过 process.exit 的返回类型：让替身真的抛，
    // 万一有代码真去调退出，测试会指着这条消息说话，而不是静默把 runner 干掉。
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('测试里不许真的退出主进程')
    })
    const log = vi.fn()
    const notify = vi.fn()
    handle = installCrashGuard({ log, notify })

    const secret = 'mysql -u root ' + 'pass' + 'word=Sup3rS' + 'ecretValue'
    emitException(new Error(`命令执行超时(30000ms): ${secret}`))

    expect(notify).toHaveBeenCalledTimes(1)
    const detail = String(notify.mock.calls[0][1])
    expect(detail, '原串进了弹窗就等于进了截图/客服工单/任何人的眼睛').not.toContain(secret)
    expect(detail).toMatch(/\[REDACTED/)
    expect(detail, '除凭据外的诊断信息必须留着，否则弹窗说了等于没说').toContain('命令执行超时(30000ms)')
  })

  it('连环异常只弹一次框，但每一条都记下来', () => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => process) as never)
    const log = vi.fn()
    const notify = vi.fn()
    handle = installCrashGuard({ log, notify })

    emitException(new Error('第一次'))
    emitException(new Error('第二次'))
    emitException(new Error('第三次'))

    expect(notify).toHaveBeenCalledTimes(1)
    expect(handle.dialogsShown()).toBe(1)
    expect(log).toHaveBeenCalledTimes(3)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('Promise 拒绝：只记日志，不弹窗（后台任务坏了不该拦住用户）', () => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => process) as never)
    const log = vi.fn()
    const notify = vi.fn()
    handle = installCrashGuard({ log, notify })

    emitRejection(new Error('后台任务失败'))
    emitRejection('不是 Error 的拒绝值')

    expect(log).toHaveBeenCalledTimes(2)
    expect(notify).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    // 非 Error 的拒绝值也要有可读的 message，不能记成 undefined
    expect((log.mock.calls[1][1] as { message: string }).message).toBe('不是 Error 的拒绝值')
  })

  it('dispose 之后监听摘干净（重复安装不会把日志写两遍）', () => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => process) as never)
    const before = process.listenerCount('uncaughtException')
    const log = vi.fn()
    const h = installCrashGuard({ log, notify: vi.fn() })
    expect(process.listenerCount('uncaughtException')).toBe(before + 1)
    h.dispose()
    expect(process.listenerCount('uncaughtException')).toBe(before)
    // 再装一次、只触发一次：日志必须还是一次（若 dispose 漏摘，这里会变成两次）
    const log2 = vi.fn()
    handle = installCrashGuard({ log: log2, notify: vi.fn() })
    emitException(new Error('再来'))
    expect(log).not.toHaveBeenCalled()
    expect(log2).toHaveBeenCalledTimes(1)
  })

  it('logger 自己坏了也不再抛：兜底不能变成新的崩溃源', () => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => process) as never)
    const notify = vi.fn()
    handle = installCrashGuard({
      log: () => {
        throw new Error('logger 写盘失败')
      },
      notify,
    })
    // 监听器里抛出的异常会被 Node 再当一次 uncaughtException，测试进程都会被带走
    expect(() => emitException(new Error('日志坏了也要让用户知道'))).not.toThrow()
    expect(notify, '日志写不下去时，对话框那一半必须仍然生效').toHaveBeenCalledTimes(1)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('接线：主进程入口真的装上它，而且装在任何异步逻辑之前', async () => {
    // 防线造好 ≠ 防线生效（本次巡检 3 个 P0 都是这一类）。这里查两件事：
    // 装了、并且装在 app.whenReady() 之前——装晚了的话启动阶段的异常仍然没人接。
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs
      .readFileSync(path.resolve(__dirname, '../../src/main/index.ts'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
    const at = src.indexOf('installCrashGuard()')
    expect(at, 'src/main/index.ts 里没有 installCrashGuard() 调用').toBeGreaterThan(-1)
    const ready = src.indexOf('app.whenReady().then(')
    expect(ready, '找不到 app.whenReady().then( 这个调用点（判据形状变了）').toBeGreaterThan(-1)
    expect(at, '兜底必须装在 app.whenReady() 之前').toBeLessThan(ready)
    const initLogger = src.indexOf('initLogger(app.getPath')
    expect(initLogger, '入口里找不到 initLogger 的调用点（判据形状变了）').toBeGreaterThan(-1)
    expect(at, '兜底要装在 initLogger 之后（否则日志那一半还没就绪）').toBeGreaterThan(initLogger)
  })

  it('默认走 logger + dialog（不注入时也接得上真实现）', async () => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => process) as never)
    const { logger } = await import('@main/services/log/logger')
    const { dialog } = await import('electron')
    handle = installCrashGuard()
    emitException(new Error('默认路径'))
    expect(logger.error).toHaveBeenCalledWith('CRASH', expect.any(String), expect.objectContaining({ message: '默认路径' }))
    expect(dialog.showErrorBox).toHaveBeenCalledTimes(1)
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
