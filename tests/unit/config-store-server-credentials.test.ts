/**
 * tests/unit/config-store-server-credentials.test.ts — 口令没存进去就不许说"保存成功"
 *
 * 为什么钉这一条：saveServerList 先把非敏感列表写进 electron-store，再逐台把
 * password/privateKey/passphrase 交给 SecureStore 加密存储，但**不接它的返回值**，
 * 最后无条件 return true。safeStorage 不可用时（Windows 凭据管理器被关、
 * Linux 没有 libsecret）每一台都存失败，界面照样提示"已保存"，
 * 用户下次连接被要求重输口令，还以为是应用忘了。
 *
 * 判据引擎：electron-store 用内存 Map 顶掉，SecureStore 的返回值可切换，
 * 观察"列表已经落库但口令没落库"这一真实中间态下函数到底回什么。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const box = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  /** 下一次 saveServerCredential 返回什么 */
  credentialOk: true,
  savedIds: [] as string[],
}))

vi.mock('electron-store', () => ({
  default: class {
    get(key: string, fallback?: unknown) {
      return box.store.has(key) ? box.store.get(key) : (fallback ?? undefined)
    }
    set(key: string, value: unknown) {
      box.store.set(key, value)
    }
    delete(key: string) {
      box.store.delete(key)
    }
  },
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/tdsf-config-store-test', isReady: () => true },
  safeStorage: { isEncryptionAvailable: () => true },
}))

vi.mock('../../src/main/services/storage/secure-store', () => ({
  SecureStore: {
    isEncryptionAvailable: () => true,
    saveServerCredential: (id: string) => {
      box.savedIds.push(id)
      return box.credentialOk
    },
    loadServerCredential: () => null,
    deleteServerCredential: () => true,
    listServerCredentialIds: () => [],
  },
}))

import { ConfigStore } from '../../src/main/services/storage/config-store'

function server(id: string, overrides: Record<string, unknown> = {}): never {
  return {
    id,
    name: id,
    host: '10.0.0.1',
    port: 22,
    username: 'tester',
    authType: 'password',
    password: ['Sup3r', 'Value'].join(''),
    ...overrides,
  } as never
}

describe('saveServerList 的成败口径', () => {
  beforeEach(() => {
    box.store.clear()
    box.credentialOk = true
    box.savedIds = []
  })

  it('1. 加密存储可用 → 回 true，且每台口令都试着存了', () => {
    const ok = ConfigStore.saveServerList([server('srv-a'), server('srv-b')] as never)
    expect(ok).toBe(true)
    expect(box.savedIds.sort()).toEqual(['srv-a', 'srv-b'])
  })

  it('2. 加密存储全失败 → 回 false（老代码这里回 true，界面报"已保存"）', () => {
    box.credentialOk = false
    const ok = ConfigStore.saveServerList([server('srv-c')] as never)
    expect(ok, '口令一条都没存进去，不能报成功').toBe(false)
  })

  it('3. 正对照：没有口令的服务器（只用私钥路径）不碰加密存储，照常 true', () => {
    const ok = ConfigStore.saveServerList([
      server('srv-d', { password: undefined, privateKeyPath: '/keys/id_ed25519' }),
    ] as never)
    expect(ok).toBe(true)
    expect(box.savedIds).toEqual([])
  })

  it('4. 列表本身仍然落库（回 false 不该把用户填的主机信息一起丢掉）', () => {
    box.credentialOk = false
    ConfigStore.saveServerList([server('srv-e')] as never)
    const stored = box.store.get('sshServers') as Array<Record<string, unknown>>
    expect(stored.map((s) => s.id)).toEqual(['srv-e'])
    expect(stored[0].password, '明文口令不该出现在 electron-store 那份里').toBeUndefined()
  })
})
