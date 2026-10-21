/**
 * 断线推送必须有消费者（2026-10-21 全维度审查 E1）
 *
 * 主进程广播 ssh:state-changed、preload 也暴露了 onSshStateChanged，
 * 但渲染层 0 订阅 ⇒ 远端断链后状态栏仍写「SSH已连接」。
 * 这里钉住：事件到达后连接状态变成 error/connecting，且重复 init 只订阅一次。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SshStateEvent } from '@shared/models'

let handler: ((event: SshStateEvent) => void) | null = null
let registrations = 0

beforeEach(() => {
  handler = null
  registrations = 0
  // server-store 用 zustand persist；node 环境没有 localStorage，补一个最小替身
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      electronAPI: {
        onSshStateChanged: (cb: (event: SshStateEvent) => void) => {
          registrations += 1
          handler = cb
          return () => undefined
        },
      },
    },
  })
})

describe('initSshStateSubscription', () => {
  it('断开事件把该服务器状态置 error，重连中置 connecting', async () => {
    vi.resetModules()
    const { useServerStore } = await import('@renderer/stores/server-store')
    const { initSshStateSubscription } = await import('@renderer/stores/ssh-state-subscription')
    useServerStore.setState({ connectionStates: { srv1: 'connected' } })

    initSshStateSubscription()
    const emit = handler as ((event: SshStateEvent) => void) | null
    expect(emit).toBeTruthy()

    emit!({ sessionId: 's1', serverId: 'srv1', state: 'reconnecting', reason: 'x', attemptCount: 0 })
    expect(useServerStore.getState().connectionStates.srv1).toBe('connecting')

    emit!({ sessionId: 's1', serverId: 'srv1', state: 'disconnected', reason: 'x', attemptCount: 3 })
    expect(useServerStore.getState().connectionStates.srv1).toBe('error')
  })

  it('重复 init 只订阅一次（幂等）', async () => {
    vi.resetModules()
    const { initSshStateSubscription } = await import('@renderer/stores/ssh-state-subscription')
    initSshStateSubscription()
    initSshStateSubscription()
    expect(registrations).toBe(1)
  })
})
