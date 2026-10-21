/**
 * 服务器增删改的写失败要可见（2026-10-21 全维度审查 C3）
 *
 * removeServer / updateServer 以前丢弃 syncToMain 的返回值：主进程没写成，
 * 界面已经按"删掉了/改好了"渲染，重启后旧配置又回来。
 * 这里用假 API 让 serverSave 回 false，断言会提示用户。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

import { toast } from 'sonner'
import { useServerStore } from '@renderer/stores/server-store'

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
        serverSave: async () => false,
        serverDeleteCred: async () => true,
        serverList: async () => [],
      },
    },
  })
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
  installApi()
  useServerStore.setState({
    servers: [
      {
        id: 'srv-1',
        name: '测试机',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password' as const,
        hasCredential: false,
      },
    ],
    connectionStates: {},
    sessionMap: {},
  })
})

describe('服务器写入失败要提示', () => {
  it('removeServer 同步失败 → toast.error', async () => {
    await useServerStore.getState().removeServer('srv-1')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('删除未保存'))
  })

  it('updateServer 同步失败 → toast.error', async () => {
    await useServerStore.getState().updateServer('srv-1', { name: '改名' })
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('修改未保存'))
  })
})
