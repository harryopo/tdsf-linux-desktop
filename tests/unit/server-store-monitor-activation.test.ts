/**
 * "会话被激活 = 这台主机的监控开始采集"（2026-10-12 真机反馈：进程监控失败 / 首页永远离线）
 *
 * 原来这件事写在两处连接收尾里，而两处不一样：
 *   - 工作台标题栏那份传 `monitorStart(sessionId, 3)`，可 v2.4 起这个参数单位是毫秒，
 *     3 被主进程下限夹成 1000（本意 3 秒），间隔口径悄悄漂；
 *   - 设置页那份（SshSettings.openSession）压根没有这一句 —— 于是从设置页连上的机器
 *     不采集，首页状态格与进程表就一直空着，用户看到的正是"监控失败"。
 * 现在收进 server-store.setActiveSession 一处：任何路径让会话成为当前会话，采集就跟着起来。
 *
 * 这里断言的是行为（调用发生、参数正确），不是源码字符串。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useServerStore, MONITOR_INTERVAL_MS } from '@renderer/stores/server-store'

/** 记录主进程收到的启动请求；返回 Promise 以贴近真实 IPC */
function installFakeApi(sink: Array<[string, number]>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        monitorStart: (sessionId: string, interval: number) => {
          sink.push([sessionId, interval])
          return Promise.resolve(true)
        },
      },
    },
  })
}

describe('会话激活时拉起监控采集', () => {
  let calls: Array<[string, number]>

  beforeEach(() => {
    calls = []
    installFakeApi(calls)
    useServerStore.setState({ activeSessionId: null })
  })

  it('正样本：激活会话就按统一间隔启动这个会话的采集', async () => {
    useServerStore.getState().setActiveSession('sess-a')
    await Promise.resolve()
    expect(calls, '激活后必须真的发出一次 monitorStart，否则首页与进程表永远无数据').toEqual([
      ['sess-a', MONITOR_INTERVAL_MS],
    ])
  })

  it('换会话就换采集目标（间隔仍是同一个口径）', async () => {
    useServerStore.getState().setActiveSession('sess-a')
    useServerStore.getState().setActiveSession('sess-b')
    await Promise.resolve()
    expect(calls).toEqual([
      ['sess-a', MONITOR_INTERVAL_MS],
      ['sess-b', MONITOR_INTERVAL_MS],
    ])
  })

  it('置空（断开当前会话）不发采集请求', async () => {
    useServerStore.getState().setActiveSession('sess-a')
    calls.length = 0
    useServerStore.getState().setActiveSession(null)
    await Promise.resolve()
    expect(calls, '没有会话时不该向主进程要采集').toEqual([])
    expect(useServerStore.getState().activeSessionId).toBeNull()
  })

  it('electronAPI 不在（纯浏览器/单测环境）时激活不炸', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    expect(() => useServerStore.getState().setActiveSession('sess-c')).not.toThrow()
    expect(useServerStore.getState().activeSessionId).toBe('sess-c')
  })

  it('采集起不来（主进程报错）不打断激活流程', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electronAPI: {
          monitorStart: () => Promise.reject(new Error('Channel open failure')),
        },
      },
    })
    expect(() => useServerStore.getState().setActiveSession('sess-d')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(useServerStore.getState().activeSessionId).toBe('sess-d')
  })
})
