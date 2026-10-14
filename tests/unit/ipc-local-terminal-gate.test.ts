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

// handler 的表余参数写成 never[] 会让"带参调用"永远过不了类型检查，
// 于是 call() 只能把每个实参 as never。表本身就该收 unknown[]（IPC 的入参在边界上都是 unknown）。
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: () => require('node:os').tmpdir(), getName: () => 'tdsf-test', on: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
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
      // 形参按 local-pty.ts:223 的真实签名给：写成无参的话，用例里
      // spyOn(manager, 'onShellData').mockImplementation((_shellId, cb) => ...) 对不上，
      // 而"产品到底拿什么参数订阅输出"这件事就没人管了。
      onShellData: (_shellId: string, _cb: (data: string) => void) => () => {},
      onShellExit: (_shellId: string, _cb: (code: number) => void) => () => {},
      closeAll: () => {},
    },
  }
})

vi.mock('@main/services/terminal/local-pty', () => ({
  localPtyManager: manager,
  pickLocalShell: () => '/bin/bash',
}))

/**
 * 输出通道替身：拦截提示必须走这里（渲染到屏幕），不能走 PTY stdin（会被 shell 执行）
 */
const broadcasts = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }))

vi.mock('@main/windows/main-window', () => ({
  broadcastToWindows: (channel: string, ...args: unknown[]) => {
    broadcasts.calls.push([channel, args])
  },
}))

import { LOCAL_TTY, TERMINAL } from '@shared/ipc-channels'
import { registerLocalTerminalHandlers } from '@main/ipc/local-terminal'

/** 一个"活着但什么都不做"的窗口替身 */
// 已经用不上了：registerLocalTerminalHandlers() 从 W4 多窗口那轮起不再收窗口，
// 输出改走 broadcastToWindows（本文件第 63 行替身的那条路）。
function call<T = unknown>(channel: string, ...args: unknown[]): T {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`通道没注册：${channel}`)
  return fn({}, ...args) as T
}

beforeEach(() => {
  handlers.clear()
  writes.length = 0
  broadcasts.calls.length = 0
  registerLocalTerminalHandlers()
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

/**
 * P0-2：用户自己敲/粘贴的路径也要过闸。
 *
 * 判据重点是"拒了且原文一个字节都没进 PTY"——把危险命令写进去再报错等于已经执行。
 * 拦截提示是**唯一**允许写出去的内容，所以断言里明确它是什么。
 */
describe('local-tty:write — 逐键写入的行缓冲闸', () => {
  /** 键入安全命令：逐字符放行，回车时也放行 */
  it('ls -la 回车：原样转发，返回 true', () => {
    call(LOCAL_TTY.START)
    expect(call(LOCAL_TTY.WRITE, 'pty-1', 'ls -la')).toBe(true)
    expect(call(LOCAL_TTY.WRITE, 'pty-1', '\r')).toBe(true)
    expect(writes.map((w) => w[1])).toEqual(['ls -la', '\r'])
  })

  it('rm -rf / 回车：返回 false，stdin 只收到丢行指令，提示走输出通道', () => {
    call(LOCAL_TTY.START)
    expect(call(LOCAL_TTY.WRITE, 'pty-1', 'rm -rf /')).toBe(true)
    writes.length = 0
    broadcasts.calls.length = 0
    expect(call(LOCAL_TTY.WRITE, 'pty-1', '\r')).toBe(false)
    // stdin 侧：只许有 Ctrl-C（弃掉 shell 行缓冲里这条命令），不许有命令原文
    expect(writes.map((w) => w[1])).toEqual(['\x03'])
    // 输出侧：提示必须渲染到屏幕，否则用户只看到按了没反应
    const notice = broadcasts.calls
      .filter((c) => c[0] === TERMINAL.DATA)
      .map((c) => (c[1] as unknown[])[1])
      .join('')
    expect(notice).toContain('已拦截高危命令')
    expect(notice).toContain('递归强制删除')
  })

  it('按了回车被拦之后，再按一次不会把这条命令补出去执行', () => {
    call(LOCAL_TTY.START)
    call(LOCAL_TTY.WRITE, 'pty-1', 'rm -rf /')
    expect(call(LOCAL_TTY.WRITE, 'pty-1', '\r')).toBe(false)
    writes.length = 0
    // 第二次回车时 shell 的行缓冲已被 Ctrl-U 清空，这里放行是安全的
    expect(call(LOCAL_TTY.WRITE, 'pty-1', '\r')).toBe(true)
    expect(writes.map((w) => w[1])).toEqual(['\r'])
  })

  it('粘贴多行里有一行危险：整段拦掉，安全行也不转发', () => {
    call(LOCAL_TTY.START)
    writes.length = 0
    expect(call(LOCAL_TTY.WRITE, 'pty-1', 'ls -la\nrm -rf /\n')).toBe(false)
    expect(writes.map((w) => w[1]).join('')).not.toContain('ls -la')
  })

  it('vim 里打字不误拦：输出侧进了备用屏后暂停判定', () => {
    let pushData: ((data: string) => void) | undefined
    const offSpy = vi
      .spyOn(manager, 'onShellData')
      .mockImplementation((_shellId: string, cb: (data: string) => void) => {
        pushData = cb
        return () => {}
      })
    call(LOCAL_TTY.START)
    expect(pushData, 'start 必须挂上输出回调').toBeTruthy()
    pushData?.('\x1b[?1049h')
    writes.length = 0
    // 备用屏期间这一行要原样进 PTY —— 拦下来会把提示写进用户的文件内容
    expect(call(LOCAL_TTY.WRITE, 'pty-1', 'rm -rf /\r')).toBe(true)
    expect(writes.map((w) => w[1])).toEqual(['rm -rf /\r'])
    // vim 退出后恢复判定
    pushData?.('\x1b[?1049l')
    expect(call(LOCAL_TTY.WRITE, 'pty-1', 'rm -rf /\r')).toBe(false)
    offSpy.mockRestore()
  })

  it('run-authored 清了行，行缓冲也要跟着清（否则半截键入会和代写命令拼一行）', () => {
    call(LOCAL_TTY.START)
    expect(call(LOCAL_TTY.WRITE, 'pty-1', 'echo rm -rf /')).toBe(true)
    call(LOCAL_TTY.RUN_AUTHORED, 'pty-1', 'uptime')
    writes.length = 0
    // 缓冲已随 Ctrl+U 清掉，这里回车没有内容，应当放行
    expect(call(LOCAL_TTY.WRITE, 'pty-1', '\r')).toBe(true)
  })
})
