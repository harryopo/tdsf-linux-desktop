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
    useTerminalStore.getState().addShell({ shellId: 'stale', sessionId: 's1', title: 'web-03', openedAt: 1 })
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
    useTerminalStore.getState().addShell({ shellId: 'keep', sessionId: 's2', title: 'db-01', openedAt: 1 })
    useTerminalStore.getState().addShell({ shellId: 'gone', sessionId: 's1', title: 'web-03', openedAt: 2 })
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
})
