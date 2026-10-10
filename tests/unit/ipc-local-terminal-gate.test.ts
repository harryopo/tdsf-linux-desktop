/**
 * 本机终端通道的风险闸判据（W3 的安全面）
 *
 * 用户口径是"本机命令也过闸"：AI 起草 / 决策页重跑的整条命令，
 * 不管投进远端还是本机终端，都必须先过 core/command-gate，block 级直接拒绝，
 * 而且**一个字节都不许写进去**（写进去再报错就等于已经执行了）。
 *
 * 这里测 IPC 处理器本身（不是再抄一遍 command-gate）：
 * 假 mainWindow + 假 manager，断言"拒了且没写"与"放行且只写一次"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: never[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => require('node:os').tmpdir(), getName: () => 'tdsf-test', on: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: never[]) => unknown) => {
      handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => handlers.delete(channel),
    on: () => {},
    removeAllListeners: () => {},
  },
  BrowserWindow: class {},
}))

/**
 * 假 manager：只记录被调了什么，不真开进程
 *
 * vi.mock 的工厂会被提到文件最顶上执行，所以这份替身必须走 vi.hoisted，
 * 否则工厂里引用不到它（实测报 "Cannot access 'manager' before initialization"）。
 */
const { writes, manager } = vi.hoisted(() => {
  const writes: Array<[string, string]> = []
  return {
    writes,
    manager: {
      getStatus: () => ({ available: true, reason: null, shellPath: '/bin/bash' }),
      startShell: () => ({ shellId: 'pty-1' }),
      listShells: () => ['pty-1'],
      isShellOpen: () => true,
      writeShell: (shellId: string, data: string) => void writes.push([shellId, data]),
      resizeShell: () => {},
      closeShell: () => true,
      onShellData: () => () => {},
      onShellExit: () => () => {},
      closeAll: () => {},
    },
  }
})

vi.mock('@main/services/terminal/local-pty', () => ({
  localPtyManager: manager,
  pickLocalShell: () => '/bin/bash',
}))

import { LOCAL_TTY } from '@shared/ipc-channels'
import { registerLocalTerminalHandlers } from '@main/ipc/local-terminal'

/** 一个"活着但什么都不做"的窗口替身 */
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false, send: () => {} },
} as never

function call<T = unknown>(channel: string, ...args: unknown[]): T {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`通道没注册：${channel}`)
  return fn({} as never, ...(args as never[])) as T
}

beforeEach(() => {
  handlers.clear()
  writes.length = 0
  registerLocalTerminalHandlers(fakeWindow)
})

describe('local-tty:run-authored', () => {
  it('高危命令被拒，且一个字节都没写进终端', () => {
    let message = ''
    try {
      call(LOCAL_TTY.RUN_AUTHORED, 'pty-1', 'rm -rf / --no-preserve-root')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message, '必须抛出拦截原因').toContain('高危命令已被拦截')
    expect(writes, '拒绝之后不许已经写进去').toEqual([])
  })

  it('普通命令放行：只写一次，且先清行再补回车', () => {
    expect(call(LOCAL_TTY.RUN_AUTHORED, 'pty-1', 'uptime')).toBe(true)
    expect(writes).toHaveLength(1)
    const [shellId, data] = writes[0]
    expect(shellId).toBe('pty-1')
    // \x15 = Ctrl+U 清掉当前行可能的半截输入；末尾补 \n 才真的执行
    expect(data).toBe('\x15uptime\n')
  })

  it('已经带换行的命令不再补第二个换行（双换行会多跑一次空命令）', () => {
    call(LOCAL_TTY.RUN_AUTHORED, 'pty-1', 'df -h\n')
    expect(writes[0][1]).toBe('\x15df -h\n')
  })

  it('start 会挂上输出转发；close 之后必须退订干净', () => {
    const dispose = vi.fn()
    const offSpy = vi.spyOn(manager, 'onShellData').mockReturnValue(dispose)
    expect(call(LOCAL_TTY.START)).toBe('pty-1')
    expect(offSpy, '开终端就要挂转发').toHaveBeenCalledTimes(1)
    call(LOCAL_TTY.CLOSE, 'pty-1')
    expect(dispose, '关闭必须把转发退订干净（W0 那类叠加缺陷）').toHaveBeenCalledTimes(1)
    offSpy.mockRestore()
  })
})
