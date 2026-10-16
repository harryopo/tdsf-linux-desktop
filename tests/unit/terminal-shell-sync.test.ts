// @vitest-environment jsdom
/**
 * syncShells —— 终端标签与主进程对账（W2：界面那份只是投影）
 *
 * 钉三件会坏的事：
 *   1. 主进程还开着的终端必须在界面上出现（页面重载后、别的窗口开的，都靠这条捞回来）；
 *   2. 主进程已经关掉的必须消失（留着就是点不动的死标签）；
 *   3. 对账不许抢焦点：后台会话补出一个标签，不能把人从正在看的终端上拽走。
 * 顺带钉标题口径：补出来的标签用服务器名，不是 sessionId。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { syncShells } from '@/terminal/shell-launcher'
import { useTerminalStore } from '@/stores/terminal-store'
import { useServerStore } from '@/stores/server-store'

/** 假的 sshShellList：按会话返回主进程那张表 */
function setApi(listBySession: Record<string, string[] | 'throw'>): void {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    sshShellList: async (sessionId: string) => {
      const r = listBySession[sessionId]
      if (r === 'throw') throw new Error('会话不存在')
      if (!r) throw new Error(`未预期的会话 ${sessionId}`)
      return r
    },
  }
}

function shellIds(): string[] {
  return useTerminalStore.getState().shells.map((s) => s.shellId)
}

beforeEach(() => {
  useTerminalStore.setState({ shells: [], activeShellId: null, pendingCommand: null, commandBlocks: null })
  useServerStore.setState({
    servers: [{ id: 'srv1', name: 'web-03', host: '10.0.0.1' }] as never,
    sessionMap: { srv1: 's1' },
    activeSessionId: 's1',
  })
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('syncShells', () => {
  it('主进程多出来的补进界面、已经不认的摘掉，标题用服务器名', async () => {
    setApi({ s1: ['a', 'b'] })
    useTerminalStore.getState().addShell({ kind: 'ssh', shellId: 'stale', sessionId: 's1', title: 'web-03', openedAt: 1 })
    useTerminalStore.getState().setActiveShell('stale')

    await syncShells()

    expect(shellIds()).toEqual(['a', 'b'])
    const added = useTerminalStore.getState().shells.find((s) => s.shellId === 'b')
    expect(added?.title).toBe('web-03')
    // 活跃的那个刚被主进程关掉，指针必须落到还活着的终端上
    expect(useTerminalStore.getState().activeShellId).not.toBe('stale')
    expect(shellIds()).toContain(useTerminalStore.getState().activeShellId)
  })

  it('别的会话的标签原样留着；只有一条会话问不到时不影响另一条', async () => {
    useServerStore.setState({
      servers: [
        { id: 'srv1', name: 'web-03', host: '10.0.0.1' },
        { id: 'srv2', name: 'db-01', host: '10.0.0.2' },
      ] as never,
      sessionMap: { srv1: 's1', srv2: 's2' },
      activeSessionId: 's1',
    })
    setApi({ s1: 'throw', s2: ['keep'] })
    useTerminalStore.getState().addShell({ kind: 'ssh', shellId: 'keep', sessionId: 's2', title: 'db-01', openedAt: 1 })
    useTerminalStore.getState().addShell({ kind: 'ssh', shellId: 'gone', sessionId: 's1', title: 'web-03', openedAt: 2 })
    useTerminalStore.getState().setActiveShell('keep')

    await syncShells()

    // s1 问不到（已断开）：它的标签由断开路径的 dropSession 负责，这里不猜
    expect(shellIds()).toContain('gone')
    expect(shellIds()).toContain('keep')
    expect(useTerminalStore.getState().activeShellId, '对账没动那个终端，指针不许被抢走').toBe('keep')
  })

  it('空表开始也能建出标签，并把活跃指针立起来（重载后的恢复路径）', async () => {
    setApi({ s1: ['only'] })
    expect(useTerminalStore.getState().activeShellId).toBeNull()

    await syncShells()

    expect(shellIds()).toEqual(['only'])
    expect(useTerminalStore.getState().activeShellId).toBe('only')
  })

  it('没有 electronAPI（浏览器/单测环境）时安静跳过，不抛', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
    await expect(syncShells()).resolves.toBeUndefined()
  })

  it('并发对账：先出发的那份快照晚回来，不许把刚开出来的终端摘掉（#105）', async () => {
    // 两次询问之间主进程多开了一条通道（用户在标签条点了 "+"）
    const snapshots: string[][] = [['a'], ['a', 'b']]
    const deferred: Array<{ resolve: (v: string[]) => void }> = []
    let call = 0
    ;(window as unknown as { electronAPI: unknown }).electronAPI = {
      sshShellList: () => {
        call += 1
        return new Promise<string[]>((resolve) => deferred.push({ resolve }))
      },
    }

    // 第一轮出发，此刻主进程那边只有 a
    const firstSync = syncShells()
    // 这期间界面把刚开出来的 b 记上了
    useTerminalStore
      .getState()
      .addShell({ kind: 'ssh', shellId: 'b', sessionId: 's1', title: 'web-03', openedAt: 2 })
    // 第二轮出发（终端总线收到不认识的 shellId 也会来对账），问到的表里有 b
    const secondSync = syncShells()
    expect(call, '两轮对账各问了主进程一次').toBe(2)

    // 晚出发的先回来 —— IPC 不保证响应顺序
    deferred[1].resolve(snapshots[1])
    await secondSync
    expect(shellIds()).toEqual(expect.arrayContaining(['a', 'b']))

    // 早出发的后回来：它问的是过去那一秒的表，拿它删人就是"标签凭空消失、通道还活着"
    deferred[0].resolve(snapshots[0])
    await firstSync
    expect(shellIds(), '过期快照把刚开出来的终端摘掉了').toContain('b')
  })
})
