/**
 * 「已保存凭据」这件事，界面只许报主进程的真实状态（#239）
 *
 * 两个来源会让 hasCredential 说谎：
 * 1) 主进程按 id 换机时会作废旧凭据（#237），渲染层却沿用保存前的 true，
 *    连接框继续显示"已保存（留空则不修改）"，实际连接时根本没有口令可用；
 * 2) 加密存储写失败（safeStorage 不可用）时同步返回 false，但渲染层已经把
 *    "这次带了新口令"算进 hasCredential，界面上同样显示已保存。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

import { useServerStore } from '@renderer/stores/server-store'

const box = {
  saveOk: true,
  mainList: [] as Array<Record<string, unknown>>,
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
        serverSave: async () => box.saveOk,
        serverDeleteCred: async () => true,
        serverList: async () => box.mainList,
      },
    },
  })
}

function seed(hasCredential: boolean): void {
  useServerStore.setState({
    servers: [
      {
        id: 'srv-1',
        name: '测试机',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password' as const,
        hasCredential,
      },
    ],
    connectionStates: {},
    sessionMap: {},
    _hydrated: true,
  })
}

beforeEach(() => {
  box.saveOk = true
  box.mainList = []
  installApi()
})

describe('hasCredential 只报主进程的真实状态', () => {
  it('换机保存成功后，以主进程回传的 hasCredential 为准（旧凭据已被作废）', async () => {
    seed(true)
    box.mainList = [
      {
        id: 'srv-1',
        name: '测试机',
        host: 'evil.example.com',
        port: 22,
        username: 'root',
        authType: 'password',
        hasCredential: false,
      },
    ]
    await useServerStore.getState().updateServer('srv-1', { host: 'evil.example.com' })
    const s = useServerStore.getState().servers[0]
    expect(s.host).toBe('evil.example.com')
    expect(s.hasCredential, '主进程已经没有这台机的凭据，界面不许再说"已保存"').toBe(false)
  })

  it('保存失败时，这次新填的口令不能算成已保存', async () => {
    seed(false)
    box.saveOk = false
    await useServerStore
      .getState()
      .updateServer('srv-1', { password: ['N3w', 'Pass'].join('') } as never)
    expect(useServerStore.getState().servers[0].hasCredential).toBe(false)
  })

  it('新增服务器保存失败时，同样不许宣称已存好凭据', async () => {
    box.saveOk = false
    await useServerStore.getState().addServer({
      id: 'srv-2',
      name: '新机器',
      host: '10.0.0.9',
      port: 22,
      username: 'root',
      authType: 'password',
      password: ['N3w', 'Pass'].join(''),
    } as never)
    const added = useServerStore.getState().servers.find((s) => s.id === 'srv-2')
    expect(added?.hasCredential).toBe(false)
  })
})
