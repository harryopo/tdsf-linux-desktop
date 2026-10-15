/**
 * 服务器列表读失败不等于"已经加载过"（2026-10-15 全维度审查 B 族）
 *
 * 病根：hydrateFromMain 的 catch 分支也置 `_hydrated = true`。这个布尔量是水合守卫，
 * 一旦为 true 就再也不重读——于是一次瞬时失败（主进程忙、库正在降级）被永久认账，
 * 界面上的空列表从此看着就是事实，用户以为服务器没了，只能重启应用。
 *
 * 三条判据互相咬合：
 *   1. 读失败 ⇒ 不置守卫，并且下一次调用真的会再读一次（这是修的）
 *   2. 正向对照：读成功 ⇒ 置守卫，重复调用被跳过（防止改成"每次都重读"蒙过 1）
 *   3. 主进程真的回空数组（不是失败）⇒ 照常置守卫，别把空当成失败反复重试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useServerStore } from '@renderer/stores/server-store'

let listCalls = 0

function installApi(list: () => Promise<unknown[]>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        serverList: () => {
          listCalls += 1
          return list()
        },
        serverSaveAll: async () => true,
      },
    },
  })
}

beforeEach(() => {
  listCalls = 0
  useServerStore.setState({ servers: [], _hydrated: false })
})

describe('服务器列表水合守卫', () => {
  it('读失败不许认账：守卫保持未水合，下次调用真的重读', async () => {
    installApi(() => Promise.reject(new Error('主进程忙')))
    await useServerStore.getState().hydrateFromMain()
    expect(useServerStore.getState()._hydrated, '失败也被标记成已加载＝这次失败永久认账').toBe(false)

    // 换成能读通，下一次挂载点（App / SSH 设置页）应当真的再问一次
    installApi(() => Promise.resolve([{ id: 'a', name: 'srv', host: '10.0.0.1', port: 22, username: 'root' }]))
    await useServerStore.getState().hydrateFromMain()
    expect(listCalls, '守卫没放开就不会有第二次读').toBe(2)
    expect(useServerStore.getState().servers).toHaveLength(1)
    expect(useServerStore.getState()._hydrated).toBe(true)
  })

  it('正向对照：读成功就置守卫，重复调用不再打主进程', async () => {
    installApi(() => Promise.resolve([]))
    await useServerStore.getState().hydrateFromMain()
    await useServerStore.getState().hydrateFromMain()
    expect(listCalls, '成功后还反复重读＝把守卫改没了').toBe(1)
    expect(useServerStore.getState()._hydrated).toBe(true)
  })

  it('主进程回空数组（真的没有服务器）与读失败是两回事', async () => {
    installApi(() => Promise.resolve([]))
    await useServerStore.getState().hydrateFromMain()
    expect(useServerStore.getState()._hydrated, '空列表是权威答案，必须认账').toBe(true)
  })
})
