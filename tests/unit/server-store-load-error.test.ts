/**
 * 服务器列表读失败，不许演成"你没有服务器"（#260）
 *
 * 实测（真窗口 + 坏 config.json）：`sshServers` 被写成字符串时，主进程按设计抛错
 * （防止空列表反写覆盖），渲染层只在 console 里记一行，界面照常显示「暂无服务器」
 * 和「点击添加开始配置」——把一次读失败说成了用户的事实。
 *
 * 这里钉住 store 那一层：失败要留下原因、且不许把自己认账成"已加载"。
 * 界面上的那句话由 tests/e2e/config-shape-error.spec.ts 在真窗口里验。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

import { useServerStore } from '@renderer/stores/server-store'

const box = {
  /** 下一次 serverList 是抛错还是回空 */
  fail: true,
  reason: '读取服务器列表失败：配置文件里的服务器列表不是数组',
}

function installApi(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      electronAPI: {
        serverList: async () => {
          if (box.fail) throw new Error(box.reason)
          return []
        },
      },
    },
  })
}

beforeEach(() => {
  installApi()
  box.fail = true
  useServerStore.setState({ servers: [], loadError: null, _hydrated: false })
})

describe('服务器列表读取失败', () => {
  it('留下原因，且不把自己认账成"已加载"', async () => {
    await useServerStore.getState().hydrateFromMain()

    const s = useServerStore.getState()
    expect(s.loadError, '没有留下原因，界面就只能显示"暂无服务器"').toContain('不是数组')
    expect(s._hydrated, '失败被认账成已加载后，守卫再也不放行重读').toBe(false)
  })

  it('重读成功就把错误清掉（否则修好配置还得重启应用）', async () => {
    await useServerStore.getState().hydrateFromMain()
    expect(useServerStore.getState().loadError).not.toBeNull()

    box.fail = false
    await useServerStore.getState().hydrateFromMain(true)

    const s = useServerStore.getState()
    expect(s.loadError).toBeNull()
    expect(s._hydrated).toBe(true)
  })
})
